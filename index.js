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
const ADMIN_KEY = process.env.ADMIN_KEY || "secret123";

// Default Pixel & LP (fallback)
const DEFAULT_META_PIXEL_ID = '1340877837162888';
const DEFAULT_PUBLIC_LP_URL = 'https://tourmaline-flan-4abc0c.netlify.app/';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const PORT = process.env.PORT || 3000;

// ----- Simple hash helper (Meta ke liye) -----
function hashSha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Date format helper
function formatDateYYYYMMDD(timestamp) {
  const d = new Date(timestamp * 1000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ----- Health check route -----
app.get('/', (req, res) => {
  res.send('Telegram Funnel Bot running ✅');
});

// Debug joins
app.get('/debug-joins', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM joins ORDER BY id DESC LIMIT 20').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// Debug channels
app.get('/debug-channels', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM channels ORDER BY id DESC LIMIT 20').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'DB error' });
  }
});

// ----- MAIN: Telegram webhook -----
app.post('/telegram-webhook', async (req, res) => {
  const update = req.body;
  console.log("Incoming:", JSON.stringify(update,null,2));

  try {
    if (update.chat_join_request) {
      const jr = update.chat_join_request;
      const user = jr.from;
      const chat = jr.chat;

      await approveJoinRequest(chat.id, user.id);
      await sendMetaLeadEvent(user, jr);

      console.log("✅ Approved & Lead sent:", user.id);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ webhook error:", err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// Approve request
async function approveJoinRequest(chatId, userId) {
  await axios.post(`${TELEGRAM_API}/approveChatJoinRequest`, {
    chat_id: chatId,
    user_id: userId,
  });
}

// Channel config getter/creator
function getOrCreateChannelConfigFromJoin(jr, nowTs) {
  const chat = jr.chat;
  const telegramChatId = String(chat.id);

  let channel = db.prepare("SELECT * FROM channels WHERE telegram_chat_id = ?")
    .get(telegramChatId);

  if (!channel) {
    const info = db.prepare(`
      INSERT INTO channels (
        client_id,
        telegram_chat_id,
        telegram_title,
        deep_link,
        pixel_id,
        lp_url,
        created_at,
        is_active
      ) VALUES (1, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      telegramChatId,
      chat.title || null,
      null,
      DEFAULT_META_PIXEL_ID,
      DEFAULT_PUBLIC_LP_URL,
      nowTs
    );

    channel = {
      id: info.lastInsertRowid,
      client_id: 1,
      telegram_chat_id: telegramChatId,
      telegram_title: chat.title || null,
      deep_link: null,
      pixel_id: DEFAULT_META_PIXEL_ID,
      lp_url: DEFAULT_PUBLIC_LP_URL,
      created_at: nowTs,
      is_active: 1
    };
  }

  return channel;
}

// Meta + DB
async function sendMetaLeadEvent(user, joinRequest) {
  const eventTime = Math.floor(Date.now() / 1000);
  const channel = getOrCreateChannelConfigFromJoin(joinRequest, eventTime);

  const pixelId = channel.pixel_id || DEFAULT_META_PIXEL_ID;
  const lpUrl = channel.lp_url || DEFAULT_PUBLIC_LP_URL;

  const url = `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${META_ACCESS_TOKEN}`;

  const payload = {
    data: [{
      event_name: "Lead",
      event_time: eventTime,
      event_source_url: lpUrl,
      action_source: "system_generated",
      user_data: {
        external_id: hashSha256(String(user.id))
      }
    }]
  };

  await axios.post(url, payload);

  db.prepare(`
    INSERT INTO joins 
      (telegram_user_id, telegram_username, channel_id, channel_title, joined_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    String(user.id),
    user.username || null,
    String(joinRequest.chat.id),
    joinRequest.chat.title || null,
    eventTime
  );
}

// ----- ADMIN: update channel -----
app.post("/admin/update-channel", (req,res)=>{
  try {
    const { admin_key, telegram_chat_id, pixel_id, lp_url, client_id, deep_link } = req.body;

    if(admin_key !== ADMIN_KEY){
      return res.status(401).json({ok:false,error:"Unauthorized"});
    }

    const channel = db.prepare("SELECT * FROM channels WHERE telegram_chat_id=?")
      .get(String(telegram_chat_id));

    if(!channel){
      return res.status(404).json({ok:false,error:"Channel not found"});
    }

    db.prepare(`
      UPDATE channels
      SET pixel_id=?, lp_url=?, client_id=?, deep_link=?
      WHERE telegram_chat_id=?
    `).run(
      pixel_id || channel.pixel_id,
      lp_url || channel.lp_url,
      client_id || channel.client_id,
      deep_link || channel.deep_link,
      String(telegram_chat_id)
    );

    res.json({ok:true,message:"Updated"});
  } catch(err){
    res.status(500).json({ok:false,error:"Internal"});
  }
});

// ----- STATS API -----
app.get('/api/stats',(req,res)=>{
  try{
    const total = db.prepare("SELECT COUNT(*) AS c FROM joins").get().c;
    const today = db.prepare(`
      SELECT COUNT(*) AS c FROM joins
      WHERE joined_at >= ?
    `).get(Math.floor(new Date().setHours(0,0,0,0)/1000)).c;

    const channels = db.prepare(`
      SELECT channel_id, channel_title, COUNT(*) AS total
      FROM joins GROUP BY channel_id
    `).all();

    res.json({ok:true,total,today,channels});
  }catch(err){
    res.status(500).json({ok:false});
  }
});

// ----- Start server -----
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
