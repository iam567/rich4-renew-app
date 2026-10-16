/**
 * Hang guard for the screen side of the game. The rules engine never waits; everything that can stall the game is
 * a promise the controller (main.ts) awaits: a camera move, a walk step, an effect, a picture or a voice. Each of
 * them is registered here (`watch`) while it is outstanding, and the controller reports every step it takes
 * (`beat`). When nothing moves for `limit` ms while no human is being asked, the watchdog logs a dump of what is
 * still outstanding (`[watchdog]` on the console, also `__rich4.watch()`), then asks the registered rescuers to
 * finish what they hold (`onStall`), so a lost promise can never freeze the game.
 */

interface Wait { label: string; t0: number }

let nextId = 0;
const waits = new Map<number, Wait>();

/** Registers an outstanding wait until the promise settles; returns the same promise. */
export function watch<T>(label: string, p: Promise<T>): Promise<T> {
  const id = ++nextId;
  waits.set(id, { label, t0: performance.now() });
  const off = () => { waits.delete(id); };
  p.then(off, off);
  return p;
}

/** Outstanding waits, oldest first, with their age in ms. */
export function outstanding(now = performance.now()): { label: string; ms: number }[] {
  return [...waits.values()].sort((a, b) => a.t0 - b.t0).map(w => ({ label: w.label, ms: Math.round(now - w.t0) }));
}

/** A promise that settles with `p`, or with `fallback` after `ms` (the timer is cleared either way). */
export function timeout<T>(p: Promise<T>, ms: number, fallback: T | (() => T)): Promise<T> {
  return new Promise<T>(resolve => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(typeof fallback === 'function' ? (fallback as () => T)() : fallback); } }, ms);
    p.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(t); resolve(typeof fallback === 'function' ? (fallback as () => T)() : fallback); } });
  });
}

export class Watchdog {
  /** Steps the controller took (every engine event, every answer). */
  seq = 0;
  /** What the controller is doing now (the event it shows or the question it waits on). */
  stage = '';
  /** Set while a human decides (the GO menu, a question): waiting then is not a hang. */
  human = false;
  /** Stalls seen so far (each logged once). */
  stalls: { stage: string; at: number; waits: { label: string; ms: number }[] }[] = [];
  private last = performance.now();
  private timer: ReturnType<typeof setInterval> | null = null;
  private reported = -1;

  /**
   * @param limit ms without a step (and no human asked) that count as a stall.
   * @param dump extra state for the log (game, camera, input mode …).
   * @param onStall called once per stall after the dump: finish whatever the view still holds.
   */
  constructor(private limit = 15000, private dump: () => unknown = () => null, private onStall: () => void = () => {}) {}

  beat(stage: string) { this.seq++; this.stage = stage; this.last = performance.now(); }

  /** Marks the start / end of a human decision. */
  setHuman(on: boolean) { this.human = on; this.last = performance.now(); }

  start() {
    this.stop();
    this.timer = setInterval(() => this.check(), 1000);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Ms since the last step. */
  idle(now = performance.now()) { return now - this.last; }

  check(now = performance.now()) {
    if (this.human || (typeof document !== 'undefined' && document.hidden)) { this.last = Math.max(this.last, now - 1000); return; }
    if (now - this.last < this.limit || this.reported === this.seq) return;
    this.reported = this.seq;
    const waits = outstanding(now);
    this.stalls.push({ stage: this.stage, at: Math.round(now), waits });
    let extra: unknown = null;
    try { extra = this.dump(); } catch (e) { extra = String(e); }
    console.warn(`[watchdog] no progress for ${Math.round((now - this.last) / 1000)} s at "${this.stage}"`, JSON.stringify({ waits, state: extra }));
    try { this.onStall(); } catch (e) { console.warn('[watchdog] rescue failed', e); }
  }

  /** State for tests and the debug handle. */
  report() { return { seq: this.seq, stage: this.stage, human: this.human, idleMs: Math.round(this.idle()), waits: outstanding(), stalls: this.stalls }; }
}
