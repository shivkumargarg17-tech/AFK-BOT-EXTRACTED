const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const config = require('./settings.json');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('Bot is running 24/7!'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: config["bot-account"].username,
    password: config["bot-account"].password,
    auth: config["bot-account"].type,
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version
  });

  bot.loadPlugin(pathfinder);
  bot.settings.colorsEnabled = false;

  bot.once('spawn', () => {
    console.log('\x1b[33m[RoasterBot] Bot joined the server!\x1b[0m');

    // 🧠 Send random roast messages
    if (config.utils["chat-messages"].enabled) {
      const messages = config.utils["chat-messages"].messages;
      const delay = config.utils["chat-messages"]["repeat-delay"];

      setInterval(() => {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        bot.chat(randomMessage);
      }, delay * 1000);
    }

    // 🚶 Anti-AFK movement
    if (config.utils["anti-afk"].enabled) {
      setInterval(() => {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);

        if (config.utils["anti-afk"].sneak) {
          bot.setControlState('sneak', true);
          setTimeout(() => bot.setControlState('sneak', false), 1000);
        }
      }, 30000);
    }

    // ⏱ Leave after 70 seconds
    setTimeout(() => {
      console.log('[INFO] 70 seconds over, bot leaving...');
      bot.quit('Roaster cooldown');
    }, 70000);
  });

  // 🔁 Auto reconnect system
  bot.on('end', () => {
    if (config.utils["auto-reconnect"]) {
      console.log(`[INFO] Bot disconnected. Rejoining in ${config.utils["auto-reconnect-delay"]}ms...`);
      setTimeout(createBot, config.utils["auto-reconnect-delay"]);
    }
  });

  // 🧱 Log errors & kicks
  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
