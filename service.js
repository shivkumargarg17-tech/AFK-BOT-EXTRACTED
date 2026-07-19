'use strict';

const express = require('express');
const mineflayer = require('mineflayer');
const settings = require('./settings.json');
const { createAntiAfkController } = require('./actions');

const app = express();
const webPort = Number(process.env.PORT || 10000);
const startedAt = Date.now();

const account = settings['bot-account'] || {};
const server = settings.server || {};
const utils = settings.utils || {};
const readiness = utils['readiness-probe'] || {};
const watchdog = utils['connection-watchdog'] || {};
const chatConfig = utils['chat-messages'] || {};

const config = {
  host: String(process.env.MC_HOST || server.ip || '').trim(),
  port: Number(process.env.MC_PORT || server.port),
  username: String(process.env.MC_USERNAME || account.username || 'AkshitAFKBot').trim(),
  password: String(process.env.MC_PASSWORD || account.password || ''),
  version: String(process.env.MC_VERSION ?? server.version ?? '').trim(),
  auth: String(process.env.MC_AUTH || account.type || 'offline').toLowerCase()
};

const timings = {
  reconnectBase: Math.max(2000, Number(utils['auto-reconnect-delay'] || 3000)),
  reconnectMax: Math.max(30000, Number(utils['max-reconnect-delay'] || 120000)),
  spawnTimeout: Math.max(90000, Number(readiness['spawn-timeout'] || 150) * 1000),
  protocolTimeout: Math.max(300000, Number(utils['keepalive-timeout'] || 600) * 1000),
  tcpKeepAlive: Math.max(10000, Number(watchdog['tcp-keepalive-delay'] || 30) * 1000),
  packetWarning: Math.max(180000, Number(watchdog['packet-warning'] || 180) * 1000),
  packetCheck: Math.max(10000, Number(watchdog['check-interval'] || 20) * 1000)
};

const state = {
  phase: 'starting',
  bot: null,
  controller: null,
  stopping: false,
  reconnectTimer: null,
  nextReconnectAt: null,
  connectingSince: null,
  connectedAt: null,
  lastPacketAt: null,
  remoteEndpoint: null,
  connectionAttempts: 0,
  consecutiveFailures: 0,
  successfulJoins: 0,
  disconnects: 0,
  throttled: false,
  lastDisconnectReason: null,
  lastDisconnectAt: null,
  lastKickReason: null,
  lastKickAt: null,
  lastError: null,
  lastErrorAt: null,
  actionCounts: { move: 0, jump: 0, crouch: 0, punch: 0 }
};

function reasonText(reason) {
  if (reason == null) return 'unknown reason';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return `${reason.code ? `${reason.code}: ` : ''}${reason.message}`;
  try { return JSON.stringify(reason); } catch { return String(reason); }
}

function validConfig() {
  return Boolean(
    config.host &&
    config.username &&
    config.username.length <= 16 &&
    Number.isInteger(config.port) &&
    config.port > 0 &&
    config.port <= 65535
  );
}

function socketUsable(bot = state.bot) {
  const socket = bot?._client?.socket;
  return Boolean(socket && !socket.destroyed && socket.writable);
}

function actuallyConnected() {
  return Boolean(state.phase === 'online' && state.bot?.player && socketUsable());
}

function packetSilenceSeconds() {
  return state.lastPacketAt ? Math.floor((Date.now() - state.lastPacketAt) / 1000) : null;
}

function healthy() {
  return actuallyConnected();
}

