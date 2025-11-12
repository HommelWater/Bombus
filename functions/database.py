import aiosqlite
from functools import wraps
db_path = "data.db"

#Wrapper to handle some stuff automatically for me.
def async_with_db(commit=False, fetchone=False, fetchall=False):
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                async with aiosqlite.connect(db_path) as conn:
                    conn.row_factory = aiosqlite.Row
                    cursor = await conn.cursor()
                    result = await func(cursor, *args, **kwargs)
                    if commit:
                        await conn.commit()
                    if fetchone:
                        row = await cursor.fetchone()
                        return dict(row) if row else None
                    if fetchall:
                        rows = await cursor.fetchall()
                        return [dict(r) for r in rows]
                    return result
            except Exception as e:
                print(f"[ASYNC DB ERROR] in {func.__name__}: {e}")
                return None
        return wrapper
    return decorator

async def init_database():
    async with aiosqlite.connect(db_path) as conn:
        await conn.execute('''
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
                FOREIGN KEY (referer_id) REFERENCES users (id) ON DELETE SET NULL
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,     
                user_id INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                last_used INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS invites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT,     
                inviter_id INTEGER,
                uses INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                last_used INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (inviter_id) REFERENCES users (id) ON DELETE CASCADE
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS channel_users (
                channel_id INTEGER,
                user_id INTEGER,
                FOREIGN KEY (channel_id) REFERENCES channels (id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel INTEGER,
                user_id INTEGER,
                content TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
                FOREIGN KEY (channel) REFERENCES channels (id) ON DELETE CASCADE
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                size, INTEGER,
                hash TEXT UNIQUE,
                uploader_user_id INTEGER,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (uploader_user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                endpoint TEXT UNIQUE NOT NULL,
                subscription_json TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            )
        ''')
        await conn.execute('''
            CREATE INDEX IF NOT EXISTS idx_posts_channel_created_at ON posts(channel, created_at DESC);
        ''')# TODO: Add more, better indexes!

# PUSH SUBSCRIPTIONS

@async_with_db(fetchall=True)
async def get_push_subscriptions(cursor, user_ids):
    query = f"SELECT subscription_json FROM push_subscriptions"
    if user_ids and len(user_ids) != 0:
        placeholders = ",".join(["?"] * len(user_ids))
        query += f" WHERE user_id IN ({placeholders})"
    await cursor.execute(query, user_ids)

@async_with_db(commit=True)
async def add_push_subscription(cursor, user_id, subscription):
    endpoint = subscription.get("endpoint")

    if not user_id or not endpoint:
        return None

    if not isinstance(subscription, str):
        import json
        subscription = json.dumps(subscription)

    await cursor.execute(
        '''
        INSERT INTO push_subscriptions (user_id, endpoint, subscription_json)
        VALUES (?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET
            user_id = excluded.user_id,
            subscription_json = excluded.subscription_json
        ''',
        (user_id, endpoint, subscription)
    )
    return endpoint

@async_with_db(commit=True)
async def remove_push_subscription(cursor, user_id, endpoint):
    await cursor.execute("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", (user_id, endpoint,))
    return cursor.lastrowid

# FILES

@async_with_db(commit=True)
async def store_file_metadata(cursor, name, size, hash):
    await cursor.execute("INSERT INTO files (name, size, hash) VALUES (?, ?, ?)", (name, size, hash,))
    return cursor.lastrowid

@async_with_db(fetchone=True)
async def get_file_metadata(cursor, name=None, hash=None):
    if name is None and hash is None:
        return None

    if name is not None:
        await cursor.execute("SELECT * FROM files WHERE name = ?", (name,))
    else:
        await cursor.execute("SELECT * FROM files WHERE hash = ?", (hash,))

@async_with_db(fetchall=True)
async def get_all_files(cursor, user_id=None):
    if user_id is not None:
        await cursor.execute("SELECT * FROM files WHERE uploader_user_id = ?", (user_id,))
    else:
        await cursor.execute("SELECT * FROM files")

# CHANNELS

@async_with_db(fetchall=True)
async def get_channels(cursor):
    await cursor.execute("SELECT * FROM channels")

@async_with_db(commit=True)
async def create_channel(cursor, name):
    await cursor.execute("INSERT INTO channels (name) VALUES (?)", (name,))
    return cursor.lastrowid

@async_with_db(commit=True)
async def delete_channel(cursor, id):
    await cursor.execute("DELETE FROM channels WHERE id = ?", (id,))
    return cursor.rowcount > 0

# POSTS

