'use strict';

const fs = require('fs');
const path = require('path');
const mineflayer = require('mineflayer');
const settings = require('./settings.json');

let installed = false;

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function install() {
  if (installed) return;
  installed = true;

  const config = settings?.utils?.['fast-join'] || {};
  const joinTimeoutMs = Math.max(
    20000,
    number(process.env.FAST_JOIN_TIMEOUT_SECONDS ?? config['join-timeout'], 45) * 1000
  );
  const closeTimeoutMs = Math.max(
    5000,
    number(process.env.MC_CLOSE_TIMEOUT_SECONDS ?? config['close-timeout'], 15) * 1000
  );
  const noPongTimeoutMs = Math.max(
    3000,
    number(process.env.MC_NO_PONG_TIMEOUT_SECONDS ?? config['no-pong-timeout'], 8) * 1000
  );
  const cacheEnabled = config['cache-version'] !== false;
  const cacheFile = process.env.MC_VERSION_CACHE_FILE ||
    path.join(process.cwd(), '.last-minecraft-version.json');

  function readCachedVersion() {
    if (!cacheEnabled) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      return typeof parsed?.version === 'string' && parsed.version.trim()
        ? parsed.version.trim()
        : null;
    } catch {
      return null;
    }
  }

  function clearCachedVersion() {
    if (!cacheEnabled) return;
    try { fs.unlinkSync(cacheFile); } catch {}
  }

  function saveCachedVersion(version) {
    if (!cacheEnabled || typeof version !== 'string' || !version.trim()) return;
    try {
      fs.writeFileSync(
        cacheFile,
        `${JSON.stringify({ version: version.trim(), savedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8'
      );
    } catch (error) {
      console.log(`[FAST JOIN] Version cache save failed: ${error.message}`);
    }
  }

  let cachedVersion = String(process.env.MC_VERSION || settings?.server?.version || '').trim() ||
    readCachedVersion();

  const originalCreateBot = mineflayer.createBot;
  if (originalCreateBot.__fastJoinWrapped) return;

  function createBot(options = {}) {
    const explicitVersion = typeof options.version === 'string' && options.version.trim()
      ? options.version.trim()
      : null;
    const usedCachedVersion = !explicitVersion && Boolean(cachedVersion);
    const selectedVersion = explicitVersion || cachedVersion || false;

    if (!explicitVersion && cachedVersion) {
      console.log(`[FAST JOIN] Using cached Java ${cachedVersion}; skipping version auto-detection.`);
    }

    const bot = originalCreateBot.call(mineflayer, {
      ...options,
      version: selectedVersion,
      closeTimeout: Math.min(
        Number.isFinite(Number(options.closeTimeout)) ? Number(options.closeTimeout) : closeTimeoutMs,
        closeTimeoutMs
      ),
      noPongTimeout: Math.min(
        Number.isFinite(Number(options.noPongTimeout)) ? Number(options.noPongTimeout) : noPongTimeoutMs,
        noPongTimeoutMs
      )
    });

    let spawned = false;
    let ended = false;
    let fallbackTimer = null;

    const clearTimers = () => {
      clearTimeout(joinTimer);
      clearTimeout(fallbackTimer);
    };

    const joinTimer = setTimeout(() => {
      if (spawned || ended) return;
      const seconds = Math.round(joinTimeoutMs / 1000);
      const reason = `fastJoinTimeout: no spawn after ${seconds}s`;
      console.error(`[FAST JOIN] ${reason}. Closing this attempt so reconnect can run.`);
      try { bot.clearControlStates?.(); } catch {}
      try { bot.end(reason); } catch {}
      try { bot._client?.socket?.destroy(new Error(reason)); } catch {}

      fallbackTimer = setTimeout(() => {
        if (ended) return;
        console.error('[FAST JOIN] No end event after forced close; emitting lifecycle recovery event.');
        try { bot.emit('end', reason); } catch {}
      }, 1500);
      fallbackTimer.unref?.();
    }, joinTimeoutMs);
    joinTimer.unref?.();

    bot.once('spawn', () => {
      spawned = true;
      clearTimers();
      const learnedVersion = typeof bot.version === 'string' ? bot.version.trim() : '';
      if (learnedVersion) {
        if (learnedVersion !== cachedVersion) {
          cachedVersion = learnedVersion;
          saveCachedVersion(learnedVersion);
        }
        console.log(`[FAST JOIN] Spawn complete using Java ${learnedVersion}; version cached for reconnects.`);
      }
    });

    bot.once('end', () => {
      ended = true;
      clearTimers();
      if (!spawned && usedCachedVersion) {
        console.log('[FAST JOIN] Cached version failed before spawn; clearing it for the next auto-detect attempt.');
        cachedVersion = null;
        clearCachedVersion();
      }
    });

    return bot;
  }

  createBot.__fastJoinWrapped = true;
  mineflayer.createBot = createBot;
  console.log(
    `[FAST JOIN] Installed: join timeout=${joinTimeoutMs / 1000}s, ` +
    `ping timeout=${noPongTimeoutMs / 1000}s, close timeout=${closeTimeoutMs / 1000}s.`
  );
}

module.exports = { install };
