from fastapi import FastAPI
import requests
import chess.pgn
import io
import sqlite3
import uuid
from fastapi.middleware.cors import CORSMiddleware
def init_db():
    conn = sqlite3.connect('chess_database.db')
    cursor = conn.cursor()
    cursor.execute('PRAGMA foreign_keys = ON;')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metadata (
            game_id TEXT PRIMARY KEY,
            white TEXT,
            black TEXT,
            result TEXT,
            date TEXT,
            time_class TEXT,  
            pgn TEXT  
        )
    ''')
    
    # 新增 player_color 欄位
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS analysis (
            fen TEXT,
            next_move TEXT,
            result TEXT,
            time_class TEXT,
            game_id TEXT,
            player_color TEXT, 
            FOREIGN KEY(game_id) REFERENCES metadata(game_id)
        )
    ''')
    conn.commit()
    return conn

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# 測試伺服器是否正常的首頁
@app.get("/")
def read_root():
    return {"message": "西洋棋後端 API 已成功啟動！"}

# 抓取對局的 API 路由
@app.get("/api/games/{username}")
def get_latest_game(username: str):
    # 1. 取得該玩家的所有月份存檔網址
    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    
    # Chess.com 規定呼叫 API 必須附帶 User-Agent，否則會被阻擋
    headers = {
        "User-Agent": "MyChessDatabaseApp/1.0 (contact: your_email@example.com)" 
    }
    
    res = requests.get(archives_url, headers=headers)
    if res.status_code != 200:
        return {"error": "找不到該玩家或遭到 Chess.com 阻擋"}
    
    archives = res.json().get("archives", [])
    if not archives:
        return {"error": "沒有對局紀錄"}
    
    # 2. 抓取最後一個月（最新）的網址
    latest_month_url = archives[-1]
    games_res = requests.get(latest_month_url, headers=headers)
    games = games_res.json().get("games", [])
    
    if not games:
        return {"error": "這個月沒有對局"}
    
    # 3. 拿出最新的一盤棋
    latest_game = games[-1]
    pgn_string = latest_game["pgn"]
    
    # 4. 透過 python-chess 解析 PGN
    pgn_io = io.StringIO(pgn_string)
    game = chess.pgn.read_game(pgn_io)
    
    # 5. 將對局轉換為前端好讀取的格式
    moves = []
    board = game.board()
    for move in game.mainline_moves():
        moves.append(board.san(move)) # 儲存如 Nf3, e4 的標準記譜
        board.push(move)
        
    return {
        "white_player": latest_game["white"]["username"],
        "black_player": latest_game["black"]["username"],
        "moves": moves,
        "final_fen": board.fen()
    }

@app.get("/api/games/sync/{username}")
def sync_all_games(username: str):
    conn = init_db()
    cursor = conn.cursor()
    archives_url = f"https://api.chess.com/pub/player/{username}/games/archives"
    headers = {"User-Agent": "MyChessDatabaseApp/1.0"}
    
    archives = requests.get(archives_url, headers=headers).json().get("archives", [])
    
    for month_url in archives: 
        games = requests.get(month_url, headers=headers).json().get("games", [])
        for game_data in games:
            # 1. 改用 Chess.com 官方提供的 URL 當作唯一 ID，確保防呆有效
            game_id = game_data["url"] 
            
            # 2. 先檢查這盤棋是否已經存過
            cursor.execute('SELECT 1 FROM metadata WHERE game_id = ?', (game_id,))
            if cursor.fetchone():
                continue # 如果存在，直接跳過整盤棋，連 analysis 都不用重新解析了！
            
            pgn_string = game_data["pgn"]
            time_class = game_data.get("time_class", "unknown")
            white_player = game_data["white"]["username"]
            black_player = game_data["black"]["username"]
            my_color = "white" if username.lower() == white_player.lower() else "black"
            result = game_data["white"]["result"] if username.lower() == white_player.lower() else game_data["black"]["result"]
            date = game_data.get("end_time", "") 
            
            cursor.execute(
                'INSERT INTO metadata (game_id, white, black, result, date, time_class, pgn) VALUES (?, ?, ?, ?, ?, ?, ?)', 
                (game_id, white_player, black_player, result, str(date), time_class, pgn_string)
            )

            pgn_io = io.StringIO(pgn_string)
            game = chess.pgn.read_game(pgn_io)
            if game is None:
                continue

            board = game.board()
            pgn_result = game.headers.get("Result", "*")
            
            for move in game.mainline_moves():
                fen = board.fen()
                san_move = board.san(move)
                
                # 3. 寫入 analysis 時，把 game_id 也綁定進去
                cursor.execute(
                    'INSERT INTO analysis (fen, next_move, result, time_class, game_id, player_color) VALUES (?, ?, ?, ?, ?, ?)', 
                    (fen, san_move, pgn_result, time_class, game_id, my_color)
                )
                board.push(move)
    
    conn.commit()
    conn.close()
    return {"message": "對局同步完成！已自動過濾重複的對局。"}

@app.get("/api/analysis")
def get_analysis(fen: str, player_color: str = "white"): # 預設抓白方
    conn = sqlite3.connect('chess_database.db')
    cursor = conn.cursor()
    
    # 根據 fen 和 player_color 查詢
    cursor.execute('''
        SELECT next_move, result, COUNT(*) as count 
        FROM analysis 
        WHERE fen = ? AND player_color = ?
        GROUP BY next_move, result
    ''', (fen, player_color))
    
    stats = cursor.fetchall()
    conn.close()
    return {"stats": stats}