@async_with_db()
async def get_posts(cursor, channel_id=None, from_id=None, direction=None, query=None, amount=100):    
    where_clauses = []
    query_params = []

    if channel_id is not None:
        where_clauses.append("channel = ?")
        query_params.append(channel_id)

    if from_id and direction:
        if direction == "up":
            where_clauses.append("id < ?")
        elif direction == "down":
            where_clauses.append("id > ?")
        query_params.append(from_id)

    if query:
        where_clauses.append("content LIKE ? COLLATE NOCASE")
        query_params.append(f"%{query}%")

    where_clause = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    order_clause = "ORDER BY id DESC" if (from_id is None or direction == "up") else "ORDER BY id ASC"
    limit_clause = f"LIMIT {int(amount)}"

    sql = f"""
        SELECT id, channel, user_id, content, created_at
        FROM posts
        {where_clause}
        {order_clause}
        {limit_clause};
    """

    await cursor.execute(sql, query_params)
    rows = await cursor.fetchall()
    posts = [dict(row) for row in rows]

    if direction == "up" or from_id is None:
        posts.reverse()
    return posts

@async_with_db(fetchone=True)
async def get_post(cursor, post_id):
    await cursor.execute("SELECT * FROM posts WHERE id = ?", (post_id,))

@async_with_db(commit=True)
async def add_post(cursor, user_id, channel, content):
    await cursor.execute(
        "INSERT INTO posts (channel, user_id, content) VALUES (?, ?, ?)",
        (channel, user_id, content)
    )
    return cursor.lastrowid

# USERS

@async_with_db(fetchone=True)
async def get_invite_code(cursor, code):
    await cursor.execute("SELECT * FROM invites WHERE code = ?", (code,))

@async_with_db(commit=True)
async def create_invite_code(cursor, code, inviter_id, uses):
    await cursor.execute('''
        INSERT INTO invites (code, inviter_id, uses)
        VALUES (?, ?, ?)
    ''', (code, inviter_id, uses))
    return True

@async_with_db()
async def get_users(cursor):
    await cursor.execute("SELECT * FROM users WHERE verified = 1")
    rows = await cursor.fetchall()
    users = [dict(row) for row in rows]
    for u in users:
        u.pop("totp_secret", None)
    return users

@async_with_db()
async def get_user(cursor, identifier, safe=True):
    await cursor.execute(
        "SELECT * FROM users WHERE id = ? OR username = ?",
        (identifier, identifier)
    )
    row = await cursor.fetchone()
    if not row:
        return None
    user = dict(row)
    if safe:
        user.pop("totp_secret", None)
    return user

@async_with_db(commit=True)
async def update_user_status(cursor, user_id: int, banned: bool = None, restricted: bool = None, admin: bool = None):
    fields = []
    values = []
    if banned is not None:
        fields.append("banned = ?")
        values.append(int(banned))
    if restricted is not None:
        fields.append("restricted = ?")
        values.append(int(restricted))
    if admin is not None:
        fields.append("admin = ?")
        values.append(int(admin))
    if not fields:
        print("No fields to update.")
        return None

    query = f"UPDATE users SET {', '.join(fields)} WHERE id = ?"
    values.append(user_id)
    await cursor.execute(query, values)
    return cursor.rowcount > 0

@async_with_db(commit=True)
async def update_user_username(cursor, user_id, username):
    await cursor.execute("UPDATE users SET username = ? WHERE id = ?", (username, user_id))
    return True 

@async_with_db(commit=True, fetchone=True)
async def create_user(cursor, username, totp_secret, referer_id=None):
    await cursor.execute(
        """
        INSERT INTO users (username, totp_secret, referer_id)
        VALUES (?, ?, ?)
        """,
        (username, totp_secret, referer_id)
    )
    await cursor.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,))

@async_with_db(commit=True)
async def verify_user(cursor, user_id):
    await cursor.execute(
        "UPDATE users SET verified = 1 WHERE id = ?",
        (user_id,)
    )
    return cursor.lastrowid

# SESSIONS

@async_with_db(commit=True)
async def create_session(cursor, session_key, user_id):
    await cursor.execute(
        "INSERT INTO sessions (key, user_id) VALUES (?, ?)",
        (session_key, user_id)
    )
    return cursor.lastrowid

@async_with_db(fetchone=True)
async def get_session(cursor, session_key):
    await cursor.execute("SELECT * FROM sessions WHERE key = ?", (session_key,))

import shutil
import os

async def create_anonymized_database(original_db_path, output_db_path):
    original_db_path = os.path.abspath(os.path.normpath(original_db_path))
    output_db_path = os.path.abspath(os.path.normpath(output_db_path))
    
    #dont do stupid shit pls :D
    assert original_db_path != output_db_path, "Input and output paths must be different"
    assert os.path.exists(original_db_path), "Source database does not exist"
    assert not os.path.exists(output_db_path), "Output file already exists"

    shutil.copy2(original_db_path, output_db_path)
    
    async with aiosqlite.connect(output_db_path) as conn:
        await conn.execute("UPDATE users SET totp_secret = ''")
        await conn.execute("UPDATE sessions SET key = ''")
        await conn.execute("UPDATE invites SET code = ''")        
        await conn.commit()
    return output_db_path
