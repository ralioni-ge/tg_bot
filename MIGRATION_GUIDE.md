# Migration Guide: Client-Only to Server-Based Architecture

## Overview

This guide explains how to migrate your existing Telegram Bookmark Manager from a client-only architecture (using MTKruto in the browser) to a server-based architecture using FastAPI + Telethon.

## Key Changes

### Before (Client-Only)
- All data stored in browser `localStorage`
- Telegram connection via MTKruto library in browser
- Automation runs in browser tabs
- Sessions stored in browser IndexedDB

### After (Server-Based)
- Data stored in SQLite database (`data/bookmarks.db`)
- Telegram connection via Telethon on server
- Automation runs as background jobs on server
- Sessions stored encrypted in database
- Works even when browser is closed

## API Endpoints Mapping

| Old (Client-Side) | New (API Endpoint) | Method |
|-------------------|-------------------|--------|
| `getCategories()` | `/api/categories` | GET |
| `saveCategories()` | `/api/categories` | POST |
| `getLinks()` | `/api/links` | GET |
| `saveLinks()` | `/api/links` | POST |
| N/A | `/api/links/{id}` | PUT |
| N/A | `/api/links/{id}` | DELETE |
| `processBulkInput()` | `/api/bulk_import` | POST |
| `analyzeUrl()` | `/api/analyze_url` | POST |
| N/A | `/api/auth/accounts` | POST/GET/DELETE |
| N/A | `/api/automation/start` | POST |
| N/A | `/api/automation/jobs/{id}` | GET |
| N/A | `/ws/automation/{job_id}` | WebSocket |

## Frontend Integration Example

### Old Code (storage.js)
```javascript
import { getLinks, saveLinks } from './storage.js';

const links = getLinks();
links.push(newLink);
saveLinks(links);
```

### New Code (API-based)
```javascript
// Get all links
async function getLinks() {
    const response = await fetch('/api/links');
    const data = await response.json();
    return data.links;
}

// Create a new link
async function createLink(linkData) {
    const response = await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(linkData)
    });
    return await response.json();
}

// Update a link
async function updateLink(linkId, updates) {
    const response = await fetch(`/api/links/${linkId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    return await response.json();
}
```

## Authentication Flow

### Adding a New Telegram Account

```javascript
// Step 1: Create account and send code
const response = await fetch('/api/auth/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        label: 'My Account',
        phone: '+1234567890'
    })
});
const { account_id } = await response.json();

// Step 2: User enters code from Telegram
const verifyResponse = await fetch('/api/auth/verify_code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        account_id: account_id,
        code: '12345'
    })
});

// If 2FA is enabled, you'll get { status: '2fa_required' }
// Then call /api/auth/verify_password with the password
```

## Automation Jobs

### Starting an Automation Job

```javascript
// Start metrics sync for selected links
const response = await fetch('/api/automation/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        job_type: 'metrics_sync',
        account_id: 1, // Optional: which Telegram account to use
        link_ids: [1, 2, 3] // IDs of links to process
    })
});
const { job_id } = await response.json();

// Monitor job progress via polling
async function checkJobStatus(jobId) {
    const response = await fetch(`/api/automation/jobs/${jobId}`);
    const data = await response.json();
    console.log(`Progress: ${data.job.progress}%`);
    console.log('Logs:', data.logs);
    
    if (data.job.status !== 'completed') {
        setTimeout(() => checkJobStatus(jobId), 1000);
    }
}

checkJobStatus(job_id);
```

### Using WebSocket for Live Updates

```javascript
const ws = new WebSocket(`ws://localhost:8000/ws/automation/${job_id}`);

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log(`Progress: ${data.progress}%`);
    console.log(`Status: ${data.status}`);
};

ws.onclose = () => {
    console.log('Job completed');
};
```

## Bulk Import Example

```javascript
const text = `@durov
https://t.me/telegram
@some_channel`;

const response = await fetch('/api/bulk_import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        text: text,
        category_path: 'Education/Engineering'
    })
});

const result = await response.json();
console.log(`Imported ${result.count} links`);
```

## Running the Backend Server

### Development

```bash
cd backend
pip install -r requirements.txt
export TG_API_ID=your_api_id
export TG_API_HASH=your_api_hash
python main.py
```

### Production with Uvicorn

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --workers 4
```

### With Docker (Optional)

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY data/ ./data/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Data Migration

To migrate existing data from localStorage to the new database:

1. Export data from current app (use the Export feature)
2. Start the backend server
3. Use the import endpoint or manually parse and insert:

```javascript
// Example migration script
const exportedData = localStorage.getItem('bookmarks_links');
const links = JSON.parse(exportedData);

for (const link of links) {
    await fetch('/api/links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(link)
    });
}
```

## Security Considerations

1. **API Credentials**: Never expose `TG_API_ID` and `TG_API_HASH` in frontend code
2. **Session Storage**: Sessions are stored server-side, not in browser
3. **CORS**: Configure CORS properly in production
4. **Authentication**: Add authentication layer for the admin panel
5. **Rate Limiting**: Implement rate limiting to prevent abuse

## Next Steps

1. ✅ Backend server implemented with FastAPI + Telethon
2. ✅ SQLite database with all required tables
3. ✅ Multi-account support
4. ✅ Automation jobs running on server
5. ⏳ Frontend integration (update `storage.js`, `crawler.js`, `automation.js`)
6. ⏳ WebSocket integration for live progress
7. ⏳ Admin authentication for the panel
8. ⏳ Session encryption with Fernet
