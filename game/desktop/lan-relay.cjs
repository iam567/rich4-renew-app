// 局域網房間 (the user 2026-11-08: only the PC version hosts it; phones on the same Wi-Fi join, nobody from outside):
// 派對模式's relay on this computer — the same wire as the game's relay-peer.ts (sessions that outlive a dropped
// socket, numbered frames, connections between two ids). The phones join with the app (派對模式 → 局域網房間, the
// address and the room's code), never in a browser (the user: 「不要讓人在網頁玩」): a browser opening the address (the
// QR code on the PC) gets a page saying how to join with the app and where to get it. Only addresses of the local
// network are let in (10.x, 172.16-31.x, 192.168.x, 169.254.x, the machine itself, IPv6 local): a port forwarded on the
// router still lets nobody in from the internet. Nothing is logged or kept.
const http = require('node:http');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { WebSocketServer } = require('ws');

const HOLD_MS = 60_000;          // a session kept after its socket went
const STALE_MS = 20_000;         // a socket silent this long is dead (the game pings every 4 s)
const BUF_MAX = 8 << 20;         // frames waiting for one phone
const FRAME_MAX = 2 << 20;       // one frame
const ID_RE = /^rich4-party-[A-Za-z0-9_-]{1,80}$/;
const CID_RE = /^[A-Za-z0-9_:-]{1,120}$/;
// (8842: few programs use it — 8848 is Nacos's, 8843 UniFi's; the user 2026-11-08)
const PORTS = [8842, 18842, 28842];

/** An address of the local network (or this machine). */
function local(ip) {
  ip = String(ip ?? '').replace(/^::ffff:/, '');
  return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || ip === '::1' || /^(fc|fd|fe8|fe9|fea|feb)/i.test(ip);
}

/** This computer's addresses on the local network (IPv4), the Wi-Fi / Ethernet ones first. */
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || !local(a.address) || a.address.startsWith('169.254.')) continue;
      // virtual adapters (VMware, VirtualBox, Hyper-V, Docker, WSL) last
      const virtual = /vmware|virtualbox|vbox|hyper-v|vethernet|docker|wsl|utun|bridge|tailscale|zerotier/i.test(name);
      out.push({ address: a.address, virtual, home: a.address.startsWith('192.168.') });
    }
  }
  out.sort((x, y) => Number(x.virtual) - Number(y.virtual) || Number(y.home) - Number(x.home));
  return out.map(x => x.address);
}

/** The page a browser gets (the QR code scanned with a phone's camera): join with the app, get it. */
const DOWNLOAD = 'https://github.com/iam567/rich4-renew-app/releases/latest';
function page(addr, room) {
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大富翁4 局域網房間</title>
<style>body{margin:0;font:16px/1.6 -apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;background:#2b4fb8;color:#fff;display:grid;place-items:center;min-height:100vh}
main{width:min(420px,92vw);background:#1d3a8f;border:3px solid #ffd84a;border-radius:18px;padding:22px 20px;text-align:center}
h1{font-size:22px;margin:0 0 6px}p{margin:8px 0}.box{background:rgba(0,0,0,.25);border-radius:12px;padding:10px;margin:12px 0}
b{color:#ffe14a;font-size:26px;letter-spacing:.06em}small{opacity:.8}a{display:block;margin-top:14px;padding:12px;border-radius:12px;background:linear-gradient(#7be07b,#3aa83a);color:#fff;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>大富翁4 局域網房間</h1><p>請用 <b style="font-size:18px">大富翁4 App</b> 加入（網頁不能玩）</p>
<div class="box"><small>打開 App →「派對模式」→「局域網房間」，輸入</small><p>地址 <b>${esc(addr)}</b></p>${room ? `<p>房間碼 <b>${esc(room)}</b></p>` : ''}</div>
<p><small>手機要連在和電腦同一個 Wi-Fi</small></p><a href="${DOWNLOAD}">還沒有 App？下載大富翁4</a></main></body></html>`;
}

/** What a phone says about itself in its hello (app version, platform, player name, install id), cleaned. */
function cleanApp(a) {
  if (!a || typeof a !== 'object') return {};
  const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>&"'`]/g, '').slice(0, n) : undefined);
  const dev = str(a.dev, 40);
  return { v: str(a.v, 20), plat: str(a.plat, 12), name: str(a.name, 14), dev: dev && /^[A-Za-z0-9]{8,40}$/.test(dev) ? dev : undefined };
}

