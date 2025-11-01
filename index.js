const mineflayer = require('mineflayer');
const { Movements, pathfinder, goals: { GoalBlock } } = require('mineflayer-pathfinder');
const express = require('express');
const config = require('./settings.json');

const app = express();
app.get('/', (req, res) => res.send('Bot is running 24/7!'));
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
  const defaultMove = new Movements(bot, mcData);
  bot.settings.colorsEnabled = false;

  bot.once('spawn', () => {
    console.log('[AfkBot] Bot joined the server.');

    // 🕒 Stay for 70 seconds then leave
    setTimeout(() => {
      console.log('[INFO] 70 seconds over, bot leaving...');
      bot.quit('AFK timer ended');
    }, 70000);

    // 💬 Chat messages
    if (config.utils['chat-messages'].enabled) {
      console.log('[INFO] Started chat-messages module');
      const messages = config.utils['chat-messages']['messages'];
      if (config.utils['chat-messages'].repeat) {
        const delay = config.utils['chat-messages']['repeat-delay'];
        let i = 0;
        setInterval(() => {
          bot.chat(messages[i]);
          i = (i + 1) % messages.length;
        }, delay * 1000);
      } else {
        messages.forEach(msg => bot.chat(msg));
      }
    }

    // 🧍 Anti-AFK movement
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
  });

  // 🔁 Auto reconnect handler
  if (config.utils['auto-reconnect']) {
    bot.on('end', () => {
      console.log(`[INFO] Bot disconnected. Rejoining in ${config.utils['auto-reconnect-delay']} ms...`);
      setTimeout(createBot, config.utils['auto-reconnect-delay']);
    });
  }

  bot.on('kicked', reason => console.log(`[AfkBot] Kicked: ${reason}`));
  bot.on('error', err => console.log(`[ERROR] ${err.message}`));
}

createBot();
