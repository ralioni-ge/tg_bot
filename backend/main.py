"""
Telegram Bookmark Manager - Backend Server
FastAPI + Telethon + SQLite
"""
import asyncio
import json
import logging
import os
import sqlite3
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError
import uvicorn

# Configuration
DATABASE_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'bookmarks.db')
SESSIONS_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'sessions')
API_ID = int(os.getenv('TG_API_ID', '0'))
API_HASH = os.getenv('TG_API_HASH', '')

# Ensure directories exist
os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
os.makedirs(SESSIONS_DIR, exist_ok=True)

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Global state
clients: Dict[str, TelegramClient] = {}  # account_id -> client
job_queues: Dict[str, asyncio.Queue] = {}  # job_id -> queue
active_jobs: Dict[str, Dict[str, Any]] = {}  # job_id -> job_info


# ==================== Database Layer ====================

def get_db_connection():
    """Get SQLite database connection"""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_database():
    """Initialize database schema"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Categories table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            parent_path TEXT
        )
    ''')
    
    # Links table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_path TEXT NOT NULL,
            title TEXT NOT NULL,
            base_link TEXT NOT NULL,
            original_link TEXT,
            chat_id TEXT,
            type TEXT DEFAULT 'web',
            status TEXT DEFAULT 'alive',
            group_link TEXT,
            timestamp INTEGER,
            subscribers INTEGER DEFAULT 0,
            post_count INTEGER DEFAULT 0,
            language TEXT DEFAULT 'Unknown',
            description TEXT,
            position INTEGER
        )
    ''')
    
    # Accounts table (for multi-account support)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT,
            phone TEXT UNIQUE NOT NULL,
            session_string TEXT,
            status TEXT DEFAULT 'disconnected',
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
    ''')
    
    # Automation jobs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS automation_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_type TEXT NOT NULL,
            account_id INTEGER,
            target_link_ids TEXT,
            status TEXT DEFAULT 'pending',
            progress INTEGER DEFAULT 0,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            completed_at INTEGER
        )
    ''')
    
    # Automation logs table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS automation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            timestamp INTEGER DEFAULT (strftime('%s', 'now'))
        )
    ''')
    
    # Insert default categories if empty
    cursor.execute('SELECT COUNT(*) FROM categories')
    if cursor.fetchone()[0] == 0:
        defaults = [
            ('Education/Engineering', 'Education'),
            ('Education/Languages', 'Education'),
            ('News/Global', 'News')
        ]
        cursor.executemany('INSERT OR IGNORE INTO categories (path, parent_path) VALUES (?, ?)', defaults)
    
    conn.commit()
    conn.close()
    logger.info("Database initialized successfully")


# ==================== Pydantic Models ====================

class AccountCreate(BaseModel):
    label: Optional[str] = None
    phone: str


class AccountVerifyCode(BaseModel):
    account_id: int
    code: str


class AccountVerifyPassword(BaseModel):
    account_id: int
    password: str


class LinkCreate(BaseModel):
    category_path: str
    title: str
    base_link: str
    original_link: Optional[str] = None
    chat_id: Optional[str] = None
    type: str = "web"
    status: str = "alive"
    group_link: Optional[str] = None
    timestamp: Optional[int] = None
    subscribers: int = 0
    post_count: int = 0
    language: str = "Unknown"
    description: str = ""
    position: Optional[int] = None


class LinkUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    subscribers: Optional[int] = None
    post_count: Optional[int] = None
    language: Optional[str] = None
    description: Optional[str] = None
    category_path: Optional[str] = None


class BulkImportRequest(BaseModel):
    text: str
    category_path: str
    discover_groups: bool = False


class AutomationJobRequest(BaseModel):
    job_type: str  # metrics_sync, recency_verify, language_classify, description_scrape, discovery_crawl
    account_id: Optional[int] = None
    link_ids: Optional[List[int]] = None
    params: Optional[Dict[str, Any]] = None


# ==================== Telethon Service ====================

class TelethonService:
    """Service for managing Telethon clients and Telegram operations"""
    
    def __init__(self):
        self.clients: Dict[int, TelegramClient] = {}
        self.pending_auth: Dict[int, dict] = {}  # account_id -> {phone_code_hash, ...}
    
    async def create_client(self, account_id: int, phone: str) -> dict:
        """Create a new Telegram client and send verification code"""
        if API_ID == 0 or not API_HASH:
            raise HTTPException(status_code=500, detail="Telegram API credentials not configured")
        
        session_name = f"account_{account_id}"
        client = TelegramClient(session_name, API_ID, API_HASH)
        
        await client.connect()
        
        if not await client.is_user_authorized():
            result = await client.send_code_request(phone)
            self.pending_auth[account_id] = {
                'phone': phone,
                'phone_code_hash': result.phone_code_hash,
                'client': client
            }
            return {'status': 'code_sent', 'phone_code_hash': result.phone_code_hash}
        
        # Already authorized (shouldn't happen for new accounts)
        session_string = await client.save_session()
        self.clients[account_id] = client
        
        return {'status': 'already_authorized'}
    
    async def verify_code(self, account_id: int, code: str) -> dict:
        """Verify login code and complete authentication"""
        if account_id not in self.pending_auth:
            raise HTTPException(status_code=400, detail="No pending authentication for this account")
        
        auth_info = self.pending_auth[account_id]
        client = auth_info['client']
        phone = auth_info['phone']
        phone_code_hash = auth_info['phone_code_hash']
        
        try:
            await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
        except SessionPasswordNeededError:
            # 2FA required
            return {'status': '2fa_required'}
        
        # Save session
        session_string = await client.save_session()
        
        # Update database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE accounts SET session_string = ?, status = ? WHERE id = ?', 
                      (session_string, 'connected', account_id))
        conn.commit()
        conn.close()
        
        self.clients[account_id] = client
        del self.pending_auth[account_id]
        
        me = await client.get_me()
        return {
            'status': 'success',
            'username': me.username,
            'first_name': me.first_name,
            'session_string': session_string
        }
    
    async def verify_password(self, account_id: int, password: str) -> dict:
        """Verify 2FA password"""
        if account_id not in self.pending_auth:
            raise HTTPException(status_code=400, detail="No pending authentication for this account")
        
        auth_info = self.pending_auth[account_id]
        client = auth_info['client']
        
        await client.sign_in(password=password)
        
        # Save session
        session_string = await client.save_session()
        
        # Update database
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute('UPDATE accounts SET session_string = ?, status = ? WHERE id = ?', 
                      (session_string, 'connected', account_id))
        conn.commit()
        conn.close()
        
        self.clients[account_id] = client
        del self.pending_auth[account_id]
        
        me = await client.get_me()
        return {
            'status': 'success',
            'username': me.username,
            'first_name': me.first_name,
            'session_string': session_string
        }
    
    async def load_account(self, account_id: int, session_string: str) -> bool:
        """Load an existing account from session string"""
        try:
            session_name = f"account_{account_id}"
            client = TelegramClient(StringSession(session_string), API_ID, API_HASH)
            await client.connect()
            
            if await client.is_user_authorized():
                self.clients[account_id] = client
                return True
            return False
        except Exception as e:
            logger.error(f"Failed to load account {account_id}: {e}")
            return False
    
    async def get_chat_metadata(self, username: str, account_id: Optional[int] = None) -> dict:
        """Get metadata for a Telegram channel/chat"""
        client = await self._get_client(account_id)
        
        clean_user = username.replace('https://t.me/', '').replace('@', '').split('/')[0]
        
        try:
            chat = await client.get_chat(clean_user)
            
            posts = []
            try:
                history = await client.get_messages(clean_user, limit=10)
                for msg in history:
                    forwarded_from = None
                    if msg.forward and msg.forward.chat:
                        forwarded_from = msg.forward.chat.username
                    
                    posts.append({
                        'text': msg.text or '',
                        'timestamp': msg.date.timestamp() * 1000 if msg.date else 0,
                        'forwardedFrom': forwarded_from
                    })
            except Exception as e:
                logger.warning(f"Could not retrieve channel history for {clean_user}: {e}")
            
            return {
                'ok': True,
                'title': chat.title or clean_user,
                'description': chat.description or '',
                'subscribers': getattr(chat, 'participants_count', 0) or 0,
                'posts': posts,
                'status': 'alive'
            }
        except Exception as e:
            return {'ok': False, 'description': str(e)}
    
    async def _get_client(self, account_id: Optional[int] = None) -> TelegramClient:
        """Get a Telegram client, using specified account or first available"""
        if account_id and account_id in self.clients:
            return self.clients[account_id]
        
        if self.clients:
            return list(self.clients.values())[0]
        
        raise HTTPException(status_code=503, detail="No Telegram client available")
    
    def detect_language(self, text: str) -> str:
        """Detect language of text based on character patterns"""
        if not text:
            return 'Unknown'
        
        arabic_persian_pattern = r'[\u0600-\u06FF]'
        cyrillic_pattern = r'[\u0400-\u04FF]'
        
        import re
        text_sample = text[:1000]
        
        score_ar_fa = len(re.findall(arabic_persian_pattern, text_sample))
        score_cyr = len(re.findall(cyrillic_pattern, text_sample))
        
        if score_ar_fa > len(text_sample) * 0.1:
            return 'Arabic/Persian'
        if score_cyr > len(text_sample) * 0.1:
            return 'Cyrillic/Russian'
        return 'English/Latin'
    
    def analyze_url(self, url: str) -> dict:
        """Analyze a URL and extract Telegram-specific info"""
        import re
        
        base_link = url.strip()
        link_type = "web"
        chat_id = None
        
        private_match = re.search(r't\.me/c/([0-9]+)', url, re.IGNORECASE)
        public_match = re.search(r't\.me/([a-zA-Z0-9_]+)', url, re.IGNORECASE)
        
        if private_match:
            raw_id = private_match.group(1)
            link_type = "telegram"
            base_link = f"https://t.me/c/{raw_id}"
            chat_id = f"-100{raw_id}"
        elif public_match and public_match.group(1).lower() != 'c':
            username = public_match.group(1)
            link_type = "telegram"
            base_link = f"https://t.me/{username}"
        
        return {'base_link': base_link, 'type': link_type, 'chat_id': chat_id}
    
    async def process_bulk_input(self, text: str, account_id: Optional[int] = None) -> List[dict]:
        """Process bulk text input and extract Telegram links"""
        import re
        
        matches = re.findall(r'(https?://[^\s]+|t\.me/[^\s]+|@[a-zA-Z0-9_]+)', text)
        results = []
        
        for raw in matches:
            url = raw
            if raw.startswith('@'):
                url = f"https://t.me/{raw[1:]}"
            elif not raw.startswith('http'):
                url = f"https://{raw}"
            
            parsed = self.analyze_url(url)
            title = url
            
            if parsed['type'] == 'telegram':
                try:
                    target = parsed['chat_id'] or f"@{url.split('t.me/')[1]}"
                    info = await self.get_chat_metadata(target.replace('@', ''), account_id)
                    if info['ok']:
                        title = info['title']
                except:
                    pass
            
            results.append({
                'original_link': url,
                'base_link': parsed['base_link'],
                'title': title,
                'chat_id': parsed['chat_id'],
                'type': parsed['type'],
                'group_link': None,
                'status': 'alive',
                'subscribers': 0,
                'post_count': 0,
                'language': 'Unknown',
                'description': ''
            })
        
        return results
    
    async def disconnect(self, account_id: Optional[int] = None):
        """Disconnect Telegram client(s)"""
        if account_id and account_id in self.clients:
            await self.clients[account_id].disconnect()
            del self.clients[account_id]
        elif not account_id:
            for client in self.clients.values():
                await client.disconnect()
            self.clients.clear()


telethon_service = TelethonService()


# ==================== Automation Jobs ====================

async def run_metrics_sync(job_id: int, link_ids: List[int], account_id: Optional[int], ws: Optional[WebSocket] = None):
    """Sync metrics for selected links"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get link details
    placeholders = ','.join('?' * len(link_ids))
    cursor.execute(f'SELECT id, base_link, type FROM links WHERE id IN ({placeholders})', link_ids)
    links = cursor.fetchall()
    
    telegram_links = [l for l in links if l['type'] == 'telegram']
    total = len(telegram_links)
    
    log_message = f"Initiating metadata metrics updating on {total} selected targets..."
    cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message})
    
    count = 0
    for link in telegram_links:
        count += 1
        progress = int((count / total) * 100)
        
        cursor.execute('UPDATE automation_jobs SET progress = ? WHERE id = ?', (progress, job_id))
        
        username = link['base_link'].split('t.me/')[1] if 't.me/' in link['base_link'] else None
        if not username or username.startswith('c/'):
            continue
        
        log_message = f"Querying details via MTProto for: @{username}"
        cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
        if ws:
            await ws.send_json({'type': 'log', 'message': log_message})
        
        info = await telethon_service.get_chat_metadata(username, account_id)
        
        if info['ok']:
            cursor.execute('''
                UPDATE links SET subscribers = ?, post_count = ?, status = ?, timestamp = ?
                WHERE id = ?
            ''', (
                info['subscribers'],
                len(info['posts']) if info['posts'] else 0,
                'alive',
                int(datetime.now().timestamp()),
                link['id']
            ))
            log_message = f"Success! Subscribers: {info['subscribers']}, Posts parsed: {len(info['posts'])}"
        else:
            cursor.execute('UPDATE links SET status = ? WHERE id = ?', ('dead', link['id']))
            log_message = f"Access Failed for @{username}: {info['description']}"
        
        cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
        if ws:
            await ws.send_json({'type': 'log', 'message': log_message})
        
        conn.commit()
        await asyncio.sleep(0.4)
    
    cursor.execute('UPDATE automation_jobs SET status = ?, completed_at = ? WHERE id = ?', 
                  ('completed', int(datetime.now().timestamp()), job_id))
    conn.commit()
    conn.close()
    
    log_message = "✅ Selected metrics sync complete."
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message, 'complete': True})


