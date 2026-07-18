'use strict';

const mineflayer = require('mineflayer');
const settings = require('./settings.json');

const watchdogConfig = settings.utils?.['connection-watchdog'] || {};
const watchdogEnabled = watchdogConfig.enabled !== false;
const checkIntervalMs = Math.max(
  10000,
  Number(watchdogConfig['check-interval'] || 20) * 1000
);
const maxPacketSilenceMs = Math.max(
  45000,
  Number(watchdogConfig['max-packet-silence'] || 90) * 1000
);
const tcpKeepAliveDelayMs = Math.max(
  10000,
  Number(watchdogConfig['tcp-keepalive-delay'] || 30) * 1000
);

const originalCreateBot = mineflayer.createBot.bind(mineflayer);

mineflayer.createBot = function createBotWithLivenessWatchdog(options = {}) {
  const bot = originalCreateBot(options);

  if (!watchdogEnabled) return bot;

  const client = bot._client;
  let lastPacketAt = Date.now();
  let watchdogTimer;
  let cleanupFallbackTimer;
  let terminating = false;
  let ended = false;

  const markPacketReceived = () => {
    lastPacketAt = Date.now();
  };

  const stopTimers = () => {
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (cleanupFallbackTimer) clearTimeout(cleanupFallbackTimer);
    watchdogTimer = undefined;
    cleanupFallbackTimer = undefined;
  };

  const terminateGhostConnection = reason => {
    if (terminating || ended) return;
    terminating = true;

    console.log(
      `[WATCHDOG] Dead connection detected (${reason}). ` +
      'Closing it so the normal reconnect system can create a fresh bot.'
    );

    try {
      bot.clearControlStates();
    } catch {
      // The bot may already be partially disconnected.
    }

    const socket = client?.socket;
    try {
      if (socket && !socket.destroyed) {
        socket.destroy(new Error('Minecraft connection liveness failure'));
      } else {
        bot.end('connectionLivenessFailure');
      }
    } catch {
      try {
        bot.end('connectionLivenessFailure');
      } catch {
        // The fallback below handles clients that remain stuck.
      }
    }

    // A few socket failures emit error without end. Force the protocol client
    // closed if the normal event chain has not completed promptly.
    cleanupFallbackTimer = setTimeout(() => {
      if (ended) return;
      console.log('[WATCHDOG] Forcing cleanup of a connection that did not end normally.');
      try {
        client?.end('forcedLivenessCleanup');
      } catch {
        try {
          client?.socket?.destroy();
        } catch {
          // Nothing else can be cleaned up here.
        }
      }
    }, 5000);
    cleanupFallbackTimer.unref?.();
  };

  client?.on('packet', markPacketReceived);

  client?.once('connect', () => {
    markPacketReceived();

    const socket = client.socket;
    try {
      socket?.setKeepAlive(true, tcpKeepAliveDelayMs);
      socket?.setNoDelay(true);
      console.log(
        `[WATCHDOG] TCP keepalive enabled (${Math.round(tcpKeepAliveDelayMs / 1000)}s).`
      );
    } catch (error) {
      console.log(`[WATCHDOG] Could not configure TCP keepalive: ${error.message}`);
    }
  });

  bot.once('spawn', () => {
    markPacketReceived();

    console.log(
      `[WATCHDOG] Packet monitor active: checking every ` +
      `${Math.round(checkIntervalMs / 1000)}s; reconnect after ` +
      `${Math.round(maxPacketSilenceMs / 1000)}s without server packets.`
    );

    watchdogTimer = setInterval(() => {
      if (terminating || ended) return;

      const socket = client?.socket;
      const packetSilenceMs = Date.now() - lastPacketAt;
      const socketClosed = !socket || socket.destroyed || !socket.writable;

      if (socketClosed) {
        terminateGhostConnection('Minecraft socket is no longer writable');
        return;
      }

      if (packetSilenceMs > maxPacketSilenceMs) {
        terminateGhostConnection(
          `no incoming Minecraft packets for ${Math.round(packetSilenceMs / 1000)}s`
        );
      }
    }, checkIntervalMs);

    watchdogTimer.unref?.();
  });

  bot.on('error', error => {
    const message = String(error?.message || error || 'unknown network error');
    const fatalNetworkError =
      /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket closed|socket hang up|keepalive|timed out/i
        .test(message);

    if (fatalNetworkError) {
      terminateGhostConnection(`fatal network error: ${message}`);
    }
  });

  bot.once('end', () => {
    ended = true;
    stopTimers();
    client?.removeListener('packet', markPacketReceived);
  });

  return bot;
};
