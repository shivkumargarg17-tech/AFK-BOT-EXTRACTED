'use strict';

const express = require('express');
const mineflayer = require('mineflayer');
const settings = require('./settings.json');

const app = express();
const webPort = Number(process.env.PORT || 10000);

const account = settings['bot-account'] || {};
const server = settings.server || {};
const utils = settings.utils || {};
const antiAfk = utils['anti-afk'] || {};
const randomActions = antiAfk['random-actions'] || {};
const chatConfig = utils['chat-messages'] || {};

const reconnectEnabled = utils['auto-reconnect'] !== false;
const reconnectDelayMs = Math.max(
  5000,
  Number(utils['auto-reconnect-delay'] || 10000)
);
const connectTimeoutMs = Math.max(
  20000,
  Number(utils['connect-timeout'] || 45) * 1000
);
const keepAliveTimeoutMs = Math.max(
  60000,
  Number(utils['keepalive-timeout'] || 300) * 1000
);

let bot;
let reconnectTimer;
let connectWatchdog;
let isConnecting = false;
const botTimers = new Set();
const actionCounts = { move: 0, jump: 0, crouch: 0, punch: 0 };

app.get('/', (_req, res) => {
  res.json({
    service: 'Minecraft AFK bot',
    connected: Boolean(bot?.player),
    connecting: isConnecting,
    username: account.username || 'AfkBotByAkshit',
    server: server.ip || null
  });
});

app.listen(webPort, () => {
  console.log(`[WEB] Listening on port ${webPort}`);
});

function randomNumber(min, max) {
  return Math.random() * (max - min) + min;
}

function randomDelayMs(minSeconds, maxSeconds) {
  const min = Math.max(0.1, Number(minSeconds));
  const max = Math.max(min, Number(maxSeconds));
  return Math.round(randomNumber(min, max) * 1000);
}