async def run_recency_verify(job_id: int, link_ids: List[int], account_id: Optional[int], 
                             threshold_date: str, ws: Optional[WebSocket] = None):
    """Verify recency of posts for selected links"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    threshold_timestamp = datetime.strptime(threshold_date, '%Y-%m-%d').timestamp() * 1000
    
    placeholders = ','.join('?' * len(link_ids))
    cursor.execute(f'SELECT id, base_link, type FROM links WHERE id IN ({placeholders})', link_ids)
    links = cursor.fetchall()
    
    telegram_links = [l for l in links if l['type'] == 'telegram']
    total = len(telegram_links)
    
    log_message = f"Scanning {total} checked elements for posts since {threshold_date}..."
    cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message})
    
    count = 0
    for link in telegram_links:
        count += 1
        progress = int((count / total) * 100)
        cursor.execute('UPDATE automation_jobs SET progress = ? WHERE id = ?', (progress, job_id))
        
        username = link['base_link'].split('t.me/')[1] if 't.me/' in link['base_link'] else None
        if not username or username.startswith('c/'):
            continue
        
        info = await telethon_service.get_chat_metadata(username, account_id)
        
        if info['ok'] and info['posts'] and len(info['posts']) > 0:
            last_post_time = max(p['timestamp'] for p in info['posts'])
            if last_post_time >= threshold_timestamp:
                cursor.execute('UPDATE links SET status = ? WHERE id = ?', ('alive', link['id']))
                log_message = f"[ACTIVE] @{username} has published posts after your threshold date."
            else:
                cursor.execute('UPDATE links SET status = ? WHERE id = ?', ('dead', link['id']))
                log_message = f"[STALE] @{username} has NO active publications since threshold."
        else:
            cursor.execute('UPDATE links SET status = ? WHERE id = ?', ('dead', link['id']))
            log_message = f"[STALE/INACCESSIBLE] @{username} could not be analyzed."
        
        cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
        if ws:
            await ws.send_json({'type': 'log', 'message': log_message})
        
        conn.commit()
        await asyncio.sleep(0.4)
    
    cursor.execute('UPDATE automation_jobs SET status = ?, completed_at = ? WHERE id = ?', 
                  ('completed', int(datetime.now().timestamp()), job_id))
    conn.commit()
    conn.close()
    
    log_message = "✅ Recency scan task completed."
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message, 'complete': True})


async def run_language_classify(job_id: int, link_ids: List[int], account_id: Optional[int], 
                                ws: Optional[WebSocket] = None):
    """Classify language of selected links"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    placeholders = ','.join('?' * len(link_ids))
    cursor.execute(f'SELECT id, base_link, type FROM links WHERE id IN ({placeholders})', link_ids)
    links = cursor.fetchall()
    
    telegram_links = [l for l in links if l['type'] == 'telegram']
    total = len(telegram_links)
    
    log_message = f"Initializing language classification on {total} selected components..."
    cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message})
    
    count = 0
    for link in telegram_links:
        count += 1
        progress = int((count / total) * 100)
        cursor.execute('UPDATE automation_jobs SET progress = ? WHERE id = ?', (progress, job_id))
        
        username = link['base_link'].split('t.me/')[1] if 't.me/' in link['base_link'] else None
        if not username or username.startswith('c/'):
            continue
        
        info = await telethon_service.get_chat_metadata(username, account_id)
        
        if info['ok'] and info['posts'] and len(info['posts']) > 0:
            combined_text = ' '.join(p['text'] for p in info['posts'])
            lang = telethon_service.detect_language(combined_text)
            cursor.execute('UPDATE links SET language = ? WHERE id = ?', (lang, link['id']))
            log_message = f"Channel @{username} language: {lang}"
        else:
            log_message = f"Inaccessible/No posts for language classification on @{username}"
        
        cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
        if ws:
            await ws.send_json({'type': 'log', 'message': log_message})
        
        conn.commit()
        await asyncio.sleep(0.4)
    
    cursor.execute('UPDATE automation_jobs SET status = ?, completed_at = ? WHERE id = ?', 
                  ('completed', int(datetime.now().timestamp()), job_id))
    conn.commit()
    conn.close()
    
    log_message = "✅ Language diagnostics completed."
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message, 'complete': True})


