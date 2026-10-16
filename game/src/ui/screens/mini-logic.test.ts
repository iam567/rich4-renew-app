import { describe, expect, it } from 'vitest';
import { Balloons, bigScore, cellAt, cellXY, Gifts, Penguin, PENGUIN_ITEMS, walkable, type Box, type Rand, type Sound } from './mini-logic';

/** The MSVC libc rand() the original links (seed · 214013 + 2531011, bits 16..30). */
function msvc(seed = 1): Rand {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 214013) + 2531011) >>> 0; return (s >>> 16) & 0x7fff; };
}
/** A rand() that returns the given values in turn (then repeats the last). */
function seq(...v: number[]): Rand { let i = 0; return () => v[Math.min(i++, v.length - 1)]; }
function recorder() {
  const log: string[] = [];
  const sound: Sound = { play: (id, loop) => log.push(loop ? `loop ${id}` : `play ${id}`), stop: id => log.push(`stop ${id}`) };
  return { log, sound };
}
const run = (g: { tick(): void }, n: number) => { for (let i = 0; i < n; i++) g.tick(); };
const ready = (g: Penguin | Balloons | Gifts) => { while (g.phase === 'intro') g.tick(); g.start(); };

describe('企鵝挖寶 (13 §2)', () => {
  it('has the 64-cell field of ref_00474d80 and finds cells by their diamonds', () => {
    let n = 0;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (walkable(c, r)) {
      n += 1;
      const { x, y } = cellXY(c, r);
      expect(cellAt(x, y)).toEqual({ c, r });
      expect(cellAt(x + 40, y)).toEqual({ c, r });
      expect(cellAt(x, y - 20)).toEqual({ c, r });
    }
    expect(n).toBe(64);
    expect(walkable(4, 4)).toBe(false); // the igloo
    expect(cellXY(3, 0)).toEqual({ x: 80, y: 153 });
    expect(cellXY(5, 8)).toEqual({ x: 560, y: 297 });
    expect(cellAt(320, 225)).toBeNull();
    expect(cellAt(5, 5)).toBeNull();
  });

  it('buries 3 bombs, 12 + 3 + 9 gems and one diamond on free cells', () => {
    for (const seed of [1, 7, 99]) {
      const g = new Penguin(msvc(seed));
      const kinds = [0, 0, 0, 0, 0, 0];
      g.items.forEach((k, i) => { if (k) { kinds[k] += 1; expect(walkable(i % 9, Math.floor(i / 9))).toBe(true); } });
      expect(kinds.slice(1)).toEqual(PENGUIN_ITEMS);
      expect(g.treasure()).toHaveLength(28);
    }
    // rand() · left >> 15 picks among the free cells in row order: all zeros fill the first 28 cells.
    const g = new Penguin(() => 0);
    expect(g.items.slice(3, 7)).toEqual([1, 1, 1, 2]);
  });

  it('shows the treasure 10 ticks, waits for READY GO, then plays 150 ticks', () => {
    const g = new Penguin(msvc());
    run(g, 9);
    expect(g.phase).toBe('intro');
    g.tick();
    expect(g.phase).toBe('ready');
    run(g, 5);
    expect(g.ticks).toBe(150);
    g.start();
    g.tick();
    expect(g.ticks).toBe(149);
    expect(g.hud().slice(0, 4).map(s => s.frame)).toEqual([1, 4, 9, 0]); // 14.90
  });

  it('walks to the clicked cell, digs, and scores what is there', () => {
    const { log, sound } = recorder();
    const g = new Penguin(msvc(), sound);
    g.items.fill(0);
    g.items[6 * 9 + 4] = 5; // a diamond two cells right of the start (2,6)
    ready(g);
    const at = cellXY(4, 6);
    g.click(at.x, at.y);
    expect(g.mode).toBe(2);
    run(g, 8); // two cells, four ticks each
    expect(g.mode).toBe(3);
    expect([g.px >> 16, g.py >> 16]).toEqual([4, 6]);
    run(g, 4);
    expect(g.mode).toBe(0);
    expect(g.counts[5]).toBe(1);
    expect(g.score).toBe(20);
    expect(g.holes).toEqual([6 * 9 + 4]);
    expect(log).toEqual(['loop 11', 'stop 11', 'play 12', 'play 18']);
    // The diamond rises out of the hole over six frames of Panel #90.
    expect(g.sprites.some(s => s.id === 90)).toBe(true);
    // Clicking its own cell does nothing.
    g.click(at.x, at.y);
    expect(g.mode).toBe(0);
  });

  it('gets round the igloo and reaches every cell from every cell', () => {
    for (let a = 0; a < 81; a++) for (let b = 0; b < 81; b++) {
      const [c0, r0, c1, r1] = [a % 9, Math.floor(a / 9), b % 9, Math.floor(b / 9)];
      if (a === b || !walkable(c0, r0) || !walkable(c1, r1)) continue;
      const g = new Penguin(msvc());
      g.items.fill(0);
      ready(g);
      g.px = (c0 << 16) + 0x8000; g.py = (r0 << 16) + 0x8000;
      const at = cellXY(c1, r1);
      g.click(at.x, at.y);
      let n = 0, onField = true;
      while (g.mode === 2 && n < 140) { g.tick(); n++; onField &&= walkable(g.px >> 16, g.py >> 16); }
      expect([onField, g.mode, g.px >> 16, g.py >> 16], `${c0},${r0} → ${c1},${r1}`).toEqual([true, 3, c1, r1]);
    }
  });

  it('a bomb ends the game: startled 15 ticks, then the score for 20 ticks (a click ends it)', () => {
    const { log, sound } = recorder();
    const g = new Penguin(msvc(), sound);
    g.items.fill(0);
    g.items[5 * 9 + 2] = 1;
    ready(g);
    const at = cellXY(2, 5);
    g.click(at.x, at.y);
    run(g, 8);
    expect(g.mode).toBe(1);
    expect(log.at(-1)).toBe('play 15');
    run(g, 14);
    expect(g.phase).toBe('play');
    expect(g.scoreShown).toBe(true);
    g.tick();
    expect(g.phase).toBe('result');
    run(g, 5);
    g.click(0, 0);
    g.tick();
    expect(g.phase).toBe('done');
    expect(bigScore(0)).toEqual([{ id: 79, frame: 10, x: 320, y: 150 }]);
    expect(bigScore(120).map(s => s.x)).toEqual([254, 320, 386]);
  });

  it('time up: sad below 40, happy above 55, plain between', () => {
    const end = (score: number[]) => {
      const { log, sound } = recorder();
      const g = new Penguin(msvc(), sound);
      ready(g);
      score.forEach((n, k) => { g.counts[k] = n; });
      run(g, 150);
      return { mode: g.mode, log, g };
    };
    expect(end([0, 0, 7])).toMatchObject({ mode: 5, log: ['stop 11', 'loop 14'] }); // 35
    expect(end([0, 0, 0, 0, 0, 3])).toMatchObject({ mode: 4, log: ['stop 11', 'loop 13'] }); // 60
    const plain = end([0, 0, 10]); // 50
    expect(plain.mode).toBe(6);
    run(plain.g, 15);
    expect(plain.g.phase).toBe('result');
    // The sad penguin plays Panel #85 (6 frames) four times, then stops its music.
    const sad = end([0, 0, 1]);
    run(sad.g, 22);
    expect(sad.g.phase).toBe('play');
    sad.g.tick();
    expect(sad.log.at(-1)).toBe('stop 14');
    expect(sad.g.phase).toBe('result');
  });
});

