'use strict';

const settings = require('./settings.json');

const account = settings['bot-account'] || {};
const server = settings.server || {};

const lockedValues = {
  MC_HOST: String(server.ip || '').trim(),
  MC_PORT: String(server.port || '').trim(),
  MC_USERNAME: String(account.username || 'AkshitAFKBot').trim(),
  MC_AUTH: String(account.type || 'offline').trim().toLowerCase(),
  MC_VERSION: String(server.version || '').trim()
};

for (const [name, value] of Object.entries(lockedValues)) {
  process.env[name] = value;
}

console.log(
  `[CONFIG LOCK] settings.json is authoritative: ${lockedValues.MC_HOST}:${lockedValues.MC_PORT} ` +
  `as ${lockedValues.MC_USERNAME}, Java ${lockedValues.MC_VERSION || 'auto-detect'}. ` +
  'Stale Render MC_* variables were ignored.'
);

module.exports = Object.freeze({ ...lockedValues });
