const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;

const META_PIXEL_ID = '1340877837162888';
const PUBLIC_LP_URL = 'https://tourmaline-flan-4abc0c.netlify.app/';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const PORT = process.env.PORT || 3000;

// Simple hash helper (Meta ke liye)
function hashSha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Health check route
app.get('/', (req, res) => {
  res.send('Telegram Funnel Bot running ✅');
});

// MAIN: Telegram webhook
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

      // 2. Meta CAPI Lead event bhejo
      await sendMetaLeadEvent(user, jr);

      console.log('✅ Approved & sent Meta Lead for user:', user.id);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('❌ Error in webhook handler:', err.response?.data || err.message);
    res.sendStatus(500);
  }
});

// Helper: approve join request
async function approveJoinRequest(chatId, userId) {
  const url = `${TELEGRAM_API}/approveChatJoinRequest`;
  const payload = {
    chat_id: chatId,
    user_id: userId,
  };

  const res = await axios.post(url, payload);
  console.log('Telegram approve response:', res.data);
}

// Helper: send Meta CAPI Lead
async function sendMetaLeadEvent(user, joinRequest) {
  const url = `https://graph.facebook.com/v18.0/${META_PIXEL_ID}/events?access_token=${META_ACCESS_TOKEN}`;

  // Telegram user id ko external_id ke roop me hash kar rahe hain
  const externalIdHash = hashSha256(String(user.id));

  const payload = {
    data: [
      {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: PUBLIC_LP_URL,
        action_source: 'system_generated',
        user_data: {
          external_id: externalIdHash,
        },
      },
    ],
  };

  const res = await axios.post(url, payload);
  console.log('Meta CAPI response:', res.data);
}

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
