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
  let terminating = false;

  const markPacketReceived = () => {
    lastPacketAt = Date.now();
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
      if (terminating) return;

      const socket = client?.socket;
      const packetSilenceMs = Date.now() - lastPacketAt;
      const socketClosed = !socket || socket.destroyed || !socket.writable;

      if (!socketClosed && packetSilenceMs <= maxPacketSilenceMs) return;

      terminating = true;

      const reason = socketClosed
        ? 'Minecraft socket is no longer writable'
        : `no incoming Minecraft packets for ${Math.round(packetSilenceMs / 1000)}s`;

      console.log(
        `[WATCHDOG] Ghost connection detected (${reason}). ` +
        'Closing it so the normal reconnect system can create a fresh bot.'
      );

      try {
        bot.clearControlStates();
      } catch {
        // The bot may already be partially disconnected.
      }

      try {
        socket?.destroy(new Error('Minecraft packet-liveness timeout'));
      } catch {
        try {
          bot.end('packetLivenessTimeout');
        } catch {
          // The normal end/error handlers will handle any remaining cleanup.
        }
      }
    }, checkIntervalMs);

    watchdogTimer.unref?.();
  });

  bot.once('end', () => {
    if (watchdogTimer) clearInterval(watchdogTimer);
    client?.removeListener('packet', markPacketReceived);
  });

  return bot;
};
