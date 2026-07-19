'use strict';

// Install sanitized rolling logs before the service starts producing output.
require('./diagnostics').install();

// Capture raw login-phase disconnect information before Mineflayer bots are created.
require('./login-debug').install();

// Render is configured with `node index.js`; keep this launcher as the stable entry point.
require('./service');
