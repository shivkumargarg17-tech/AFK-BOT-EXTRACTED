'use strict';

const mineflayer = require('mineflayer');
const settings = require('./settings.json');
const actions = require('./actions');

let installed = false;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function install() {
  if (installed) return;
  installed = true;

  const reliability = settings?.utils?.reliability || {};
  const antiAfkStartDelay = Math.max(0, number(reliability['anti-afk-start-delay'], 12) * 1000);
  const kickCleanupDelay = Math.max(2000, number(reliability['kick-cleanup-delay'], 8) * 1000);
  const socketCheckInterval = Math.max(5000, number(reliability['socket-check-interval'], 15) * 1000);
  const maximumConnectingTime = Math.max(180000, number(reliability['maximum-connecting-time'], 210) * 1000);
  const noBotRestartTime = Math.max(240000, number(reliability['no-bot-restart-time'], 300) * 1000);
  const minimumProtocolTimeout = Math.max(300000, number(reliability['minimum-protocol-timeout'], 600) * 1000);

  patchAntiAfkStart(antiAfkStartDelay);
  patchMineflayer({
    kickCleanupDelay,
    socketCheckInterval,
    maximumConnectingTime,
    noBotRestartTime,
    minimumProtocolTimeout
  });

  console.log(
    `[RELIABILITY] Installed: anti-AFK delay=${antiAfkStartDelay / 1000}s, ` +
    `kick cleanup=${kickCleanupDelay / 1000}s, protocol timeout>=${minimumProtocolTimeout / 1000}s.`
  );
}

function patchAntiAfkStart(delay) {
  const originalFactory = actions.createAntiAfkController;
  if (typeof originalFactory !== 'function' || originalFactory.__reliabilityWrapped) return;

  const wrappedFactory = function reliableAntiAfkFactory(bot, config, isHealthy) {
    const controller = originalFactory(bot, config, isHealthy);
    let startTimer = null;
    let stopped = false;

    return {
      ...controller,
      start() {
        if (stopped || startTimer) return;
        startTimer = setTimeout(() => {
          startTimer = null;
          if (stopped) return;
          if (!isHealthy()) {
            console.log('[RELIABILITY] Anti-AFK start skipped because the connection is no longer healthy.');
            return;
          }
          console.log(`[RELIABILITY] Starting anti-AFK actions after ${Math.round(delay / 1000)}s spawn-settle delay.`);
          controller.start();
        }, delay);
        startTimer.unref?.();
      },
      stop() {
        stopped = true;
        if (startTimer) clearTimeout(startTimer);
        startTimer = null;
        controller.stop();
      }
    };
  };

  wrappedFactory.__reliabilityWrapped = true;
  actions.createAntiAfkController = wrappedFactory;
}

function patchMineflayer(options) {
  const originalCreateBot = mineflayer.createBot;
  if (originalCreateBot.__reliabilityWrapped) return;

  const active = new Set();
  let createdOnce = false;
  let lastBotCreatedAt = Date.now();
  let restartRequested = false;
  const rejectionTimes = [];

  function requestProcessRestart(reason) {
    if (restartRequested) return;
    restartRequested = true;
    console.error(`[SUPERVISOR] ${reason} Restarting the Render process so its service manager can recover it.`);
    setTimeout(() => process.exit(1), 1500).unref?.();
  }

  function forceSocketCleanup(meta, reason) {
    if (!meta || meta.ended || meta.cleanupRequested) return;
    meta.cleanupRequested = true;
    console.log(`[RELIABILITY] Forcing stale connection cleanup: ${reason}.`);

    try { meta.bot.clearControlStates?.(); } catch {}
    try { meta.bot.end(`reliability:${reason}`); } catch {}

    const destroyTimer = setTimeout(() => {
      if (meta.ended) return;
      try { meta.bot?._client?.socket?.destroy(); } catch {}
    }, 750);
    destroyTimer.unref?.();
  }

  const reliableCreateBot = function reliableCreateBot(botOptions = {}) {
    const configuredTimeout = number(botOptions.checkTimeoutInterval, options.minimumProtocolTimeout);
    const safeOptions = {
      ...botOptions,
      keepAlive: true,
      checkTimeoutInterval: Math.max(configuredTimeout, options.minimumProtocolTimeout)
    };

    const bot = originalCreateBot.call(mineflayer, safeOptions);
    const meta = {
      bot,
      createdAt: Date.now(),
      lastPacketAt: Date.now(),
      spawned: false,
      ended: false,
      cleanupRequested: false,
      kickTimer: null
    };

    createdOnce = true;
    lastBotCreatedAt = meta.createdAt;
    active.add(meta);

    const markPacket = () => {
      meta.lastPacketAt = Date.now();
    };

    bot?._client?.on('packet', markPacket);

    bot.once('spawn', () => {
      meta.spawned = true;
      meta.cleanupRequested = false;
      meta.lastPacketAt = Date.now();
    });

    bot.on('kicked', () => {
      if (meta.kickTimer) clearTimeout(meta.kickTimer);
      meta.kickTimer = setTimeout(() => {
        if (!meta.ended) {
          forceSocketCleanup(meta, `kick produced no end event after ${options.kickCleanupDelay / 1000}s`);
        }
      }, options.kickCleanupDelay);
      meta.kickTimer.unref?.();
    });

    bot.on('error', () => {
      const socket = bot?._client?.socket;
      if (socket?.destroyed || socket?.writable === false) {
        setTimeout(() => forceSocketCleanup(meta, 'socket became unusable after an error'), 500).unref?.();
      }
    });

    bot.once('end', () => {
      meta.ended = true;
      if (meta.kickTimer) clearTimeout(meta.kickTimer);
      bot?._client?.removeListener('packet', markPacket);
      active.delete(meta);
    });

    return bot;
  };

  reliableCreateBot.__reliabilityWrapped = true;
  mineflayer.createBot = reliableCreateBot;

  const watchdogTimer = setInterval(() => {
    const now = Date.now();

    for (const meta of active) {
      if (meta.ended) {
        active.delete(meta);
        continue;
      }

      const client = meta.bot?._client;
      const socket = client?.socket;

      if (socket && (socket.destroyed || socket.writable === false)) {
        forceSocketCleanup(meta, 'watchdog found a closed or unwritable socket');
        continue;
      }

      if (!meta.spawned && now - meta.createdAt > options.maximumConnectingTime) {
        forceSocketCleanup(meta, `connection remained unspawned for over ${options.maximumConnectingTime / 1000}s`);
      }
    }

    if (createdOnce && active.size === 0 && now - lastBotCreatedAt > options.noBotRestartTime) {
      requestProcessRestart(`No Mineflayer bot instance has existed for over ${options.noBotRestartTime / 1000}s.`);
    }
  }, options.socketCheckInterval);
  watchdogTimer.unref?.();

  process.on('unhandledRejection', () => {
    const now = Date.now();
    rejectionTimes.push(now);
    while (rejectionTimes.length && now - rejectionTimes[0] > 5 * 60 * 1000) rejectionTimes.shift();
    if (rejectionTimes.length >= 3) {
      requestProcessRestart('Three unhandled promise rejections occurred within five minutes.');
    }
  });
}

module.exports = { install };
