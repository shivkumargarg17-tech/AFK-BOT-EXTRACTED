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
  version: String(process.env.MC_VERSION || server.version || '').trim(),
  auth: String(account.type || 'offline').toLowerCase() === 'microsoft' ? 'microsoft' : 'offline'
};

const timings = {
  reconnectAfterDisconnect: Math.max(5000, Number(utils['auto-reconnect-delay'] || 10000)),
  reconnectAfterFailedJoin: Math.max(30000, Number(readiness.interval || 30) * 1000),
  spawnTimeout: Math.max(45000, Number(readiness['spawn-timeout'] || 45) * 1000),
  packetCheck: Math.max(10000, Number(watchdog['check-interval'] || 20) * 1000),
  packetSilence: Math.max(180000, Number(watchdog['max-packet-silence'] || 180) * 1000),
  tcpKeepAlive: Math.max(10000, Number(watchdog['tcp-keepalive-delay'] || 30) * 1000),
  protocolKeepAlive: Math.max(60000, Number(utils['keepalive-timeout'] || 120) * 1000)
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
  successfulJoins: 0,
  disconnects: 0,
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

function packetsFresh() {
  return Boolean(state.lastPacketAt && Date.now() - state.lastPacketAt <= timings.packetSilence);
}

function healthy() {
  return actuallyConnected() && packetsFresh();
}

function healthPayload() {
  const now = Date.now();
  return {
    service: 'Minecraft AFK bot',
    healthy: healthy(),
    connected: actuallyConnected(),
    connecting: ['connecting', 'logging-in', 'reconnecting', 'waiting-for-server'].includes(state.phase),
    phase: state.phase,
    connectionMode: 'direct-mineflayer',
    username: config.username,
    server: `${config.host}:${config.port}`,
    clientVersion: config.version || 'auto',
    auth: config.auth,
    activeRoute: `direct (${config.host}:${config.port})`,
    availableRoutes: [`direct (${config.host}:${config.port})`],
    remoteEndpoint: state.remoteEndpoint,
    processUptimeSeconds: Math.floor((now - startedAt) / 1000),
    connectedForSeconds: state.connectedAt ? Math.floor((now - state.connectedAt) / 1000) : null,
    packetSilenceSeconds: state.lastPacketAt ? Math.floor((now - state.lastPacketAt) / 1000) : null,
    connectingForSeconds: state.connectingSince ? Math.floor((now - state.connectingSince) / 1000) : null,
    nextReconnectAt: state.nextReconnectAt ? new Date(state.nextReconnectAt).toISOString() : null,
    connectionAttempts: state.connectionAttempts,
    successfulJoins: state.successfulJoins,
    disconnects: state.disconnects,
    lastDisconnectReason: state.lastDisconnectReason,
    lastDisconnectAt: state.lastDisconnectAt,
    lastKickReason: state.lastKickReason,
    lastKickAt: state.lastKickAt,
    lastError: state.lastError,
    lastErrorAt: state.lastErrorAt,
    serverStatus: {
      enabled: false,
      mode: 'direct connection; no separate status probe'
    },
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
app.listen(webPort, () => console.log(`[WEB] Listening on port ${webPort}`));

function clearReconnectTimer() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
  state.nextReconnectAt = null;
}

function scheduleReconnect(delay, reason) {
  if (state.stopping || state.reconnectTimer || state.bot) return;
  const safeDelay = Math.max(1000, delay);
  state.phase = state.successfulJoins > 0 ? 'reconnecting' : 'waiting-for-server';
  state.nextReconnectAt = Date.now() + safeDelay;
  console.log(`[RECONNECT] Next direct Mineflayer attempt in ${(safeDelay / 1000).toFixed(1)}s after ${reasonText(reason)}.`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    state.nextReconnectAt = null;
    startBot();
  }, safeDelay);
  state.reconnectTimer.unref?.();
}

function startBot() {
  if (state.stopping || state.bot) return;
  clearReconnectTimer();

  if (!validConfig()) {
    state.phase = 'configuration-error';
    state.lastError = 'Invalid server host, port, or username (Minecraft usernames must be at most 16 characters)';
    state.lastErrorAt = new Date().toISOString();
    console.error(`[CONFIG] ${state.lastError}`);
    return;
  }

  state.phase = 'connecting';
  state.connectingSince = Date.now();
  state.connectionAttempts += 1;
  console.log(`[BOT] Direct attempt ${state.connectionAttempts}: ${config.host}:${config.port} as ${config.username}, Java ${config.version || 'auto'}.`);

  let bot;
  try {
    bot = mineflayer.createBot({
      host: config.host,
      port: config.port,
      username: config.username,
      auth: config.auth,
      version: config.version || false,
      keepAlive: true,
      checkTimeoutInterval: timings.protocolKeepAlive,
      respawn: true,
      logErrors: false,
      hideErrors: true
    });
  } catch (error) {
    state.connectingSince = null;
    state.lastError = reasonText(error);
    state.lastErrorAt = new Date().toISOString();
    console.error(`[BOT CREATE ERROR] ${state.lastError}`);
    scheduleReconnect(timings.reconnectAfterFailedJoin, 'bot creation error');
    return;
  }

  state.bot = bot;
  const client = bot._client;
  let spawned = false;
  let finished = false;
  let closing = false;
  let spawnTimer = null;
  let packetTimer = null;
  let forcedCloseTimer = null;
  let chatTimer = null;

  const markPacket = () => {
    if (state.bot === bot) state.lastPacketAt = Date.now();
  };

  const clearConnectionTimers = () => {
    clearTimeout(spawnTimer);
    clearInterval(packetTimer);
    clearTimeout(forcedCloseTimer);
    clearTimeout(chatTimer);
  };

  const forceClose = reason => {
    if (finished || closing) return;
    closing = true;
    console.log(`[RECOVERY] Closing direct connection: ${reasonText(reason)}`);
    try { bot.end(reasonText(reason)); } catch {}
    forcedCloseTimer = setTimeout(() => {
      if (finished) return;
      try { client?.socket?.destroy(); } catch {}
    }, 1500);
    forcedCloseTimer.unref?.();
  };

  const finish = reason => {
    if (finished) return;
    finished = true;
    clearConnectionTimers();
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
    console.log(`[BOT] Direct connection ended: ${state.lastDisconnectReason}`);

    if (state.stopping) {
      state.phase = 'stopped';
      return;
    }

    const delay = spawned ? timings.reconnectAfterDisconnect : timings.reconnectAfterFailedJoin;
    scheduleReconnect(delay, state.lastDisconnectReason);
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

  spawnTimer = setTimeout(() => {
    if (!spawned && !finished) forceClose(`no spawn after ${Math.round(timings.spawnTimeout / 1000)}s`);
  }, timings.spawnTimeout);
  spawnTimer.unref?.();

  bot.once('login', () => console.log('[BOT] Login accepted.'));
  bot.once('spawn', () => {
    if (finished) return;
    spawned = true;
    clearTimeout(spawnTimer);
    markPacket();
    state.phase = 'online';
    state.connectedAt = Date.now();
    state.connectingSince = null;
    state.successfulJoins += 1;
    state.lastError = null;
    state.lastErrorAt = null;
    console.log(`[BOT] Joined successfully using the direct legacy-style connection path.`);

    state.controller = createAntiAfkController(
      bot,
      utils['anti-afk'] || {},
      () => state.bot === bot && healthy()
    );
    state.actionCounts = state.controller.counts;
    state.controller.start();

    packetTimer = setInterval(() => {
      if (finished) return;
      if (!socketUsable(bot)) {
        forceClose('socket closed or not writable');
        return;
      }
      const silence = state.lastPacketAt ? Date.now() - state.lastPacketAt : Infinity;
      if (silence > timings.packetSilence) {
        forceClose(`no incoming packets for ${Math.round(silence / 1000)}s`);
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
    state.lastKickReason = reasonText(reason);
    state.lastKickAt = new Date().toISOString();
    console.log(`[KICKED] ${state.lastKickReason}`);
  });

  bot.on('error', error => {
    state.lastError = reasonText(error);
    state.lastErrorAt = new Date().toISOString();
    console.log(`[ERROR] ${state.lastError}`);
    if (!finished && /ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|ENOTFOUND|socket|keepalive|timed out/i.test(state.lastError)) {
      forceClose(`network error: ${state.lastError}`);
    }
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
