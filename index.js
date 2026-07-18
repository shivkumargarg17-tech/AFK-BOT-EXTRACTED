'use strict';

const express = require('express');
const mineflayer = require('mineflayer');
const settings = require('./settings.json');

const app = express();
const webPort = Number(process.env.PORT || 10000);
const startedAt = Date.now();

const account = settings['bot-account'] || {};
const server = settings.server || {};
const utils = settings.utils || {};
const antiAfk = utils['anti-afk'] || {};
const randomActions = antiAfk['random-actions'] || {};
const chatConfig = utils['chat-messages'] || {};
const watchdogConfig = utils['connection-watchdog'] || {};

const reconnectEnabled = utils['auto-reconnect'] !== false;
const reconnectDelayMs = Math.max(5000, Number(utils['auto-reconnect-delay'] || 10000));
const connectTimeoutMs = Math.max(20000, Number(utils['connect-timeout'] || 45) * 1000);
const keepAliveTimeoutMs = Math.max(60000, Number(utils['keepalive-timeout'] || 120) * 1000);
const livenessCheckMs = Math.max(10000, Number(watchdogConfig['check-interval'] || 20) * 1000);
const maxPacketSilenceMs = Math.max(45000, Number(watchdogConfig['max-packet-silence'] || 90) * 1000);
const tcpKeepAliveDelayMs = Math.max(10000, Number(watchdogConfig['tcp-keepalive-delay'] || 30) * 1000);

let bot;
let reconnectTimer;
let shuttingDown = false;
let generation = 0;
const actionTimers = new Set();
const actionCounts = { move: 0, jump: 0, crouch: 0, punch: 0 };

const runtime = {
  phase: 'starting',
  connectedAt: null,
  connectingSince: null,
  nextReconnectAt: null,
  lastPacketAt: null,
  lastError: null,
  lastKickReason: null,
  lastDisconnectReason: null,
  remoteEndpoint: null,
  connectionAttempts: 0,
  successfulJoins: 0,
  disconnects: 0
};

function serverConfig() {
  return {
    host: String(server.ip || '').trim(),
    port: Number(server.port),
    version: String(server.version || '').trim(),
    username: String(account.username || 'AfkBotByAkshit').trim(),
    auth: String(account.type || 'offline').toLowerCase() === 'microsoft'
      ? 'microsoft'
      : 'offline'
  };
}

function validServerConfig(config) {
  return Boolean(
    config.host &&
    Number.isInteger(config.port) &&
    config.port >= 1 &&
    config.port <= 65535 &&
    config.username
  );
}

