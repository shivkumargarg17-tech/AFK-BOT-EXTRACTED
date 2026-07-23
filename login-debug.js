'use strict';

const util = require('util');
const mineflayer = require('mineflayer');

let installed = false;

function inspect(value) {
  try {
    return util.inspect(value, {
      depth: 8,
      breakLength: 240,
      compact: true,
      maxArrayLength: 100,
      maxStringLength: 4000
    });
  } catch {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
}

function install() {
  if (installed) return;
  installed = true;

  const originalCreateBot = mineflayer.createBot.bind(mineflayer);

  mineflayer.createBot = options => {
    const bot = originalCreateBot(options);
    const client = bot._client;
    let loginSeen = false;
    let endSeen = false;

    bot.once('login', () => {
      loginSeen = true;
      console.log(`[LOGIN DEBUG] login accepted; clientState=${client?.state || 'unknown'}.`);
    });

    bot.once('end', () => {
      endSeen = true;
    });

    bot.on('kicked', (reason, loggedIn) => {
      console.log(
        `[LOGIN DEBUG] kicked loggedIn=${Boolean(loggedIn)} loginSeen=${loginSeen} ` +
        `clientState=${client?.state || 'unknown'} raw=${inspect(reason)}`
      );
    });

    client?.on('packet', (data, meta) => {
      if (meta?.name !== 'disconnect') return;
      console.log(
        `[LOGIN DEBUG] raw disconnect packet state=${meta.state || client?.state || 'unknown'} ` +
        `data=${inspect(data)}`
      );
    });

    client?.on('connect', () => {
      const socket = client.socket;
      socket?.once('close', hadError => {
        console.log(
          `[LOGIN DEBUG] socket closed hadError=${Boolean(hadError)} ` +
          `clientState=${client?.state || 'unknown'} loginSeen=${loginSeen}.`
        );

        const fallbackTimer = setTimeout(() => {
          if (endSeen) return;
          console.log('[LOGIN DEBUG] Socket closed without a Mineflayer end event; forcing reconnect cleanup.');
          bot.emit('end', hadError ? 'socketErrorClosed' : 'socketClosed');
        }, 1500);
        fallbackTimer.unref?.();
      });
      socket?.once('error', error => {
        console.log(`[LOGIN DEBUG] socket error ${error?.code || ''} ${error?.message || inspect(error)}`.trim());
      });
    });

    return bot;
  };

  console.log('[LOGIN DEBUG] Detailed pre-login disconnect capture and socket-close recovery enabled.');
}

module.exports = { install };
