import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from './audio';
import { Loudspeakers } from './jq-loudspeaker';

/**
 * A stand-in AudioContext: every node remembers its context, and connecting nodes of two contexts throws as Web Audio
 * does (InvalidAccessError) — what iOS's context rebuild (ui/audio.ts `rebuild`) turned a kept horn into.
 */
function fakeContext() {
  const ctx: Record<string, unknown> = { state: 'running', currentTime: 0, sampleRate: 44100, connects: 0 };
  // (an AudioParam belongs to its node's context too: a modulator connects to one)
  const param = () => new Proxy({ value: 0, ctx } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : () => undefined),
  });
  const node = () => {
    const o: Record<string, unknown> = {
      ctx,
      connect(t: { ctx?: unknown }) {
        if (t?.ctx !== ctx) throw new Error('InvalidAccessError: cannot connect to an AudioNode belonging to a different audio context');
        (ctx.connects as number)++;
        return t;
      },
      disconnect() {}, start() {}, stop() {},
    };
    return new Proxy(o, { get: (t, k) => (k in t ? t[k as string] : (t[k as string] = param())) });
  };
  return new Proxy(ctx, {
    get: (t, k) => {
      if (k in t) return t[k as string];
      if (k === 'createBuffer') return (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) });
      if (typeof k === 'string' && k.startsWith('create')) return () => node();
      return undefined;
    },
  });
}

describe('激情歲月 loudspeakers across an audio context rebuild (iOS)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('the news jingle plays on the new context instead of throwing on the old horn (the board was skipped)', () => {
    const a = fakeContext(), b = fakeContext();
    const spy = vi.spyOn(audio, 'ambience').mockReturnValue({ ctx: a as unknown as AudioContext, out: (a as unknown as AudioContext).createGain() });
    const loud = new Loudspeakers();
    expect(() => loud.newsJingle(true)).not.toThrow();
    // iOS closes the context after an interruption / the background and starts a fresh one
    audio.generation++;
    spy.mockReturnValue({ ctx: b as unknown as AudioContext, out: (b as unknown as AudioContext).createGain() });
    const before = b.connects as number;
    expect(() => loud.newsJingle(true)).not.toThrow();
    expect(b.connects as number).toBeGreaterThan(before);
  });

  it('the street programs too (and a stale horn is not busy for ever)', () => {
    const a = fakeContext(), b = fakeContext();
    const spy = vi.spyOn(audio, 'ambience').mockReturnValue({ ctx: a as unknown as AudioContext, out: (a as unknown as AudioContext).createGain() });
    const loud = new Loudspeakers();
    expect(loud.play('march', 10)).toBeGreaterThan(0);
    expect(loud.busy()).toBe(true);
    audio.generation++;
    spy.mockReturnValue({ ctx: b as unknown as AudioContext, out: (b as unknown as AudioContext).createGain() });
    expect(loud.busy()).toBe(false);
    expect(() => loud.play('dance', 10)).not.toThrow();
    expect(b.connects as number).toBeGreaterThan(0);
  });
});