async def run_description_scrape(job_id: int, link_ids: List[int], account_id: Optional[int], 
                                 ws: Optional[WebSocket] = None):
    """Scrape descriptions for selected links"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    placeholders = ','.join('?' * len(link_ids))
    cursor.execute(f'SELECT id, base_link, type FROM links WHERE id IN ({placeholders})', link_ids)
    links = cursor.fetchall()
    
    telegram_links = [l for l in links if l['type'] == 'telegram']
    total = len(telegram_links)
    
    log_message = f"Retrieving channel description contexts for {total} targets..."
    cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message})
    
    count = 0
    for link in telegram_links:
        count += 1
        progress = int((count / total) * 100)
        cursor.execute('UPDATE automation_jobs SET progress = ? WHERE id = ?', (progress, job_id))
        
        username = link['base_link'].split('t.me/')[1] if 't.me/' in link['base_link'] else None
        if not username or username.startswith('c/'):
            continue
        
        info = await telethon_service.get_chat_metadata(username, account_id)
        
        if info['ok']:
            description = info['description'] or 'No description found'
            cursor.execute('UPDATE links SET description = ? WHERE id = ?', (description, link['id']))
            log_message = f"Description captured for @{username}"
        else:
            log_message = f"Failed fetching bio details for @{username}"
        
        cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
        if ws:
            await ws.send_json({'type': 'log', 'message': log_message})
        
        conn.commit()
        await asyncio.sleep(0.4)
    
    cursor.execute('UPDATE automation_jobs SET status = ?, completed_at = ? WHERE id = ?', 
                  ('completed', int(datetime.now().timestamp()), job_id))
    conn.commit()
    conn.close()
    
    log_message = "✅ Biography scraping complete."
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message, 'complete': True})


async def run_discovery_crawl(job_id: int, link_ids: List[int], account_id: Optional[int], 
                              posts_count: int, ws: Optional[WebSocket] = None):
    """Discover new channels from forwarded messages"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    placeholders = ','.join('?' * len(link_ids))
    cursor.execute(f'SELECT id, base_link, type FROM links WHERE id IN ({placeholders})', link_ids)
    links = cursor.fetchall()
    
    telegram_links = [l for l in links if l['type'] == 'telegram']
    total = len(telegram_links)
    
    log_message = f"Checking forwarding attributes of the last {posts_count} posts in {total} checked channels..."
    cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message})
    
    discovered = []
    count = 0
    for link in telegram_links:
        count += 1
        progress = int((count / total) * 100)
        cursor.execute('UPDATE automation_jobs SET progress = ? WHERE id = ?', (progress, job_id))
        
        username = link['base_link'].split('t.me/')[1] if 't.me/' in link['base_link'] else None
        if not username or username.startswith('c/'):
            continue
        
        info = await telethon_service.get_chat_metadata(username, account_id)
        
        if info['ok'] and info['posts']:
            sample_posts = info['posts'][-posts_count:]
            for post in sample_posts:
                if post.get('forwardedFrom'):
                    clean_handle = post['forwardedFrom'].replace('https://t.me/', '').replace('@', '').split('/')[0]
                    if clean_handle and clean_handle.lower() != 'c':
                        formatted_link = f"https://t.me/{clean_handle}"
                        
                        # Check if already exists
                        cursor.execute('SELECT COUNT(*) FROM links WHERE base_link = ?', (formatted_link,))
                        exists = cursor.fetchone()[0] > 0
                        
                        if not exists and clean_handle not in [d['handle'] for d in discovered]:
                            discovered.append({'handle': clean_handle, 'source': f"@{username}"})
                            log_message = f"Discovered new path: @{clean_handle} (Forwarded by @{username})"
                            cursor.execute('INSERT INTO automation_logs (job_id, message) VALUES (?, ?)', (job_id, log_message))
                            if ws:
                                await ws.send_json({'type': 'log', 'message': log_message, 'discovered': discovered})
        
        await asyncio.sleep(0.4)
    
    # Store discovered channels in job info for frontend retrieval
    cursor.execute('UPDATE automation_jobs SET status = ?, completed_at = ? WHERE id = ?', 
                  ('completed', int(datetime.now().timestamp()), job_id))
    conn.commit()
    conn.close()
    
    log_message = f"Discovery completed: {len(discovered)} unrecognized forwarding tracks discovered."
    if ws:
        await ws.send_json({'type': 'log', 'message': log_message, 'complete': True, 'discovered': discovered})


