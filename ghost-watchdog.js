'use strict';

const mineflayer = require('mineflayer');
const settings = require('./settings.json');
const actions = require('./actions');

let installed = false;
const sessions = new WeakMap();

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sessionFresh(bot, timeoutMs) {
  const session = sessions.get(bot);
  if (!session || !session.spawned) return true;
  return !session.stale && Date.now() - session.lastPacketAt < timeoutMs;
}

function patchActions(timeoutMs) {
  const originalFactory = actions.createAntiAfkController;
  if (typeof originalFactory !== 'function' || originalFactory.__ghostWatchdogWrapped) return;

  function createGhostAwareController(bot, config, isHealthy) {
    const baseHealthy = typeof isHealthy === 'function' ? isHealthy : () => true;
    return originalFactory(bot, config, () => baseHealthy() && sessionFresh(bot, timeoutMs));
  }

  createGhostAwareController.__ghostWatchdogWrapped = true;
  actions.createAntiAfkController = createGhostAwareController;
}

function patchMineflayer(timeoutMs, checkIntervalMs) {
  const originalCreateBot = mineflayer.createBot;
  if (originalCreateBot.__ghostWatchdogWrapped) return;

  function createBot(options = {}) {
    const bot = originalCreateBot.call(mineflayer, options);
    const client = bot?._client;
    const session = {
      spawned: false,
      stale: false,
      ended: false,
      lastPacketAt: Date.now(),
      checkTimer: null,
      fallbackTimer: null
    };
    sessions.set(bot, session);

    const markPacket = () => {
      if (session.ended) return;
      session.lastPacketAt = Date.now();
    };

    const cleanup = () => {
      session.ended = true;
      clearInterval(session.checkTimer);
      clearTimeout(session.fallbackTimer);
      client?.removeListener('packet', markPacket);
    };

    const terminateGhostSession = silenceMs => {
      if (session.stale || session.ended) return;
      session.stale = true;

      const seconds = Math.floor(silenceMs / 1000);
      const reason = `ghostSessionTimeout: no incoming Minecraft packets for ${seconds}s`;
      console.error(`[GHOST WATCHDOG] ${reason}. Stopping actions and reconnecting.`);

      try { bot.clearControlStates?.(); } catch {}
      try { bot.end(reason); } catch {}
      try { client?.socket?.destroy(new Error(reason)); } catch {}

      session.fallbackTimer = setTimeout(() => {
        if (session.ended) return;
        console.error('[GHOST WATCHDOG] No natural end event after socket destruction; forcing lifecycle recovery.');
        try { bot.emit('end', reason); } catch (error) {
          console.error(`[GHOST WATCHDOG] Forced end event failed: ${error.message}`);
          process.exitCode = 1;
        }
      }, 1500);
      session.fallbackTimer.unref?.();
    };

    client?.on('packet', markPacket);

    bot.once('spawn', () => {
      session.spawned = true;
      session.stale = false;
      session.lastPacketAt = Date.now();

      session.checkTimer = setInterval(() => {
        if (session.ended || session.stale) return;
        const silenceMs = Date.now() - session.lastPacketAt;
        if (silenceMs >= timeoutMs) terminateGhostSession(silenceMs);
      }, checkIntervalMs);
      session.checkTimer.unref?.();
    });

    bot.once('end', cleanup);
    return bot;
  }

  createBot.__ghostWatchdogWrapped = true;
  mineflayer.createBot = createBot;
}

function install() {
  if (installed) return;
  installed = true;

  const watchdog = settings?.utils?.['connection-watchdog'] || {};
  const timeoutMs = Math.max(
    30000,
    number(process.env.GHOST_PACKET_TIMEOUT_SECONDS ?? watchdog['ghost-session-timeout'], 60) * 1000
  );
  const checkIntervalMs = Math.max(
    5000,
    number(process.env.GHOST_CHECK_INTERVAL_SECONDS ?? watchdog['ghost-check-interval'], 10) * 1000
  );

  patchActions(timeoutMs);
  patchMineflayer(timeoutMs, checkIntervalMs);
  console.log(
    `[GHOST WATCHDOG] Installed: packet silence timeout=${timeoutMs / 1000}s, ` +
    `check interval=${checkIntervalMs / 1000}s.`
  );
}

module.exports = { install };
