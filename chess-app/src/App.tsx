import { useState, useEffect } from 'react';
import { Chess, Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';

type Arrow = [Square, Square, string];

function App() {
  const [game, setGame] = useState(new Chess());
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [currentStats, setCurrentStats] = useState<Record<string, { wins: number, total: number, winRate: number }>>({});
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
      </div>
    </div>
  );
}

export default App;