function clampChance(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function configuredServer() {
  const host = String(server.ip || '').trim();
  const configuredPort = Number(server.port);
  const useSrv = server['use-srv'] !== false && /\.aternos\.me$/i.test(host);

  return {
    host,
    configuredPort,
    useSrv,
    username: String(account.username || 'AfkBotByAkshit').trim(),
    version: String(server.version || '').trim()
  };
}

function validServerConfig(config) {
  if (!config.host) return false;
  if (config.useSrv) return true;
  return Number.isInteger(config.configuredPort) &&
    config.configuredPort >= 1 && config.configuredPort <= 65535;
}

function formatReason(reason) {
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function scheduleBotTimer(callback, delayMs) {
  const timer = setTimeout(() => {
    botTimers.delete(timer);
    callback();
  }, delayMs);
  botTimers.add(timer);
  return timer;
}

function clearBotTimers(activeBot = bot) {
  for (const timer of botTimers) clearTimeout(timer);
  botTimers.clear();

  if (activeBot) {
    try {
      activeBot.clearControlStates();
    } catch {
      // The client may already be closed.
    }
  }
}

function clearConnectWatchdog() {
  if (connectWatchdog) clearTimeout(connectWatchdog);
  connectWatchdog = undefined;
}

function isActiveBot(activeBot) {
  return bot === activeBot && Boolean(activeBot?.entity && activeBot?.player);
}

function scheduleReconnect(delayMs = reconnectDelayMs) {
  if (!reconnectEnabled) {
    console.log('[BOT] Auto-reconnect is disabled.');
    return;
  }

  if (reconnectTimer || isConnecting || bot?.player) return;

  console.log(`[BOT] Reconnecting in ${Math.round(delayMs / 1000)}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    createBot();
  }, delayMs);
}

function actionConfig(name, defaults) {
  const config = randomActions[name] || {};
  return {
    chance: clampChance(config.chance, defaults.chance),
    minDelay: Number(config['min-delay'] ?? defaults.minDelay),
    maxDelay: Number(config['max-delay'] ?? defaults.maxDelay),
    minDuration: Number(config['min-duration'] ?? defaults.minDuration ?? 0),
    maxDuration: Number(config['max-duration'] ?? defaults.maxDuration ?? 0)
  };
}

function logAction(action, detail = '') {
  actionCounts[action] += 1;
  if (antiAfk['log-actions'] === false) return;
  const suffix = detail ? ` (${detail})` : '';
  console.log(`[ACTION] ${action}${suffix} | total=${actionCounts[action]}`);
}

function scheduleMovement(activeBot) {
  const config = actionConfig('move', {
    chance: 1,
    minDelay: 2,
    maxDelay: 6,
    minDuration: 0.8,
    maxDuration: 2.5
  });

  scheduleBotTimer(() => {
    if (!isActiveBot(activeBot)) return;

    if (Math.random() > config.chance) {
      scheduleMovement(activeBot);
      return;
    }

    const directions = ['forward', 'back', 'left', 'right'];
    const direction = directions[Math.floor(Math.random() * directions.length)];
    const durationMs = randomDelayMs(config.minDuration, config.maxDuration);

    activeBot.look(
      randomNumber(-Math.PI, Math.PI),
      randomNumber(-0.18, 0.18),
      true
    ).catch(() => {});

    activeBot.setControlState(direction, true);
    activeBot.setControlState('sprint', direction === 'forward');
    logAction('move', `${direction}, ${(durationMs / 1000).toFixed(1)}s`);

    scheduleBotTimer(() => {
      if (!isActiveBot(activeBot)) return;
      activeBot.setControlState(direction, false);
      activeBot.setControlState('sprint', false);
      scheduleMovement(activeBot);
    }, durationMs);
  }, randomDelayMs(config.minDelay, config.maxDelay));
}

function scheduleJump(activeBot) {
  const config = actionConfig('jump', {
    chance: 0.7,
    minDelay: 2,
    maxDelay: 8,
    minDuration: 0.15,
    maxDuration: 0.45
  });

  scheduleBotTimer(() => {
    if (!isActiveBot(activeBot)) return;

    if (Math.random() <= config.chance) {
      const durationMs = randomDelayMs(config.minDuration, config.maxDuration);
      activeBot.setControlState('jump', true);
      logAction('jump');
      scheduleBotTimer(() => {
        if (isActiveBot(activeBot)) activeBot.setControlState('jump', false);
      }, durationMs);
    }

    scheduleJump(activeBot);
  }, randomDelayMs(config.minDelay, config.maxDelay));
}

function scheduleCrouch(activeBot) {
  const config = actionConfig('crouch', {
    chance: 0.5,
    minDelay: 4,
    maxDelay: 12,
    minDuration: 0.5,
    maxDuration: 2.5
  });

  scheduleBotTimer(() => {
    if (!isActiveBot(activeBot)) return;

    if (Math.random() <= config.chance) {
      const durationMs = randomDelayMs(config.minDuration, config.maxDuration);
      activeBot.setControlState('sneak', true);
      logAction('crouch', `${(durationMs / 1000).toFixed(1)}s`);
      scheduleBotTimer(() => {
        if (isActiveBot(activeBot)) activeBot.setControlState('sneak', false);
      }, durationMs);
    }

    scheduleCrouch(activeBot);
  }, randomDelayMs(config.minDelay, config.maxDelay));
}

function schedulePunch(activeBot) {
  const config = actionConfig('punch', {
    chance: 0.75,
    minDelay: 2,
    maxDelay: 10
  });

  scheduleBotTimer(() => {
    if (!isActiveBot(activeBot)) return;
    if (Math.random() <= config.chance) {
      activeBot.swingArm('right');
      logAction('punch');
    }
    schedulePunch(activeBot);
  }, randomDelayMs(config.minDelay, config.maxDelay));
}

function scheduleActionSummary(activeBot) {
  const summarySeconds = Math.max(15, Number(antiAfk['summary-interval'] || 60));

  scheduleBotTimer(() => {
    if (!isActiveBot(activeBot)) return;
    const total = Object.values(actionCounts).reduce((sum, count) => sum + count, 0);
    const ratio = Object.entries(actionCounts)
      .map(([action, count]) => {
        const percentage = total === 0 ? 0 : (count / total) * 100;
        return `${action}=${count} (${percentage.toFixed(1)}%)`;
      })
      .join(', ');

    console.log(`[ACTION SUMMARY] total=${total} | ${ratio}`);
    scheduleActionSummary(activeBot);
  }, summarySeconds * 1000);
}

function startRandomActions(activeBot) {
  if (!antiAfk.enabled || randomActions.enabled === false) return;
  for (const action of Object.keys(actionCounts)) actionCounts[action] = 0;
  scheduleMovement(activeBot);
  scheduleJump(activeBot);
  scheduleCrouch(activeBot);
  schedulePunch(activeBot);
  scheduleActionSummary(activeBot);
}

function startChatMessages(activeBot) {
  const messages = Array.isArray(chatConfig.messages)
    ? chatConfig.messages.filter(message =>
        typeof message === 'string' && message.trim().length > 0)
    : [];

  if (!chatConfig.enabled || messages.length === 0) return;

  const repeatDelayMs = Math.max(
    30000,
    Number(chatConfig['repeat-delay'] || 60) * 1000
  );

  const sendRandomMessage = () => {
    if (!isActiveBot(activeBot)) return;
    const message = messages[Math.floor(Math.random() * messages.length)]
      .trim()
      .slice(0, 240);
    activeBot.chat(message);
    console.log(`[CHAT SENT] ${message}`);
  };

  scheduleBotTimer(sendRandomMessage, 15000);

  if (chatConfig.repeat !== false) {
    const scheduleNextMessage = () => {
      scheduleBotTimer(() => {
        if (!isActiveBot(activeBot)) return;
        sendRandomMessage();
        scheduleNextMessage();
      }, repeatDelayMs);
    };
    scheduleNextMessage();
  }
}

function createBot(config = configuredServer()) {
  if (isConnecting || bot?.player) return;

  if (!validServerConfig(config)) {
    console.error('[CONFIG] Invalid server address or fallback port in settings.json');
    return;
  }

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearBotTimers();
  clearConnectWatchdog();
  isConnecting = true;

  const options = {
    host: config.host,
    username: config.username,
    auth: String(account.type || 'offline').toLowerCase() === 'microsoft'
      ? 'microsoft'
      : 'offline',
    keepAlive: true,
    checkTimeoutInterval: keepAliveTimeoutMs,
    logErrors: false,
    hideErrors: true
  };

  if (config.version) options.version = config.version;

  // Aternos changes the real backend host/port between server starts.
  // Omitting port makes node-minecraft-protocol resolve the domain's SRV record.
  if (!config.useSrv) options.port = config.configuredPort;

  const target = config.useSrv
    ? `${config.host} (SRV auto-resolve; configured port ${config.configuredPort} ignored)`
    : `${config.host}:${config.configuredPort}`;

  console.log(
    `[BOT] Connecting to ${target} as ${config.username}` +
    `${config.version ? ` using Java ${config.version}` : ' with version auto-detection'}`
  );

  let activeBot;
  let spawned = false;

  try {
    activeBot = mineflayer.createBot(options);
    bot = activeBot;
  } catch (error) {
    isConnecting = false;
    bot = undefined;
    console.log(`[BOT CREATE ERROR] ${error?.message || error}`);
    scheduleReconnect();
    return;
  }

  activeBot._client?.once('connect', () => {
    const socket = activeBot._client?.socket;
    const remote = socket?.remoteAddress && socket?.remotePort
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : 'resolved Minecraft endpoint';
    console.log(`[NETWORK] TCP connection established to ${remote}.`);
  });

  connectWatchdog = setTimeout(() => {
    if (bot !== activeBot || spawned) return;

    console.log(
      `[CONNECT TIMEOUT] No spawn after ${Math.round(connectTimeoutMs / 1000)}s. ` +
      'Closing this attempt and retrying...'
    );

    clearConnectWatchdog();
    isConnecting = false;
    if (bot === activeBot) bot = undefined;

    try {
      activeBot._client?.socket?.destroy(
        new Error('Minecraft connection attempt timed out')
      );
    } catch {
      try {
        activeBot.end('connectionTimeout');
      } catch {
        // Ignore cleanup errors.
      }
    }

    scheduleReconnect(5000);
  }, connectTimeoutMs);

  activeBot.once('login', () => {
    console.log('[BOT] Server accepted the offline-mode login handshake.');
  });

  activeBot.once('spawn', () => {
    spawned = true;
    isConnecting = false;
    clearConnectWatchdog();
    clearBotTimers(activeBot);
    console.log(`[BOT] Joined successfully as ${config.username}`);
    startRandomActions(activeBot);
    startChatMessages(activeBot);
  });

  if (utils['chat-log'] !== false) {
    activeBot.on('chat', (playerName, message) => {
      console.log(`[CHAT] <${playerName}> ${message}`);
    });
  }

  activeBot.on('kicked', reason => {
    console.log(`[KICKED] ${formatReason(reason)}`);
  });

  activeBot.on('error', error => {
    console.log(`[ERROR] ${error?.message || error}`);
  });

  activeBot.once('end', reason => {
    console.log(`[BOT] Disconnected: ${reason || 'unknown reason'}`);
    clearConnectWatchdog();
    clearBotTimers(activeBot);
    if (bot === activeBot) bot = undefined;
    isConnecting = false;
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
