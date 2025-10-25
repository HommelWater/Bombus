import sqlite3
from typing import Optional, Dict, Any, List
db_path = "data.db"
    
def init_database():
    with sqlite3.connect(db_path) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                referer_id INTEGER,
                username TEXT UNIQUE NOT NULL,
                totp_secret TEXT UNIQUE NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                verified BOOLEAN DEFAULT 0,
                restricted BOOLEAN DEFAULT 0,
                banned BOOLEAN DEFAULT 0,
                admin BOOLEAN DEFAULT 0,
                FOREIGN KEY (referer_id) REFERENCES users (id)
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,     
                user_id INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                last_used INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT,     
                inviter_id INTEGER,
                uses INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                last_used INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (inviter_id) REFERENCES users (id)
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel INTEGER,
                user_id INTEGER,
                content TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (channel) REFERENCES channels (id)
            )
        ''')
        conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_posts_channel_created_at ON posts(channel, created_at DESC);
        ''')

def search_posts(channel_id: int, query: str, limit: int = 50):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute('''
        SELECT p.*, u.username
        FROM posts p
        JOIN users u ON p.user_id = u.id
        WHERE p.channel = ?
          AND p.content LIKE ?
        ORDER BY p.created_at DESC
        LIMIT ?
        ''', (channel_id, f'%{query}%', limit))

        columns = [col[0] for col in cursor.description]
        posts = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return posts


#gpt function :(
def get_neighboring_posts(post_id: int, n_before: int = 5, n_after: int = 5): 
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row

        # Get the channel of the reference post
        channel_row = conn.execute(
            "SELECT channel FROM posts WHERE id = ?", (post_id,)
        ).fetchone()
        if channel_row is None:
            return None
        channel_id = channel_row["channel"]

        # Get posts before (descending order)
        before_cursor = conn.execute('''
            SELECT p.*, u.username
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.channel = ?
              AND p.id < ?
            ORDER BY p.id DESC
            LIMIT ?
        ''', (channel_id, post_id, n_before))
        before_posts = before_cursor.fetchall()

        # Get the reference post itself
        current_cursor = conn.execute('''
            SELECT p.*, u.username
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.id = ?
        ''', (post_id,))
        current_post = current_cursor.fetchone()

        # Get posts after (ascending order)
        after_cursor = conn.execute('''
            SELECT p.*, u.username
            FROM posts p
            JOIN users u ON p.user_id = u.id
            WHERE p.channel = ?
              AND p.id > ?
            ORDER BY p.id ASC
            LIMIT ?
        ''', (channel_id, post_id, n_after))
        after_posts = after_cursor.fetchall()

        # Combine: before (reversed to chronological), current, after
        posts = list(reversed(before_posts))
        if current_post:
            posts.append(current_post)
        posts.extend(after_posts)

        # Convert rows to dicts
        columns = [col[0] for col in before_cursor.description]
        all_posts = [dict(zip(columns, row)) for row in posts]

        return channel_id, all_posts

def get_posts_before(channel_id, post_id, n):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute('''
        SELECT p.*
        FROM posts p
        WHERE p.channel = ?
          AND p.id < ?
        ORDER BY p.id DESC
        LIMIT ?
        ''', (channel_id, post_id, n))

        columns = [col[0] for col in cursor.description]
        posts = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return posts

def get_posts_after(channel_id, post_id, n):
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.execute('''
        SELECT p.*
        FROM posts p
        WHERE p.channel = ?
          AND p.id > ?
        ORDER BY p.id ASC
        LIMIT ?
        ''', (channel_id, post_id, n))

        columns = [col[0] for col in cursor.description]
        posts = [dict(zip(columns, row)) for row in cursor.fetchall()]
        return posts

def create_invite_code(code, user_id, uses):
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO invites (code, inviter_id, uses) 
            VALUES (?, ?, ?)""",
            (code, user_id, uses)
        )
        return cursor.lastrowid

def get_invite_code(code: str) -> dict | None:
    """Get an invite code from the database"""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, code, inviter_id, uses, created_at, last_used FROM invites WHERE code = ?",
            (code,)
        )
        row = cursor.fetchone()
        print(row)
        if row:
            return {
                'id': row[0],
                'code': row[1],
                'inviter_id': row[2],
                'uses': row[3],
                'created_at': row[4],
                'last_used': row[5]
            }

def get_post(post_id):
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM posts WHERE id = ?",
            (post_id,)
        )
        row = cursor.fetchone()
        if row:
            return {
                'id': row[0],
                'channel': row[1],
                'user_id': row[2],
                'content': row[3],
                'created_at': row[4]
            }


def create_session(session_key: str, user_id: int) -> int:
    """Create a new session"""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO sessions (key, user_id) 
            VALUES (?, ?)""",
            (session_key, user_id)
        )
        print(cursor.lastrowid)
        return cursor.lastrowid

