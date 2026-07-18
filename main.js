'use strict';

const dns = require('dns');
const express = require('express');
const mineflayer = require('mineflayer');
const settings = require('./settings.json');
const { createAntiAfkController } = require('./actions');

const app = express();
const port = Number(process.env.PORT || 10000);
const startedAt = Date.now();
const account = settings['bot-account'] || {};
const server = settings.server || {};
const utils = settings.utils || {};
const routing = utils['connection-routing'] || {};
const watchdog = utils['connection-watchdog'] || {};

const config = {
  host: String(server.ip || '').trim(),
  port: Number(server.port),
  version: String(server.version || '').trim(),
  username: String(account.username || 'AfkBotByAkshit').trim(),
  auth: String(account.type || 'offline').toLowerCase() === 'microsoft' ? 'microsoft' : 'offline'
};

const timings = {
  reconnect: Math.max(5000, Number(utils['auto-reconnect-delay'] || 10000)),
  routeTimeout: Math.max(20000, Number(routing['route-timeout'] || 35) * 1000),
  dnsTimeout: Math.max(2000, Number(routing['dns-timeout'] || 5) * 1000),
  protocolKeepAlive: Math.max(60000, Number(utils['keepalive-timeout'] || 300) * 1000),
  packetCheck: Math.max(10000, Number(watchdog['check-interval'] || 20) * 1000),
  packetSilence: Math.max(60000, Number(watchdog['max-packet-silence'] || 120) * 1000),
  tcpKeepAlive: Math.max(10000, Number(watchdog['tcp-keepalive-delay'] || 30) * 1000)
};

const state = {
  phase: 'starting',
  bot: null,
  controller: null,
  cycle: null,
  reconnectTimer: null,
  stopping: false,
  connectedAt: null,
  connectingSince: null,
  nextReconnectAt: null,
  lastPacketAt: null,
  lastError: null,
  lastKickReason: null,
  lastDisconnectReason: null,
  lastDnsError: null,
  activeRoute: null,
  availableRoutes: [],
  remoteEndpoint: null,
  connectionCycles: 0,
  connectionAttempts: 0,
  successfulJoins: 0,
  disconnects: 0,
  actionCounts: { move: 0, jump: 0, crouch: 0, punch: 0 }
};

const validConfig = () => Boolean(
  config.host && config.username && Number.isInteger(config.port) && config.port > 0 && config.port <= 65535
);

const reasonText = reason => {
  if (reason == null) return 'unknown reason';
  if (typeof reason === 'string') return reason;
  try { return JSON.stringify(reason); } catch { return String(reason); }
};

const routeText = route => `${route.name} (${route.host}:${route.port})`;
const usableSocket = bot => Boolean(bot?._client?.socket && !bot._client.socket.destroyed && bot._client.socket.writable);
const freshPackets = () => state.lastPacketAt && Date.now() - state.lastPacketAt <= timings.packetSilence;
const healthy = () => state.phase === 'online' && state.bot?.player && usableSocket(state.bot) && freshPackets();

function healthPayload() {
  const now = Date.now();
  return {
    service: 'Minecraft AFK bot',
    healthy: Boolean(healthy()),
    connected: Boolean(healthy()),
    connecting: ['resolving', 'connecting', 'routing-fallback'].includes(state.phase),
    phase: state.phase,
    username: config.username,
    server: `${config.host}:${config.port}`,
    clientVersion: config.version || 'auto',
    auth: config.auth,
    activeRoute: state.activeRoute,
    availableRoutes: state.availableRoutes,
    remoteEndpoint: state.remoteEndpoint,
    processUptimeSeconds: Math.floor((now - startedAt) / 1000),
    connectedForSeconds: state.connectedAt ? Math.floor((now - state.connectedAt) / 1000) : null,
    packetSilenceSeconds: state.lastPacketAt ? Math.floor((now - state.lastPacketAt) / 1000) : null,
    nextReconnectAt: state.nextReconnectAt ? new Date(state.nextReconnectAt).toISOString() : null,
    connectionCycles: state.connectionCycles,
    connectionAttempts: state.connectionAttempts,
    successfulJoins: state.successfulJoins,
    disconnects: state.disconnects,
    lastDisconnectReason: state.lastDisconnectReason,
    lastKickReason: state.lastKickReason,
    lastError: state.lastError,
    lastDnsError: state.lastDnsError,
    actions: { ...state.actionCounts },
    checkedAt: new Date(now).toISOString()
  };
}

