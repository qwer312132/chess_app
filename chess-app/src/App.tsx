import { useState, useEffect } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';

type Arrow = [Square, Square, string];
interface EngineLine {
  score: number | string; // 數字分數（如 0.25）或將殺字串（如 "M3"）
  move_san: string | null;
  from: string | null;
  to: string | null;
}

function App() {
  const [game, setGame] = useState(new Chess());
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [currentStats, setCurrentStats] = useState<Record<string, { wins: number, total: number, winRate: number }>>({});
  const [engineLines, setEngineLines] = useState<EngineLine[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showEngine, setShowEngine] = useState(true); // 可隨時開關引擎

  // 監聽 currentFen 呼叫本地 Stockfish 引擎
  useEffect(() => {
    const currentFen = game.fen();
    if (!showEngine) {
      setEngineLines([]);
      setIsAnalyzing(false);
      return;
    }

    const controller = new AbortController();
    setIsAnalyzing(true);

    // 延遲 300ms 再發請求，避免快速連按上/下一步時重複啟動多個引擎
    const timer = setTimeout(() => {
      fetch(
        `http://127.0.0.1:8000/api/engine?fen=${encodeURIComponent(currentFen)}&depth=15&multipv=3`,
        { signal: controller.signal }
      )
        .then(res => res.json())
        .then(data => {
          if (data.analysis) {
            setEngineLines(data.analysis);
          }
          setIsAnalyzing(false);
        })
        .catch(err => {
          if (err.name !== 'AbortError') {
            console.error("獲取 Stockfish 分析失敗:", err);
            setIsAnalyzing(false);
          }
        });
    }, 300);

    // 切換到下一個盤面時，取消還沒跑完的舊請求
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [game.fen(), showEngine]);
  useEffect(() => {
    const currentFen = game.fen();
    
    // 呼叫 API 時帶上 player_color 參數
    fetch(`http://127.0.0.1:8000/api/analysis?fen=${encodeURIComponent(currentFen)}&player_color=${orientation}`)
      .then(res => res.json())
      .then(data => {
        if (!data.stats || data.stats.length === 0) {
            setArrows([]); 
            return;
        }
        
        const moveStats: Record<string, { wins: number, total: number }> = {};
        
        data.stats.forEach((statInfo: any) => {
          const move = statInfo[0];
          const result = statInfo[1];
          const count = statInfo[2];

          if (!moveStats[move]) moveStats[move] = { wins: 0, total: 0 };
          moveStats[move].total += count;
          
          // 勝率計算：現在我們只抓自己的對局，所以只要贏了就算勝利
          // 如果視角是白方，"1-0" 算贏；如果視角是黑方，"0-1" 算贏
          if ((orientation === 'white' && result === "1-0") || (orientation === 'black' && result === "0-1")) {
            moveStats[move].wins += count;
          }
        });

        const newArrows: Arrow[] = [];
        let maxCount = 0;
        Object.keys(moveStats).forEach(move => {
           if (moveStats[move].total > maxCount) {
               maxCount = moveStats[move].total;
           }
        });
        const processedStats: Record<string, { wins: number, total: number, winRate: number }> = {};
        Object.keys(moveStats).forEach(move => {
          const stats = moveStats[move];
          if (stats.total === 0) return;
          
          const winRate = stats.wins / stats.total;
          processedStats[move] = { wins: stats.wins, total: stats.total, winRate: winRate };
          
          let r = 255;
          let g = 255;
          const b = 0; // 藍色通道保持 0，產生紅黃綠漸層

          if (winRate < 0.5) {
              // 0% 到 50%：紅色滿，綠色從 0 升到 255
              // 當 winRate = 0，g = 0
              // 當 winRate = 0.5，g = 255
              g = Math.round(winRate * 2 * 255);
          } else {
              // 50% 到 100%：綠色滿，紅色從 255 降到 0
              // 當 winRate = 0.5，r = 255
              // 當 winRate = 1.0，r = 0
              r = Math.round((1 - winRate) * 2 * 255);
          }
          
          // 計算透明度 Alpha (正規化)
          // 最少給 0.2 的透明度，免得只有下過 1 次的箭頭完全看不見
          // 最多 1.0 完全不透明
          let alpha = 0.2;
          if (maxCount > 0) {
              // 依比例加上 0.8 的彈性空間
              alpha = 0.2 + (stats.total / maxCount) * 0.8;
          }

          // 為了視覺柔和一點，我們不要用純紅純綠，稍微加一點其他色光
          const color = `rgb(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
          
          try {
             const tempGame = new Chess(currentFen); 
             const moveDetails = tempGame.move(move);
             if (moveDetails) {
                 newArrows.push([moveDetails.from as Square, moveDetails.to as Square, color]);
             }
          } catch(e) {}
        });

        setArrows(newArrows);
        setCurrentStats(processedStats); // 把算好的統計數據存進 state
      })
      .catch(err => console.error("獲取勝率失敗:", err));
      
  }, [game.fen(), orientation]); // 將 orientation 加入依賴陣列，切換視角時自動重新拉資料

  function onDrop(sourceSquare: string, targetSquare: string): boolean {
    // 防呆：如果現在是在「復盤模式」看以前的步數，不允許下新棋
    console.log("當前步數索引:", currentMoveIndex, "歷史步數長度:", game.history().length);
    if (currentMoveIndex !== game.history().length-1) {
      alert("請先跳到最新步數才能繼續下棋！");
      return false;
    }
    const gameCopy = new Chess();
    game.history().forEach(move => gameCopy.move(move));
    try {
      const move = gameCopy.move({
        from: sourceSquare,
        to: targetSquare,
        promotion: 'q',
      });
      if (move === null) return false;
      setGame(gameCopy);
      setCurrentMoveIndex(gameCopy.history().length - 1);
      return true;
    } catch (error) {
      return false; 
    }
  }
  
  // 切換視角的函數
  const toggleOrientation = () => {
    setOrientation(prev => prev === 'white' ? 'black' : 'white');
  };
  // ----------------------------------------------------
  // 新增：導航控制功能
  // ----------------------------------------------------
  
  // 計算要顯示在棋盤上的 FEN。
  // 如果在復盤模式，就用 chess.js 去重演到那一步的 FEN；否則就顯示最新盤面。
  const displayFen = () => {
      if (currentMoveIndex === game.history().length - 1) {
          return game.fen();
      }
      // 建立一個暫時的棋盤，重演到指定的歷史步數來獲取 FEN
      const tempGame = new Chess();
      const history = game.history();
      for (let i = 0; i <= currentMoveIndex; i++) {
          tempGame.move(history[i]);
      }
      return tempGame.fen();
  };

  // 跳到最開始
  const goToStart = () => setCurrentMoveIndex(-1);
  
  // 上一步
  const goBack = () => {
      const index = currentMoveIndex === -1 ? -1 : currentMoveIndex - 1;
      if (index >= -1) setCurrentMoveIndex(index);
  };
  
  // 下一步
  const goForward = () => {
      const index = currentMoveIndex;
      if (index < game.history().length) setCurrentMoveIndex(index + 1);
  };
  
  // 跳到最新步數
  const goToEnd = () => setCurrentMoveIndex(game.history().length - 1);

  // 將引擎分數換算成白方評分條的高度百分比 (0% ~ 100%)
  const getWhiteBarPercent = (score: number | string | undefined): number => {
    if (score === undefined) return 50;
    if (typeof score === 'string') {
      // "M3" 代表白方必殺 (100%)，"M-3" 代表黑方必殺 (0%)
      return score.startsWith('M-') ? 0 : 100;
    }
    // 將分數限制在 -10 到 +10 之間，線性對應到 5% ~ 95%
    const clamped = Math.max(-10, Math.min(10, score));
    return 50 + (clamped / 10) * 45;
  };

  const formatScore = (score: number | string | undefined): string => {
    if (score === undefined) return '0.00';
    if (typeof score === 'string') return score;
    return score > 0 ? `+${score.toFixed(2)}` : score.toFixed(2);
  };

  // 取出引擎第一推薦走法，畫成藍色箭頭與原本的歷史勝率箭頭合併
  const topLine = engineLines[0];
  const engineArrow: Arrow[] =
    showEngine && topLine?.from && topLine?.to
      ? [[topLine.from as Square, topLine.to as Square, 'rgba(30, 144, 255, 0.85)']]
      : [];

  const combinedArrows: Arrow[] = [...arrows, ...engineArrow];
  const whitePercent = getWhiteBarPercent(topLine?.score);
  return (
    <div style={{ width: '500px', margin: '50px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>我的西洋棋資料庫</h2>
      
      {/* 增加一個按鈕來切換視角 */}
      <button 
        onClick={toggleOrientation} 
        style={{ marginBottom: '15px', padding: '8px 16px', cursor: 'pointer' }}
      >
        切換為 {orientation === 'white' ? '黑方' : '白方'} 視角
      </button>
      <button
          onClick={() => setShowEngine(prev => !prev)}
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            backgroundColor: showEngine ? '#1e90ff' : '#ddd',
            color: showEngine ? '#fff' : '#333',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          Stockfish：{showEngine ? '開啟' : '關閉'}
        </button>
      <div
        style={{
          width: '28px',
          height: '500px',
          backgroundColor: '#333',
          border: '1px solid #999',
          display: 'flex',
          flexDirection: orientation === 'white' ? 'column-reverse' : 'column',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: `${whitePercent}%`,
            backgroundColor: '#f0f0f0',
            transition: 'height 0.3s ease',
          }}
        />
        <span
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            fontSize: '10px',
            fontWeight: 'bold',
            color: '#ff6b00',
            backgroundColor: 'rgba(255,255,255,0.85)',
            padding: '1px 2px',
            borderRadius: '2px',
          }}
        >
          {formatScore(topLine?.score)}
        </span>
      </div>
        
      <Chessboard 
        position={displayFen()} 
        onPieceDrop={onDrop}
        customArrows={arrows} 
        boardOrientation={orientation} // 透過這個屬性翻轉棋盤
      />
      
      <div style={{ width: '300px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
            <button onClick={goToStart} disabled={currentMoveIndex === -1}>|&lt;</button>
            <button onClick={goBack} disabled={currentMoveIndex === -1}>&lt;</button>
            <button onClick={goForward} disabled={currentMoveIndex === game.history().length - 1}>&gt;</button>
            <button onClick={goToEnd} disabled={currentMoveIndex === game.history().length - 1}>&gt;|</button>
        </div>
        {/* 新增：當前局面勝率統計面板 */}
        <div style={{ marginBottom: '20px', padding: '10px', border: '1px solid #ccc', backgroundColor: '#f0f8ff' }}>
            <h4 style={{ margin: '0 0 10px 0' }}>當前局面推薦</h4>
            {Object.keys(currentStats).length === 0 ? (
                <div style={{ fontSize: '14px', color: '#666' }}>無此局面歷史資料</div>
            ) : (
                <table style={{ width: '100%', fontSize: '14px', textAlign: 'left' }}>
                    <thead>
                        <tr>
                            <th>走法</th>
                            <th>對局數</th>
                            <th>勝率</th>
                        </tr>
                    </thead>
                    <tbody>
                        {/* 將走法依照對局數由多到少排序顯示 */}
                        {Object.entries(currentStats)
                            .sort((a, b) => b[1].total - a[1].total)
                            .map(([move, stats]) => (
                            <tr key={move}>
                                <td><strong>{move}</strong></td>
                                <td>{stats.total}</td>
                                <td>{(stats.winRate * 100).toFixed(1)}%</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
        <div style={{ 
            flexGrow: 1, 
            border: '1px solid #ccc', 
            padding: '10px', 
            overflowY: 'auto',
            maxHeight: '500px',
            backgroundColor: '#f9f9f9',
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start'
        }}>
            {game.history().map((move, index) => {
                // 將一維陣列轉換為回合制的顯示 (例如 "1. e4 e5")
                const isWhiteMove = index % 2 === 0;
                const turnNumber = Math.floor(index / 2) + 1;
                
                // 判斷這一步是否為現在正在看的那一步 (標示背景色)
                const isCurrent = index === (currentMoveIndex === -1 ? game.history().length - 1 : currentMoveIndex);
                
                return (
                    <span key={index} style={{ 
                        width: isWhiteMove ? '60px' : '40px',
                        padding: '2px 5px',
                        cursor: 'pointer',
                        backgroundColor: isCurrent ? '#a3d1ff' : 'transparent',
                        fontWeight: isCurrent ? 'bold' : 'normal'
                    }}
                    onClick={() => setCurrentMoveIndex(index)} // 點擊記譜可以直接跳到該步！
                    >
                        {isWhiteMove && <span style={{ color: '#888', marginRight: '5px' }}>{turnNumber}.</span>}
                        {move}
                    </span>
                );
            })}
        </div>
        {/* 新增：Stockfish 引擎分析面板 */}
        <div style={{ marginBottom: '15px', padding: '10px', border: '1px solid #1e90ff', backgroundColor: '#f5faff' }}>
          <h4 style={{ margin: '0 0 8px 0', display: 'flex', justifyContent: 'space-between' }}>
            <span>Stockfish 分析 (深度 15)</span>
            {isAnalyzing && <span style={{ fontSize: '12px', color: '#888' }}>計算中...</span>}
          </h4>
          {!showEngine ? (
            <div style={{ fontSize: '13px', color: '#666' }}>引擎已關閉</div>
          ) : engineLines.length === 0 ? (
            <div style={{ fontSize: '13px', color: '#666' }}>等待分析結果...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '14px' }}>
              {engineLines.map((line, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '4px 6px',
                    backgroundColor: idx === 0 ? '#e0f0ff' : 'transparent',
                    borderRadius: '4px',
                  }}
                >
                  <span>
                    <strong>#{idx + 1}</strong> {line.move_san ?? '-'}
                  </span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                    {formatScore(line.score)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;