/**
 * The relay itself (sessions, connections between two ids) on an http server of its own, without a port yet — shared
 * by 局域網房間 (startLan below) and 私服 (tools/private-server, the user 2026-11-18). `allow(ip)`: who may come in;
 * `route(u, req, res, cors)`: the server's own pages (true: answered); `page(host, room)`: what a browser gets;
 * `maxSessions` (a number, or a function: the 私服's 管理頁 changes it), `perIp`: how many phones at once, in all and
 * from one address.
 *
 * 斷線重連 (the user 2026-11-23, 「掉線就連不回去」 on a 私服): `holdMs` how long a session outlives its socket (a
 * room's own id: `roomHoldMs` — the longer a lost host's id is held, the longer the others wait before one of them
 * takes the room over), told to the phone in its `ok` (`hold`) so it waits as long. `gate(m, ip)`: a fresh hello refused
 * (null: let in) — a 私服's password, bans, a player sent away — with the reason sent as it is ({ t: 'password' } …).
 * `onSession(sess)`: each session as it comes (fresh or back). `kick(sess, why)`: ends it, the phone told why
 * ({ t: 'kicked', why }: it does not come back by itself).
 */
function relayCore({ allow = () => true, route = () => false, page: pageOf = page, maxSessions = 500, perIp = 0, holdMs = HOLD_MS, roomHoldMs = holdMs, gate = () => null, onSession = () => {} } = {}) {
  const sessions = new Map(), conns = new Map();
  const maxNow = () => (typeof maxSessions === 'function' ? maxSessions() : maxSessions);
  const holdOf = id => (/-room-\d{1,8}$/.test(id) ? roomHoldMs : holdMs);

  const raw = (ws, obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  function put(sess, obj) {
    const f = { ...obj, s: ++sess.sOut };
    const text = JSON.stringify(f);
    sess.out.push([f.s, text]);
    sess.outBytes += text.length;
    if (sess.outBytes > BUF_MAX) { end(sess, 'overflow'); return; }
    if (sess.ws && sess.ws.readyState === 1) sess.ws.send(text);
  }
  function acked(sess, a) { while (sess.out.length && sess.out[0][0] <= a) sess.outBytes -= sess.out.shift()[1].length; }
  function end(sess, why) {
    if (sessions.get(sess.id) !== sess) return;
    sessions.delete(sess.id);
    for (const cid of sess.conns) {
      const c = conns.get(cid);
      conns.delete(cid);
      const other = c && sessions.get(c.a === sess.id ? c.b : c.a);
      if (other) { other.conns.delete(cid); put(other, { t: 'close', cid }); }
    }
    sess.conns.clear();
    if (sess.ws) { if (why === 'evicted') raw(sess.ws, { t: 'evicted' }); try { sess.ws.close(); } catch { /* gone */ } }
  }
  /** Sent away (a 私服's 管理頁): told why, the session ended at once. */
  function kick(sess, why) {
    if (sessions.get(sess.id) !== sess) return;
    raw(sess.ws, { t: 'kicked', why: String(why ?? '').slice(0, 80) });
    end(sess, 'kicked');
  }
  const refuse = (ws, obj) => { raw(ws, obj); try { ws.close(); } catch { /* gone */ } return null; };
  function hello(ws, m) {
    if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return refuse(ws, { t: 'bad' });
    let sess = sessions.get(m.id);
    if (sess && m.token && sess.token === m.token) {
      if (sess.ws && sess.ws !== ws) { const old = sess.ws; old.sess = null; try { old.close(); } catch { /* gone */ } }
      sess.ws = ws; sess.lostAt = 0; sess.seen = Date.now(); sess.ip = ws.ip; sess.drops = (sess.drops ?? 0) + 1;
      if (m.app) sess.app = cleanApp(m.app);
      raw(ws, { t: 'ok', token: sess.token, ack: sess.sIn, fresh: false, hold: holdOf(sess.id) });
      acked(sess, Number(m.ack) || 0);
      for (const [, text] of sess.out) ws.send(text);
      onSession(sess);
      return sess;
    }
    const app = cleanApp(m.app);
    const no = gate(m, ws.ip, app);
    if (no) return refuse(ws, no);
    if (sess) {
      const live = sess.ws && sess.ws.readyState === 1 && Date.now() - sess.seen < STALE_MS;
      if (live) return refuse(ws, { t: 'taken' });
      end(sess, 'evicted');
    }
    const max = maxNow();
    if (sessions.size >= max) return refuse(ws, { t: 'full', online: sessions.size, max });
    if (perIp && [...sessions.values()].filter(x => x.ip === ws.ip).length >= perIp) return refuse(ws, { t: 'full' });
    sess = { id: m.id, ip: ws.ip, app, token: randomBytes(12).toString('hex'), ws, sOut: 0, sIn: 0, out: [], outBytes: 0, conns: new Set(), seen: Date.now(), since: Date.now(), lostAt: 0, win: 0, winAt: Date.now(), drops: 0 };
    sessions.set(m.id, sess);
    raw(ws, { t: 'ok', token: sess.token, ack: 0, fresh: true, hold: holdOf(sess.id) });
    onSession(sess);
    return sess;
  }
  function frame(sess, m) {
    if (m.s !== undefined) {
      if (m.s <= sess.sIn) return;
      sess.sIn = m.s;
      sess.ackDue = true;
    }
    switch (m.t) {
      case 'conn': {
        if (typeof m.cid !== 'string' || !CID_RE.test(m.cid) || conns.has(m.cid)) return;
        const to = typeof m.to === 'string' ? sessions.get(m.to) : undefined;
        if (!to || to === sess) { put(sess, { t: 'nopeer', cid: m.cid }); return; }
        conns.set(m.cid, { a: sess.id, b: to.id });
        sess.conns.add(m.cid); to.conns.add(m.cid);
        put(to, { t: 'conn', cid: m.cid, from: sess.id });
        put(sess, { t: 'open', cid: m.cid });
        return;
      }
      case 'd': case 'close': {
        const c = conns.get(m.cid);
        if (!c || (c.a !== sess.id && c.b !== sess.id)) { if (m.t === 'd' && typeof m.cid === 'string') put(sess, { t: 'close', cid: m.cid }); return; }
        const other = sessions.get(c.a === sess.id ? c.b : c.a);
        if (m.t === 'close') { conns.delete(m.cid); sess.conns.delete(m.cid); if (other) { other.conns.delete(m.cid); put(other, { t: 'close', cid: m.cid }); } return; }
        if (other) put(other, { t: 'd', cid: m.cid, d: m.d });
        return;
      }
      case 'ack': acked(sess, Number(m.a) || 0); return;
      case 'p': raw(sess.ws, { t: 'q', at: m.at }); return;
      case 'bye': end(sess, 'bye'); return;
    }
  }

  // The player's address: the socket's, or behind a proxy on this machine (nginx, Caddy) the first X-Forwarded-For.
  const ipOf = req => {
    const remote = String(req?.socket?.remoteAddress ?? '');
    const fwd = String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
    return (/^(127\.|::1$|::ffff:127\.)/.test(remote) && fwd ? fwd : remote).replace(/^::ffff:/, '');
  };
  const wss = new WebSocketServer({ noServer: true, maxPayload: FRAME_MAX });
  wss.on('connection', (ws, req) => {
    ws.ip = ipOf(req);
    let sess = null;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (!sess) { if (m.t === 'hello') { sess = hello(ws, m); if (sess) ws.sess = sess; } return; }
      if (ws.sess !== sess) return;
      sess.seen = Date.now();
      if (Date.now() - sess.winAt > 10_000) { sess.win = 0; sess.winAt = Date.now(); }
      if (++sess.win > 3000) { end(sess, 'flood'); return; }
      frame(sess, m);
    });
    ws.on('close', () => { if (sess && sess.ws === ws) { sess.ws = null; sess.lostAt = Date.now(); } });
    ws.on('error', () => { /* close follows */ });
  });
  const tick = setInterval(() => {
    const now = Date.now();
    for (const sess of [...sessions.values()]) {
      if (sess.ackDue && sess.ws) { sess.ackDue = false; raw(sess.ws, { t: 'ack', a: sess.sIn }); }
      if (sess.ws && now - sess.seen > STALE_MS) { try { sess.ws.terminate(); } catch { /* gone */ } sess.ws = null; sess.lostAt = now; }
      if (!sess.ws && sess.lostAt && now - sess.lostAt > holdOf(sess.id)) end(sess, 'expired');
    }
  }, 1000);

  /** The rooms' codes open here. */
  const rooms = () => [...sessions.keys()].map(id => /-room-(\d{1,8})$/.exec(id)?.[1]).filter(Boolean);
  const server = http.createServer((req, res) => {
    if (!allow(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return; }
    const u = new URL(req.url ?? '/', 'http://x');
    const cors = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    // what the game asks a relay for besides the rooms: nothing to tell here
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-headers': 'content-type, authorization, x-rich4-password, x-rich4-pw', 'access-control-allow-methods': 'GET, POST' }); res.end(); return; }
    if (route(u, req, res, cors)) return;
    if (u.pathname === '/stats') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify({ online: 0, menu: 0, room: 0, game: 0 })); return; }
    if (u.pathname === '/notice') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end('{}'); return; }
    if (req.method === 'POST') { req.resume(); res.writeHead(204, cors); res.end(); return; } // reports, chat: kept nowhere
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    // the game's files are never served: a browser gets how to join with the app
    const room = /^\d{1,8}$/.test(u.searchParams.get('room') ?? '') ? u.searchParams.get('room') : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? '' : pageOf(String(req.headers.host ?? ''), room));
  });
  server.on('upgrade', (req, socket, head) => {
    if (!allow(req.socket.remoteAddress)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });

  const stop = () => { clearInterval(tick); for (const c of wss.clients) c.terminate(); server.close(); };
  return { server, sessions, conns, rooms, stop, tick, kick, end, ipOf };
}