app.get('/', (_req, res) => res.status(200).json(healthPayload()));
app.get('/health', (_req, res) => {
  const payload = healthPayload();
  res.status(payload.healthy ? 200 : 503).json(payload);
});
app.listen(port, () => console.log(`[WEB] Listening on port ${port}`));

function timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

async function query(resolver, method, value) {
  return timeout(resolver[method](value), timings.dnsTimeout, `${method} ${value}`);
}

async function buildRoutes() {
  const routes = [];
  const seen = new Set();
  const add = route => {
    const key = `${route.host.toLowerCase()}:${route.port}`;
    if (!route.host || !Number.isInteger(route.port) || seen.has(key)) return;
    seen.add(key);
    routes.push(route);
  };

  add({ name: 'configured-address', host: config.host, port: config.port });
  if (!/\.aternos\.me$/i.test(config.host)) return routes;

  const resolvers = [];
  if (routing['public-dns'] !== false) {
    for (const servers of [['1.1.1.1', '1.0.0.1'], ['8.8.8.8', '8.8.4.4']]) {
      const resolver = new dns.promises.Resolver();
      resolver.setServers(servers);
      resolvers.push({ name: servers[0], resolver });
    }
  }
  resolvers.push({ name: 'system', resolver: dns.promises });
  const errors = [];

  for (const item of resolvers) {
    try {
      const addresses = await query(item.resolver, 'resolve4', config.host);
      for (const address of addresses || []) {
        add({ name: `fresh-a-via-${item.name}`, host: address, port: config.port, fakeHost: config.host });
      }
      if (addresses?.length) {
        console.log(`[DNS] ${item.name} resolved ${config.host} to ${addresses.join(', ')}.`);
        break;
      }
    } catch (error) {
      errors.push(`${item.name} A: ${reasonText(error)}`);
    }
  }

  if (routing['srv-fallback'] !== false) {
    const srvName = `_minecraft._tcp.${config.host}`;
    for (const item of resolvers) {
      try {
        const records = await query(item.resolver, 'resolveSrv', srvName);
        records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
        for (const record of records) {
          add({
            name: `srv-via-${item.name}`,
            host: String(record.name).replace(/\.$/, ''),
            port: Number(record.port),
            fakeHost: config.host
          });
        }
        if (records.length) {
          console.log(`[DNS] ${item.name} resolved ${srvName}: ${records.map(r => `${r.name}:${r.port}`).join(', ')}.`);
          break;
        }
      } catch (error) {
        errors.push(`${item.name} SRV: ${reasonText(error)}`);
      }
    }
  }

  state.lastDnsError = errors.length ? errors.join(' | ') : null;
  return routes;
}

function scheduleCycle(reason = '') {
  if (state.stopping || utils['auto-reconnect'] === false || state.reconnectTimer) return;
  state.phase = 'reconnecting';
  state.nextReconnectAt = Date.now() + timings.reconnect;
  console.log(`[BOT] New connection cycle in ${timings.reconnect / 1000}s${reason ? ` after ${reason}` : ''}.`);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    state.nextReconnectAt = null;
    startCycle();
  }, timings.reconnect);
  state.reconnectTimer.unref?.();
}

async function startCycle() {
  if (state.stopping || state.bot || state.cycle?.active) return;
  if (!validConfig()) {
    state.phase = 'configuration-error';
    state.lastError = 'Invalid server host, port, or username';
    return console.error(`[CONFIG] ${state.lastError}`);
  }

  const cycle = { id: state.connectionCycles + 1, active: true, routes: [], index: 0 };
  state.cycle = cycle;
  state.connectionCycles += 1;
  state.phase = 'resolving';
  state.connectingSince = Date.now();
  state.activeRoute = null;
  state.remoteEndpoint = null;

  try {
    cycle.routes = await buildRoutes();
  } catch (error) {
    state.lastDnsError = reasonText(error);
    cycle.routes = [{ name: 'configured-address', host: config.host, port: config.port }];
  }

  if (!cycle.active || state.cycle !== cycle || state.stopping) return;
  state.availableRoutes = cycle.routes.map(routeText);
  console.log(`[ROUTING] ${state.availableRoutes.join(' -> ')}`);
  connectRoute(cycle);
}

