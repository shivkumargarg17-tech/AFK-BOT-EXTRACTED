const mineflayer = require('mineflayer');
const config = require('./settings.json');

function createBot() {
  const bot = mineflayer.createBot({
    host: config.server.ip,
    port: config.server.port,
    username: config['bot-account'].username,
    password: config['bot-account'].password || undefined,
    version: config.server.version,
    auth: config['bot-account'].type
  });

  const { messages, repeat } = config.utils['chat-messages'];
  const repeatDelay = config.utils['chat-messages']['repeat-delay'];
  const autoReconnect = config.utils['auto-reconnect'];
  const autoReconnectDelay = config.utils['auto-reconnect-delay'];

  // When the bot spawns
  bot.on('spawn', () => {
    console.log('[INFO] Bot has joined the server.');

    // Anti-AFK feature
    if (config.utils['anti-afk'].enabled) {
      setInterval(() => {
        bot.setControlState('sneak', true);
        setTimeout(() => bot.setControlState('sneak', false), 1000);
      }, 60000); // Sneak every 60 seconds
    }

    // Send random roast messages
    if (config.utils['chat-messages'].enabled && repeat) {
      setTimeout(function sendRandomMessage() {
        const randomMessage = messages[Math.floor(Math.random() * messages.length)];
        bot.chat(randomMessage);
        setTimeout(sendRandomMessage, repeatDelay * 1000);
      }, 10000); // Wait 10s before first message
    }
  });

  // Chat log
  if (config.utils['chat-log']) {
    bot.on('chat', (username, message) => {
      console.log(`[CHAT] <${username}> ${message}`);
    });
  }

  // Handle kick/disconnects
  bot.on('kicked', (reason) => {
    console.log(`[KICKED] ${reason}`);
    if (autoReconnect) {
      console.log(`[INFO] Bot disconnected. Rejoining in ${autoReconnectDelay}ms...`);
      setTimeout(createBot, autoReconnectDelay);
    }
  });

  bot.on('error', (err) => {
    console.log(`[ERROR] ${err.message}`);
    if (autoReconnect) {
      console.log(`[INFO] Bot crashed. Rejoining in ${autoReconnectDelay}ms...`);
      setTimeout(createBot, autoReconnectDelay);
    }
  });

  bot.on('end', () => {
    console.log('[INFO] Connection ended.');
    if (autoReconnect) {
      console.log(`[INFO] Attempting to reconnect in ${autoReconnectDelay}ms...`);
      setTimeout(createBot, autoReconnectDelay);
    }
  });
}

createBot();
