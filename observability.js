'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const mineflayer = require('mineflayer');

const LIMIT = 100;
const file = process.env.BOT_HISTORY_FILE ||
  path.join(process.cwd(), 'connection-history.json');

let installed = false;
let events = load();
let saveTimer;
let attempt = events.filter(item => item.type === 'attempt').length;
const live = {
  bot: null,
  connected: false,
  connectedAt: null,
  category: null,
  reason: null,
  disconnectedAt: null
};

function text(value) {
  if (value == null) return 'Unknown reason';
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return `${value.code ? `${value.code}: ` : ''}${value.message || value.name}`;
  }
  try {
    if (typeof value.value === 'string') return value.value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clean(value) {
  return text(value).replace(/\s+/g, ' ').trim().slice(0, 500);
}

function classify(value) {
  const raw = clean(value).toLowerCase();
  const rules = [
    ['server_closed', 'Server closed', /server closed|server is closed|server shutdown|stopping server/],
    ['server_offline', 'Server offline or unreachable', /econnrefused|enotfound|getaddrinfo|ehostunreach|no route|server offline/],
    ['timeout', 'Connection timed out', /timeout|timed out|keepalive|did not respond|connectiontimeout/],
    ['throttled', 'Reconnect throttled', /throttl|rate.?limit|too fast|wait before reconnect/],
    ['whitelist', 'Not whitelisted', /whitelist|not whitelisted/],
    ['banned', 'Bot is banned', /\bbanned?\b|ban reason/],
    ['authentication', 'Authentication or login problem', /invalid session|failed to verify|authentication|not authenticated|login failed/],
    ['duplicate', 'Duplicate login session', /already connected|duplicate login|another location/],
    ['network_reset', 'Network connection reset', /econnreset|socket hang up|end of stream|connection reset|broken pipe/],
    ['kicked', 'Kicked by server', /\bkick(?:ed)?\b/],
    ['ended', 'Connection ended', /connection ended|socket closed|client ended/]
  ];
  const match = rules.find(rule => rule[2].test(raw));
  return match
    ? { code: match[0], label: match[1] }
    : { code: 'other', label: 'Other disconnect reason' };
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed.slice(-LIMIT) : [];
  } catch {
    return [];
  }
}

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(file, `${JSON.stringify(events, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.log(`[HISTORY] Save failed: ${clean(error)}`);
    }
  }, 200);
  saveTimer.unref?.();
}

function record(type, details = {}) {
  events.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    type,
    ...details
  });
  events = events.slice(-LIMIT);
  saveSoon();
}

function historyPayload() {
  const count = type => events.filter(item => item.type === type).length;
  return {
    connected: live.connected,
    connectedAt: live.connectedAt,
    lastCategory: live.category,
    lastReason: live.reason,
    lastDisconnectAt: live.disconnectedAt,
    totals: {
      attempts: count('attempt'),
      joins: count('connected'),
      disconnects: count('disconnected'),
      kicks: count('kicked')
    },
    events: [...events].reverse(),
    note: 'History survives ordinary process restarts when Render keeps the local filesystem, but redeploys may clear it.'
  };
}

function dashboard() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Akshit AFK Bot</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0c1220;color:#eef3ff;font-family:system-ui,sans-serif}
main{width:min(1080px,calc(100% - 28px));margin:28px auto}h1{margin:0}.sub{color:#9eabc0;margin:5px 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:11px}
.card,.panel{background:#151d30;border:1px solid #293650;border-radius:13px;padding:15px}
.label{color:#9eabc0;font-size:11px;text-transform:uppercase;letter-spacing:.08em}
.value{font-size:20px;font-weight:700;margin-top:7px;overflow-wrap:anywhere}
.online{color:#61db98}.offline{color:#ff7b86}.wait{color:#ffd166}
.panel{margin-top:14px;overflow:auto}table{width:100%;border-collapse:collapse;min-width:720px}
th,td{padding:9px 7px;border-bottom:1px solid #293650;text-align:left;font-size:13px}th{color:#9eabc0}
</style></head><body><main>
<h1>Minecraft AFK Bot</h1><div class="sub" id="server">Loading…</div>
<div class="grid">
<div class="card"><div class="label">Status</div><div class="value" id="status">Loading…</div></div>
<div class="card"><div class="label">Connected for</div><div class="value" id="onlineFor">—</div></div>
<div class="card"><div class="label">Health / Hunger</div><div class="value" id="vitals">—</div></div>
<div class="card"><div class="label">Coordinates</div><div class="value" id="coords">—</div></div>
<div class="card"><div class="label">Attempts / Joins</div><div class="value" id="counts">—</div></div>
<div class="card"><div class="label">Disconnects</div><div class="value" id="disconnects">0</div></div>
<div class="card"><div class="label">Last type</div><div class="value" id="category">None</div></div>
<div class="card"><div class="label">Last reason</div><div class="value" id="reason">None</div></div>
<div class="card"><div class="label">Movement totals</div><div class="value" id="actions">—</div></div>
<div class="card"><div class="label">Process uptime</div><div class="value" id="uptime">—</div></div>
</div>
<div class="panel"><h2>Recent connection history</h2>
<table><thead><tr><th>Time</th><th>Event</th><th>Category</th><th>Duration</th><th>Reason</th></tr></thead>
<tbody id="rows"></tbody></table></div>
</main><script>
const $=id=>document.getElementById(id);
const put=(id,v)=>$(id).textContent=v??'—';
function dur(v){if(v==null)return'—';v=Math.max(0,Math.floor(Number(v)));const h=Math.floor(v/3600),m=Math.floor(v%3600/60),s=v%60;return(h?h+'h ':'')+(m?m+'m ':'')+(!h&&!m?s+'s':'')}
const names={process_start:'Process started',attempt:'Connection attempt',tcp:'TCP connected',login:'Login accepted',connected:'Spawned online',kicked:'Kicked',error:'Error',disconnected:'Disconnected'};
async function refresh(){
 try{
  const [a,b]=await Promise.all([fetch('/health',{cache:'no-store'}),fetch('/history',{cache:'no-store'})]);
  const h=await a.json(),x=await b.json(),p=h.position,ac=h.actions||{};
  put('server',h.server+' · '+h.username);
  put('status',h.connected?'ONLINE':String(h.phase||'OFFLINE').toUpperCase());
  $('status').className='value '+(h.connected?'online':h.connecting?'wait':'offline');
  put('onlineFor',dur(h.connectedForSeconds));put('vitals',(h.health??'—')+' / '+(h.food??'—'));
  put('coords',p?'X '+Math.floor(p.x)+' Y '+Math.floor(p.y)+' Z '+Math.floor(p.z):'—');
  put('counts',(h.connectionAttempts??x.totals.attempts)+' / '+(h.successfulJoins??x.totals.joins));
  put('disconnects',h.disconnects??x.totals.disconnects);put('category',x.lastCategory||'None');
  put('reason',x.lastReason||h.lastDisconnectReason||'None');
  put('actions','M '+(ac.move||0)+' · J '+(ac.jump||0)+' · C '+(ac.crouch||0)+' · P '+(ac.punch||0));
  put('uptime',dur(h.processUptimeSeconds));
  const body=$('rows');body.replaceChildren();
  for(const e of (x.events||[]).slice(0,40)){
   const tr=document.createElement('tr');
   [new Date(e.at).toLocaleString(),names[e.type]||e.type,e.category||'—',dur(e.durationSeconds),e.reason||'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.appendChild(td)});
   body.appendChild(tr);
  }
 }catch(e){put('status','DASHBOARD ERROR');$('status').className='value offline';put('reason',e.message)}
}
refresh();setInterval(refresh,5000);
</script></body></html>`;
}