function connectRoute(cycle) {
  if (state.stopping || !cycle.active || state.cycle !== cycle || state.bot) return;
  if (cycle.index >= cycle.routes.length) {
    cycle.active = false;
    state.cycle = null;
    state.phase = 'offline';
    state.connectingSince = null;
    state.activeRoute = null;
    return scheduleCycle('all routes failed');
  }

  const route = cycle.routes[cycle.index++];
  state.phase = 'connecting';
  state.connectingSince = Date.now();
  state.activeRoute = routeText(route);
  state.connectionAttempts += 1;
  console.log(`[BOT] Attempt ${state.connectionAttempts}: ${routeText(route)} as ${config.username}, Java ${config.version}.`);

  let activeBot;
  try {
    const options = {
      host: route.host,
      port: route.port,
      username: config.username,
      auth: config.auth,
      version: config.version || false,
      keepAlive: true,
      checkTimeoutInterval: timings.protocolKeepAlive,
      respawn: true,
      logErrors: false,
      hideErrors: true
    };
    if (route.fakeHost) options.fakeHost = route.fakeHost;
    activeBot = mineflayer.createBot(options);
  } catch (error) {
    state.lastError = reasonText(error);
    console.log(`[BOT CREATE ERROR] ${state.lastError}`);
    return setTimeout(() => connectRoute(cycle), 1000).unref?.();
  }

  state.bot = activeBot;
  const client = activeBot._client;
  let spawned = false;
  let done = false;
  let closing = false;
  let routeTimer;
  let packetTimer;
  let cleanupTimer;
  let lastPacket = Date.now();

  const markPacket = () => {
    lastPacket = Date.now();
    if (state.bot === activeBot) state.lastPacketAt = lastPacket;
  };

  const clearTimers = () => {
    clearTimeout(routeTimer);
    clearInterval(packetTimer);
    clearTimeout(cleanupTimer);
  };

  const finish = reason => {
    if (done) return;
    done = true;
    clearTimers();
    client?.removeListener('packet', markPacket);
    state.controller?.stop();
    state.controller = null;
    if (state.bot === activeBot) state.bot = null;
    state.connectedAt = null;
    state.lastPacketAt = null;
    state.remoteEndpoint = null;
    state.lastDisconnectReason = reasonText(reason);
    state.disconnects += 1;
    console.log(`[BOT] Disconnected from ${routeText(route)}: ${state.lastDisconnectReason}`);

    if (state.stopping) return (state.phase = 'stopped');
    if (spawned) {
      cycle.active = false;
      state.cycle = null;
      state.activeRoute = null;
      state.phase = 'offline';
      scheduleCycle(state.lastDisconnectReason);
    } else {
      state.phase = 'routing-fallback';
      setTimeout(() => connectRoute(cycle), 1500).unref?.();
    }
  };

  const close = reason => {
    if (done || closing) return;
    closing = true;
    state.phase = 'disconnecting';
    state.controller?.stop();
    console.log(`[RECOVERY] Closing ${routeText(route)}: ${reason}`);
    try { activeBot.end(reason); } catch {
      try { client?.socket?.destroy(); } catch {}
    }
    cleanupTimer = setTimeout(() => {
      if (done) return;
      try { client?.socket?.destroy(); } catch {}
      finish(`${reason} (forced cleanup)`);
    }, 3000);
    cleanupTimer.unref?.();
  };

  client?.on('packet', markPacket);
  client?.once('connect', () => {
    markPacket();
    const socket = client.socket;
    state.remoteEndpoint = socket?.remoteAddress && socket?.remotePort
      ? `${socket.remoteAddress}:${socket.remotePort}`
      : `${route.host}:${route.port}`;
    try {
      socket?.setKeepAlive(true, timings.tcpKeepAlive);
      socket?.setNoDelay(true);
    } catch (error) {
      console.log(`[NETWORK] TCP tuning warning: ${reasonText(error)}`);
    }
    console.log(`[NETWORK] TCP established to ${state.remoteEndpoint} through ${route.name}.`);
  });

  routeTimer = setTimeout(() => {
    if (!spawned && !done) close(`no spawn after ${timings.routeTimeout / 1000}s`);
  }, timings.routeTimeout);
  routeTimer.unref?.();

  activeBot.once('login', () => console.log(`[BOT] Login accepted through ${route.name}.`));
  activeBot.once('spawn', () => {
    if (done) return;
    spawned = true;
    closing = false;
    clearTimeout(routeTimer);
    markPacket();
    state.phase = 'online';
    state.connectedAt = Date.now();
    state.connectingSince = null;
    state.successfulJoins += 1;
    state.lastError = null;
    state.lastKickReason = null;
    console.log(`[BOT] Joined successfully through ${routeText(route)}.`);
    console.log(`[WATCHDOG] Packet checks every ${timings.packetCheck / 1000}s; recovery after ${timings.packetSilence / 1000}s silence.`);

    state.controller = createAntiAfkController(
      activeBot,
      utils['anti-afk'] || {},
      () => state.bot === activeBot && state.phase === 'online' && usableSocket(activeBot)
    );
    state.actionCounts = state.controller.counts;
    state.controller.start();

    packetTimer = setInterval(() => {
      if (done || closing) return;
      if (!usableSocket(activeBot)) return close('socket closed or not writable');
      const silence = Date.now() - lastPacket;
      if (silence > timings.packetSilence) close(`no incoming packets for ${Math.round(silence / 1000)}s`);
    }, timings.packetCheck);
    packetTimer.unref?.();
  });

  activeBot.on('resourcePack', () => {
    try {
      activeBot.acceptResourcePack?.();
      console.log('[BOT] Accepted resource pack request.');
    } catch (error) {
      console.log(`[BOT] Resource pack response failed: ${reasonText(error)}`);
    }
  });

  if (utils['chat-log'] !== false) {
    activeBot.on('chat', (name, message) => console.log(`[CHAT] <${name}> ${message}`));
  }

  activeBot.on('kicked', reason => {
    state.lastKickReason = reasonText(reason);
    console.log(`[KICKED] ${state.lastKickReason}`);
    setTimeout(() => close(`kicked: ${state.lastKickReason}`), 500).unref?.();
  });

  activeBot.on('error', error => {
    const message = reasonText(error);
    state.lastError = message;
    console.log(`[ERROR] ${message}`);
    if (!spawned || /ECONN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|ENOTFOUND|socket|keepalive|timed out/i.test(message)) {
      close(`network error: ${message}`);
    }
  });

  activeBot.once('end', reason => finish(reason || 'connection ended'));
}

