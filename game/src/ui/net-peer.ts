/**
 * 派對模式's two ways (the user 2026-11-03): through the user's VPS when it answers (relay-peer.ts: no NAT trouble, a
 * phone that drops for a moment carries on), else phone to phone as before (PeerJS + STUN/TURN) — the game never
 * depends on the server alone. A NetPeer is this phone on both under one peer id:
 *
 * - a named id (a room, the 尋找夥伴 list) is taken on the relay and, when it is free there too, on PeerJS, so a
 *   phone that cannot reach the VPS still finds it;
 * - a connection tries the relay first and, when nobody has that id there (a host without the VPS), PeerJS.
 *
 * Where the relay is: RELAYS in the app, replaced by relay.json in the app's GitHub repo when that answers (a new
 * server needs no new version; an empty list there turns the relay off) and remembered for the next start.
 */
import Peer, { type DataConnection } from 'peerjs';
import { openRelay, RelayPeer, type RelayConn } from './relay-peer';

/** The relay (tools/party-relay; behind Caddy on 443 with its own certificate, 2026-11-03). */
export const RELAYS = ['wss://rich.areu.pro'];
const LIST_URL = 'https://raw.githubusercontent.com/iam567/rich4-renew-app/main/game/relay.json';
const LIST_KEY = 'rich4.party.relays';

/** A connection either way: PeerJS's DataConnection or a RelayConn (`via`: which). */
export interface NetConn {
  readonly peer: string;
  readonly open: boolean;
  via?: 'vps' | 'p2p';
  send(d: unknown): void;
  close(): void;
  on(ev: 'open' | 'close', fn: () => void): unknown;
  on(ev: 'data', fn: (d: unknown) => void): unknown;
  on(ev: 'error', fn: (e: unknown) => void): unknown;
}
const asConn = (c: DataConnection | RelayConn) => c as unknown as NetConn;

