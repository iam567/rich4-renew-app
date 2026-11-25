import { describe, expect, it } from 'vitest';
import {
  bandAt, bandsAt, BOARS, boarKind, boarWave, HIT_DAMAGE, MIN_RUN, pickSpot, redZone, sliderAt, spotXY, STRIKE_RECOVER, sweepSecs,
  THROW_STUN, tigerPace, WRESTLE_SECS, YAN_AT, type Area, type Rnd,
} from './qm-logic';

const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]; };
/** A seeded random (mulberry32), so the simulations below give the same figures every run. */
function seeded(seed: number): Rnd {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = (r: Rnd) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const RUNS = 400;

// ---------------------------------------------------------------- the players the games are tuned for (the user 2026-11-23:
// 「大部分人能撐到13秒就行，留兩秒是極限挑戰」 — an ordinary hand to about 13 s, only the very quick to 15)

/** 景陽岡: a hand that taps a spot `rt` s (± jitter) after it lights, then needs `gap` s before the next tap. */
function tigerRun(r: Rnd, rt: number, jit: number, gap: number): { secs: number; hits: number } {
  const lit: { born: number; life: number; tap: number }[] = [];
  let next = 0.5, free = 0, hits = 0;
  for (let t = 0; t < 15; t += 1 / 120) {
    if (lit.some(s => t - s.born > s.life)) return { secs: t, hits };
    for (const s of lit) if (s.tap < 0) s.tap = s.born + rt + (r() * 2 - 1) * jit;
    const due = lit.filter(s => t >= s.tap).sort((a, b) => a.born - b.born)[0];
    if (due && t >= free) { lit.splice(lit.indexOf(due), 1); hits++; free = t + gap; }
    const p = tigerPace(t);
    if (t >= next && lit.length < p.max) { for (let i = 0; i < p.burst && lit.length < p.max; i++) lit.push({ born: t, life: p.life, tap: -1 }); next = t + p.every; }
  }
  return { secs: 15, hits };
}
/** 野豬林: `rate` arrows a second at the nearest boar, `acc` of them hitting. */
function boarRun(r: Rnd, rate: number, acc: number): { secs: number; pts: number } {
  const boars: { p: number; hp: number; cross: number; pts: number }[] = [];
  let last = -9, shot = 0, pts = 0;
  for (let t = 0; t < 15; t += 1 / 60) {
    for (const b of boars) { b.p += 1 / 60 / b.cross; if (b.p >= 1) return { secs: t, pts }; }
    if (t >= shot) {
      const b = boars.filter(x => x.p > 0.2).sort((x, y) => y.p - x.p)[0];
      if (b && r() < acc) { b.hp--; b.p = Math.max(0, b.p - 0.05); if (b.hp <= 0) { boars.splice(boars.indexOf(b), 1); pts += b.pts; } }
      shot = t + 1 / rate;
    }
    const w = boarWave(t);
    if (boars.length < w.target && t - last >= w.gap) { const k = BOARS[boarKind(w, r)]; boars.push({ p: 0, hp: k.arrows, cross: w.cross, pts: k.points }); last = t; }
  }
  return { secs: 15, pts };
}
/** 相撲擂台: a hand that stops the slider at the red zone's middle with a timing error of `sigma` s. */
function wrestleRun(r: Rnd, sigma: number): { won: boolean; at: number; hpAt13: number } {
  let t = 0, hp = 100, n = 0, ti = 0, at13 = -1;
  while (t < WRESTLE_SECS) {
    const sw = sweepSecs(n), w = bandsAt(n), red = redZone(r, w), c = red + w.red / 2;
    let tc = c * sw;
    if (tc < MIN_RUN + 0.1) tc = (2 - c) * sw;
    const run = Math.max(MIN_RUN, tc + gauss(r) * sigma), tap = t + run;
    if (ti < YAN_AT.length && YAN_AT[ti] <= tap) { t = Math.max(t, YAN_AT[ti]) + THROW_STUN; ti++; continue; }
    if (tap >= WRESTLE_SECS) break;
    if (at13 < 0 && tap >= 13) at13 = hp;
    hp -= HIT_DAMAGE[bandAt(sliderAt(run, sw), red, w)]; n++; t = tap + STRIKE_RECOVER;
    if (hp <= 0) return { won: true, at: tap, hpAt13: at13 < 0 ? 0 : at13 };
  }
  return { won: false, at: WRESTLE_SECS, hpAt13: at13 < 0 ? Math.max(0, hp) : at13 };
}

describe('景陽岡打虎 (35: the spots get quicker)', () => {
  it('starts at one spot every 1.1 s lit 1.3 s, ends at two at a time every 0.65 s lit 0.5 s', () => {
    const a = tigerPace(0), b = tigerPace(15);
    expect(a.every).toBeCloseTo(1.1, 5); expect(a.life).toBeCloseTo(1.8, 5); expect(a.burst).toBe(1);
    expect(b.every).toBeCloseTo(0.65, 5); expect(b.life).toBeCloseTo(0.5, 5); expect(b.burst).toBe(2);
    for (let t = 0; t < 15; t += 0.5) {
      const p = tigerPace(t), q = tigerPace(t + 0.5);
      expect(q.every).toBeLessThanOrEqual(p.every); expect(q.life).toBeLessThanOrEqual(p.life); expect(q.burst).toBeGreaterThanOrEqual(p.burst);
    }
  });
  it('an ordinary hand (a tap ~0.45 s after a spot lights) falls about 13 s with under 100 點券; only a quick one (~0.3 s) lasts 15', () => {
    const r = seeded(1), out: string[] = [];
    const run = (rt: number, jit: number, gap: number) => Array.from({ length: RUNS }, () => tigerRun(r, rt, jit, gap));
    const slow = run(0.55, 0.12, 0.35), typical = run(0.45, 0.1, 0.3), quick = run(0.38, 0.08, 0.25), fast = run(0.3, 0.06, 0.2);
    for (const [name, xs] of [['slow 0.55 s', slow], ['typical 0.45 s', typical], ['quick 0.38 s', quick], ['fast 0.30 s', fast]] as const)
      out.push(`${name}: median ${pct(xs.map(x => x.secs), 0.5).toFixed(1)} s, full ${Math.round(xs.filter(x => x.secs >= 15).length / RUNS * 100)} %, median ${pct(xs.map(x => x.hits), 0.5)} spots`);
    console.log(`景陽岡 ${out.join(' | ')}`);
    const med = (xs: { secs: number }[]) => pct(xs.map(x => x.secs), 0.5);
    expect(med(typical)).toBeGreaterThan(12.5); expect(med(typical)).toBeLessThan(14.2);
    expect(typical.filter(x => x.secs >= 15).length).toBeLessThan(RUNS * 0.05);
    expect(fast.filter(x => x.secs >= 15).length).toBeGreaterThan(RUNS * 0.8);
    expect(pct(typical.map(x => x.hits), 0.5) * 5).toBeLessThanOrEqual(100);   // 5 點券 a spot (the user 2026-11-23: 一般玩家 100 點券以內)
    expect(pct(fast.map(x => x.hits), 0.5)).toBeGreaterThan(pct(typical.map(x => x.hits), 0.5));
  });
  it('puts a new spot on a free part of the tiger, inside its area', () => {
    const areas: Area[] = [{ part: 'head', x: 0.3, y: 0.3, rx: 0.05, ry: 0.05 }, { part: 'tail', x: 0.8, y: 0.4, rx: 0.04, ry: 0.06 }];
    const s = pickSpot(areas, [{ area: 0, u: 0, v: 0 }], -1, Math.random);
    expect(s.area).toBe(1);
    for (let i = 0; i < 200; i++) {
      const p = spotXY(areas, pickSpot(areas, [], -1, Math.random));
      expect(areas.find(x => Math.hypot((p.x - x.x) / x.rx, (p.y - x.y) / x.ry) <= 1)).toBeTruthy();
    }
  });
});

describe('野豬林射野豬 (35: harder and harder)', () => {
  it('runs one normal boar at a time at first, kings only from 6 s, the big pack from 10.5 s', () => {
    expect(boarWave(1)).toMatchObject({ target: 1, mix: [1, 0, 0] });
    expect(boarWave(4).target).toBeGreaterThanOrEqual(2); expect(boarWave(5.5).target).toBeLessThanOrEqual(3); expect(boarWave(4).mix[2]).toBe(0);
    expect(boarWave(7).mix[2]).toBeGreaterThan(0);
    expect(boarWave(11).target).toBeGreaterThanOrEqual(7); expect(boarWave(14).target).toBeGreaterThan(boarWave(11).target);
    for (let t = 0; t < 15; t += 0.25) expect(boarWave(t + 0.25).cross).toBeLessThanOrEqual(boarWave(t).cross);
    expect(boarKind(boarWave(1), Math.random)).toBe(0);
    expect(boarKind(boarWave(12), seq(0.99))).toBe(2);
  });
  it('an ordinary hand (3–5 arrows a second, 85 % hitting) lasts about 13 s with under 100 點券; only a very quick one 15', () => {
    const r = seeded(2), out: string[] = [], got: Record<string, number[]> = {}, pts: Record<string, number[]> = {};
    for (const [rate, acc] of [[3, 0.85], [4, 0.85], [5, 0.85], [6, 0.9], [8, 0.95], [10, 0.95]]) {
      const runs = Array.from({ length: RUNS }, () => boarRun(r, rate, acc)), xs = runs.map(x => x.secs);
      got[rate] = xs; pts[rate] = runs.map(x => x.pts);
      out.push(`${rate}/s ${acc * 100}%: median ${pct(xs, 0.5).toFixed(1)} s, full ${Math.round(xs.filter(x => x >= 15).length / RUNS * 100)} %, median ${pct(runs.map(x => x.pts), 0.5)} 點券 (+30 when full)`);
    }
    console.log(`野豬林 ${out.join(' | ')}`);
    for (const k of [3, 4, 5]) {
      expect(pct(got[k], 0.5)).toBeGreaterThan(12.5); expect(pct(got[k], 0.5)).toBeLessThan(14.5); expect(got[k].filter(x => x >= 15).length).toBeLessThan(RUNS * 0.05);
      expect(pct(pts[k], 0.5)).toBeLessThanOrEqual(100);
    }
    expect(got[10].filter(x => x >= 15).length).toBeGreaterThan(RUNS * 0.4);
  });
});

describe('相撲擂台 (35: 15 s against 燕青; red 50 %, orange 34 %, yellow 25 %, else 10 %)', () => {
  it('reads the bands round the red zone', () => {
    const red = 0.4, BAND = bandsAt(9);
    expect(bandAt(red + BAND.red / 2, red, BAND)).toBe('red');
    expect(bandAt(red - BAND.orange / 2, red, BAND)).toBe('orange'); expect(bandAt(red + BAND.red + BAND.orange / 2, red, BAND)).toBe('orange');
    expect(bandAt(red - BAND.orange - BAND.yellow / 2, red, BAND)).toBe('yellow');
    expect(bandAt(0.02, red, BAND)).toBe('miss'); expect(bandAt(0.98, red, BAND)).toBe('miss');
  });
  it('starts wide and narrows every strike (the user 2026-11-25)', () => {
    expect([0, 1, 2, 3, 9].map(n => bandsAt(n).red)).toEqual([0.3, 0.1, 0.05, 0.05, 0.05]);
    for (let n = 0; n < 2; n++) { expect(bandsAt(n + 1).orange).toBeLessThan(bandsAt(n).orange); expect(bandsAt(n + 1).yellow).toBeLessThan(bandsAt(n).yellow); }
  });
  it('keeps the zone and its bands inside the bar, anywhere along it', () => {
    for (const n of [0, 2, 9]) for (const r of [0, 0.5, 0.9999]) {
      const BAND = bandsAt(n), z = redZone(() => r, BAND);
      expect(z - BAND.orange - BAND.yellow).toBeGreaterThanOrEqual(-1e-9);
      expect(z + BAND.red + BAND.orange + BAND.yellow).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
  it('moves the slider back and forth, quicker every strike', () => {
    expect(sliderAt(0, 1)).toBe(0); expect(sliderAt(0.5, 1)).toBeCloseTo(0.5); expect(sliderAt(1, 1)).toBeCloseTo(1); expect(sliderAt(1.5, 1)).toBeCloseTo(0.5);
    for (let n = 0; n < 3; n++) expect(sweepSecs(n + 1)).toBeLessThan(sweepSecs(n));
  });
  it('an ordinary hand mostly floors 燕青, not always; a quick, accurate one nearly always', () => {
    const r = seeded(3), out: string[] = [], got: Record<string, ReturnType<typeof wrestleRun>[]> = {};
    for (const [name, sigma] of [['slow σ 90 ms', 0.09], ['typical σ 70 ms', 0.07], ['quick σ 50 ms', 0.05], ['fast σ 35 ms', 0.035]] as const) {
      const xs = Array.from({ length: RUNS * 2 }, () => wrestleRun(r, sigma));
      got[name] = xs;
      const wins = xs.filter(x => x.won);
      out.push(`${name}: wins ${Math.round(wins.length / xs.length * 100)} % (median at ${wins.length ? pct(wins.map(x => x.at), 0.5).toFixed(1) : '-'} s), 燕青 left at 13 s ${pct(xs.map(x => x.hpAt13), 0.5)} %`);
    }
    console.log(`相撲 ${out.join(' | ')}`);
    const rate = (k: string) => got[k].filter(x => x.won).length / got[k].length;
    // (easier since 2026-11-25: red 30 % / 10 % / 5 % — most ordinary hands win, not every one)
    expect(rate('typical σ 70 ms')).toBeLessThan(0.9); expect(rate('fast σ 35 ms')).toBeGreaterThan(0.85);
    expect(rate('slow σ 90 ms')).toBeLessThan(rate('typical σ 70 ms'));
  });
});