# ==================== FastAPI App ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events"""
    # Startup
    init_database()
    
    # Load existing accounts
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, session_string FROM accounts WHERE session_string IS NOT NULL')
    accounts = cursor.fetchall()
    conn.close()
    
    for account in accounts:
        await telethon_service.load_account(account['id'], account['session_string'])
    
    logger.info(f"Loaded {len(telethon_service.clients)} Telegram sessions")
    
    yield
    
    # Shutdown
    await telethon_service.disconnect()
    logger.info("Disconnected all Telegram clients")


app = FastAPI(title="Telegram Bookmark Manager API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== Auth Endpoints ====================

@app.post("/api/auth/accounts")
async def create_account(account: AccountCreate):
    """Create a new Telegram account"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO accounts (label, phone) VALUES (?, ?)', 
                      (account.label, account.phone))
        account_id = cursor.lastrowid
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Phone number already registered")
    
    conn.close()
    
    result = await telethon_service.create_client(account_id, account.phone)
    return {'account_id': account_id, **result}


@app.post("/api/auth/verify_code")
async def verify_code(data: AccountVerifyCode):
    """Verify login code"""
    return await telethon_service.verify_code(data.account_id, data.code)


@app.post("/api/auth/verify_password")
async def verify_password(data: AccountVerifyPassword):
    """Verify 2FA password"""
    return await telethon_service.verify_password(data.account_id, data.password)


@app.get("/api/auth/accounts")
async def list_accounts():
    """List all accounts"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT id, label, phone, status, created_at FROM accounts')
    accounts = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {'accounts': accounts}


@app.delete("/api/auth/accounts/{account_id}")
async def delete_account(account_id: int):
    """Delete an account"""
    if account_id in telethon_service.clients:
        await telethon_service.clients[account_id].disconnect()
        del telethon_service.clients[account_id]
    
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM accounts WHERE id = ?', (account_id,))
    conn.commit()
    conn.close()
    
    return {'status': 'deleted'}


# ==================== Categories Endpoints ====================

@app.get("/api/categories")
async def get_categories():
    """Get all categories"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT * FROM categories ORDER BY path')
    categories = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {'categories': categories}


@app.post("/api/categories")
async def create_category(path: str, parent_path: Optional[str] = None):
    """Create a new category"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute('INSERT INTO categories (path, parent_path) VALUES (?, ?)', 
                      (path, parent_path))
        conn.commit()
        category_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Category path already exists")
    
    conn.close()
    return {'id': category_id, 'path': path, 'parent_path': parent_path}


