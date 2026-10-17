import { describe, expect, it } from 'vitest';
import { Fireworks, FIREWORKS_MS } from './fireworks';

/** A seeded generator (mulberry32) so the show is the same every run. */
function seeded(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ROOM = { up: 240, left: 220, right: 220 };

function run(frameMs: number, level = 1, room = ROOM) {
  const f = new Fireworks(seeded(7), level);
  let ms = 0, frames = 0;
  while (!f.step(frameMs, room)) { ms += frameMs; frames++; if (frames > 10000) break; }
  return { f, ms: ms + frameMs, frames };
}

describe('level-5 fireworks (drawn in code)', () => {
  it('lasts as long as the original clip (66 × 42 ms) at any frame rate', () => {
    for (const dt of [8.33, 16.67, 33.3]) {
      const { ms } = run(dt);
      expect(ms).toBeGreaterThanOrEqual(FIREWORKS_MS - 1);
      expect(ms).toBeLessThan(FIREWORKS_MS + dt + 1);
    }
  });

  it('bursts every shell, overlapping, and every star is out by the end', () => {
    const { f } = run(16.67);
    expect(f.bursts).toBe(11);
    expect(f.n).toBeLessThan(40);
    expect(f.peak).toBeGreaterThan(300);
    expect(f.peak).toBeLessThan(1400);
  });

  it('draws fewer stars on a slow device', () => {
    const full = run(16.67, 1).f.peak, low = run(16.67, 0.3).f.peak;
    expect(low).toBeLessThan(full * 0.45);
  });

  it('stays inside a small view (landscape phone)', () => {
    const f = new Fireworks(seeded(3), 1), room = { up: 200, left: 160, right: 160 };
    let maxUp = 0;
    while (!f.step(16.67, room)) {
      for (const r of (f as unknown as { rockets: { y1: number; r: number }[] }).rockets) maxUp = Math.max(maxUp, -r.y1 + r.r);
    }
    expect(maxUp).toBeLessThanOrEqual(200);
  });
});
