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
    client_id INTEGER,
    telegram_chat_id TEXT UNIQUE,
    telegram_title TEXT,
    deep_link TEXT,
    pixel_id TEXT,
    lp_url TEXT,
    created_at INTEGER,
    is_active INTEGER DEFAULT 1
  );
`);

// --- Table: joins log ---
db.exec(`
  CREATE TABLE IF NOT EXISTS joins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_user_id TEXT,
    telegram_username TEXT,
    channel_id TEXT,
    channel_title TEXT,
    joined_at INTEGER,
    meta_event_id TEXT
  );
`);

// 🔹 NEW TABLE: pre_leads (LP JOIN click → fbc store)
db.exec(`
  CREATE TABLE IF NOT EXISTS pre_leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id TEXT NOT NULL,
    fbc TEXT,
    created_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
`);

// --- Ensure ek default client row ho always (id=1) ---
const defaultClient = db.prepare(`SELECT id FROM clients WHERE id = 1`).get();
if (!defaultClient) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO clients (id, name, email, api_key, created_at)
    VALUES (1, 'Default Client', 'default@example.com', 'DEFAULT_KEY', ?)
  `).run(now);

  console.log("✅ Default client created (id=1)");
}

module.exports = db;
