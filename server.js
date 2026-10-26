'use strict';
/* 5 Cards — game server.
   One Node process serves the web page AND runs every room (rules + bots) over WebSockets.
   Hands live only here, so players can never see each other's cards. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const ROOT = __dirname;
require(path.join(ROOT, 'engine.js'));
require(path.join(ROOT, 'bot.js'));
require(path.join(ROOT, 'room.js'));

// Only these files are ever sent to browsers. Everything else in the repo
// (server.js, package.json, ...) stays private.
const PUBLIC_FILES = new Set([
  'index.html', 'style.css', 'config.js', 'engine.js', 'bot.js', 'room.js', 'audio.js', 'net.js',
  'voice.js', 'stats.js', 'ui.js'
]);
const FC = globalThis.FC;

const crypto = require('crypto');
const MAX_ROOMS = 300;
const MAX_SOCKETS = 1500;
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8'
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss:",
  "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"
].join('; ');

// ---------- ICE servers for voice chat ----------
// STUN lets most players connect directly. A TURN relay is what makes voice work between ANY two
// networks (mobile carriers, offices, strict routers). Configure one with environment variables:
//   Cloudflare:  CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN   (credentials are minted automatically)
//   Any server:  TURN_URLS (comma separated) + TURN_USERNAME + TURN_CREDENTIAL
//   coturn:      TURN_URLS + TURN_SECRET   (time-limited credentials from a shared secret)
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
let iceCache = { until: 0, servers: STUN };
let iceWarned = false;

async function loadIceServers() {
  const env = process.env;
  try {
    if (env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN) {
      const ttl = 86400;
      const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CLOUDFLARE_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl })
      });
      if (!res.ok) throw new Error('Cloudflare TURN answered HTTP ' + res.status);
      const data = await res.json();
      let list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
      // Browsers cannot use port 53, and waiting for it to time out only slows connections down.
      list = list.map(s => Object.assign({}, s, { urls: [].concat(s.urls).filter(u => !/:53(\?|$)/.test(u)) })).filter(s => s.urls.length);
      if (!list.length) throw new Error('Cloudflare TURN returned no servers');
      return { servers: list, ttl: ttl * 1000 * 0.8 };
    }
    if (env.TURN_URLS) {
      const urls = env.TURN_URLS.split(',').map(u => u.trim()).filter(Boolean);
      if (env.TURN_SECRET) {
        const ttl = 86400;
        const username = String(Math.floor(Date.now() / 1000) + ttl);
        const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
        return { servers: STUN.concat([{ urls, username, credential }]), ttl: ttl * 1000 * 0.8 };
      }
      if (env.TURN_USERNAME && env.TURN_CREDENTIAL) {
        return { servers: STUN.concat([{ urls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL }]), ttl: 3600 * 1000 };
      }
    }
  } catch (e) {
    if (!iceWarned) { iceWarned = true; console.error('TURN setup failed, falling back to STUN only:', e.message); }
    return { servers: STUN, ttl: 60 * 1000 };
  }
  return { servers: STUN, ttl: 3600 * 1000 };
}

async function getIceServers() {
  if (Date.now() < iceCache.until) return iceCache.servers;
  const r = await loadIceServers();
  iceCache = { until: Date.now() + r.ttl, servers: r.servers };
  return r.servers;
}

function start(port, opts) {
  opts = opts || {};
  const allowedOrigins = (opts.allowedOrigins || process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const rooms = new Map();
  const startedAt = Date.now();

  // ---------- static files ----------
  function serveStatic(req, res) {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size, uptime: Math.round((Date.now() - startedAt) / 1000) }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
    if (rel === '/' || rel === '') rel = '/index.html';
    const name = rel.slice(1);
    const file = path.join(ROOT, name);
    fs.stat(PUBLIC_FILES.has(name) ? file : '', (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
      }
      const ext = path.extname(file).toLowerCase();
      const headers = {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()'
      };
      if (ext === '.html') headers['Content-Security-Policy'] = CSP;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(serveStatic);

  // ---------- websockets ----------
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });

  function originAllowed(req) {
    const origin = req.headers.origin;
    if (!origin) return true;                       // non-browser clients
    let host;
    try { host = new URL(origin).host; } catch (e) { return false; }
    if (host === (req.headers['x-forwarded-host'] || req.headers.host)) return true;
    return allowedOrigins.includes(origin) || allowedOrigins.includes('*');
  }

  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://x').pathname;
    if (pathname !== '/ws' || !originAllowed(req) || wss.clients.size >= MAX_SOCKETS) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  function newCode() {
    for (let i = 0; i < 50; i++) {
      const c = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
      if (!rooms.has(c)) return c;
    }
    return null;
  }

  wss.on('connection', ws => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    const conn = {
      send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
      close(reason) { try { ws.close(1000, String(reason || '').slice(0, 100)); } catch (e) {} }
    };
    let room = null, pid = null;
    let tokens = 150, last = Date.now(), strikes = 0;

    ws.on('message', async raw => {
      // Token bucket: ~30 messages per second sustained, bursts of 150 (voice setup sends a burst of ICE candidates).
      const now = Date.now();
      tokens = Math.min(150, tokens + ((now - last) / 1000) * 30); last = now;
      if (tokens < 1) { if (++strikes > 100) ws.terminate(); return; }
      tokens -= 1;

      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') return conn.send({ t: 'pong' });

      try {
        if (!room) {
          if (msg.t === 'create') {
            if (rooms.size >= MAX_ROOMS) throw new Error('The server is full right now. Try again in a few minutes.');
            const code = newCode();
            if (!code) throw new Error('Could not create a room. Try again.');
            const r = new FC.Room({ code, onEmpty: x => rooms.delete(x.code) });
            rooms.set(code, r);
            try { pid = r.join(msg, conn); } catch (e) { r.close(); rooms.delete(code); throw e; }
            room = r;
          } else if (msg.t === 'join') {
            const code = String(msg.code || '').toUpperCase().trim();
            const r = rooms.get(code);
            if (!r) throw new Error(`No room found with code ${code || '?'}. It may have ended.`);
            pid = r.join(msg, conn);
            room = r;
          } else return;
          let ice = STUN;
          try { ice = await getIceServers(); } catch (e) {}
          conn.send({ t: 'welcome', id: pid, code: room.code, ice });
          room.broadcast();
          return;
        }
        room.handle(pid, msg);
      } catch (e) {
        if (!room) { conn.send({ t: 'rejected', msg: e.message, fatal: true }); setTimeout(() => conn.close(), 300); }
        else conn.send({ t: 'error', msg: e.message });
      }
    });

    ws.on('close', () => { if (room && pid) room.detach(pid, conn); });
    ws.on('error', () => {});
  });

  // Drop sockets that stopped answering (phone went into a tunnel, laptop lid closed).
  const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    });
  }, 30000);

  function stop() {
    clearInterval(heartbeat);
    rooms.forEach(r => r.close());
    wss.clients.forEach(ws => { try { ws.send(JSON.stringify({ t: 'closed', msg: 'The server is restarting. Please rejoin in a moment.' })); ws.close(1001); } catch (e) {} });
    return new Promise(res => { server.close(() => res()); setTimeout(res, 1500); });
  }

  return new Promise(resolve => {
    server.listen(port, '0.0.0.0', () => resolve({ server, port: server.address().port, rooms, stop }));
  });
}

module.exports = { start };

if (require.main === module) {
  const port = parseInt(process.env.PORT, 10) || 10000;
  start(port).then(s => {
    console.log(`5 Cards is running on port ${s.port}`);
    const bye = () => { console.log('Shutting down…'); s.stop().then(() => process.exit(0)); };
    process.on('SIGTERM', bye);
    process.on('SIGINT', bye);
  });
}
