'use strict';

const dns = require('dns');
const net = require('net');
const mineflayer = require('mineflayer');

let installed = false;

function errorText(error) {
  if (!error) return 'unknown error';
  return `${error.code ? `${error.code}: ` : ''}${error.message || String(error)}`;
}

function install() {
  if (installed) return;
  installed = true;

  const originalCreateBot = mineflayer.createBot;
  if (originalCreateBot.__directSocketWrapped) return;

  function directCreateBot(options = {}) {
    const host = String(options.host || 'localhost').trim();
    const port = Number(options.port || 25565);
    const tcpTimeoutMs = Math.max(5000, Number(process.env.DIRECT_TCP_TIMEOUT_MS || 20000));
    const spawnTimeoutMs = Math.max(30000, Number(process.env.DIRECT_SPAWN_TIMEOUT_MS || 60000));
    const originalConnect = options.connect;

    console.log(`[DIRECT] Starting direct IPv4 connection to ${host}:${port}.`);

    const bot = originalCreateBot.call(mineflayer, {
      ...options,
      fakeHost: options.fakeHost || host,
      closeTimeout: Math.min(Number(options.closeTimeout || tcpTimeoutMs), tcpTimeoutMs),
      noPongTimeout: Math.min(Number(options.noPongTimeout || 10000), 10000),
      connect(client) {
        if (typeof originalConnect === 'function') {
          console.log('[DIRECT] A custom connection handler already exists; using it.');
          originalConnect(client);
          return;
        }

        console.log(`[DIRECT] Resolving ${host} using IPv4 DNS...`);
        dns.lookup(host, { family: 4 }, (dnsError, address, family) => {
          if (dnsError) {
            console.error(`[DIRECT] DNS failed: ${errorText(dnsError)}`);
            client.emit('error', dnsError);
            client.emit('end', `directDnsFailure:${errorText(dnsError)}`);
            return;
          }

          console.log(`[DIRECT] DNS resolved ${host} -> ${address} (IPv${family}).`);
          console.log(`[DIRECT] Opening raw TCP socket to ${address}:${port}...`);

          const socket = net.createConnection({ host: address, port, family: 4 });
          let handedOff = false;

          const fail = error => {
            if (handedOff) return;
            handedOff = true;
            try { socket.destroy(); } catch {}
            console.error(`[DIRECT] TCP connection failed: ${errorText(error)}`);
            client.emit('error', error);
            client.emit('end', `directTcpFailure:${errorText(error)}`);
          };

          socket.setTimeout(tcpTimeoutMs);
          socket.once('timeout', () => {
            const error = new Error(`Raw TCP connection timed out after ${tcpTimeoutMs / 1000}s`);
            error.code = 'ETIMEDOUT';
            fail(error);
          });
          socket.once('error', fail);
          socket.once('connect', () => {
            if (handedOff) return;
            handedOff = true;
            socket.removeListener('error', fail);
            socket.setTimeout(0);
            socket.setKeepAlive(true, 30000);
            socket.setNoDelay(true);
            console.log(`[DIRECT] Raw TCP connected to ${address}:${port}; handing socket to Minecraft protocol.`);
            client.setSocket(socket);
            client.emit('connect');
          });
        });
      }
    });

    let spawned = false;
    let ended = false;
    let waitedSeconds = 0;

    const progressTimer = setInterval(() => {
      if (spawned || ended) return;
      waitedSeconds += 10;
      console.log(`[DIRECT] Still waiting for Minecraft login/spawn (${waitedSeconds}s).`);
    }, 10000);
    progressTimer.unref?.();

    const hardTimeout = setTimeout(() => {
      if (spawned || ended) return;
      console.error(`[DIRECT] No spawn after ${spawnTimeoutMs / 1000}s; forcing this attempt to close and retry.`);
      try { bot.end('directSpawnTimeout'); } catch {}
      try { bot._client?.socket?.destroy(); } catch {}
    }, spawnTimeoutMs);
    hardTimeout.unref?.();

    const clearTimers = () => {
      clearInterval(progressTimer);
      clearTimeout(hardTimeout);
    };

    bot.once('login', () => console.log(`[DIRECT] Minecraft login accepted using Java ${bot.version || options.version || 'auto-detected'}.`));
    bot.once('spawn', () => {
      spawned = true;
      clearTimers();
      console.log('[DIRECT] Spawn completed successfully.');
    });
    bot.once('end', () => {
      ended = true;
      clearTimers();
    });

    return bot;
  }

  directCreateBot.__directSocketWrapped = true;
  mineflayer.createBot = directCreateBot;
  console.log('[DIRECT] Raw IPv4 socket connector installed.');
}

module.exports = { install };
