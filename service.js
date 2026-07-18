'use strict';

const dns = require('dns');
const net = require('net');
const express = require('express');
const mineflayer = require('mineflayer');
const minecraftProtocol = require('minecraft-protocol');
const settings = require('./settings.json');
const { createAntiAfkController } = require('./actions');

const app = express();
const webPort = Number(process.env.PORT || 10000);
const startedAt = Date.now();

const account = settings['bot-account'] || {};
const server = settings.server || {};
const utils = settings.utils || {};
const routing = utils['connection-routing'] || {};
const readiness = utils['readiness-probe'] || {};
const packetWatchdog = utils['connection-watchdog'] || {};
const statusWatchdog = utils['server-status-watchdog'] || {};
const chatConfig = utils['chat-messages'] || {};

const config = {
  host: String(server.ip || '').trim(),
  port: Number(server.port),
  version: String(server.version || '').trim(),
  username: String(account.username || 'AkshitAFKBot').trim(),
  auth: String(account.type || 'offline').toLowerCase() === 'microsoft' ? 'microsoft' : 'offline',
  dynIp: String(process.env.ATERNOS_DYNIP || server.dynip || '').trim()
};

const timings = {
  readinessInterval: Math.max(1500, Number(readiness.interval || 3) * 1000),
  tcpProbeTimeout: Math.max(1000, Number(readiness['tcp-timeout'] || 3) * 1000),
  dnsRefresh: Math.max(5000, Number(readiness['dns-refresh'] || 15) * 1000),
  spawnTimeout: Math.max(10000, Number(readiness['spawn-timeout'] || 20) * 1000),
  retryAfterDisconnect: Math.max(1500, Number(readiness['retry-after-disconnect'] || 3) * 1000),
  dnsTimeout: Math.max(1500, Number(routing['dns-timeout'] || 4) * 1000),
  protocolKeepAlive: Math.max(45000, Number(utils['keepalive-timeout'] || 120) * 1000),
  packetCheck: Math.max(10000, Number(packetWatchdog['check-interval'] || 20) * 1000),
  packetSilence: Math.max(60000, Number(packetWatchdog['max-packet-silence'] || 120) * 1000),
  tcpKeepAlive: Math.max(10000, Number(packetWatchdog['tcp-keepalive-delay'] || 30) * 1000),
  statusInterval: Math.max(15000, Number(statusWatchdog.interval || 30) * 1000),
  statusTimeout: Math.max(3000, Number(statusWatchdog.timeout || 8) * 1000),
  statusStartupGrace: Math.max(5000, Number(statusWatchdog['startup-grace'] || 15) * 1000)
};

const maxStatusFailures = Math.max(2, Number(statusWatchdog['max-failures'] || 3));
const statusEnabled = statusWatchdog.enabled !== false;

const state = {
  phase: 'starting',
  bot: null,
  controller: null,
  stopping: false,
  generation: 0,
  readinessTimer: null,
  readinessInFlight: false,
  nextReadinessAt: null,
  routes: [],
  routesRefreshedAt: null,
  activeRoute: null,
  remoteEndpoint: null,
  connectedAt: null,
  connectingSince: null,
  lastPacketAt: null,
  lastError: null,
  lastKickReason: null,
  lastDisconnectReason: null,
  lastDnsError: null,
  readinessChecks: 0,
  tcpProbeSuccesses: 0,
  connectionAttempts: 0,
  successfulJoins: 0,
  disconnects: 0,
  actionCounts: { move: 0, jump: 0, crouch: 0, punch: 0 },
  statusProbeFailures: 0,
  statusProbeInFlight: false,
  lastStatusProbeAt: null,
  lastStatusSuccessAt: null,
  lastStatusError: null,
  lastStatusLatencyMs: null,
  lastStatusVersion: null,
  lastStatusPlayersOnline: null,
  lastStatusDescription: null
};

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

function reasonText(reason) {
  if (reason == null) return 'unknown reason';
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return `${reason.code ? `${reason.code}: ` : ''}${reason.message}`;
  try { return JSON.stringify(reason); } catch { return String(reason); }
}

