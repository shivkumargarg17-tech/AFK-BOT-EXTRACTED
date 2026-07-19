'use strict';

const util = require('util');
const express = require('express');

const MAX_ENTRIES = 200;
const PUBLIC_ENTRIES = 120;
const processStartedAt = new Date().toISOString();
const entries = [];
let installed = false;

function sanitize(value) {
  return String(value)
    .replace(/([?&](?:token|key|password|secret|api[_-]?key)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .slice(0, 2000);
}

function record(level, args) {
  let message;
  try {
    message = sanitize(util.format(...args));
  } catch {
    message = '[unformattable log entry]';
  }

  entries.push({
    timestamp: new Date().toISOString(),
    level,
    message
  });

  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

function patchConsoleMethod(name, level) {
  const original = console[name].bind(console);
  console[name] = (...args) => {
    record(level, args);
    original(...args);
  };
}

function installDiagnosticsRoute() {
  const originalListen = express.application.listen;
  if (originalListen.__diagnosticsPatched) return;

  function patchedListen(...args) {
    if (!this.locals.__diagnosticsInstalled) {
      this.locals.__diagnosticsInstalled = true;

      this.get('/diagnostics', (_req, res) => {
        res.set('cache-control', 'no-store');
        res.status(200).json({
          service: 'Minecraft AFK bot diagnostics',
          processStartedAt,
          processUptimeSeconds: Math.floor(process.uptime()),
          entryCount: entries.length,
          entries: entries.slice(-PUBLIC_ENTRIES)
        });
      });

      this.get('/diagnostics/text', (_req, res) => {
        res.set('cache-control', 'no-store');
        res.type('text/plain').status(200).send(
          entries
            .slice(-PUBLIC_ENTRIES)
            .map(entry => `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.message}`)
            .join('\n')
        );
      });
    }

    return originalListen.apply(this, args);
  }

  patchedListen.__diagnosticsPatched = true;
  express.application.listen = patchedListen;
}

function install() {
  if (installed) return;
  installed = true;

  patchConsoleMethod('log', 'info');
  patchConsoleMethod('warn', 'warn');
  patchConsoleMethod('error', 'error');
  installDiagnosticsRoute();

  record('info', ['[DIAGNOSTICS] Rolling sanitized log capture enabled.']);
}

module.exports = { install };