describe('射氣球 (13 §3)', () => {
  it('lets balloons up from free columns: kinds by rand() % 1000', () => {
    const { log, sound } = recorder();
    // Slot 0: 13 → kind 3 in free column 2 (x 200); slot 1: 21 → kind 8 in the first free one (40); slot 2: 28, then
    // 9 → the surprise 11, in free column 2 of 120, 280, 360 … (360); 999 is nothing.
    const g = new Balloons(seq(13, 2, 21, 0, 28, 9, 2, 999), sound);
    ready(g);
    g.tick();
    expect(g.slots.slice(0, 3).map(b => [b.x, b.y, b.w])).toEqual([[200, 420, 3], [40, 420, 8], [360, 420, 11]]);
    expect(log).toEqual(['play 19', 'play 19', 'play 19']);
    g.tick();
    expect(g.slots.slice(0, 3).map(b => b.y)).toEqual([405, 396, 402]);
  });

  it('scores a burst: kind + 1 up to 999, ×2 unbounded, ÷2, and the surprise', () => {
    const { log, sound } = recorder();
    const g = new Balloons(seq(999), sound);
    ready(g);
    const put = (w: number) => Object.assign(g.slots[0], { x: 200, y: 200, w });
    put(8); g.click(200, 200);
    expect(g.score).toBe(9);
    expect(log).toEqual(['play 21']);
    expect(g.slots[0].w).toBe(0x3c);
    run(g, 1);
    expect(g.sprites.map(s => s.frame)).toEqual([13]);
    run(g, 2);
    expect(g.slots[0].x).toBe(0);
    g.score = 990; put(5); g.click(222, 230); expect(g.score).toBe(996);
    put(4); g.click(200, 200); expect(g.score).toBe(999);
    put(9); g.click(200, 200); expect(g.score).toBe(1998);
    put(10); g.click(200, 200); expect(g.score).toBe(999);
    // Small balloons (kind ≥ 6) have the ±18×±26 box.
    put(7); log.length = 0; g.click(219, 200);
    expect(g.score).toBe(999);
    expect(log).toEqual(['play 20']);
  });

  it('a finger near a balloon bursts the nearest one only (remake touch tolerance)', () => {
    const g = new Balloons(seq(999));
    ready(g);
    Object.assign(g.slots[0], { x: 200, y: 200, w: 7 }); // small 8: ±18×±26
    Object.assign(g.slots[1], { x: 280, y: 200, w: 0 }); // big 1, the next column
    g.click(225, 200, 0); // a mouse just beside the small one: a miss, as in the original
    expect(g.score).toBe(0);
    g.click(225, 200, 20); // a finger: the nearest balloon (the small one) bursts, not its neighbour
    expect(g.score).toBe(8);
    expect(g.slots[0].w).toBe(0x3c);
    expect(g.slots[1].w).toBe(0);
  });

  it('the surprise: end, freeze 2 s, fast, slow, score 0, score ×2', () => {
    const surprise = (r: number) => {
      const g = new Balloons(seq(...new Array(16).fill(999), r, 999));
      ready(g);
      g.tick();
      g.score = 10;
      Object.assign(g.slots[0], { x: 120, y: 100, w: 11 });
      g.click(120, 100);
      return g;
    };
    expect(surprise(0).ticks).toBe(1);
    expect(surprise(1).freeze).toBe(20);
    expect(surprise(2).speed).toBe(-1);
    expect(surprise(3).speed).toBe(1);
    expect(surprise(4).score).toBe(0);
    expect(surprise(5).score).toBe(20);
  });

  it('after the time no new balloons; when the last is gone the score shows 2 s', () => {
    const g = new Balloons(msvc(3));
    ready(g);
    run(g, 150);
    expect(g.ticks).toBe(0);
    let n = 0;
    while (g.phase === 'play' && n < 100) { g.tick(); n++; }
    expect(g.phase).toBe('result');
    expect(g.slots.every(b => !b.x)).toBe(true);
    run(g, 19);
    expect(g.phase).toBe('result');
    g.tick();
    expect(g.phase).toBe('done');
  });
});