function descriptionText(description) {
  if (description == null) return '';
  if (typeof description === 'string') return description;
  if (typeof description.text === 'string') return description.text;
  try { return JSON.stringify(description); } catch { return String(description); }
}

function parseHostPort(value, defaultPort) {
  const input = String(value || '').trim();
  if (!input) return null;

  if (input.startsWith('[')) {
    const closing = input.indexOf(']');
    if (closing > 0) {
      const host = input.slice(1, closing);
      const suffix = input.slice(closing + 1);
      const port = suffix.startsWith(':') ? Number(suffix.slice(1)) : defaultPort;
      return { host, port };
    }
  }

  const colon = input.lastIndexOf(':');
  if (colon > 0 && input.indexOf(':') === colon) {
    const parsedPort = Number(input.slice(colon + 1));
    if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
      return { host: input.slice(0, colon), port: parsedPort };
    }
  }

  return { host: input, port: defaultPort };
}

const routeKey = route => `${String(route.host).toLowerCase()}:${Number(route.port)}`;
const routeText = route => `${route.name} (${route.host}:${route.port})`;
const usableSocket = (activeBot = state.bot) => Boolean(
  activeBot?._client?.socket &&
  !activeBot._client.socket.destroyed &&
  activeBot._client.socket.writable
);
const packetsAreFresh = () => Boolean(
  state.lastPacketAt && Date.now() - state.lastPacketAt <= timings.packetSilence
);

function statusIsFresh() {
  if (!statusEnabled) return true;
  if (!state.connectedAt) return false;
  const connectedFor = Date.now() - state.connectedAt;
  if (!state.lastStatusSuccessAt) {
    return connectedFor <= timings.statusStartupGrace + timings.statusInterval;
  }
  const freshnessWindow = timings.statusInterval * (maxStatusFailures + 1);
  return Date.now() - state.lastStatusSuccessAt <= freshnessWindow &&
    state.statusProbeFailures < maxStatusFailures;
}

function healthy() {
  return Boolean(
    state.phase === 'online' &&
    state.bot?.player &&
    usableSocket() &&
    packetsAreFresh() &&
    statusIsFresh()
  );
}