function formatReason(reason) {
  if (reason == null) return 'unknown reason';
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function socketIsUsable(activeBot = bot) {
  const socket = activeBot?._client?.socket;
  return Boolean(socket && !socket.destroyed && socket.writable);
}

function isHealthyConnection() {
  if (runtime.phase !== 'online' || !bot?.player || !socketIsUsable(bot)) return false;
  if (!runtime.lastPacketAt) return false;
  return Date.now() - runtime.lastPacketAt <= maxPacketSilenceMs;
}

function healthPayload() {
  const now = Date.now();
  const config = serverConfig();
  const connected = isHealthyConnection();

  return {
    service: 'Minecraft AFK bot',
    healthy: connected,
    connected,
    connecting: runtime.phase === 'connecting',
    phase: runtime.phase,
    username: config.username,
    server: `${config.host}:${config.port}`,
    clientVersion: config.version || 'auto',
    auth: config.auth,
    remoteEndpoint: runtime.remoteEndpoint,
    processUptimeSeconds: Math.floor((now - startedAt) / 1000),
    connectedForSeconds: runtime.connectedAt
      ? Math.floor((now - runtime.connectedAt) / 1000)
      : null,
    packetSilenceSeconds: runtime.lastPacketAt
      ? Math.floor((now - runtime.lastPacketAt) / 1000)
      : null,
    nextReconnectAt: runtime.nextReconnectAt
      ? new Date(runtime.nextReconnectAt).toISOString()
      : null,
    connectionAttempts: runtime.connectionAttempts,
    successfulJoins: runtime.successfulJoins,
    disconnects: runtime.disconnects,
    lastDisconnectReason: runtime.lastDisconnectReason,
    lastKickReason: runtime.lastKickReason,
    lastError: runtime.lastError,
    actions: { ...actionCounts },
    checkedAt: new Date(now).toISOString()
  };
}

app.get('/', (_req, res) => {
  res.status(200).json(healthPayload());
});

app.get('/health', (_req, res) => {
  const payload = healthPayload();
  res.status(payload.healthy ? 200 : 503).json(payload);
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

function scheduleActionTimer(callback, delayMs) {
  const timer = setTimeout(() => {
    actionTimers.delete(timer);
    callback();
  }, delayMs);
  actionTimers.add(timer);
  return timer;
}

function clearActionTimers(activeBot = bot) {
  for (const timer of actionTimers) clearTimeout(timer);
  actionTimers.clear();

  try {
    activeBot?.clearControlStates();
  } catch {
    // The connection may already be closed.
  }
}

function isActiveBot(activeBot) {
  return Boolean(
    bot === activeBot &&
    runtime.phase === 'online' &&
    activeBot?.entity &&
    activeBot?.player &&
    socketIsUsable(activeBot)
  );
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

  scheduleActionTimer(() => {
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
      randomNumber(-0.2, 0.2),
      true
    ).catch(() => {});

    activeBot.setControlState(direction, true);
    activeBot.setControlState('sprint', direction === 'forward');
    logAction('move', `${direction}, ${(durationMs / 1000).toFixed(1)}s`);

    scheduleActionTimer(() => {
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

  scheduleActionTimer(() => {
    if (!isActiveBot(activeBot)) return;

    if (Math.random() <= config.chance) {
      const durationMs = randomDelayMs(config.minDuration, config.maxDuration);
      activeBot.setControlState('jump', true);
      logAction('jump');
      scheduleActionTimer(() => {
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

  scheduleActionTimer(() => {
    if (!isActiveBot(activeBot)) return;

    if (Math.random() <= config.chance) {
      const durationMs = randomDelayMs(config.minDuration, config.maxDuration);
      activeBot.setControlState('sneak', true);
      logAction('crouch', `${(durationMs / 1000).toFixed(1)}s`);
      scheduleActionTimer(() => {
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

  scheduleActionTimer(() => {
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

  scheduleActionTimer(() => {
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

  scheduleActionTimer(sendRandomMessage, 15000);

  if (chatConfig.repeat !== false) {
    const scheduleNextMessage = () => {
      scheduleActionTimer(() => {
        if (!isActiveBot(activeBot)) return;
        sendRandomMessage();
        scheduleNextMessage();
      }, repeatDelayMs);
    };
    scheduleNextMessage();
  }
}

function scheduleReconnect(reason, delayMs = reconnectDelayMs) {
  if (shuttingDown || !reconnectEnabled || reconnectTimer) return;

  runtime.phase = 'reconnecting';
  runtime.nextReconnectAt = Date.now() + delayMs;
  console.log(
    `[BOT] Reconnecting in ${Math.round(delayMs / 1000)}s` +
    `${reason ? ` after ${reason}` : ''}...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    runtime.nextReconnectAt = null;
    connectBot();
  }, delayMs);
}

function connectBot() {
  if (shuttingDown || bot || runtime.phase === 'connecting') return;

  const config = serverConfig();
  if (!validServerConfig(config)) {
    runtime.phase = 'configuration-error';
    runtime.lastError = 'Invalid server address, port, or username in settings.json';
    console.error(`[CONFIG] ${runtime.lastError}`);
    return;
  }

  const connectionGeneration = ++generation;
  runtime.phase = 'connecting';
  runtime.connectingSince = Date.now();
  runtime.nextReconnectAt = null;
  runtime.remoteEndpoint = null;
  runtime.connectionAttempts += 1;

  console.log(
    `[BOT] Connecting to ${config.host}:${config.port} as ${config.username} ` +
    `using Java ${config.version || 'auto'} (attempt ${runtime.connectionAttempts})`
  );

  let activeBot;
  try {
    activeBot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      version: config.version || false,
      keepAlive: true,
      checkTimeoutInterval: keepAliveTimeoutMs,
      respawn: true,
      logErrors: false,
      hideErrors: true
    });
  } catch (error) {
    runtime.phase = 'offline';
    runtime.lastError = formatReason(error);
    console.log(`[BOT CREATE ERROR] ${runtime.lastError}`);
    scheduleReconnect('bot creation failure');
    return;
  }

  bot = activeBot;
  const client = activeBot._client;
  let spawned = false;
  let finalized = false;
  let terminating = false;
  let connectTimer;
  let livenessTimer;
  let forcedCleanupTimer;
  let lastPacketAt = Date.now();

  const markPacket = () => {
    lastPacketAt = Date.now();
    if (bot === activeBot && generation === connectionGeneration) {
      runtime.lastPacketAt = lastPacketAt;
    }
  };

  const clearConnectionTimers = () => {
    if (connectTimer) clearTimeout(connectTimer);
    if (livenessTimer) clearInterval(livenessTimer);
    if (forcedCleanupTimer) clearTimeout(forcedCleanupTimer);
    connectTimer = undefined;
    livenessTimer = undefined;
    forcedCleanupTimer = undefined;
  };

  const finalizeDisconnect = reason => {
    if (finalized) return;
    finalized = true;
    clearConnectionTimers();
    client?.removeListener('packet', markPacket);
    clearActionTimers(activeBot);

    if (bot === activeBot) bot = undefined;
    runtime.phase = shuttingDown ? 'stopped' : 'offline';
    runtime.connectedAt = null;
    runtime.connectingSince = null;
    runtime.remoteEndpoint = null;
    runtime.lastPacketAt = null;
    runtime.lastDisconnectReason = formatReason(reason);
    runtime.disconnects += 1;

    console.log(`[BOT] Disconnected: ${runtime.lastDisconnectReason}`);
    if (!shuttingDown) scheduleReconnect(runtime.lastDisconnectReason);
  };

  const terminateConnection = reason => {
    if (finalized || terminating) return;
    terminating = true;
    runtime.phase = 'disconnecting';
    clearActionTimers(activeBot);
    console.log(`[RECOVERY] Closing connection: ${reason}`);

    try {
      activeBot.end(reason);
    } catch {
      try {
        client?.socket?.destroy();
      } catch {
        // Forced cleanup below guarantees the state machine can continue.
      }
    }

    forcedCleanupTimer = setTimeout(() => {
      if (finalized) return;
      console.log('[RECOVERY] Connection did not end normally; forcing socket cleanup.');
      try {
        client?.socket?.destroy();
      } catch {
        // Finalization below still releases the local connection state.
      }
      finalizeDisconnect(`${reason} (forced cleanup)`);
    }, 3000);
    forcedCleanupTimer.unref?.();
  };

  client?.on('packet', markPacket);

  client?.once('connect', () => {
    markPacket();
    const socket = client.socket;
    const remote = socket?.remoteAddress && socket?.remotePort
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : `${config.host}:${config.port}`;
    runtime.remoteEndpoint = remote;

    try {
      socket?.setKeepAlive(true, tcpKeepAliveDelayMs);
      socket?.setNoDelay(true);
    } catch (error) {
      console.log(`[NETWORK] TCP tuning warning: ${formatReason(error)}`);
    }

    console.log(`[NETWORK] TCP connection established to ${remote}.`);
  });

  connectTimer = setTimeout(() => {
    if (!spawned && !finalized) {
      terminateConnection(
        `no spawn after ${Math.round(connectTimeoutMs / 1000)} seconds`
      );
    }
  }, connectTimeoutMs);
  connectTimer.unref?.();

  activeBot.once('login', () => {
    console.log('[BOT] Server accepted the offline-mode login handshake.');
  });

  activeBot.once('spawn', () => {
    if (finalized) return;
    spawned = true;
    terminating = false;
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = undefined;
    markPacket();

    runtime.phase = 'online';
    runtime.connectedAt = Date.now();
    runtime.connectingSince = null;
    runtime.successfulJoins += 1;
    runtime.lastError = null;
    runtime.lastKickReason = null;

    console.log(`[BOT] Joined successfully as ${config.username}`);
    console.log(
      `[WATCHDOG] Monitoring packets every ${Math.round(livenessCheckMs / 1000)}s; ` +
      `recovery after ${Math.round(maxPacketSilenceMs / 1000)}s of silence.`
    );

    livenessTimer = setInterval(() => {
      if (finalized || terminating || !spawned) return;

      if (!socketIsUsable(activeBot)) {
        terminateConnection('Minecraft socket is closed or not writable');
        return;
      }

      const silenceMs = Date.now() - lastPacketAt;
      if (silenceMs > maxPacketSilenceMs) {
        terminateConnection(
          `no incoming Minecraft packets for ${Math.round(silenceMs / 1000)} seconds`
        );
      }
    }, livenessCheckMs);
    livenessTimer.unref?.();

    startRandomActions(activeBot);
    startChatMessages(activeBot);
  });

  if (utils['chat-log'] !== false) {
    activeBot.on('chat', (playerName, message) => {
      console.log(`[CHAT] <${playerName}> ${message}`);
    });
  }

  activeBot.on('kicked', reason => {
    const formatted = formatReason(reason);
    runtime.lastKickReason = formatted;
    console.log(`[KICKED] ${formatted}`);

    setTimeout(() => {
      if (!finalized) terminateConnection(`kicked: ${formatted}`);
    }, 1000).unref?.();
  });

  activeBot.on('error', error => {
    const message = formatReason(error);
    runtime.lastError = message;
    console.log(`[ERROR] ${message}`);

    const fatalNetworkError =
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket closed|socket hang up|keepalive|timed out|read ECONN/i
        .test(message);

    if (!spawned || fatalNetworkError) {
      terminateConnection(`network error: ${message}`);
    }
  });

  activeBot.once('end', reason => {
    finalizeDisconnect(reason || 'connection ended');
  });
}

runtime.phase = 'offline';
connectBot();

const selfPingUrl =
  process.env.SELF_PING_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  'https://aternos-bot-wre2.onrender.com/';

setInterval(() => {
  fetch(selfPingUrl)
    .then(response => console.log(`[PING] ${response.status}`))
    .catch(error => console.log(`[PING ERROR] ${error.message}`));
}, 4 * 60 * 1000).unref?.();

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime.phase = 'stopping';
  console.log(`[PROCESS] ${signal} received; shutting down cleanly.`);

  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  clearActionTimers(bot);

  try {
    bot?.end('serviceShutdown');
  } catch {
    try {
      bot?._client?.socket?.destroy();
    } catch {
      // Process exit below is the final fallback.
    }
  }

  setTimeout(() => process.exit(0), 1500).unref?.();
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', reason => {
  runtime.lastError = `Unhandled rejection: ${formatReason(reason)}`;
  console.error(`[PROCESS] ${runtime.lastError}`);
});

process.on('uncaughtException', error => {
  runtime.lastError = `Uncaught exception: ${formatReason(error)}`;
  console.error(`[PROCESS] ${runtime.lastError}`);
  setTimeout(() => process.exit(1), 1000).unref?.();
});
