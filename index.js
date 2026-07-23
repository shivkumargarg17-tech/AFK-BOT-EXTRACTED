'use strict';

// Install sanitized rolling logs before the service starts producing output.
require('./diagnostics').install();

// Make settings.json authoritative so stale Render MC_* variables cannot point
// the bot at an old server, port, username, or protocol version.
require('./runtime-config');

// Capture raw login-phase disconnect information before Mineflayer bots are created.
require('./login-debug').install();

// Add lifecycle supervision, stale-socket cleanup, and delayed anti-AFK startup.
require('./reliability').install();

// Speed up failed joins and reuse the negotiated Java version on reconnect.
// This wraps one normal Mineflayer connection and never opens another socket.
require('./fast-join').install();

// Detect silent ghost sessions, stop fake actions, and force a clean reconnect.
// This observes the Mineflayer session only; it does not replace its connection method.
require('./ghost-watchdog').install();

// Add the dashboard, readable disconnect categories, and connection history.
require('./observability').install();

// Render is configured with `node index.js`; keep this launcher as the stable entry point.
require('./service');