function healthPayload() {
  const now = Date.now();
  return {
    service: 'Minecraft AFK bot',
    healthy: healthy(),
    connected: healthy(),
    connecting: ['waiting-for-server', 'connecting', 'logging-in'].includes(state.phase),
    phase: state.phase,
    username: config.username,
    server: `${config.host}:${config.port}`,
    dynIpConfigured: Boolean(config.dynIp),
    clientVersion: config.version || 'auto',
    auth: config.auth,
    activeRoute: state.activeRoute,
    availableRoutes: state.routes.map(routeText),
    remoteEndpoint: state.remoteEndpoint,
    processUptimeSeconds: Math.floor((now - startedAt) / 1000),
    connectedForSeconds: state.connectedAt ? Math.floor((now - state.connectedAt) / 1000) : null,
    packetSilenceSeconds: state.lastPacketAt ? Math.floor((now - state.lastPacketAt) / 1000) : null,
    nextReadinessAt: state.nextReadinessAt ? new Date(state.nextReadinessAt).toISOString() : null,
    routesRefreshedAt: state.routesRefreshedAt ? new Date(state.routesRefreshedAt).toISOString() : null,
    readinessChecks: state.readinessChecks,
    tcpProbeSuccesses: state.tcpProbeSuccesses,
    connectionAttempts: state.connectionAttempts,
    successfulJoins: state.successfulJoins,
    disconnects: state.disconnects,
    lastDisconnectReason: state.lastDisconnectReason,
    lastKickReason: state.lastKickReason,
    lastError: state.lastError,
    lastDnsError: state.lastDnsError,
    serverStatus: {
      enabled: statusEnabled,
      failures: state.statusProbeFailures,
      maxFailures: maxStatusFailures,
      probeInFlight: state.statusProbeInFlight,
      lastProbeAt: state.lastStatusProbeAt ? new Date(state.lastStatusProbeAt).toISOString() : null,
      lastSuccessAt: state.lastStatusSuccessAt ? new Date(state.lastStatusSuccessAt).toISOString() : null,
      lastError: state.lastStatusError,
      latencyMs: state.lastStatusLatencyMs,
      version: state.lastStatusVersion,
      playersOnline: state.lastStatusPlayersOnline,
      description: state.lastStatusDescription
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

function timeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

const query = (resolver, method, value) => timeout(
  resolver[method](value),
  timings.dnsTimeout,
  `${method} ${value}`
);

async function buildRoutes() {
  const routes = [];
  const seen = new Set();
  const add = route => {
    if (!route?.host || !Number.isInteger(route.port) || route.port <= 0 || route.port > 65535) return;
    const key = routeKey(route);
    if (seen.has(key)) return;
    seen.add(key);
    routes.push(route);
  };

  const dyn = parseHostPort(config.dynIp, config.port);
  if (dyn) add({ name: 'dynip', host: dyn.host, port: dyn.port, fakeHost: config.host });

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
  const srvName = `_minecraft._tcp.${config.host}`;

  for (const item of resolvers) {
    try {
      const records = await query(item.resolver, 'resolveSrv', srvName);
      records.sort((a, b) => a.priority - b.priority || b.weight - a.weight);
      for (const record of records) {
        const srvHost = String(record.name).replace(/\.$/, '');
        add({ name: `srv-via-${item.name}`, host: srvHost, port: Number(record.port), fakeHost: config.host });

        try {
          const srvAddresses = await query(item.resolver, 'resolve4', srvHost);
          for (const address of srvAddresses || []) {
            add({ name: `srv-ip-via-${item.name}`, host: address, port: Number(record.port), fakeHost: config.host });
          }
        } catch (error) {
          errors.push(`${item.name} SRV-A: ${reasonText(error)}`);
        }
      }
      if (records.length) {
        console.log(`[DNS] ${item.name} resolved ${srvName}: ${records.map(record => `${record.name}:${record.port}`).join(', ')}.`);
        break;
      }
    } catch (error) {
      errors.push(`${item.name} SRV: ${reasonText(error)}`);
    }
  }

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

  state.lastDnsError = errors.length ? errors.join(' | ') : null;
  return routes;
}

function tcpProbe(route) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ host: route.host, port: route.port });
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve({ route, latencyMs: Date.now() - started });
    };

    const timer = setTimeout(
      () => finish(new Error(`TCP timeout after ${timings.tcpProbeTimeout}ms`)),
      timings.tcpProbeTimeout
    );
    timer.unref?.();

    socket.once('connect', () => finish());
    socket.once('error', finish);
  });
}

async function findReadyRoute(routes) {
  const probes = routes.map(async route => {
    try {
      return await tcpProbe(route);
    } catch (error) {
      throw new Error(`${routeText(route)}: ${reasonText(error)}`);
    }
  });

  if (!probes.length) throw new Error('No routes available');

  try {
    return await Promise.any(probes);
  } catch (aggregate) {
    const messages = Array.isArray(aggregate?.errors)
      ? aggregate.errors.map(reasonText)
      : [reasonText(aggregate)];
    throw new Error(messages.join(' | '));
  }
}

function protocolSocketConnect(route) {
  return client => {
    const socket = net.connect({ host: route.host, port: route.port });
    let handedOff = false;

    const fail = error => {
      if (handedOff) return;
      handedOff = true;
      socket.destroy();
      client.emit('error', error);
    };

    const timer = setTimeout(
      () => fail(new Error(`connect timeout after ${timings.tcpProbeTimeout}ms`)),
      timings.tcpProbeTimeout
    );
    timer.unref?.();

    socket.once('error', fail);
    socket.once('connect', () => {
      if (handedOff) return;
      handedOff = true;
      clearTimeout(timer);
      socket.removeListener('error', fail);
      client.setSocket(socket);
      client.emit('connect');
    });
  };
}

function pingRoute(route) {
  const started = Date.now();
  return minecraftProtocol.ping({
    host: config.host,
    port: route.port,
    version: config.version || undefined,
    closeTimeout: timings.statusTimeout,
    noPongTimeout: Math.min(4000, timings.statusTimeout),
    connect: protocolSocketConnect(route)
  }).then(result => ({
    result,
    route,
    latencyMs: Number(result?.latency) || Date.now() - started
  }));
}