function healthPayload() {
  const now = Date.now();
  return {
    service: 'Minecraft AFK bot',
    healthy: healthy(),
    connected: actuallyConnected(),
    connecting: ['connecting', 'logging-in', 'reconnecting', 'waiting-for-server'].includes(state.phase),
    phase: state.phase,
    connectionMode: 'slobos-style-direct',
    username: config.username,
    server: `${config.host}:${config.port}`,
    clientVersion: config.version || 'auto-detect',
    auth: config.auth,
    remoteEndpoint: state.remoteEndpoint,
    processUptimeSeconds: Math.floor((now - startedAt) / 1000),
    connectedForSeconds: state.connectedAt ? Math.floor((now - state.connectedAt) / 1000) : null,
    packetSilenceSeconds: packetSilenceSeconds(),
    connectingForSeconds: state.connectingSince ? Math.floor((now - state.connectingSince) / 1000) : null,
    nextReconnectAt: state.nextReconnectAt ? new Date(state.nextReconnectAt).toISOString() : null,
    connectionAttempts: state.connectionAttempts,
    consecutiveFailures: state.consecutiveFailures,
    successfulJoins: state.successfulJoins,
    disconnects: state.disconnects,
    lastDisconnectReason: state.lastDisconnectReason,
    lastDisconnectAt: state.lastDisconnectAt,
    lastKickReason: state.lastKickReason,
    lastKickAt: state.lastKickAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    actions: { ...state.actionCounts },
    checkedAt: new Date(now).toISOString()
  };
}

app.disable('x-powered-by');
app.get('/', (_req, res) => res.status(200).json(healthPayload()));
app.get('/ping', (_req, res) => res.status(200).json({ ok: true, phase: state.phase, checkedAt: new Date().toISOString() }));
app.get('/health', (_req, res) => {
  const payload = healthPayload();
  res.status(payload.healthy ? 200 : 503).json(payload);
});
app.listen(webPort, '0.0.0.0', () => console.log(`[WEB] Listening on port ${webPort}`));

function clearReconnectTimer() {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.nextReconnectAt = null;
}

function reconnectDelay() {
  if (state.throttled) {
    state.throttled = false;
    return 60000 + Math.floor(Math.random() * 60000);
  }

  const exponential = timings.reconnectBase * Math.pow(2, Math.min(state.consecutiveFailures, 8));
  return Math.min(exponential, timings.reconnectMax) + Math.floor(Math.random() * 2000);
}

function scheduleReconnect(reason) {
  if (state.stopping || state.reconnectTimer || state.bot) return;

  const delay = reconnectDelay();
  state.phase = state.successfulJoins > 0 ? 'reconnecting' : 'waiting-for-server';
  state.nextReconnectAt = Date.now() + delay;
  console.log(`[RECONNECT] Next attempt in ${(delay / 1000).toFixed(1)}s after ${reasonText(reason)}.`);

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    state.nextReconnectAt = null;
    startBot();
  }, delay);
  state.reconnectTimer.unref?.();
}

function cleanupGhostBot(reason = 'cleanup before reconnect') {
  const previous = state.bot;
  if (!previous) return;

  console.log(`[CLEANUP] Removing previous bot instance: ${reason}.`);
  state.controller?.stop();
  state.controller = null;

  try { previous.clearControlStates?.(); } catch {}
  try { previous.removeAllListeners(); } catch {}
  try { previous._client?.removeAllListeners(); } catch {}
  try { previous.end(reason); } catch {}
  try { previous._client?.socket?.destroy(); } catch {}

  if (state.bot === previous) state.bot = null;
}