@app.delete("/api/categories/{category_id}")
async def delete_category(category_id: int):
    """Delete a category and its subcategories"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Get category path
    cursor.execute('SELECT path FROM categories WHERE id = ?', (category_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Category not found")
    
    path = row['path']
    
    # Delete subcategories
    cursor.execute('DELETE FROM categories WHERE path = ? OR path LIKE ?', 
                  (path, f"{path}/%"))
    
    # Update links
    cursor.execute('DELETE FROM links WHERE category_path = ? OR category_path LIKE ?', 
                  (path, f"{path}/%"))
    
    conn.commit()
    conn.close()
    
    return {'status': 'deleted'}


# ==================== Links Endpoints ====================

@app.get("/api/links")
async def get_links(category_path: Optional[str] = None):
    """Get all links, optionally filtered by category"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if category_path:
        cursor.execute('SELECT * FROM links WHERE category_path = ? ORDER BY position', (category_path,))
    else:
        cursor.execute('SELECT * FROM links ORDER BY position')
    
    links = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return {'links': links}


@app.post("/api/links")
async def create_link(link: LinkCreate):
    """Create a new link"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if link.timestamp is None:
        link.timestamp = int(datetime.now().timestamp())
    if link.position is None:
        cursor.execute('SELECT COALESCE(MAX(position), 0) + 1 FROM links')
        link.position = cursor.fetchone()[0]
    
    cursor.execute('''
        INSERT INTO links (category_path, title, base_link, original_link, chat_id, type, 
                          status, group_link, timestamp, subscribers, post_count, language, 
                          description, position)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (link.category_path, link.title, link.base_link, link.original_link, 
          link.chat_id, link.type, link.status, link.group_link, link.timestamp,
          link.subscribers, link.post_count, link.language, link.description, link.position))
    
    link_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    return {'id': link_id, **link.model_dump()}


@app.put("/api/links/{link_id}")
async def update_link(link_id: int, link: LinkUpdate):
    """Update a link"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    updates = []
    values = []
    
    for field, value in link.model_dump(exclude_unset=True).items():
        updates.append(f"{field} = ?")
        values.append(value)
    
    if not updates:
        conn.close()
        raise HTTPException(status_code=400, detail="No fields to update")
    
    values.append(link_id)
    cursor.execute(f'UPDATE links SET {",".join(updates)} WHERE id = ?', values)
    
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Link not found")
    
    conn.commit()
    conn.close()
    
    return {'status': 'updated'}


