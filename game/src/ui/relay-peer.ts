/**
 * 派對模式 through the user's VPS (docs/rules/22 §3.1; the server: tools/party-relay/relay.mjs). A RelayPeer is this
 * phone under its peer id on the relay, a RelayConn one connection to another phone there — shaped like PeerJS's
 * Peer and DataConnection, so party-net.ts uses either (net-peer.ts picks).
 *
 * Not dropping: the socket may go (background, tunnel, Wi-Fi ⇄ mobile data); the session stays on the server for a
 * minute. Every frame either way is numbered and kept until acknowledged, so on reconnecting both sides send again
 * what the other has not had, and the connections never notice. Only a session gone for good closes them.
 */

type Handler = (...a: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

class Emitter {
  private h = new Map<string, Handler[]>();
  on(ev: string, fn: Handler): this { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)!).push(fn); return this; }
  off(ev: string, fn: Handler): this { const l = this.h.get(ev); if (l) this.h.set(ev, l.filter(x => x !== fn)); return this; }
  protected emit(ev: string, ...a: unknown[]) { for (const fn of [...(this.h.get(ev) ?? [])]) { try { fn(...a); } catch (e) { console.error(e); } } }
}

export class RelayConn extends Emitter {
  open = false;
  readonly via = 'vps' as const;
  private done = false;
  constructor(readonly owner: RelayPeer, readonly cid: string, readonly peer: string) { super(); }
  send(d: unknown) { if (this.open && !this.done) this.owner.put({ t: 'd', cid: this.cid, d }); }
  close() {
    if (this.done) return;
    this.owner.put({ t: 'close', cid: this.cid });
    this.closed();
  }
  /** @internal */ opened() { if (this.done || this.open) return; this.open = true; this.emit('open'); }
  /** @internal */ data(d: unknown) { if (!this.done) this.emit('data', d); }
  /** @internal */ closed() { if (this.done) return; this.done = true; this.open = false; this.owner.forget(this.cid); this.emit('close'); }
  /** @internal */ failed() { if (this.done) return; this.done = true; this.owner.forget(this.cid); this.emit('error', { type: 'peer-unavailable' }); }
}

const browser = () => typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.addEventListener === 'function';

/** What this phone says about itself in each hello: version, platform, name, install id. */
let helloApp: Record<string, string> = {};
export function setHelloApp(a: Record<string, string>) { helloApp = a; }

/**
 * Why the newest relay said no to a fresh hello (a 私服: full, its password, a ban, sent away), for the message the
 * game shows (net-peer.ts refusalWhy); null: it did not refuse.
 */
export interface Refusal { t: 'full' | 'password' | 'banned' | 'kicked'; online?: number; max?: number; why?: string }
let refused: Refusal | null = null;
export const lastRefusal = (): Refusal | null => refused;

/** Kept outgoing frames before giving up on a session (a phone away with a lot to say). */
const OUT_MAX = 8 << 20;
/** The server keeps a session this long after its socket went (relay.mjs HOLD_MS, less a margin). */
const HOLD_MS = 55_000;

export class RelayPeer extends Emitter {
  readonly via = 'vps' as const;
  /** Registered on the relay (first `ok`); false again only once the session is gone. */
  open = false;
  destroyed = false;
  /** Round trip to the relay (ms), the newest measure; 0 before the first. */
  rtt = 0;
  private ws: WebSocket | null = null;
  private token = '';
  private sOut = 0;
  private sIn = 0;
  private ackSent = 0;
  private out: [number, string][] = [];
  private outBytes = 0;
  private conns = new Map<string, RelayConn>();
  private n = 0;
  private lastHeard = 0;
  private lostAt = 0;
  private tries = 0;
  private timer = 0;
  private beat = 0;
  /** Registered at least once: from then on a failed try is tried again (斷線重連), never the end. */
  private was = false;
  /** How long the relay keeps this session after its socket went (its `ok` says; else relay.mjs's), less a margin. */
  private hold = HOLD_MS;
  private wake = () => { if (!this.destroyed && (!this.ws || this.ws.readyState > 1)) this.dial(true); else this.ping(); };