function startBot() {
  if (state.stopping) return;
  clearReconnectTimer();
  cleanupGhostBot();

  if (!validConfig()) {
    state.phase = 'configuration-error';
    state.lastError = 'Invalid host, port, or username (Minecraft usernames must be at most 16 characters)';
    state.lastErrorAt = new Date().toISOString();
    console.error(`[CONFIG] ${state.lastError}`);
    return;
  }

  state.phase = 'connecting';
  state.connectingSince = Date.now();
  state.connectionAttempts += 1;
  console.log(`[BOT] Slobos-style attempt ${state.connectionAttempts}: ${config.host}:${config.port} as ${config.username}, Java ${config.version || 'auto-detect'}.`);

  let bot;
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.password || undefined,
      auth: config.auth,
      version: config.version || false,
      keepAlive: true,
      checkTimeoutInterval: timings.protocolTimeout,
      respawn: true,
      logErrors: true,
      hideErrors: false
    });
  } catch (error) {
    state.connectingSince = null;
    state.consecutiveFailures += 1;
    state.lastError = reasonText(error);
    state.lastErrorAt = new Date().toISOString();
    console.error(`[BOT CREATE ERROR] ${state.lastError}`);
    scheduleReconnect('bot creation error');
    return;
  }

  state.bot = bot;
  const client = bot._client;
  let spawned = false;
  let finished = false;
  let connectionTimer = null;
  let packetTimer = null;
  let chatTimer = null;
  let silenceWarningLogged = false;

  const markPacket = () => {
    if (state.bot === bot) {
      state.lastPacketAt = Date.now();
      silenceWarningLogged = false;
    }
  };

  const clearAttemptTimers = () => {
    clearTimeout(connectionTimer);
    clearInterval(packetTimer);
    clearTimeout(chatTimer);
  };

  const finish = reason => {
    if (finished) return;
    finished = true;
    clearAttemptTimers();
    client?.removeListener('packet', markPacket);
    state.controller?.stop();
    state.controller = null;

    if (state.bot === bot) state.bot = null;
    state.connectedAt = null;
    state.connectingSince = null;
    state.lastPacketAt = null;
    state.remoteEndpoint = null;
    state.disconnects += 1;
    state.lastDisconnectReason = reasonText(reason);
    state.lastDisconnectAt = new Date().toISOString();

    if (!spawned) state.consecutiveFailures += 1;
    else state.consecutiveFailures = 0;

    console.log(`[BOT] Connection ended: ${state.lastDisconnectReason}`);

    if (state.stopping) {
      state.phase = 'stopped';
      return;
    }

    scheduleReconnect(state.lastDisconnectReason);
  };

  client?.on('packet', markPacket);
  client?.once('connect', () => {
    markPacket();
    state.phase = 'logging-in';
    const socket = client.socket;
    state.remoteEndpoint = socket?.remoteAddress && socket?.remotePort
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : `${config.host}:${config.port}`;

    try {
      socket?.setKeepAlive(true, timings.tcpKeepAlive);
      socket?.setNoDelay(true);
    } catch (error) {
      console.log(`[NETWORK] TCP tuning warning: ${reasonText(error)}`);
    }

    console.log(`[NETWORK] Direct TCP established to ${state.remoteEndpoint}.`);
  });

  connectionTimer = setTimeout(() => {
    if (spawned || finished) return;
    console.log(`[BOT] Connection timeout: no spawn after ${Math.round(timings.spawnTimeout / 1000)}s.`);
    try { bot.removeAllListeners(); } catch {}
    try { client?.removeAllListeners(); } catch {}
    try { bot.end('connectionTimeout'); } catch {}
    try { client?.socket?.destroy(); } catch {}
    finish('connectionTimeout');
  }, timings.spawnTimeout);
  connectionTimer.unref?.();

  bot.once('login', () => console.log(`[BOT] Login accepted; negotiated Java ${bot.version || config.version || 'unknown'}.`));

  bot.once('spawn', () => {
    if (finished || spawned) return;
    spawned = true;
    clearTimeout(connectionTimer);
    markPacket();
    state.phase = 'online';
    state.connectedAt = Date.now();
    state.connectingSince = null;
    state.successfulJoins += 1;
    state.consecutiveFailures = 0;
    state.lastError = null;
    state.lastErrorAt = null;
    console.log(`[BOT] Successfully spawned using Slobos-style connection logic (Java ${bot.version || 'unknown'}).`);

    state.controller = createAntiAfkController(
      bot,
      utils['anti-afk'] || {},
      () => state.bot === bot && actuallyConnected()
    );
    state.actionCounts = state.controller.counts;
    state.controller.start();

    packetTimer = setInterval(() => {
      if (finished || !state.lastPacketAt) return;
      const silence = Date.now() - state.lastPacketAt;
      if (silence > timings.packetWarning && !silenceWarningLogged) {
        silenceWarningLogged = true;
        console.log(`[NETWORK WARNING] No incoming packet for ${Math.round(silence / 1000)}s; leaving Mineflayer's ${Math.round(timings.protocolTimeout / 1000)}s timeout in control.`);
      }
    }, timings.packetCheck);
    packetTimer.unref?.();

    const messages = Array.isArray(chatConfig.messages)
      ? chatConfig.messages.filter(message => typeof message === 'string' && message.trim())
      : [];

    if (chatConfig.enabled && messages.length > 0) {
      const sendChat = () => {
        if (finished || state.phase !== 'online') return;
        const message = messages[Math.floor(Math.random() * messages.length)].trim().slice(0, 240);
        bot.chat(message);
        console.log(`[CHAT SENT] ${message}`);
        if (chatConfig.repeat !== false) {
          const repeatMs = Math.max(30000, Number(chatConfig['repeat-delay'] || 60) * 1000);
          chatTimer = setTimeout(sendChat, repeatMs);
          chatTimer.unref?.();
        }
      };
      chatTimer = setTimeout(sendChat, 15000);
      chatTimer.unref?.();
    }
  });

  bot.on('resourcePack', () => {
    try {
      bot.acceptResourcePack?.();
      console.log('[BOT] Accepted resource pack request.');
    } catch (error) {
      console.log(`[BOT] Resource pack response failed: ${reasonText(error)}`);
    }
  });

  if (utils['chat-log'] !== false) {
    bot.on('chat', (name, message) => console.log(`[CHAT] <${name}> ${message}`));
  }

  bot.on('kicked', reason => {
    const text = reasonText(reason);
    state.lastKickReason = text;
    state.lastKickAt = new Date().toISOString();
    console.log(`[KICKED] ${text}`);

    if (/throttl|wait before reconnect|too fast|rate.?limit/i.test(text)) {
      state.throttled = true;
      console.log('[RECONNECT] Throttle-style kick detected; next retry will wait 60–120 seconds.');
    }
  });

  bot.on('error', error => {
    state.lastError = reasonText(error);
    state.lastErrorAt = new Date().toISOString();
    console.error(`[ERROR] ${state.lastError}`);
  });

  bot.once('end', reason => finish(reason || 'connection ended'));
}