@app.delete("/api/links/{link_id}")
async def delete_link(link_id: int):
    """Delete a link"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('DELETE FROM links WHERE id = ?', (link_id,))
    
    if cursor.rowcount == 0:
        conn.close()
        raise HTTPException(status_code=404, detail="Link not found")
    
    conn.commit()
    conn.close()
    
    return {'status': 'deleted'}


@app.post("/api/bulk_import")
async def bulk_import(request: BulkImportRequest):
    """Bulk import links from text"""
    items = await telethon_service.process_bulk_input(request.text)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    
    imported = []
    for item in items:
        cursor.execute('SELECT COUNT(*) FROM links WHERE base_link = ? AND category_path = ?', 
                      (item['base_link'], request.category_path))
        if cursor.fetchone()[0] == 0:
            cursor.execute('''
                INSERT INTO links (category_path, title, base_link, original_link, chat_id, type,
                                  status, group_link, timestamp, subscribers, post_count, language,
                                  description, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                        (SELECT COALESCE(MAX(position), 0) + 1 FROM links))
            ''', (request.category_path, item['title'], item['base_link'], item['original_link'],
                  item['chat_id'], item['type'], item['status'], item['group_link'],
                  int(datetime.now().timestamp()), item['subscribers'], item['post_count'],
                  item['language'], item['description']))
            imported.append(item)
    
    conn.commit()
    conn.close()
    
    return {'imported': imported, 'count': len(imported)}


# ==================== Automation Endpoints ====================

@app.post("/api/automation/start")
async def start_automation_job(request: AutomationJobRequest, background_tasks: BackgroundTasks):
    """Start an automation job"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Create job record
    link_ids_json = json.dumps(request.link_ids) if request.link_ids else '[]'
    cursor.execute('''
        INSERT INTO automation_jobs (job_type, account_id, target_link_ids, status, progress)
        VALUES (?, ?, ?, 'pending', 0)
    ''', (request.job_type, request.account_id, link_ids_json))
    job_id = cursor.lastrowid
    conn.commit()
    conn.close()
    
    # Map job types to functions
    job_handlers = {
        'metrics_sync': run_metrics_sync,
        'recency_verify': run_recency_verify,
        'language_classify': run_language_classify,
        'description_scrape': run_description_scrape,
        'discovery_crawl': run_discovery_crawl
    }
    
    if request.job_type not in job_handlers:
        raise HTTPException(status_code=400, detail=f"Unknown job type: {request.job_type}")
    
    # Prepare arguments
    handler = job_handlers[request.job_type]
    args = [job_id, request.link_ids or [], request.account_id]
    
    if request.job_type == 'recency_verify' and request.params:
        args.append(request.params.get('threshold_date', datetime.now().strftime('%Y-%m-%d')))
    elif request.job_type == 'discovery_crawl' and request.params:
        args.append(request.params.get('posts_count', 5))
    else:
        args.append(None)  # ws placeholder
    
    # Run job in background
    background_tasks.add_task(handler, *args)
    
    return {'job_id': job_id, 'status': 'started'}


