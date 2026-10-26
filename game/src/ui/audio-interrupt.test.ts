import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A minimal AudioContext: the states WebKit uses (incl. 'interrupted') and 'statechange' events. */
class FakeContext {
  static made: FakeContext[] = [];
  state: string = 'running';
  currentTime = 0;
  destination = {};
  resumes = 0;
  /** What resume() leads to (WebKit keeps an interrupted context interrupted while Siri is up). */
  resumeTo = 'running';
  private handlers: (() => void)[] = [];
  constructor() { FakeContext.made.push(this); }
  addEventListener(ev: string, fn: () => void) { if (ev === 'statechange') this.handlers.push(fn); }
  set(state: string) { if (state === this.state) return; this.state = state; for (const h of this.handlers) h(); }
  resume() { this.resumes++; this.set(this.resumeTo); return Promise.resolve(); }
  suspend() { this.set('suspended'); return Promise.resolve(); }
  close() { this.set('closed'); return Promise.resolve(); }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect: (n: unknown) => n }; }
  createBuffer() { return {}; }
  createBufferSource() { return { connect: (n: unknown) => n, start() {}, stop() {}, buffer: null }; }
  decodeAudioData() { return Promise.reject(new Error('no audio in tests')); }
}

type Listener = (e?: unknown) => void;
const winL = new Map<string, Listener[]>(), docL = new Map<string, Listener[]>();
const on = (m: Map<string, Listener[]>) => (ev: string, fn: Listener) => { m.set(ev, [...(m.get(ev) ?? []), fn]); };
const fire = (m: Map<string, Listener[]>, ev: string) => { for (const fn of m.get(ev) ?? []) fn(); };
const doc = { hidden: false, addEventListener: on(docL), removeEventListener() {} };

describe('audio after an iOS interruption (Siri, #17)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeContext.made = [];
    winL.clear(); docL.clear(); doc.hidden = false;
    vi.stubGlobal('window', { AudioContext: FakeContext, addEventListener: on(winL), removeEventListener() {} });
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  const start = async () => {
    const { audio } = await import('./audio');
    fire(winL, 'pointerdown');           // the first touch creates and unlocks the context
    expect(FakeContext.made).toHaveLength(1);
    return { audio, ctx: FakeContext.made[0]! };
  };

  it('retries resume while interrupted and builds a fresh context once it runs again', async () => {
    const { audio, ctx } = await start();
    const gen = audio.generation;
    ctx.resumeTo = 'interrupted';
    ctx.set('interrupted');               // Siri comes up
    vi.advanceTimersByTime(600);
    expect(ctx.resumes).toBeGreaterThan(0);
    expect(FakeContext.made).toHaveLength(1);
    ctx.resumeTo = 'running';             // Siri gone: the next retry gets it running
    vi.advanceTimersByTime(1100);
    expect(ctx.state).toBe('running');
    vi.advanceTimersByTime(400);
    expect(FakeContext.made).toHaveLength(2);
    expect(ctx.state).toBe('closed');
    expect(audio.generation).toBe(gen + 1);
    vi.advanceTimersByTime(10000);        // and stops trying
    expect(FakeContext.made).toHaveLength(2);
  });

  it('rebuilds inside the next touch when the context stays interrupted', async () => {
    const { ctx } = await start();
    ctx.resumeTo = 'interrupted';
    ctx.set('interrupted');
    fire(winL, 'pointerdown');
    expect(FakeContext.made).toHaveLength(2);
    expect(FakeContext.made[1]!.resumes).toBeGreaterThan(0);
  });

  it('leaves its own suspend (page hidden) to the visibility handling', async () => {
    const { ctx } = await start();
    doc.hidden = true;
    fire(docL, 'visibilitychange');
    expect(ctx.state).toBe('suspended');
    vi.advanceTimersByTime(5000);
    expect(ctx.resumes).toBe(0);
    expect(FakeContext.made).toHaveLength(1);
  });
});
