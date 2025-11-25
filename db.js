const Database = require('better-sqlite3');

// DB file ka naam (ye hi file me sab data store hoga)
const db = new Database('telegram_funnel.db');

// --- Table: clients (future SaaS users / agencies) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    api_key TEXT,
    created_at INTEGER
  );
`);

// --- Table: channels (har Telegram channel ki config) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,             -- kis client ka channel hai (future use)
    telegram_chat_id TEXT UNIQUE,  -- Telegram ka chat.id (e.g. -1002065xxxxx)
    telegram_title TEXT,
    deep_link TEXT,                -- t.me/+... link (optional)
    pixel_id TEXT,                 -- is channel ka Pixel ID
    lp_url TEXT,                   -- is channel ka LP URL
    created_at INTEGER,
    is_active INTEGER DEFAULT 1
  );
`);

// --- Table: joins log (pehle se tha, as it is) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS joins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT,
    telegram_username TEXT,
    channel_id TEXT,
    channel_title TEXT,
    joined_at INTEGER,       -- UNIX timestamp (seconds)
    meta_event_id TEXT       -- optional future use
  );
`);

module.exports = db;