@app.get("/api/automation/jobs/{job_id}")
async def get_job_status(job_id: int):
    """Get job status and logs"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    cursor.execute('SELECT * FROM automation_jobs WHERE id = ?', (job_id,))
    job = cursor.fetchone()
    
    if not job:
        conn.close()
        raise HTTPException(status_code=404, detail="Job not found")
    
    cursor.execute('SELECT * FROM automation_logs WHERE job_id = ? ORDER BY timestamp', (job_id,))
    logs = [dict(row) for row in cursor.fetchall()]
    
    conn.close()
    
    return {
        'job': dict(job),
        'logs': logs
    }


@app.websocket("/ws/automation/{job_id}")
async def websocket_automation(websocket: WebSocket, job_id: int):
    """WebSocket endpoint for live job progress"""
    await websocket.accept()
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        while True:
            cursor.execute('SELECT status, progress FROM automation_jobs WHERE id = ?', (job_id,))
            job = cursor.fetchone()
            
            if not job:
                await websocket.send_json({'error': 'Job not found'})
                break
            
            await websocket.send_json({
                'status': job['status'],
                'progress': job['progress']
            })
            
            if job['status'] in ('completed', 'failed'):
                break
            
            await asyncio.sleep(1)
        
        conn.close()
    except WebSocketDisconnect:
        pass


# ==================== Utility Endpoints ====================

@app.post("/api/analyze_url")
async def analyze_url(url: str):
    """Analyze a URL"""
    return telethon_service.analyze_url(url)


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        'status': 'healthy',
        'telegram_clients': len(telethon_service.clients),
        'timestamp': int(datetime.now().timestamp())
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
