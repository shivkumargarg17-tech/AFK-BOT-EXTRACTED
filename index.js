const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (req, res) => res.send('Bot is roasting and ruling 😎🔥'));
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));

function createBot() {
  const bot = mineflayer.createBot({
    username: config['bot-account']['username'],
    password: config['bot-account']['password'],
    auth: config['bot-account']['type'],
    host: config.server.ip,
    port: config.server.port,
    version: config.server.version
  });

  bot.loadPlugin(pathfinder);
  const mcData = require('minecraft-data')(bot.version);
  const movements = new Movements(bot, mcData);

  bot.once('spawn', () => {
    console.log(`[INFO] Bot joined the server as ${bot.username}`);

    // 💬 Random roast messages
    if (config.utils['chat-messages'].enabled) {
      const { messages, repeat, repeat-delay } = config.utils['chat-messages'];
      if (repeat) {
        setInterval(() => {
          const randomMsg = messages[Math.floor(Math.random() * messages.length)];
          bot.chat(randomMsg);
        }, repeat-delay * 1000);
      } else {
        const randomMsg = messages[Math.floor(Math.random() * messages.length)];
        bot.chat(randomMsg);
      }
    }

    // 🧍 Anti-AFK
    if (config.utils['anti-afk'].enabled) {
      setInterval(() => {
        bot.setControlState('jump', true);
        setTimeout(() => bot.setControlState('jump', false), 500);
        if (config.utils['anti-afk'].sneak) {
          bot.setControlState('sneak', true);
          setTimeout(() => bot.setControlState('sneak', false), 1000);
        }
      }, 30000);
    }

    // ⏱ Leave after 2 minutes
    setTimeout(() => {
      console.log('[INFO] 2 minutes over, bot leaving...');
      bot.quit('AFK timer ended');
    }, 120000);
  });

  // 🔁 Reconnect after delay
  bot.on('end', () => {
    console.log(`[INFO] Bot disconnected. Reconnecting in ${config.utils['auto-reconnect-delay']} ms...`);
    setTimeout(createBot, config.utils['auto-reconnect-delay']);
  });

  bot.on('kicked', reason => console.log(`[KICKED] ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
