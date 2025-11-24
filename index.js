// Load environment variables from .env (Render / local dono ke liye)
require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const db = require('./db'); // SQLite (better-sqlite3) DB connection

const app = express();
app.use(express.json());

// ----- Config from env -----
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

// Pixel & LP URL (Pixel ID yahi change karna hoga)
const META_PIXEL_ID = '1340877837162888';
const PUBLIC_LP_URL = 'https://tourmaline-flan-4abc0c.netlify.app/';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const PORT = process.env.PORT || 3000;

// ----- Simple hash helper (Meta ke liye) -----
function hashSha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// ----- Health check route -----
app.get('/', (req, res) => {
  res.send('Telegram Funnel Bot running ✅');
});

// OPTIONAL: Debug route to see last joins from DB
// (Testing ke baad ise hata bhi sakte ho)
app.get('/debug-joins', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM joins ORDER BY id DESC LIMIT 20')
      .all();

    res.json(rows);
  } catch (err) {
    console.error('❌ Error reading DB:', err.message);
    res.status(500).json({ error: 'DB error' });
  }
});

// ----- MAIN: Telegram webhook -----
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;
  console.log('Incoming update:', JSON.stringify(update, null, 2));

  try {
    // 1) Join request ko handle karo
    if (update.chat_join_request) {
      const jr = update.chat_join_request;
      const user = jr.from;
      const chat = jr.chat;

      // 1. Auto-approve join request
      await approveJoinRequest(chat.id, user.id);

      // 2. Meta CAPI Lead event bhejo + DB me store karo
      await sendMetaLeadEvent(user, jr);

      console.log('✅ Approved & sent Meta Lead for user:', user.id);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(
      '❌ Error in webhook handler:',
      err.response?.data || err.message
    );
    res.sendStatus(500);
  }
});

// ----- Helper: approve join request -----
async function approveJoinRequest(chatId, userId) {
  const url = `${TELEGRAM_API}/approveChatJoinRequest`;
  const payload = {
    chat_id: chatId,
    user_id: userId,
  };

  const res = await axios.post(url, payload);
  console.log('Telegram approve response:', res.data);
}

// ----- Helper: send Meta CAPI Lead + DB insert -----
async function sendMetaLeadEvent(user, joinRequest) {
  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  // Telegram user id ko external_id ke roop me hash kar rahe hain
  const externalIdHash = hashSha256(String(user.id));
  const eventTime = Math.floor(Date.now() / 1000);

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: eventTime,
        event_source_url: PUBLIC_LP_URL,
        action_source: 'system_generated',
        user_data: {
          external_id: externalIdHash,
        },
      },
    ],
  };

  // 1) Meta CAPI ko event bhejo
  const res = await axios.post(url, payload);
  console.log('Meta CAPI response:', res.data);

  // 2) DB me join log store karo
  const stmt = db.prepare(`
    INSERT INTO joins 
      (telegram_user_id, telegram_username, channel_id, channel_title, joined_at, meta_event_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const channel = joinRequest.chat;

  stmt.run(
    String(user.id),
    user.username || null,
    String(channel.id),
    channel.title || null,
    eventTime,
    null // meta_event_id future ke liye
  );

  console.log('✅ Join stored in DB for user:', user.id);
}

// ----- Start server -----
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