/** Starts the server on the first free port of PORTS, on every address (the firewall may ask once). Resolves with { port, urls, stop }. */
function startLan({ log = () => {} } = {}) {
  // the phones looking for a room on the network (lan-find.ts): this computer's name and its rooms' codes
  const route = (u, req, res, cors) => {
    if (u.pathname !== '/lan') return false;
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ rich4: 'lan', host: os.hostname().replace(/\.local$/, '').slice(0, 40), rooms: core.rooms() }));
    return true;
  };
  const core = relayCore({ allow: local, route });
  const { server, stop, tick } = core;
  // the first free port of PORTS (another program on one: the next; each try's listeners go with it)
  return new Promise((resolve, reject) => {
    let k = 0;
    const tryNext = () => {
      if (k >= PORTS.length) { clearInterval(tick); reject(new Error('no free port')); return; }
      const port = PORTS[k++];
      const failed = e => {
        server.off('listening', up);
        if (e.code === 'EADDRINUSE' || e.code === 'EACCES') tryNext(); else { clearInterval(tick); reject(e); }
      };
      const up = () => {
        server.off('error', failed);
        server.on('error', e => log('lan', e.message));
        const urls = lanAddresses().map(a => `http://${a}:${port}`);
        log('lan on', port, urls.join(' '));
        resolve({ port, urls, stop });
      };
      server.once('error', failed);
      server.once('listening', up);
      server.listen(port, '0.0.0.0');
    };
    tryNext();
  });
}