function statusResultLooksOnline(result) {
  const combined = `${descriptionText(result?.description)} ${String(result?.version?.name || '')}`.toLowerCase();
  if (/server\s+is\s+offline|not\s+online|not\s+running|server\s+offline|starting|stopping|queued|unavailable/.test(combined)) {
    return false;
  }
  return Boolean(result?.version);
}

async function probeServerStatus(routes) {
  const unique = [];
  const seen = new Set();
  for (const route of routes || []) {
    const key = routeKey(route);
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(route);
    }
  }

  const outcomes = await Promise.allSettled(unique.map(route => pingRoute(route)));
  const successes = [];
  const errors = [];

  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    if (outcome.status === 'fulfilled' && statusResultLooksOnline(outcome.value.result)) {
      successes.push(outcome.value);
    } else if (outcome.status === 'fulfilled') {
      errors.push(`${routeText(unique[index])}: status reports offline`);
    } else {
      errors.push(`${routeText(unique[index])}: ${reasonText(outcome.reason)}`);
    }
  }

  if (!successes.length) throw new Error(errors.join(' | ') || 'No status route succeeded');
  successes.sort((a, b) => a.latencyMs - b.latencyMs);
  return successes[0];
}

function clearReadinessTimer() {
  clearTimeout(state.readinessTimer);
  state.readinessTimer = null;
  state.nextReadinessAt = null;
}

function scheduleReadiness(delay = timings.readinessInterval, reason = '') {
  if (state.stopping || state.bot || state.readinessTimer || state.readinessInFlight) return;
  state.phase = 'waiting-for-server';
  state.nextReadinessAt = Date.now() + delay;
  if (reason) console.log(`[READY] Next probe in ${(delay / 1000).toFixed(1)}s after ${reason}.`);
  state.readinessTimer = setTimeout(() => {
    state.readinessTimer = null;
    state.nextReadinessAt = null;
    readinessTick();
  }, delay);
  state.readinessTimer.unref?.();
}

async function refreshRoutes(force = false) {
  if (!force && state.routes.length && state.routesRefreshedAt && Date.now() - state.routesRefreshedAt < timings.dnsRefresh) {
    return state.routes;
  }

  state.phase = 'resolving';
  try {
    const routes = await buildRoutes();
    state.routes = routes.length ? routes : [{ name: 'configured-address', host: config.host, port: config.port }];
  } catch (error) {
    state.lastDnsError = reasonText(error);
    state.routes = [{ name: 'configured-address', host: config.host, port: config.port }];
  }
  state.routesRefreshedAt = Date.now();
  console.log(`[ROUTING] ${state.routes.map(routeText).join(' -> ')}`);
  return state.routes;
}

async function readinessTick() {
  if (state.stopping || state.bot || state.readinessInFlight) return;
  if (!validConfig()) {
    state.phase = 'configuration-error';
    state.lastError = 'Invalid server host, port, or username (Minecraft usernames must be at most 16 characters)';
    console.error(`[CONFIG] ${state.lastError}`);
    return;
  }

  const generation = state.generation;
  state.readinessInFlight = true;
  state.readinessChecks += 1;
  state.phase = 'waiting-for-server';

  try {
    const routes = await refreshRoutes(false);
    if (state.stopping || state.bot || generation !== state.generation) return;

    const ready = await findReadyRoute(routes);
    if (state.stopping || state.bot || generation !== state.generation) return;

    state.tcpProbeSuccesses += 1;
    state.lastError = null;
    console.log(`[READY] Minecraft TCP is accepting connections through ${routeText(ready.route)} (${ready.latencyMs}ms).`);
    connectBot(ready.route);
  } catch (error) {
    state.lastError = reasonText(error);
    const refreshDue = !state.routesRefreshedAt || Date.now() - state.routesRefreshedAt >= timings.dnsRefresh;
    if (refreshDue) await refreshRoutes(true);
    if (!state.stopping && !state.bot && generation === state.generation) {
      scheduleReadiness(timings.readinessInterval);
    }
  } finally {
    state.readinessInFlight = false;
    if (!state.stopping && !state.bot && !state.readinessTimer && state.phase !== 'configuration-error') {
      scheduleReadiness(timings.readinessInterval);
    }
  }
}

