'use strict';

// Install sanitized rolling logs before the service starts producing output.
require('./diagnostics').install();

// Render is configured with `node index.js`; keep this launcher as the stable entry point.
require('./service');
