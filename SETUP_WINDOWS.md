# Telegram Bookmark Manager - Setup Guide for Windows

## Prerequisites

1. **Python 3.8+** installed from [python.org](https://python.org)
2. **Telegram API Credentials** from [my.telegram.org](https://my.telegram.org/apps)

## Installation Steps

### Step 1: Get Telegram API Credentials

1. Go to https://my.telegram.org/apps
2. Log in with your phone number
3. Click on "API development tools"
4. Create a new application:
   - **App title**: Any name (e.g., "Bookmark Manager")
   - **Short description**: Any description
   - **Platform**: Desktop
5. Copy your **API ID** and **API Hash**

### Step 2: Configure Environment

1. Copy `.env.example` to `.env`:
   ```cmd
   copy .env.example .env
   ```

2. Edit `.env` file and replace:
   - `your_api_id_here` with your actual API ID (numbers)
   - `your_api_hash_here` with your actual API Hash (string)
   - (Optional) Generate an encryption key for session storage:
     ```cmd
     python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
     ```
     Then paste the result as `ENCRYPTION_KEY`

### Step 3: Run the Application

**Option A: Using the batch file (Recommended)**
```cmd
run.bat
```

**Option B: Manual setup**
```cmd
# Create virtual environment
python -m venv venv

# Activate virtual environment
venv\Scripts\activate

# Install dependencies
pip install -r backend\requirements.txt

# Start the server
cd backend
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

### Step 4: Access the Application

Open your browser and go to: **http://127.0.0.1:8000**

## First-Time Setup

1. **Add a Telegram Account**:
   - Click on "Account Management" in the sidebar
   - Click "Add New Account"
   - Enter your phone number (with country code, e.g., +989123456789)
   - Enter the verification code sent by Telegram
   - If you have 2FA enabled, enter your password

2. **Import Bookmarks**:
   - Click "➕ Add Bookmarks" → "Add Bulk Raw Text"
   - Paste channel usernames or URLs
   - Click "Analyze Inputs"
   - Select the channels you want to add
   - Choose a category folder
   - Click "Import Checked to Library"

3. **Run Automation**:
   - Select channels from the table
   - Click "⚙️ Automation Actions"
   - Choose an action (e.g., "Pull Selected Metrics")
   - Watch the progress in the console

## Project Structure

```
telegram-bookmark-manager/
├── backend/
│   ├── main.py              # FastAPI server with Telethon
│   └── requirements.txt     # Python dependencies
├── data/
│   ├── bookmarks.db         # SQLite database
│   └── sessions/            # Encrypted Telegram sessions
├── frontend/                # Static files served by backend
├── .env                     # Environment configuration
├── .env.example             # Example configuration
├── run.bat                  # Windows startup script
├── index.html               # Main UI
├── styles.css               # Styling
└── [other JS files]         # Frontend logic
```

## Troubleshooting

### "Telegram API credentials not configured"
- Make sure `.env` file exists and contains valid `TG_API_ID` and `TG_API_HASH`

### "No module named 'telethon'"
- Run: `pip install -r backend\requirements.txt`

### Port 8000 already in use
- Change the PORT in `.env` or stop other applications using port 8000

### Session authentication fails
- Delete the session file in `data/sessions/` and re-authenticate

## Security Notes

- **Never share your `.env` file** - it contains sensitive credentials
- Sessions are stored encrypted in the database
- Keep your API credentials private
- The server runs locally only (not exposed to the internet)

## Updating

To update dependencies:
```cmd
venv\Scripts\activate
pip install -r backend\requirements.txt --upgrade
```
