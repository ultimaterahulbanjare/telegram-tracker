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

// Date ko YYYY-MM-DD format me convert (stats ke liye)
function formatDateYYYYMMDD(timestamp) {
  const d = new Date(timestamp * 1000);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ----- Health check route -----
app.get('/', (req, res) => {
  res.send('Telegram Funnel Bot running ✅');
});

// OPTIONAL: Debug route to see last joins from DB
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

// ----- JSON Stats API: /api/stats -----
app.get('/api/stats', (req, res) => {
  try {
    // 1) Total joins
    const totalRow = db.prepare('SELECT COUNT(*) AS cnt FROM joins').get();
    const totalJoins = totalRow.cnt || 0;

    // 2) Today joins (server time ke hisaab se)
    const now = Math.floor(Date.now() / 1000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTs = Math.floor(startOfDay.getTime() / 1000);

    const todayRow = db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM joins WHERE joined_at >= ? AND joined_at <= ?'
      )
      .get(startOfDayTs, now);
    const todayJoins = todayRow.cnt || 0;

    // 3) Last 7 days breakdown
    const sevenDaysAgoTs = now - 7 * 24 * 60 * 60;
    const rows7 = db
      .prepare(
        'SELECT joined_at FROM joins WHERE joined_at >= ? ORDER BY joined_at ASC'
      )
      .all(sevenDaysAgoTs);

    const byDateMap = {};
    for (const r of rows7) {
      const dateKey = formatDateYYYYMMDD(r.joined_at);
      if (!byDateMap[dateKey]) byDateMap[dateKey] = 0;
      byDateMap[dateKey] += 1;
    }

    const last7Days = Object.keys(byDateMap)
      .sort()
      .map((date) => ({
        date,
        count: byDateMap[date],
      }));

    // 4) By channel summary
    const channels = db
      .prepare(`
        SELECT 
          channel_id,
          channel_title,
          COUNT(*) AS total
        FROM joins
        GROUP BY channel_id, channel_title
        ORDER BY total DESC
      `)
      .all();

    res.json({
      ok: true,
      total_joins: totalJoins,
      today_joins: todayJoins,
      last_7_days: last7Days,
      by_channel: channels,
    });
  } catch (err) {
    console.error('❌ Error in /api/stats:', err);
    res.status(500).json({ ok: false, error: 'Internal error' });
  }
});

// ----- HTML Dashboard: /dashboard -----
app.get('/dashboard', (req, res) => {
  try {
    const totalRow = db.prepare('SELECT COUNT(*) AS cnt FROM joins').get();
    const totalJoins = totalRow.cnt || 0;

    const now = Math.floor(Date.now() / 1000);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTs = Math.floor(startOfDay.getTime() / 1000);

    const todayRow = db
      .prepare(
        'SELECT COUNT(*) AS cnt FROM joins WHERE joined_at >= ? AND joined_at <= ?'
      )
      .get(startOfDayTs, now);
    const todayJoins = todayRow.cnt || 0;

    const sevenDaysAgoTs = now - 7 * 24 * 60 * 60;
    const rows7 = db
      .prepare(
        'SELECT joined_at FROM joins WHERE joined_at >= ? ORDER BY joined_at ASC'
      )
      .all(sevenDaysAgoTs);

    const byDateMap = {};
    for (const r of rows7) {
      const dateKey = formatDateYYYYMMDD(r.joined_at);
      if (!byDateMap[dateKey]) byDateMap[dateKey] = 0;
      byDateMap[dateKey] += 1;
    }

    const last7Days = Object.keys(byDateMap)
      .sort()
      .map((date) => ({
        date,
        count: byDateMap[date],
      }));

    const channels = db
      .prepare(`
        SELECT 
          channel_id,
          channel_title,
          COUNT(*) AS total
        FROM joins
        GROUP BY channel_id, channel_title
        ORDER BY total DESC
      `)
      .all();

    // Simple HTML render
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Telegram Funnel Stats</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #0f172a;
            color: #e5e7eb;
            padding: 24px;
          }
          .container {
            max-width: 900px;
            margin: 0 auto;
          }
          h1 {
            font-size: 24px;
            margin-bottom: 16px;
          }
          .cards {
            display: flex;
            gap: 16px;
            flex-wrap: wrap;
            margin-bottom: 24px;
          }
          .card {
            background: #111827;
            border-radius: 12px;
            padding: 16px 18px;
            flex: 1 1 180px;
            min-width: 180px;
          }
          .card h2 {
            font-size: 14px;
            color: #9ca3af;
            margin-bottom: 8px;
          }
          .card .value {
            font-size: 22px;
            font-weight: 600;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
          }
          th, td {
            padding: 8px 10px;
            border-bottom: 1px solid #1f2937;
            font-size: 13px;
          }
          th {
            text-align: left;
            color: #9ca3af;
          }
          tr:hover {
            background: #111827;
          }
          .section-title {
            font-size: 16px;
            margin: 16px 0 8px;
          }
          .muted {
            color: #6b7280;
            font-size: 12px;
          }
          @media (max-width: 600px) {
            .cards {
              flex-direction: column;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Telegram Funnel Stats 📊</h1>

          <div class="cards">
            <div class="card">
              <h2>Total Joins</h2>
              <div class="value">${totalJoins}</div>
            </div>
            <div class="card">
              <h2>Today Joins</h2>
              <div class="value">${todayJoins}</div>
            </div>
          </div>

          <div>
            <div class="section-title">Last 7 Days</div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Joins</th>
                </tr>
              </thead>
              <tbody>
                ${
                  last7Days.length === 0
                    ? `<tr><td colspan="2" class="muted">No data yet</td></tr>`
                    : last7Days
                        .map(
                          (d) => `
                  <tr>
                    <td>${d.date}</td>
                    <td>${d.count}</td>
                  </tr>`
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>

          <div>
            <div class="section-title">By Channel</div>
            <table>
              <thead>
                <tr>
                  <th>Channel Title</th>
                  <th>Channel ID</th>
                  <th>Total Joins</th>
                </tr>
              </thead>
              <tbody>
                ${
                  channels.length === 0
                    ? `<tr><td colspan="3" class="muted">No data yet</td></tr>`
                    : channels
                        .map(
                          (c) => `
                  <tr>
                    <td>${c.channel_title || '(no title)'}</td>
                    <td>${c.channel_id}</td>
                    <td>${c.total}</td>
                  </tr>`
                        )
                        .join('')
                }
              </tbody>
            </table>
          </div>

          <div class="muted">
            Simple v1 dashboard – future: add client login, filters, date range, etc.
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('❌ Error in /dashboard:', err);
    res.status(500).send('Internal error');
  }
});

// ----- Start server -----
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