startBot();

const selfPingBase = process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || 'https://aternos-bot-wre2.onrender.com';
setInterval(() => {
  const separator = selfPingBase.includes('?') ? '&' : '?';
  fetch(`${selfPingBase.replace(/\/$/, '')}/ping${separator}t=${Date.now()}`, {
    headers: { 'cache-control': 'no-cache' }
  })
    .then(response => console.log(`[KEEPALIVE] ${response.status}`))
    .catch(error => console.log(`[KEEPALIVE ERROR] ${error.message}`));
}, 8 * 60 * 1000).unref?.();

function shutdown(signal) {
  if (state.stopping) return;
  state.stopping = true;
  state.phase = 'stopping';
  console.log(`[PROCESS] ${signal} received; stopping.`);
  clearReconnectTimer();
  state.controller?.stop();
  try { state.bot?.end('serviceShutdown'); } catch {}
  setTimeout(() => process.exit(0), 1500).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => {
  state.lastError = `Unhandled rejection: ${reasonText(reason)}`;
  state.lastErrorAt = new Date().toISOString();
  console.error(`[PROCESS] ${state.lastError}`);
});
process.on('uncaughtException', error => {
  state.lastError = `Uncaught exception: ${reasonText(error)}`;
  state.lastErrorAt = new Date().toISOString();
  console.error(`[PROCESS] ${state.lastError}`);
  setTimeout(() => process.exit(1), 1000).unref?.();
});
