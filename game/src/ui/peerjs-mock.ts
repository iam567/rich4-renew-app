/**
 * An in-memory PeerJS for the 派對模式 tests (party-version.test.ts, party-rules.test.ts): every send arrives as a
 * copy, in order; ids are taken like the real server's (a second phone asking for the same id gets 'unavailable-id').
 * Used as `vi.mock('peerjs', () => import('./peerjs-mock'))`; not part of the app.
 */
type H = Record<string, ((...a: unknown[]) => void)[]>;
const emit = (h: H, ev: string, ...a: unknown[]) => { for (const f of [...(h[ev] ?? [])]) f(...a); };
class Conn {
  open = false; other: Conn | null = null; h: H = {};
  constructor(readonly peer: string) {}
  on(ev: string, f: (...a: unknown[]) => void) { (this.h[ev] ??= []).push(f); return this; }
  send(d: unknown) {
    if (!this.open) return;
    const o = this.other!, copy = structuredClone(d);
    queueMicrotask(() => { if (o.open) emit(o.h, 'data', copy); });
  }
  close() {
    if (!this.open) return;
    this.open = false; emit(this.h, 'close');
    const o = this.other!;
    if (o.open) { o.open = false; queueMicrotask(() => emit(o.h, 'close')); }
  }
}
const peers = new Map<string, Peer>();
let n = 0;
class Peer {
  id: string; h: H = {}; destroyed = false; conns: Conn[] = [];
  constructor(id?: unknown) {
    this.id = typeof id === 'string' ? id : `peer-${++n}`;
    queueMicrotask(() => {
      if (peers.has(this.id)) { emit(this.h, 'error', { type: 'unavailable-id' }); return; }
      peers.set(this.id, this); emit(this.h, 'open', this.id);
    });
  }
  on(ev: string, f: (...a: unknown[]) => void) { (this.h[ev] ??= []).push(f); return this; }
  connect(id: string) {
    const a = new Conn(id);
    queueMicrotask(() => {
      const t = peers.get(id);
      if (!t || t.destroyed || this.destroyed) { emit(this.h, 'error', { type: 'peer-unavailable' }); return; }
      const b = new Conn(this.id);
      a.other = b; b.other = a; a.open = b.open = true;
      this.conns.push(a); t.conns.push(b);
      emit(t.h, 'connection', b);
      emit(a.h, 'open');
    });
    return a;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (peers.get(this.id) === this) peers.delete(this.id);
    for (const c of this.conns) c.close();
  }
  reconnect() {}
}
export default Peer;
