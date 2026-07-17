'use strict';

const dns = require('dns');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (error) {
  console.log(`[DNS] Could not enable IPv4-first resolution: ${error.message}`);
}

// node-minecraft-protocol uses dns.resolveSrv() for Minecraft domains. Try
// fresh public resolvers first to avoid stale Aternos records, but always fall
// back to Render's system DNS if direct public-DNS traffic is unavailable.
const originalResolveSrv = dns.resolveSrv.bind(dns);
const publicResolver = new dns.Resolver();
publicResolver.setServers(['1.1.1.1', '8.8.8.8']);

dns.resolveSrv = function resolveSrvWithFallback(hostname, callback) {
  let finished = false;

  const finishWithSystemDns = () => {
    if (finished) return;
    finished = true;
    originalResolveSrv(hostname, callback);
  };

  const timeout = setTimeout(finishWithSystemDns, 5000);

  publicResolver.resolveSrv(hostname, (error, records) => {
    if (finished) return;
    clearTimeout(timeout);

    if (!error && Array.isArray(records) && records.length > 0) {
      finished = true;
      console.log(`[DNS] Public DNS resolved ${hostname}.`);
      callback(null, records);
      return;
    }

    console.log(
      `[DNS] Public DNS could not resolve ${hostname}; using system DNS.`
    );
    finishWithSystemDns();
  });
};

const mineflayer = require('mineflayer');
const originalCreateBot = mineflayer.createBot;

mineflayer.createBot = function createReliableBot(options = {}) {
  const patched = { ...options };
  const host = String(patched.host || '').trim();

  if (/\.aternos\.me$/i.test(host)) {
    // node-minecraft-protocol only performs Minecraft SRV lookup on port 25565.
    patched.port = 25565;

    // Preserve the public Aternos hostname in the Minecraft handshake even
    // when DNS resolves it to a changing backend hostname and port.
    patched.fakeHost = host;

    // Let Mineflayer ping the live endpoint and select its actual protocol.
    patched.version = false;

    // Aternos can lag during busy periods; avoid the default 30-second timeout.
    patched.keepAlive = true;
    patched.checkTimeoutInterval = Math.max(
      Number(patched.checkTimeoutInterval) || 0,
      300000
    );

    console.log(
      `[DNS] Aternos connection mode enabled for ${host}: ` +
      'SRV lookup, original handshake host, version auto-detection.'
    );
  }

  return originalCreateBot(patched);
};
