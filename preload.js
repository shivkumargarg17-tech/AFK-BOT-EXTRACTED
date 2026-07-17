'use strict';

const dns = require('dns');

try {
  dns.setDefaultResultOrder('ipv4first');
  dns.setServers(['1.1.1.1', '8.8.8.8']);
  console.log('[DNS] Using Cloudflare/Google DNS with IPv4-first resolution.');
} catch (error) {
  console.log(`[DNS] Could not apply custom DNS settings: ${error.message}`);
}

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