/** Panel #100 (阿土伯): 5 poses, 10 frames walking left, 10 right (manifest boxes, rounded). */
const BODY: Box[] = [
  ...new Array(5).fill({ w: 66, h: 72, ax: 33, ay: 71 }),
  ...new Array(10).fill({ w: 77, h: 74, ax: 43, ay: 72 }),
  ...new Array(10).fill({ w: 76, h: 73, ax: 34, ay: 72 }),
];

describe('喜從天降 (13 §4)', () => {
  it('throws one gift every six ticks walking 110..530, drifting outward', () => {
    const g = new Gifts(BODY, 100, msvc(5));
    ready(g);
    const xs = new Set<number>();
    for (let i = 0; i < 300; i++) { g.tick(); xs.add(g.thrower.x); expect(g.thrower.x % 12).toBe(110 % 12); }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(110);
    expect(Math.max(...xs)).toBeLessThanOrEqual(530);
    // A gift thrown at x 530 drifts 50 px out by the floor, one thrown at 320 not at all.
    const h = new Gifts(BODY, 100, () => 0);
    (h as unknown as { spawn(x: number, b: boolean): void }).spawn(530, false);
    (h as unknown as { spawn(x: number, b: boolean): void }).spawn(320, false);
    expect(h.items.slice(0, 2).map(i => [i.x, i.y, i.vy, i.w])).toEqual([[530, 100, -16, (50 << 8) | 3], [320, 100, -16, 3]]);
  });

  it('catches only once the catcher has moved; scores 10/5/3/1', () => {
    const g = new Gifts(BODY, 100, () => 32767); // the god of wealth throws coins (rand() % 20 = 7) far from the catcher
    ready(g);
    const drop = (kind: number) => Object.assign(g.items[15], { x: 320, y: 340, w: kind, vy: 0 });
    drop(0);
    g.tick();
    expect(g.counts[0]).toBe(0); // standing still since the start: dir 0 never catches
    g.aim(330); g.tick(); g.tick(); // one step right (to 330), then within 8 px: stays, still facing right
    expect(g.dir).toBe(2);
    expect(g.px).toBe(330);
    for (const k of [0, 1, 2, 3]) { Object.assign(g.items[15], { x: 330, y: 340, w: k, vy: 0 }); g.tick(); }
    expect(g.counts).toEqual([1, 1, 1, 1]);
    expect(g.score).toBe(19);
  });

  it('a caught bomb blasts (Data#526, 8 ticks) and ends the game in the hurt pose', () => {
    const { log, sound } = recorder();
    const g = new Gifts(BODY, 100, () => 0, sound);
    ready(g);
    g.aim(330); g.tick();
    Object.assign(g.items[15], { x: 330, y: 340, w: 4, vy: 0 });
    g.tick();
    expect(g.boom).toMatchObject({ x: 275, y: 295 });
    expect(log).toContain('play 15');
    expect(g.pose).toBe(4);
    let n = 0;
    while (g.phase === 'play' && n < 50) { g.tick(); n++; }
    expect(g.phase).toBe('result');
    expect(g.sprites.find(s => s.id === 100)?.frame).toBe(4);
  });

  it('runs 360 ticks; the clock shows half of them', () => {
    const g = new Gifts(BODY, 100, msvc(9));
    expect(g.hud().slice(0, 4).map(s => s.frame)).toEqual([1, 8, 0, 0]);
    ready(g);
    run(g, 360);
    expect(g.ticks).toBe(0);
  });
});