/**
 * The rooms on this computer's networks (lan-find.ts asks through main.cjs): every address of each /24 asked for /lan
 * on `ports`, many at once, each giving up quickly — from Node, which has none of a web page's limits on connections.
 * Resolves with [{ addr, host, rooms }].
 */
function findLan(ports = PORTS) {
  const mine = lanAddresses();
  const nets = [...new Set(mine.map(ip => ip.split('.').slice(0, 3).join('.')))].slice(0, 3);
  const hosts = [...mine, ...nets.flatMap(n => Array.from({ length: 254 }, (_, i) => `${n}.${i + 1}`)).filter(ip => !mine.includes(ip))];
  const all = ports.flatMap(p => hosts.map(ip => [ip, p]));
  const ask = ([ip, port]) => new Promise(resolve => {
    const req = http.get({ host: ip, port, path: '/lan', timeout: 700 }, res => {
      let body = '';
      res.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          if (j.rich4 !== 'lan') return resolve(null);
          resolve({ addr: `${ip}:${port}`, host: String(j.host ?? '').slice(0, 40), rooms: Array.isArray(j.rooms) ? j.rooms.filter(x => /^\d{1,8}$/.test(String(x))).map(String) : [] });
        } catch { resolve(null); }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
  return (async () => {
    const out = [];
    for (let i = 0; i < all.length; i += 128) for (const s of await Promise.all(all.slice(i, i + 128).map(ask))) if (s) out.push(s);
    return out;
  })();
}

module.exports = { startLan, findLan, local, lanAddresses, relayCore, cleanApp };
