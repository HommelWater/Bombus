import sqlite3
from typing import Optional, Dict, Any

class DataManager:
    def __init__(self, db_path: str = "data.db"):
        self.db_path = db_path
        self._init_database()
    
    def _init_database(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    referer_id INTEGER,
                    username TEXT UNIQUE NOT NULL,
                    totp_secret TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (referer_id) REFERENCES users (id)
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT,     
                    user_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS channels (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS posts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel INTEGER,
                    user_id INTEGER,
                    content TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (channel) REFERENCES channels (id)
                )
            ''')
    
    def create_user(self, username: str) -> int:
        """Create a new user"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (username) VALUES (?)",
                (username,)
            )
            return cursor.lastrowid
    
    def set_totp_secret(self, username: str, secret: str):
        """Set TOTP secret for user"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "UPDATE users SET totp_secret = ? WHERE username = ?",
                (secret, username)
            )
    
    def get_user(self, username: str) -> Optional[Dict[str, Any]]:
        """Get user data"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM users WHERE username = ?",
                (username,)
            )
            row = cursor.fetchone()
            if row:
                return {
                    'id': row[0],
                    'referer_id': row[1],
                    'username': row[2],
                    'totp_secret': row[3],
                    'created_at': row[4]
                }
            return None