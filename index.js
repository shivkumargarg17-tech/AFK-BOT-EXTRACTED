const mineflayer = require('mineflayer');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('24/7RoasterXXX is alive! 🔥'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`✅ Server started on port ${PORT}`));

// ==========================
// CONFIGURATION
// ==========================
const config = {
  username: "24/7RoasterXXX",
  password: "",
  auth: "mojang",
  host: "HOGAKING.aternos.me",
  port: 19754,
  version: "1.12.1",
  messageDelay: 60, // seconds between messages
  rejoinDelay: 10000, // 10 sec rejoin after leave
  stayDuration: 70000, // stay 70 sec before leaving
  roastMessages: [
    "While you were buying realms, I was buying knowledge😎",
    "Call me server admin, because I technically am🤣🤣",
    "You spent ₹20k on games, I spent ₹0 but still win💀",
    "24/7 online unlike some people's IQ💀🤣",
    "You paid ₹20k in game, I paid ₹0 for brain🧠🤯💀",
    "Bro bought a realm and still can't buy skill💀",
    "Not paid to win, just coded to rule🔥",
    "Imagine paying for Realms just to get carried by a bot 💀",
    "Keep spending money, I’ll keep owning servers for free 💪",
    "This bot runs smoother than your gameplay 💀",
    "Still waiting for someone to match my IQ level ⏳",
    "Imagine paying for lag💀"
  ]
};

// ==========================
// BOT CREATION
// ==========================
function createBot() {
  const bot = mineflayer.createBot({
    username: config.username,
    password: config.password,
    auth: config.auth,
    host: config.host,
    port: config.port,
    version: config.version
  });

  bot.once('spawn', () => {
    console.log(`🤖 [BOT] ${config.username} joined the server`);

    // 💬 Send random roast messages
    setInterval(() => {
      const msg = config.roastMessages[Math.floor(Math.random() * config.roastMessages.length)];
      bot.chat(msg);
      console.log(`[Chat] Sent: ${msg}`);
    }, config.messageDelay * 1000);

    // ⏰ Leave after stayDuration
    setTimeout(() => {
      console.log(`[INFO] ${config.username} leaving the server after ${config.stayDuration / 1000}s...`);
      bot.quit('AFK timer ended');
    }, config.stayDuration);
  });

  // 🔁 Auto Reconnect
  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Rejoining in ${config.rejoinDelay / 1000}s...`);
    setTimeout(createBot, config.rejoinDelay);
  });

  bot.on('kicked', (reason) => console.log(`[KICKED] ${reason}`));
  bot.on('error', (err) => console.log(`[ERROR] ${err.message}`));
}

createBot();
