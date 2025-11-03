// index.js - AFK Roaster Bot (CommonJS)
// Bot name: CodedByLegend
// Server: HOGAKING.aternos.me:19754
// Works with Render + self-ping for uptime

const mineflayer = require('mineflayer');
const express = require('express');

const app = express();

// --- Web server for Render / uptime monitors ---
app.get('/', (req, res) => res.send('Bot is running 24/7 - CodedByLegend'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// --- Minecraft connection settings (already set to your server) ---
const MINECRAFT_HOST = 'HOGAKING.aternos.me';
const MINECRAFT_PORT = 19754;
const BOT_USERNAME = 'CodedByLegend';

// --- Roast lines (no emojis) ---
const roastLines = [
  "Bhai tu to creeper se bhi kam dhamaka karta hai.",
  "Aree bhai tu chal raha hai ya server lag ho gaya?",
  "Tere aim dekh ke skeleton bhi sharma jaaye.",
  "Tu maarne gaya tha ya selfie lene?",
  "Tere move dekh ke lagta hai Wi-Fi dukaan se liya hai.",
  "Bro tu fight karta hai ya yoga kar raha hai?",
  "Tere jaise players ke liye respawn invent kiya gaya tha.",
  "Tu marne ke baad bhi excuse ready rakhta hai kya?",
  "Aree bhai tu mining kar raha hai ya chhup-chhup ke rotis paka raha hai?",
  "Server ne bhi kaha — isko kick karo, ye AFK nahi, slow hai!",
  "Tere piche zombie bhi keh rahe the — 'isse door rehna bhai!'",
  "Tere speed dekh ke ghoda bhi soch raha hai chhod yaar.",
  "Tu diamond ke sapne dekhta hai, cobblestone milta hai.",
  "Bhai tu Nether jaane layak nahi, ghar sambhal pehle."
];

// --- Create bot function (so we can reconnect cleanly) ---
function createBot() {
  const bot = mineflayer.createBot({
    host: MINECRAFT_HOST,
    port: MINECRAFT_PORT,
    username: BOT_USERNAME,
    // version: false // optional: auto detect. Remove/comment if you must pin version.
  });

  // When bot spawns
  bot.once('spawn', () => {
    console.log(`[BOT] Joined server successfully as ${BOT_USERNAME}`);
  });

  // Send a random roast (if in-game) every 60 seconds
  let roastTimer = null;
  function startRoasts() {
    if (roastTimer) clearInterval(roastTimer);
    roastTimer = setInterval(() => {
      try {
        if (bot && bot.player && bot.chat) {
          const msg = roastLines[Math.floor(Math.random() * roastLines.length)];
          bot.chat(msg);
          console.log('[ROAST] Sent:', msg);
        }
      } catch (e) {
        console.log('[ROAST] Error sending roast:', e && e.message);
      }
    }, 60 * 1000); // 60s
  }

  // Small movement every 1s to avoid AFK detection
  let moveTimer = null;
  function startMovement() {
    if (moveTimer) clearInterval(moveTimer);
    moveTimer = setInterval(() => {
      try {
        if (!bot || !bot.entity) return;
        // look around randomly and step forward briefly
        bot.look(Math.random() * Math.PI * 2, 0);
        bot.setControlState('forward', true);
        setTimeout(() => bot.setControlState('forward', false), 300); // move ~300ms
      } catch (e) {
        // ignore
      }
    }, 1000); // every 1 second
  }

  // Start modules when spawn
  bot.on('spawn', () => {
    startRoasts();
    startMovement();
  });

  // Logging helpful events
  bot.on('chat', (username, message) => {
    console.log(`[CHAT] <${username}> ${message}`);
  });

  bot.on('kicked', (reason) => {
    console.log('[KICKED] Reason:', reason);
  });

  bot.on('death', () => {
    console.log('[EVENT] Bot died; waiting to respawn.');
  });

  bot.on('respawn', () => {
    console.log('[EVENT] Bot respawned.');
  });

  bot.on('end', () => {
    console.log('[INFO] Bot disconnected. Cleaning up timers and will reconnect in 10s...');
    if (roastTimer) clearInterval(roastTimer);
    if (moveTimer) clearInterval(moveTimer);
    // reconnect after 10s
    setTimeout(() => {
      createBot();
    }, 10 * 1000);
  });

  bot.on('error', (err) => {
    console.log('[ERROR]', err && err.message ? err.message : err);
  });

  // Optional: if server forces duplicate logins, attempt reconnect after a bit
  bot.on('kicked', (reason) => {
    console.log('[KICKED EVENT] ', reason);
  });

  return bot;
}

// Start the first bot
createBot();

// --- Self-ping to keep Render awake (uses global fetch) ---
const SELF_PING_URL = 'https://afk-bot-extracted-for-render.onrender.com/'; // your render URL
setInterval(() => {
  // Node 18+ has global fetch; if not available you can npm add node-fetch and require it.
  fetch(SELF_PING_URL)
    .then(() => console.log('[PING] Self-ping succeeded'))
    .catch((e) => console.log('[PING] Self-ping failed:', e && e.message));
}, 4 * 60 * 1000); // every 4 minutes