function connectBot(route) {
  if (state.stopping || state.bot) return;

  clearReadinessTimer();
  state.phase = 'connecting';
  state.connectingSince = Date.now();
  state.activeRoute = routeText(route);
  state.connectionAttempts += 1;
  state.lastError = null;
  console.log(`[BOT] Attempt ${state.connectionAttempts}: ${routeText(route)} as ${config.username}, Java ${config.version || 'auto'}.`);

  let activeBot;
  try {
    const options = {
      host: config.host,
      port: route.port,
      username: config.username,
      auth: config.auth,
      version: config.version || false,
      keepAlive: true,
      checkTimeoutInterval: timings.protocolKeepAlive,
      respawn: true,
      logErrors: false,
      hideErrors: true,
      connect: protocolSocketConnect(route)
    };
    if (route.fakeHost || route.host !== config.host) options.fakeHost = config.host;
    activeBot = mineflayer.createBot(options);
  } catch (error) {
    state.lastError = reasonText(error);
    console.log(`[BOT CREATE ERROR] ${state.lastError}`);
    scheduleReadiness(timings.retryAfterDisconnect, 'bot creation error');
    return;
  }

  state.bot = activeBot;
  const client = activeBot._client;
  const generation = ++state.generation;
  let spawned = false;
  let done = false;
  let closing = false;
  let lastPacket = Date.now();
  let spawnTimer;
  let packetTimer;
  let statusTimer;
  let cleanupTimer;
  let chatTimer;

  const markPacket = () => {
    lastPacket = Date.now();
    if (state.bot === activeBot) state.lastPacketAt = lastPacket;
  };

  const clearTimers = () => {
    clearTimeout(spawnTimer);
    clearInterval(packetTimer);
    clearInterval(statusTimer);
    clearTimeout(cleanupTimer);
    clearTimeout(chatTimer);
  };

  const finish = reason => {
    if (done) return;
    done = true;
    clearTimers();
    client?.removeListener('packet', markPacket);
    state.controller?.stop();
    state.controller = null;
    state.statusProbeInFlight = false;
    if (state.bot === activeBot) state.bot = null;
    state.connectedAt = null;
    state.connectingSince = null;
    state.lastPacketAt = null;
    state.remoteEndpoint = null;
    state.lastDisconnectReason = reasonText(reason);
    state.disconnects += 1;
    console.log(`[BOT] Disconnected from ${routeText(route)}: ${state.lastDisconnectReason}`);

    if (state.stopping) {
      state.phase = 'stopped';
      return;
    }

    state.phase = 'waiting-for-server';
    state.generation = generation + 1;
    refreshRoutes(true)
      .catch(error => { state.lastDnsError = reasonText(error); })
      .finally(() => scheduleReadiness(timings.retryAfterDisconnect, state.lastDisconnectReason));
  };

  const close = reason => {
    if (done || closing) return;
    closing = true;
    state.phase = 'disconnecting';
    state.controller?.stop();
    console.log(`[RECOVERY] Closing ${routeText(route)}: ${reason}`);

    try { activeBot.end(reason); }
    catch {
      try { client?.socket?.destroy(); } catch {}
    }

    cleanupTimer = setTimeout(() => {
      if (done) return;
      try { client?.socket?.destroy(); } catch {}
      finish(`${reason} (forced cleanup)`);
    }, 2500);
    cleanupTimer.unref?.();
  };

  const recordStatus = response => {
    const result = response.result;
    state.statusProbeFailures = 0;
    state.lastStatusSuccessAt = Date.now();
    state.lastStatusError = null;
    state.lastStatusLatencyMs = response.latencyMs;
    state.lastStatusVersion = result?.version?.name || null;
    state.lastStatusPlayersOnline = Number.isFinite(result?.players?.online) ? result.players.online : null;
    state.lastStatusDescription = descriptionText(result?.description) || null;
  };

  const runStatusProbe = async () => {
    if (!statusEnabled || done || closing || !spawned || state.statusProbeInFlight) return;
    state.statusProbeInFlight = true;
    state.lastStatusProbeAt = Date.now();
    try {
      const response = await probeServerStatus([route, ...state.routes]);
      if (done || closing) return;
      recordStatus(response);
      console.log(`[STATUS] Online via ${routeText(response.route)} | latency=${response.latencyMs}ms | players=${state.lastStatusPlayersOnline ?? '?'} | version=${state.lastStatusVersion || '?'}`);
    } catch (error) {
      if (done || closing) return;
      state.statusProbeFailures += 1;
      state.lastStatusError = reasonText(error);
      console.log(`[STATUS] Probe failed ${state.statusProbeFailures}/${maxStatusFailures}: ${state.lastStatusError}`);
      if (state.statusProbeFailures >= maxStatusFailures) {
        close(`server status failed ${state.statusProbeFailures} consecutive times`);
      }
    } finally {
      state.statusProbeInFlight = false;
    }
  };

  client?.on('packet', markPacket);
  client?.once('connect', () => {
    markPacket();
    state.phase = 'logging-in';
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

  spawnTimer = setTimeout(() => {
    if (!spawned && !done) close(`no spawn after ${Math.round(timings.spawnTimeout / 1000)}s`);
  }, timings.spawnTimeout);
  spawnTimer.unref?.();

  activeBot.once('login', () => console.log(`[BOT] Login accepted through ${route.name}.`));
  activeBot.once('spawn', () => {
    if (done) return;
    spawned = true;
    closing = false;
    clearTimeout(spawnTimer);
    markPacket();
    state.phase = 'online';
    state.connectedAt = Date.now();
    state.connectingSince = null;
    state.successfulJoins += 1;
    state.lastError = null;
    state.lastKickReason = null;
    state.statusProbeFailures = 0;
    state.lastStatusError = null;
    state.lastStatusSuccessAt = Date.now();
    console.log(`[BOT] Joined successfully through ${routeText(route)}.`);
    console.log(`[WATCHDOG] Readiness=${timings.readinessInterval / 1000}s, packets=${timings.packetCheck / 1000}s, status=${timings.statusInterval / 1000}s.`);

    state.controller = createAntiAfkController(
      activeBot,
      utils['anti-afk'] || {},
      () => state.bot === activeBot && state.phase === 'online' && usableSocket(activeBot) && packetsAreFresh() && statusIsFresh()
    );
    state.actionCounts = state.controller.counts;
    state.controller.start();

    packetTimer = setInterval(() => {
      if (done || closing) return;
      if (!usableSocket(activeBot)) {
        close('socket closed or not writable');
        return;
      }
      const silence = Date.now() - lastPacket;
      if (silence > timings.packetSilence) {
        close(`no incoming packets for ${Math.round(silence / 1000)}s`);
      }
    }, timings.packetCheck);
    packetTimer.unref?.();

    if (statusEnabled) {
      setTimeout(runStatusProbe, timings.statusStartupGrace).unref?.();
      statusTimer = setInterval(runStatusProbe, timings.statusInterval);
      statusTimer.unref?.();
    }

    const messages = Array.isArray(chatConfig.messages)
      ? chatConfig.messages.filter(message => typeof message === 'string' && message.trim())
      : [];
    if (chatConfig.enabled && messages.length > 0) {
      const sendChat = () => {
        if (done || closing || state.phase !== 'online') return;
        const message = messages[Math.floor(Math.random() * messages.length)].trim().slice(0, 240);
        activeBot.chat(message);
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
    setTimeout(() => close(`kicked: ${state.lastKickReason}`), 250).unref?.();
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

function start() {
  if (!validConfig()) {
    state.phase = 'configuration-error';
    state.lastError = 'Invalid server host, port, or username (Minecraft usernames must be at most 16 characters)';
    console.error(`[CONFIG] ${state.lastError}`);
    return;
  }
  state.phase = 'waiting-for-server';
  readinessTick();
}

start();

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
  state.generation += 1;
  console.log(`[PROCESS] ${signal} received; stopping.`);
  clearReadinessTimer();
  state.controller?.stop();
  try { state.bot?.end('serviceShutdown'); }
  catch {
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
