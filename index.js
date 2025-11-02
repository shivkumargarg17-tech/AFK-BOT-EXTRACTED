// ───────────────────────────────────────────────
// 🧾 Minecraft 24/7 Roaster Bot (Coded By Legend)
// ───────────────────────────────────────────────
//
// ✅ Works on Render + UptimeRobot combo
// ✅ No settings.json needed
// ✅ Sends random desi roast messages
// ✅ Moves every second to avoid idle kick
// ✅ Auto reconnects after disconnect
// ✅ Server stays alive with UptimeRobot pinging Render
// ✅ Tested on Purpur/Bukkit 1.21.1 and below with ViaBackwards
//
// 🌐 Made with ❤️ by "Legend"
// ───────────────────────────────────────────────

const mineflayer = require('mineflayer');
const express = require('express');

// ── Express webserver to keep bot alive on Render ──
const app = express();
app.get('/', (req, res) => res.send('🔥 Bot is running 24/7 — Coded By Legend 🔥'));
app.listen(process.env.PORT || 8000, () => {
  console.log('[WEB] Express server started. UptimeRobot will ping this to stay awake.');
});

// ── Configuration ──
const config = {
  username: "CodedByLegend",     // Bot username
  host: "HOGAKING.aternos.me",   // Your Aternos IP (no port if SRV)
  port: 19754,                   // Server port (if needed)
  version: "1.21.1",             // Minecraft version
  chatDelay: 60,                 // Seconds between roasts
  moveDelay: 1000,               // Bot moves every 1 second
  reconnectDelay: 15000          // 15 seconds before rejoining
};

// ── Desi Roast Messages ──
const ROASTS = [
  "Bhai tu game khelta hai ya lag show karta hai?",
  "Tere PvP se zyada slow to Airtel ka customer care hai.",
  "Main afk hoon fir bhi tu haar gaya!",
  "Realm khareed ke bhi skill download nahi hoti bhai.",
  "Tu diamond armor pehne ke bhi mar gaya? Respect gaya!",
  "Tere aim pe doubt hai ya mouse pe?",
  "Bro mobile pe khel raha hai kya? Lag se zyada tu freeze hai.",
  "Main code se chalta hoon, tu excuses se.",
  "Server ke mobs bhi tujhe ignore karte hain.",
  "Game me pro banna mushkil nahi, tere liye namumkin hai.",
  "Tere hits dekh ke skeleton bhi haste hain.",
  "Main 24/7 online hoon, tu 24/7 respawn pe.",
  "Khelne se pehle tutorial dekh le bhai, hamare liye asaan ho jayega.",
  "Tere ping se zyada delay to school bell me bhi nahi hota.",
  "Bro tu hacker nahi, packet loss ka ambassador hai.",
  "Aaj bhi tu practice kar raha hai ya YouTube dekh raha hai?",
  "Owner ki meherbani se server chal raha hai — respect 🙏"
];

// ── Bot Creation Function ──
function createBot() {
  const bot = mineflayer.createBot({
    username: config.username,
    host: config.host,
    port: config.port,
    version: config.version
  });

  // ── On Bot Spawn ──
  bot.once('spawn', () => {
    console.log(`[BOT] ${config.username} joined the server.`);

    // Move slightly every second to avoid AFK
    setInterval(() => {
      const x = Math.random() > 0.5 ? 1 : -1;
      const z = Math.random() > 0.5 ? 1 : -1;
      bot.setControlState('forward', true);
      setTimeout(() => bot.setControlState('forward', false), 200);
      bot.look(x, z);
    }, config.moveDelay);

    // Send random roast message every 60 seconds
    setInterval(() => {
      const msg = ROASTS[Math.floor(Math.random() * ROASTS.length)];
      bot.chat(msg);
      console.log(`[CHAT] Sent message: ${msg}`);
    }, config.chatDelay * 1000);
  });

  // ── Handle Disconnects ──
  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Reconnecting in ${config.reconnectDelay / 1000}s...`);
    setTimeout(createBot, config.reconnectDelay);
  });

  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

// ── Start the Bot ──
createBot();

// ───────────────────────────────────────────────
// 💡 HOSTING INSTRUCTIONS:
//
// 1️⃣ Upload this file + package.json to Render.
// 2️⃣ In Render: "New Web Service" → "Node.js" → Connect your repo.
// 3️⃣ Start Command: `node index.js`
// 4️⃣ Deploy.
//
// 5️⃣ In UptimeRobot → Add new HTTP monitor
//     → URL: your Render web link (e.g., https://yourbot.onrender.com)
//     → Interval: 5 minutes
//
// This keeps the Render service awake 24/7,
// so your bot never goes offline 🔥
// ───────────────────────────────────────────────