def get_session(session_key:str):
    with sqlite3.connect(db_path) as conn:
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

def create_user(username:str, totp_secret: str, referer_id: int):
    """Create a new user"""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO users (username, totp_secret, referer_id) VALUES (?, ?, ?)",
            (username, totp_secret, referer_id)
        )
        return cursor.lastrowid

def verify_user(user_id: int) -> bool:
    """Set user as verified"""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE users SET verified = 1 WHERE id = ?",
            (user_id,)
        )
        return cursor.rowcount if cursor.rowcount > 0 else None

def add_post(user_id, channel, content):
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO posts (channel, user_id, content) VALUES (?, ?, ?)",
            (channel, user_id, content)
        )
        return cursor.lastrowid
    
def get_user(username: str) -> Optional[Dict[str, Any]]:
    """Get user data"""
    with sqlite3.connect(db_path) as conn:
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
                'verified': row[5],
                'restricted': row[6],
                'banned': row[7],
                'admin': row[8]
            }
        return None
    
def get_users() -> Optional[Dict[str, Any]]:
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM users",
            ()
        )
        rows = cursor.fetchall()
        users = []
        if rows:
            for row in rows:
                 users.append({
                    'id': row[0],
                    'referer_id': row[1],
                    'username': row[2],
                    'created_at': row[4],
                    'verified': row[5],
                    'restricted': row[6],
                    'banned': row[7],
                    'admin': row[8]
                })
        return users
    
def get_user_by_id(id: str) -> Optional[Dict[str, Any]]:
    """Get user data"""
    with sqlite3.connect(db_path) as conn:
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
                'verified': row[5],
                'restricted': row[6],
                'banned': row[7],
                'admin': row[8]
            }
        return None
    
def get_users_ids() -> Dict[int, str]:
    """Return a dictionary of all users as {user_id: username}."""
    with sqlite3.connect(db_path) as conn:
        cur = conn.execute("SELECT id, username FROM users ORDER BY id;")
        return {row[0]: row[1] for row in cur.fetchall()}

def create_channel(name: str) -> int:
    """Create a new session"""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO channels (name) 
            VALUES (?)""",
            (name,)
        )
        return cursor.lastrowid
    
def get_channels() -> Optional[Dict[str, Any]]:
    """Get user data"""
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT * FROM channels",
            ()
        )
        rows = cursor.fetchall()
        return [{'id': row[0], 'name': row[1]} for row in rows]
    
def recent_posts_per_channel(
    limit: int = 50,
    since_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Fetch a flat list of recent posts across all channels.
    - Always limits to 'limit' posts per channel (default 50).
    - If since_id is provided, only include posts with id > since_id.
    """
    
    base_query = """
    WITH ranked AS (
      SELECT
        p.id,
        p.channel,
        c.name AS channel_name,
        p.user_id,
        p.content,
        p.created_at,
        ROW_NUMBER() OVER (
          PARTITION BY p.channel
          ORDER BY p.created_at DESC, p.id DESC
        ) AS rn
      FROM posts p
      LEFT JOIN channels c ON c.id = p.channel
      {filter_clause}
    )
    SELECT id, channel, channel_name, user_id, content, created_at
    FROM ranked
    WHERE rn <= ?
    ORDER BY created_at DESC;
    """

    if since_id is not None:
        filter_clause = "WHERE p.id > ?"
        params = (since_id, limit)
    else:
        filter_clause = ""
        params = (limit,)

    query = base_query.format(filter_clause=filter_clause)

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.execute(query, params)
        rows = cur.fetchall()

    return [dict(r) for r in rows]

def toggle_restricted(user_id: int) -> bool:
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT restricted FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return None
        
        current_restricted = bool(row[0])
        new_restricted = not current_restricted
        
        cursor.execute(
            "UPDATE users SET restricted = ? WHERE id = ?",
            (int(new_restricted), user_id)
        )
        conn.commit()
        
        return new_restricted

def toggle_banned(user_id: int) -> bool:
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT banned FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return None
        
        current_banned = bool(row[0])
        new_banned = not current_banned
        
        cursor.execute(
            "UPDATE users SET banned = ? WHERE id = ?",
            (int(new_banned), user_id)
        )
        conn.commit()
        
        return new_banned

def toggle_admin(user_id: int) -> bool:
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT admin FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            return None
        
        current_admin = bool(row[0])
        new_admin = not current_admin
        
        cursor.execute(
            "UPDATE users SET admin = ? WHERE id = ?",
            (int(new_admin), user_id)
        )
        conn.commit()
        
        return new_admin

def reset_posts():
    """Delete all posts from the database."""
    with sqlite3.connect(db_path) as conn:
        conn.execute("DELETE FROM posts;")
        conn.commit()