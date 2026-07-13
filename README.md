# Telegram Bookmark Manager

A powerful web-based application for managing, categorizing, and analyzing Telegram channels and bookmarks. Built with **FastAPI**, **Telethon**, and modern JavaScript.

## Features

- 📂 **Hierarchical Categories**: Organize channels in nested folders
- 🔍 **Smart Discovery**: Extract channel info, detect languages, find discussion groups
- ⚙️ **Automation Suite**: 
  - Sync subscriber counts and post metrics
  - Verify channel activity recency
  - Classify content languages
  - Scrape channel descriptions
  - Discover forwarded channels
- 👥 **Multi-Account Support**: Connect multiple Telegram accounts (user clients)
- 📊 **Live Progress Tracking**: Real-time WebSocket updates for long-running jobs
- 💾 **Export/Import**: Standard Netscape bookmarks format or database backup

## Architecture

```
┌─────────────────┐
│   Frontend      │  (HTML/CSS/JS)
│   (Browser)     │
└────────┬────────┘
         │ REST API + WebSocket
         ▼
┌─────────────────┐
│   Backend       │  (FastAPI + Python)
│   Server        │
│  ┌───────────┐  │
│  │ Telethon  │  │  (Telegram Client)
│  │ Service   │  │
│  └───────────┘  │
│  ┌───────────┐  │
│  │ SQLite    │  │  (Database)
│  │   DB      │  │
│  └───────────┘  │
└─────────────────┘
```

## Quick Start (Windows)

### Prerequisites

1. **Python 3.8+** from [python.org](https://python.org)
2. **Telegram API Credentials** from [my.telegram.org](https://my.telegram.org/apps)

### Installation

1. **Get API Credentials**:
   - Visit https://my.telegram.org/apps
   - Create a new application
   - Copy your **API ID** and **API Hash**

2. **Configure Environment**:
   ```cmd
   copy .env.example .env
   ```
   Edit `.env` and add your credentials:
   ```
   TG_API_ID=12345678
   TG_API_HASH=your_api_hash_here
   ```

3. **Run the Application**:
   ```cmd
   run.bat
   ```

4. **Open Browser**: Navigate to http://127.0.0.1:8000

## Project Structure

```
telegram-bookmark-manager/
├── backend/
│   ├── main.py              # FastAPI server with Telethon integration
│   └── requirements.txt     # Python dependencies
├── frontend/
│   └── api_client.js        # REST API client for backend communication
├── data/
│   ├── bookmarks.db         # SQLite database (auto-created)
│   └── sessions/            # Encrypted Telegram session files
├── .env                     # Environment configuration (create from .env.example)
├── .env.example             # Example configuration template
├── run.bat                  # Windows startup script
├── index.html               # Main UI
├── styles.css               # Styling
├── app.js                   # Main application logic
├── ui.js                    # UI rendering functions
├── automation.js            # Automation triggers (now API-based)
├── crawler.js               # Legacy (deprecated, moved to backend)
├── parser.js                # Text parsing utilities
├── storage.js               # Legacy localStorage (deprecated)
└── SETUP_WINDOWS.md         # Detailed setup guide
```

## First-Time Setup

### 1. Add Telegram Account

1. Click **"Account Management"** in the sidebar
2. Click **"Add New Account"**
3. Enter phone number (e.g., `+989123456789`)
4. Enter verification code from Telegram
5. If 2FA enabled, enter password

### 2. Import Channels

1. Click **"➕ Add Bookmarks"** → **"Add Bulk Raw Text"**
2. Paste channel usernames or URLs
3. Click **"Analyze Inputs"**
4. Select channels to import
5. Choose destination folder
6. Click **"Import Checked to Library"**

### 3. Run Automation

1. Select channels from the table
2. Click **"⚙️ Automation Actions"**
3. Choose action:
   - 🔄 Pull Selected Metrics
   - 📅 Verify Activity Recency
   - 🌐 Run Language Classifiers
   - 📝 Scrape Selected Bios
   - 🔍 Crawl Forward For New Channels
4. Monitor progress in real-time console

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all categories |
| POST | `/api/categories` | Create category |
| DELETE | `/api/categories/{path}` | Delete category |
| GET | `/api/links` | List links (with filters) |
| POST | `/api/links` | Create link |
| PUT | `/api/links/{id}` | Update link |
| DELETE | `/api/links/{id}` | Delete link |
| POST | `/api/accounts` | Add Telegram account |
| POST | `/api/auth/send_code` | Send verification code |
| POST | `/api/auth/verify_code` | Verify login code |
| POST | `/api/auth/verify_password` | Verify 2FA password |
| POST | `/api/automation/start` | Start automation job |
| WS | `/api/automation/stream/{job_id}` | Live job progress |
| GET | `/api/export` | Export bookmarks |
| GET | `/api/export_db` | Download database backup |

## Security Notes

- 🔒 Sessions are encrypted using Fernet (symmetric encryption)
- 🔑 API credentials stored in `.env` (never commit this file)
- 🌐 Server runs locally only (not exposed to internet by default)
- 👤 Uses **user client** (Telethon) instead of bot API for full channel access

## Troubleshooting

### "Telegram API credentials not configured"
Ensure `.env` file exists with valid `TG_API_ID` and `TG_API_HASH`.

### "No module named 'telethon'"
Run: `pip install -r backend\requirements.txt`

### Port 8000 already in use
Change `PORT` in `.env` or stop other applications using port 8000.

### Authentication fails
Delete session files in `data/sessions/` and re-authenticate.

## Development

### Manual Setup (without run.bat)

```cmd
# Create virtual environment
python -m venv venv

# Activate
venv\Scripts\activate

# Install dependencies
pip install -r backend\requirements.txt

# Start server
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### Updating Dependencies

```cmd
venv\Scripts\activate
pip install -r backend\requirements.txt --upgrade
```

## License

MIT License

## Credits

- **FastAPI**: Modern Python web framework
- **Telethon**: Async Telegram client library
- **SQLite**: Lightweight database engine