type Handler = (...a: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Settings the tests change: no relay at all (PeerJS only), PeerJS's options. */
export const netConfig: { relays: string[] | null; peerOpts: Record<string, unknown> } = {
  relays: typeof process !== 'undefined' && process.env?.VITEST ? [] : null,
  peerOpts: { debug: 0 },
};

let listed: Promise<string[]> | null = null;
/** The relays to try: the tests' setting, else GitHub's list (3 s), else the last one seen, else the app's. */
export function relays(): Promise<string[]> {
  if (netConfig.relays) return Promise.resolve(netConfig.relays);
  // A developer's own relay (a local test): localStorage rich4.party.relayDev = 'ws://127.0.0.1:8443'.
  try { const dev = localStorage.getItem('rich4.party.relayDev'); if (dev) return Promise.resolve([dev]); } catch { /* none */ }
  listed ??= (async () => {
    let kept: string[] | null = null;
    try { const k = JSON.parse(localStorage.getItem(LIST_KEY) ?? 'null'); if (Array.isArray(k?.relays)) kept = k.relays; } catch { /* none */ }
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(LIST_URL, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json() as { relays?: unknown };
        if (Array.isArray(j.relays)) {
          const list = j.relays.filter((u): u is string => typeof u === 'string' && /^wss?:\/\//.test(u));
          try { localStorage.setItem(LIST_KEY, JSON.stringify({ relays: list, at: Date.now() })); } catch { /* not kept */ }
          return list;
        }
      }
    } catch { /* GitHub not reached */ }
    return kept ?? RELAYS;
  })();
  return listed;
}

/** The relay that answered last (tried first next time); `downUntil`: none answered, PeerJS only until then. */
let goodRelay = '';
let downUntil = 0;

async function relayFor(id: string): Promise<RelayPeer | null | 'down'> {
  if (Date.now() < downUntil) return 'down';
  const list = await relays();
  const order = goodRelay && list.includes(goodRelay) ? [goodRelay, ...list.filter(u => u !== goodRelay)] : list;
  for (const url of order) {
    const r = await openRelay(url, id, 5000);
    if (r === 'down') continue;
    goodRelay = url;
    return r;
  }
  if (list.length) downUntil = Date.now() + 60_000;
  return 'down';
}

function openP2P(id: string, opts: Record<string, unknown>): Promise<Peer | null> {
  return new Promise(resolve => {
    const p = new Peer(id, opts);
    let done = false;
    p.on('open', () => { if (!done) { done = true; resolve(p); } });
    p.on('error', () => { if (!done) { done = true; p.destroy(); resolve(null); } });
    setTimeout(() => { if (!done) { done = true; p.destroy(); resolve(null); } }, 12000);
  });
}

/** A fresh id for a phone (the same on both ways, so a member is one id whichever way it came). */
export const freshId = (prefix: string) => `${prefix}u-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export class NetPeer {
  private h = new Map<string, Handler[]>();
  private opening: Promise<Peer | null> | null = null;
  destroyed = false;

  constructor(readonly id: string, public relay: RelayPeer | null, public p2p: Peer | null, private readonly peerOpts: Record<string, unknown>) {
    if (relay) this.hook(relay, 'vps');
    if (p2p) this.hook(p2p, 'p2p');
  }

  /** Which way this phone is reachable: the VPS, phone to phone, or both. */
  get via(): string { return this.relay?.open ? (this.p2p ? 'vps+p2p' : 'vps') : 'p2p'; }
  /** Round trip to the relay (0: none). */
  get relayRtt(): number { return this.relay?.open ? this.relay.rtt : 0; }

  on(ev: 'connection', fn: (c: NetConn) => void): this;
  on(ev: 'disconnected', fn: () => void): this;
  on(ev: 'error', fn: (e: { type?: string }) => void): this;
  on(ev: string, fn: Handler): this { (this.h.get(ev) ?? this.h.set(ev, []).get(ev)!).push(fn); return this; }
  private emit(ev: string, ...a: unknown[]) { for (const fn of [...(this.h.get(ev) ?? [])]) fn(...a); }

  private hook(p: RelayPeer | Peer, via: 'vps' | 'p2p') {
    (p as RelayPeer).on('connection', (c: NetConn) => { (c as { via?: string }).via = via; this.emit('connection', c); });
    if (via === 'p2p') {
      (p as Peer).on('disconnected', () => this.emit('disconnected'));
      // The background registration of a named id on PeerJS failing changes nothing while the relay holds it.
      (p as Peer).on('error', e => { if (!this.relay?.open) this.emit('error', e); });
    } else {
      (p as RelayPeer).on('disconnected', () => { if (!this.destroyed) (p as RelayPeer).reconnect(); });
      (p as RelayPeer).on('error', (e: { type?: string }) => { if (e.type === 'unavailable-id') this.emit('error', e); });
    }
  }

  /** Also reachable phone to phone (a named id: best effort, in the background). */
  attachP2P() {
    if (this.p2p || this.opening || this.destroyed) return this.opening;
    this.opening = openP2P(this.id, this.peerOpts).then(p => {
      this.opening = null;
      if (!p) return null;
      if (this.destroyed) { p.destroy(); return null; }
      this.p2p = p; this.hook(p, 'p2p');
      return p;
    });
    return this.opening;
  }

  /** A connection to `to`: the relay first, PeerJS when nobody has that id on the relay (or there is no relay). */
  async dial(to: string): Promise<NetConn | null> {
    if (this.relay?.open) {
      const c = await waitOpen(asConn(this.relay.connect(to)), 8000);
      if (c) { (c as { via?: string }).via = 'vps'; return c; }
    }
    const p = this.p2p ?? await this.attachP2P();
    if (!p || this.destroyed) return null;
    const c = await waitOpen(asConn(p.connect(to, { reliable: true })), 10000, p);
    if (c) (c as { via?: string }).via = 'p2p';
    return c;
  }

  reconnect() { if (this.p2p && this.p2p.disconnected && !this.p2p.destroyed) this.p2p.reconnect(); if (this.relay && !this.relay.open && !this.relay.destroyed) this.relay.reconnect(); }

  destroy() { this.destroyed = true; this.relay?.destroy(); this.p2p?.destroy(); }
}

function waitOpen(c: NetConn, ms: number, peer?: Peer): Promise<NetConn | null> {
  return new Promise(resolve => {
    let done = false;
    const fail = () => { if (!done) { done = true; try { c.close(); } catch { /* gone */ } resolve(null); } };
    c.on('open', () => { if (!done) { done = true; resolve(c); } });
    c.on('error', fail);
    peer?.on('error', e => { if ((e as { type?: string }).type === 'peer-unavailable') fail(); });
    setTimeout(fail, ms);
  });
}

/**
 * This phone on the network under `id` (a room's, the list's) or a fresh one: null when the id is taken. On the relay
 * when it answers (a named id also on PeerJS, in the background), else PeerJS alone.
 */
export async function openNet(id: string, named: boolean, peerOpts: Record<string, unknown> = netConfig.peerOpts): Promise<NetPeer | null> {
  const r = await relayFor(id);
  if (r === null) return null;            // taken on the relay
  if (r !== 'down') {
    const n = new NetPeer(id, r, null, peerOpts);
    if (named) void n.attachP2P();
    return n;
  }
  const p = await openP2P(id, peerOpts);
  return p ? new NetPeer(id, null, p, peerOpts) : null;
}

/** Whether the relay answers now (the network check): its round trip in ms, or 0. */
export async function relayReachable(): Promise<number> {
  const r = await relayFor(freshId('rich4-party-check-'));
  if (r === null || r === 'down') return 0;
  await new Promise(res => setTimeout(res, 600));
  const rtt = r.rtt || 1;
  r.destroy();
  return rtt;
}
