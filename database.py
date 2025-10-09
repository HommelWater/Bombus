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
                    totp_secret TEXT UNIQUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    verified BOOLEAN DEFAULT 0,
                    FOREIGN KEY (referer_id) REFERENCES users (id)
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    key TEXT UNIQUE NOT NULL,     
                    user_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS invites (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT,     
                    inviter_id INTEGER,
                    uses INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (inviter_id) REFERENCES users (id)
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

    def create_invite_code(self, code, user_id, uses):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """INSERT INTO invites (code, inviter_id, uses) 
                VALUES (?, ?, ?)""",
                (code, user_id, uses)
            )
            return cursor.lastrowid
    
    def get_invite_code(self, code: str) -> bool:
        """Check if an invite code exists in the database"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT 1 FROM invites WHERE code = ?",
                (code,)
            )
            row = cursor.fetchone()
            if row:
                return {
                    'id': row[0],
                    'code': row[1],
                    'inviter_id': row[2],
                    'uses':row[3],
                    'created_at': row[4],
                    'last_used': row[5]
                }

    def create_session(self, session_key: str, user_id: int) -> int:
        """Create a new session"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                """INSERT INTO sessions (key, user_id) 
                VALUES (?, ?)""",
                (session_key, user_id)
            )
            return cursor.lastrowid

    def get_session(self, session_key:str):
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM sessions WHERE key = ?",
                (session_key,)
            )
            row = cursor.fetchone()
            if row:
                return {
                    'id': row[0],
                    'key': row[1],
                    'user_id': row[2],
                    'created_at': row[3],
                    'last_used': row[4]
                }

    def create_user(self, username:str, totp_secret: str, referer_id: int):
        """Create a new user"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (username, totp_secret, referer_id) VALUES (?, ?, ?)",
                (username, totp_secret, referer_id)
            )
            return cursor.lastrowid
    
    def verify_user(self, user_id: int) -> bool:
        """Set user as verified"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "UPDATE users SET verified = 1 WHERE id = ?",
                (user_id,)
            )
            return cursor.rowcount if cursor.rowcount > 0 else None

    def add_post(username, channel, message):
        pass

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
                    'created_at': row[4],
                    'verified': row[5]
                }
            return None
        
    def get_user_by_id(self, id: str) -> Optional[Dict[str, Any]]:
        """Get user data"""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM users WHERE id = ?",
                (id,)
            )
            row = cursor.fetchone()
            if row:
                return {
                    'id': row[0],
                    'referer_id': row[1],
                    'username': row[2],
                    'totp_secret': row[3],
                    'created_at': row[4],
                    'verified': row[5]
                }
            return None