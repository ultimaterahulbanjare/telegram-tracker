const Database = require('better-sqlite3');

// DB file ka naam (ye hi file me sab data store hoga)
const db = new Database('telegram_funnel.db');

// Table create: joins log
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
