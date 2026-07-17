'use strict';

const express = require('express');
const mineflayer = require('mineflayer');
const settings = require('./settings.json');

const app = express();
const webPort = Number(process.env.PORT || 10000);

app.get('/', (_req, res) => {
  res.send('Minecraft AFK bot service is running.');
});

app.listen(webPort, () => {
  console.log(`[WEB] Listening on port ${webPort}`);
});

const account = settings['bot-account'] || {};
const server = settings.server || {};
const utils = settings.utils || {};
const antiAfk = utils['anti-afk'] || {};
const chatConfig = utils['chat-messages'] || {};

const reconnectEnabled = utils['auto-reconnect'] !== false;
const reconnectDelayMs = Math.max(
  10000,
  Number(utils['auto-reconnect-delay'] || 60000)
);

let bot;
let reconnectTimer;
let antiAfkTimer;
let chatTimer;
let sneakState = false;
let reconnectAttempt = 0;

function clearBotTimers() {
  if (antiAfkTimer) clearInterval(antiAfkTimer);
  if (chatTimer) clearInterval(chatTimer);
  antiAfkTimer = undefined;
  chatTimer = undefined;
}

function formatReason(reason) {
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function scheduleReconnect() {
  if (!reconnectEnabled) {
    console.log('[BOT] Auto-reconnect is disabled.');
    return;
  }

  if (reconnectTimer) {
    console.log('[BOT] A reconnect is already scheduled.');
    return;
  }

  const nextAttempt = reconnectAttempt + 1;
  console.log(
    `[BOT] Reconnect attempt #${nextAttempt} scheduled in ${reconnectDelayMs / 1000}s...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    reconnectAttempt = nextAttempt;
    console.log(`[BOT] Reconnect attempt #${reconnectAttempt} starting now...`);
    createBot();
  }, reconnectDelayMs);
}

function startAntiAfk(activeBot) {
  if (!antiAfk.enabled) return;

  antiAfkTimer = setInterval(() => {
    if (!activeBot.entity) return;

    const nextYaw = activeBot.entity.yaw + 0.35;
    activeBot.look(nextYaw, activeBot.entity.pitch, true).catch(() => {});
    activeBot.swingArm('right');

    if (antiAfk.sneak) {
      sneakState = !sneakState;
      activeBot.setControlState('sneak', sneakState);
    }
  }, 10000);
}

function startChatMessages(activeBot) {
  const messages = Array.isArray(chatConfig.messages)
    ? chatConfig.messages.filter(
        message => typeof message === 'string' && message.trim().length > 0
      )
    : [];

  if (!chatConfig.enabled || messages.length === 0) return;

  const repeatDelayMs = Math.max(
    30000,
    Number(chatConfig['repeat-delay'] || 60) * 1000
  );

  const sendRandomMessage = () => {
    if (!activeBot.player) return;
    const message = messages[Math.floor(Math.random() * messages.length)]
      .trim()
      .slice(0, 240);
    activeBot.chat(message);
    console.log(`[CHAT SENT] ${message}`);
  };

  setTimeout(sendRandomMessage, 15000);

  if (chatConfig.repeat !== false) {
    chatTimer = setInterval(sendRandomMessage, repeatDelayMs);
  }
}

function createBot() {
  clearBotTimers();
  sneakState = false;

  const host = String(server.ip || '').trim();
  const port = Number(server.port);
  const username = String(account.username || 'BotMadeByAkshit').trim();
  const version = String(server.version || '1.21.11').trim();

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('[CONFIG] Invalid server IP or port in settings.json');
    return;
  }

  const options = {
    host,
    port,
    username,
    version,
    auth: String(account.type || 'offline').toLowerCase() === 'microsoft'
      ? 'microsoft'
      : 'offline'
  };

  console.log(
    `[BOT] Connecting to ${host}:${port} as ${username} using Java ${version}`
  );

  bot = mineflayer.createBot(options);

  bot.once('login', () => {
    console.log('[BOT] Login accepted by the server.');
  });

  bot.once('spawn', () => {
    reconnectAttempt = 0;
    console.log(`[BOT] Joined successfully as ${username}`);
    startAntiAfk(bot);
    startChatMessages(bot);
  });

  if (utils['chat-log'] !== false) {
    bot.on('chat', (playerName, message) => {
      console.log(`[CHAT] <${playerName}> ${message}`);
    });
  }

  bot.on('kicked', reason => {
    console.log(`[KICKED] ${formatReason(reason)}`);
  });

  bot.on('error', error => {
    console.log(`[ERROR] ${error?.message || error}`);
  });

  bot.once('end', reason => {
    console.log(`[BOT] Disconnected: ${reason || 'unknown reason'}`);
    clearBotTimers();
    scheduleReconnect();
  });
}

createBot();

const selfPingUrl =
  process.env.SELF_PING_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://aternos-bot-wre2.onrender.com/';

setInterval(() => {
  fetch(selfPingUrl)
    .then(response => console.log(`[PING] ${response.status}`))
    .catch(error => console.log(`[PING ERROR] ${error.message}`));
}, 4 * 60 * 1000);