  /** `extra`: more for each hello (a 私服's password, `pw`). */
  constructor(readonly url: string, readonly id: string, private readonly extra: Record<string, unknown> = {}) {
    super();
    this.dial(true);
    this.beat = setInterval(() => this.tick(), 1000) as unknown as number;
    if (browser()) {
      window.addEventListener('online', this.wake);
      document.addEventListener('visibilitychange', this.wake);
    }
  }

  /** A connection to another phone's id; 'open' when the relay has it, 'error' when nobody has that id. */
  connect(to: string): RelayConn {
    const c = new RelayConn(this, `${this.id.slice(-12)}:${Date.now().toString(36)}:${++this.n}`, to);
    this.conns.set(c.cid, c);
    this.put({ t: 'conn', cid: c.cid, to });
    return c;
  }

  /** Registers again after the session ended (PeerJS's reconnect). */
  reconnect() { if (!this.destroyed && !this.open) { this.token = ''; this.dial(true); } }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'bye' })); } catch { /* gone */ }
    this.ws?.close();
    this.ws = null;
    clearInterval(this.beat); clearTimeout(this.timer);
    if (browser()) { window.removeEventListener('online', this.wake); document.removeEventListener('visibilitychange', this.wake); }
    for (const c of [...this.conns.values()]) c.closed();
  }

  /** @internal A numbered frame: sent now if the socket is up, kept until the relay acknowledges it. */
  put(obj: Record<string, unknown>) {
    if (this.destroyed) return;
    const text = JSON.stringify({ ...obj, s: ++this.sOut });
    this.out.push([this.sOut, text]);
    this.outBytes += text.length;
    if (this.outBytes > OUT_MAX) { this.lost(); return; }
    if (this.ws?.readyState === 1 && this.open) this.ws.send(text);
  }
  /** @internal */ forget(cid: string) { this.conns.delete(cid); }

  private ping() { try { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'p', at: Date.now() })); } catch { /* closing */ } }

  private tick() {
    if (this.destroyed) return;
    const now = Date.now();
    if (this.ws?.readyState === 1 && this.open) {
      if (now % 4000 < 1000) this.ping();
      if (this.sIn !== this.ackSent) { this.ackSent = this.sIn; this.ws.send(JSON.stringify({ t: 'ack', a: this.sIn })); }
      // Nothing heard for 12 s (pings every 4 s): the socket is dead without saying so.
      if (now - this.lastHeard > 12_000) { try { this.ws.close(); } catch { /* gone */ } this.dropped(); }
    }
    // Away past the server's hold: the session is gone (its connections closed when it comes back fresh).
    if (this.lostAt && now - this.lostAt > this.hold && this.open) this.lost();
  }

  private dial(now = false) {
    if (this.destroyed) return;
    clearTimeout(this.timer);
    const go = () => {
      if (this.destroyed) return;
      let ws: WebSocket;
      try { ws = new WebSocket(this.url); } catch { this.dropped(); return; }
      this.ws = ws;
      let greeted = false;
      // (a socket still not open after 8 s is given up on here: closing one that is connecting may never say it closed)
      const opened = setTimeout(() => { if (!greeted) { try { ws.close(); } catch { /* gone */ } gone(); } }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ ...this.extra, t: 'hello', id: this.id, token: this.token || undefined, ack: this.sIn, app: helloApp }));
      ws.onmessage = ev => {
        if (this.ws !== ws) return;
        let m: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        try { m = JSON.parse(String(ev.data)); } catch { return; }
        this.lastHeard = Date.now();
        if (!greeted) {
          greeted = true; clearTimeout(opened);
          if (m.t === 'ok') { if (Number(m.hold) > 0) this.hold = Math.max(Number(m.hold) * 0.8, Number(m.hold) - 5000); this.welcome(m.token, Number(m.ack) || 0, !!m.fresh); }
          else if (m.t === 'taken') { this.emit('error', { type: 'unavailable-id' }); this.destroy(); }
          else if (m.t === 'password' || m.t === 'banned' || m.t === 'kicked') this.refusedBy(m);
          // full (or anything else) after having been in: tried again until there is room (the game waits meanwhile)
          else if (this.was) { try { ws.close(); } catch { /* gone */ } }
          else { if (m.t === 'full') refused = { t: 'full', online: Number(m.online) || undefined, max: Number(m.max) || undefined }; this.emit('error', { type: m.t === 'full' ? 'server-full' : 'server-error' }); this.destroy(); }
          return;
        }
        this.frame(m);
      };
      // (the first try only: one that was in keeps trying while the network is down — it used to end here when the
      // session had expired meanwhile, and a 私服, with no other way, never got the phone back)
      const gone = () => { clearTimeout(opened); if (this.ws === ws) { this.ws = null; if (!greeted && !this.open && !this.token && !this.was) { this.emit('error', { type: 'network' }); this.destroy(); return; } this.dropped(); } };
      ws.onclose = gone;
      ws.onerror = () => { /* onclose follows */ };
    };
    if (now) go(); else this.timer = setTimeout(go, Math.min(500 * 2 ** Math.min(this.tries, 3), 3000)) as unknown as number;
  }

  /** The socket went: try again soon (the session waits on the server). */
  private dropped() {
    if (this.destroyed) return;
    if (!this.lostAt) this.lostAt = Date.now();
    this.ws = null;
    this.tries++;
    this.dial();
  }

  private welcome(token: string, ack: number, fresh: boolean) {
    if (fresh && this.token) {
      // Back too late: a new session; the old connections are gone.
      this.sOut = 0; this.sIn = 0; this.ackSent = 0; this.out = []; this.outBytes = 0;
      for (const c of [...this.conns.values()]) c.closed();
    }
    const first = !this.open;
    this.was = true;
    this.token = token; this.open = true; this.lostAt = 0; this.tries = 0;
    while (this.out.length && this.out[0][0] <= ack) this.outBytes -= this.out.shift()![1].length;
    for (const [, text] of this.out) this.ws?.send(text);
    this.ping();
    if (first) this.emit('open', this.id);
  }

  /** A 私服 said no for good (its password, a ban, sent away by its owner): no more tries; the game shows why. */
  private refusedBy(m: Record<string, unknown>) {
    refused = { t: m.t as Refusal['t'], ...(typeof m.why === 'string' ? { why: m.why.slice(0, 80) } : {}) };
    this.open = false;
    this.emit('error', { type: m.t, why: refused.why });
    this.destroy();
  }

  /** The session is gone for good (away past the hold, or too much waiting): connections closed, 'disconnected'. */
  private lost() {
    this.open = false; this.token = '';
    this.sOut = 0; this.sIn = 0; this.ackSent = 0; this.out = []; this.outBytes = 0;
    for (const c of [...this.conns.values()]) c.closed();
    this.emit('disconnected');
  }

  private frame(m: Record<string, any>) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (m.t === 'q') { this.rtt = Math.max(1, Date.now() - Number(m.at)); return; }
    if (m.t === 'ack') { const a = Number(m.a) || 0; while (this.out.length && this.out[0][0] <= a) this.outBytes -= this.out.shift()![1].length; return; }
    if (m.t === 'evicted') { this.open = false; this.emit('error', { type: 'unavailable-id' }); this.destroy(); return; }
    if (m.t === 'kicked') { this.refusedBy(m); return; }
    if (typeof m.s === 'number') { if (m.s <= this.sIn) return; this.sIn = m.s; }
    const c = this.conns.get(m.cid);
    switch (m.t) {
      case 'open': c?.opened(); break;
      case 'nopeer': c?.failed(); break;
      case 'd': c?.data(m.d); break;
      case 'close': c?.closed(); break;
      case 'conn': {
        const nc = new RelayConn(this, m.cid, String(m.from));
        this.conns.set(nc.cid, nc);
        this.emit('connection', nc);
        queueMicrotask(() => nc.opened());
        break;
      }
    }
  }
}

/**
 * Opens a RelayPeer: resolves when registered, null when the id is taken, 'down' when the relay can't be reached
 * (or is full) within `ms`.
 */
export function openRelay(url: string, id: string, ms = 5000, extra?: Record<string, unknown>): Promise<RelayPeer | null | 'down'> {
  refused = null;
  return new Promise(resolve => {
    const p = new RelayPeer(url, id, extra);
    let done = false;
    const finish = (v: RelayPeer | null | 'down') => { if (!done) { done = true; resolve(v); } };
    p.on('open', () => finish(p));
    p.on('error', (e: { type?: string }) => { if (!done) { p.destroy(); finish(e.type === 'unavailable-id' ? null : 'down'); } });
    setTimeout(() => { if (!done) { p.destroy(); finish('down'); } }, ms);
  });
}
