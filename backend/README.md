# Telegram Bookmark Manager - Backend

FastAPI + Telethon backend server for managing Telegram bookmarks with multi-account support.

## Installation

```bash
pip install fastapi uvicorn telethon python-multipart pydantic
```

## Configuration

Set environment variables:

```bash
export TG_API_ID=your_api_id
export TG_API_HASH=your_api_hash
```

## Running the Server

```bash
cd backend
python main.py
```

Or with uvicorn directly:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

## API Endpoints

### Authentication

- `POST /api/auth/accounts` - Create new Telegram account
- `POST /api/auth/verify_code` - Verify login code
- `POST /api/auth/verify_password` - Verify 2FA password
- `GET /api/auth/accounts` - List all accounts
- `DELETE /api/auth/accounts/{account_id}` - Delete an account

### Categories

- `GET /api/categories` - Get all categories
- `POST /api/categories` - Create a new category
- `DELETE /api/categories/{category_id}` - Delete a category

### Links

- `GET /api/links` - Get all links (optionally filtered by category)
- `POST /api/links` - Create a new link
- `PUT /api/links/{link_id}` - Update a link
- `DELETE /api/links/{link_id}` - Delete a link
- `POST /api/bulk_import` - Bulk import links from text

### Automation

- `POST /api/automation/start` - Start an automation job
- `GET /api/automation/jobs/{job_id}` - Get job status and logs
- `WS /ws/automation/{job_id}` - WebSocket for live job progress

### Utilities

- `POST /api/analyze_url` - Analyze a URL
- `GET /api/health` - Health check endpoint

## Database

SQLite database is stored in `data/bookmarks.db` with the following tables:

- `categories` - Category hierarchy
- `links` - Bookmarked links
- `accounts` - Telegram account sessions
- `automation_jobs` - Background job tracking
- `automation_logs` - Job execution logs

## Session Management

Telegram sessions are stored securely in the database. On server startup, all saved sessions are automatically reconnected.