function patchExpress() {
  const original = express.application.get;
  if (original.__observed) return;

  function get(route, ...handlers) {
    if (arguments.length > 1 && route === '/') {
      return original.call(this, '/', (_req, res) =>
        res.status(200).type('html').send(dashboard()));
    }

    if (arguments.length > 1 && route === '/health') {
      const enriched = handlers.map(handler => typeof handler !== 'function' ? handler :
        function health(req, res, next) {
          const json = res.json.bind(res);
          res.json = payload => {
            const bot = live.bot;
            const p = bot?.entity?.position;
            return json({
              ...payload,
              health: Number.isFinite(bot?.health) ? bot.health : null,
              food: Number.isFinite(bot?.food) ? bot.food : null,
              position: p && Number.isFinite(p.x) ? { x: p.x, y: p.y, z: p.z } : null,
              disconnectCategory: live.category
            });
          };
          return handler(req, res, next);
        });

      const result = original.call(this, route, ...enriched);
      if (!this.locals.__historyRoute) {
        this.locals.__historyRoute = true;
        original.call(this, '/history', (_req, res) =>
          res.status(200).json(historyPayload()));
      }
      return result;
    }

    return original.call(this, route, ...handlers);
  }

  get.__observed = true;
  express.application.get = get;
}

function patchMineflayer() {
  const original = mineflayer.createBot;
  if (original.__observed) return;

  function createBot(options = {}) {
    const bot = original.call(mineflayer, options);
    live.bot = bot;
    attempt += 1;

    const meta = {
      id: attempt,
      endpoint: `${options.host || 'unknown'}:${options.port || 25565}`,
      username: options.username || 'unknown',
      spawnedAt: null,
      kickReason: null
    };

    record('attempt', { attempt: meta.id, endpoint: meta.endpoint, username: meta.username });

    bot?._client?.once('connect', () =>
      record('tcp', { attempt: meta.id, endpoint: meta.endpoint }));

    bot.once('login', () =>
      record('login', { attempt: meta.id, version: bot.version || null }));

    bot.once('spawn', () => {
      meta.spawnedAt = Date.now();
      live.connected = true;
      live.connectedAt = new Date().toISOString();
      record('connected', {
        attempt: meta.id,
        endpoint: meta.endpoint,
        version: bot.version || null
      });
    });

    bot.on('kicked', reason => {
      const raw = clean(reason);
      const kind = classify(raw);
      meta.kickReason = raw;
      live.category = kind.label;
      live.reason = raw;
      record('kicked', {
        attempt: meta.id,
        category: kind.label,
        categoryCode: kind.code,
        reason: raw
      });
      console.log(`[DISCONNECT CLASS] ${kind.label}: ${raw}`);
    });

    bot.on('error', error => {
      const raw = clean(error);
      const kind = classify(raw);
      record('error', {
        attempt: meta.id,
        category: kind.label,
        categoryCode: kind.code,
        reason: raw
      });
    });

    bot.once('end', reason => {
      const ended = Date.now();
      const raw = meta.kickReason || clean(reason);
      const kind = classify(raw);
      const durationSeconds = meta.spawnedAt
        ? Math.floor((ended - meta.spawnedAt) / 1000)
        : 0;

      if (live.bot === bot) live.bot = null;
      live.connected = false;
      live.connectedAt = null;
      live.category = kind.label;
      live.reason = raw;
      live.disconnectedAt = new Date(ended).toISOString();

      record('disconnected', {
        attempt: meta.id,
        endpoint: meta.endpoint,
        category: kind.label,
        categoryCode: kind.code,
        reason: raw,
        durationSeconds,
        reachedSpawn: Boolean(meta.spawnedAt)
      });
      console.log(`[CONNECTION HISTORY] Attempt ${meta.id}: ${durationSeconds}s, ${kind.label}.`);
    });

    return bot;
  }

  createBot.__observed = true;
  mineflayer.createBot = createBot;
}

function install() {
  if (installed) return;
  installed = true;
  patchExpress();
  patchMineflayer();
  record('process_start', { pid: process.pid, node: process.version });
  console.log('[OBSERVABILITY] Dashboard, disconnect labels, and connection history installed.');
}

module.exports = { install, classify, historyPayload };