state.phase = 'offline';
startCycle();

const selfPingUrl = process.env.SELF_PING_URL || process.env.RENDER_EXTERNAL_URL || 'https://aternos-bot-wre2.onrender.com/';
setInterval(() => {
  fetch(selfPingUrl)
    .then(response => console.log(`[PING] ${response.status}`))
    .catch(error => console.log(`[PING ERROR] ${error.message}`));
}, 4 * 60 * 1000).unref?.();

function shutdown(signal) {
  if (state.stopping) return;
  state.stopping = true;
  state.phase = 'stopping';
  console.log(`[PROCESS] ${signal} received; stopping.`);
  clearTimeout(state.reconnectTimer);
  if (state.cycle) state.cycle.active = false;
  state.controller?.stop();
  try { state.bot?.end('serviceShutdown'); } catch {
    try { state.bot?._client?.socket?.destroy(); } catch {}
  }
  setTimeout(() => process.exit(0), 1500).unref?.();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => {
  state.lastError = `Unhandled rejection: ${reasonText(reason)}`;
  console.error(`[PROCESS] ${state.lastError}`);
});
process.on('uncaughtException', error => {
  state.lastError = `Uncaught exception: ${reasonText(error)}`;
  console.error(`[PROCESS] ${state.lastError}`);
  setTimeout(() => process.exit(1), 1000).unref?.();
});
