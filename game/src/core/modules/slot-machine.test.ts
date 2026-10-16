import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { Game } from '../game';
import { pack } from '../date';
import { Rng } from '../rng';
import type { Flow } from '../flow';
import type { Answer, Ask, GameEvent, GameSettings } from '../types';
import { OBJ } from './objects';
import { runSlotMachine, SLOT_AUTO_PULL, SLOT_RESULT_FRAMES } from './slot-machine';
import { slotBonus } from './slot-machine';

/** rand() replaying fixed values (then repeating the last one), counting calls. */
function fixed(values: number[]) {
  let i = 0;
  const f = () => values[Math.min(i++, values.length - 1)];
  return Object.assign(f, { calls: () => i });
}

describe('slot machine (fcn_0043f23e)', () => {
  it('calls rand() four times on frame 0 and every 10th frame until the lever is pulled', () => {
    for (const [pull, calls] of [[1, 4], [9, 4], [10, 8], [19, 8], [20, 12], [SLOT_AUTO_PULL, 16], [40, 20], [123, 52]]) {
      for (const big of [false, true]) {
        const r = new Rng(5);
        expect(runSlotMachine(() => r.rand(), big, pull).randCalls).toBe(calls);
      }
    }
    // A computer pulls in frame 39: 16 calls.
    const f = fixed([0]);
    runSlotMachine(f, false);
    expect(f.calls()).toBe(16);
  });

  it('every reel ends on a digit (an even position); the amount reads hundreds, tens, ones (+ thousands when big)', () => {
    const rng = new Rng(2024);
    for (let i = 0; i < 300; i++) {
      for (const big of [false, true]) {
        const s = runSlotMachine(() => rng.rand(), big, 1 + (i % 60));
        const last = s.reels[s.end];
        for (let r = big ? 0 : 1; r < 4; r++) expect(last[r] % 2).toBe(0);
        const [th, h, t, o] = last.map(p => p >> 1);
        expect(s.digits).toEqual([th, h, t, o]);
        expect(s.amount).toBe(h * 100 + t * 10 + o + (big ? th * 1000 : 0));
        expect(s.amount).toBeLessThanOrEqual(big ? 9999 : 999);
      }
    }
  });

  it('the computer path: ones digit = last rand() % 10 + 1 (10 + 4 + 7 positions after the frame-30 draw)', () => {
    // Frame 30 draws 2r+1; frames 30..39 move it 10, the lever's 4 frames 4 more (2r+15, odd: reel 3 starts to
    // stop at once), the slow-down 7 more: 2r+22 ≡ 2r+2, digit r+1.
    for (let r = 0; r < 10; r++) {
      const s = runSlotMachine(fixed([r]), false);
      expect(s.digits[3]).toBe((r + 1) % 10);
    }
  });

  it('timeline: lever back up 4 frames after the pull, reels stop right to left, result held 40 frames', () => {
    const r = new Rng(77);
    const s = runSlotMachine(() => r.rand(), true, SLOT_AUTO_PULL);
    expect(s.leverUp).toBe(SLOT_AUTO_PULL + 4);
    expect(s.stopped[3]).toBeGreaterThan(s.leverUp);
    expect(s.stopped[2]).toBeGreaterThan(s.stopped[3]);
    expect(s.stopped[1]).toBeGreaterThan(s.stopped[2]);
    expect(s.stopped[0]).toBeGreaterThan(s.stopped[1]);
    expect(s.result).toBe(s.stopped[0] + 1);
    expect(s.end).toBe(s.result + SLOT_RESULT_FRAMES);
    expect(s.reels).toHaveLength(s.end + 1);
    // A stopped reel does not move again.
    for (let i = 3; i >= 0; i--) for (let f = s.stopped[i]; f <= s.end; f++) expect(s.reels[f][i]).toBe(s.reels[s.stopped[i]][i]);
    // Three reels: reel 0 is never drawn (only re-drawn by rand()), the result follows reel 1.
    const small = runSlotMachine(() => r.rand(), false, 12);
    expect(small.stopped[0]).toBe(-1);
    expect(small.result).toBe(small.stopped[1] + 1);
  });

  it('is uniform enough: each digit of a big amount appears about 10 % of the time', () => {
    const rng = new Rng(9), hist = [0, 0, 0, 0].map(() => new Array(10).fill(0));
    for (let i = 0; i < 5000; i++) runSlotMachine(() => rng.rand(), true).digits.forEach((d, r) => hist[r][d]++);
    for (const h of hist) for (const n of h) expect(Math.abs(n - 500)).toBeLessThan(110);
  });

  it('same seed, same pull, same amount (regression values)', () => {
    const amounts = [false, true].flatMap(big => [1, 10, 39, 100].map(pull => { const r = new Rng(123); return runSlotMachine(() => r.rand(), big, pull).amount; }));
    expect(amounts).toEqual([155, 245, 180, 783, 9155, 245, 8180, 5783]);
  });
});

// ---------------------------------------------------------------- the gods

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

function newGame(seed = 99): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  const g = new Game(settings, board);
  for (const p of g.players) {
    const n = g.randomFreeNode();
    Object.assign(p, { placed: true, whoPlays: 2, node: n.id, lastNode: n.adjacent.find(Boolean)! });
  }
  return g;
}

function drive<T>(flow: Flow<T>, answer: (a: Ask) => Answer = () => undefined) {
  const events: GameEvent[] = [], asks: Ask[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) { asks.push(s); r = flow.next(answer(s)); } else { events.push(s); r = flow.next(); }
  }
  return { events, asks, value: r.value };
}

const slotFx = (events: GameEvent[]) => events.find((e): e is Extract<GameEvent, { t: 'fx' }> => e.t === 'fx' && e.kind === 'slot-machine');

/** Puts a god of `type` under player 0 (placing it first when it is not on the map). */
function onGod(g: Game, type: number) {
  const p = g.players[0];
  let o = g.objects.slots[type - 1];
  if (!o.node) {
    const free = g.randomFreeNode();
    expect(g.objects.place(type, free.id)).toBe(true);
    o = g.objects.slots[type - 1];
  }
  p.node = o.node;
  return p;
}

describe.skipIf(!haveMaps)('gods use the slot machine', () => {
  it('a computer: no question, the lever at frame 39, the amount from the same rand() calls', () => {
    const g = newGame(5), p = onGod(g, OBJ.SmallWealth);
    g.current = 0;
    const copy = new Rng(g.rng.seed), want = runSlotMachine(() => copy.rand(), false, SLOT_AUTO_PULL);
    const before = g.players.map(q => q.cash + q.bank), cash = p.cash;
    const { asks, events } = drive(g.objects.step(p, 0));
    expect(asks).toEqual([]);
    const fx = slotFx(events)!;
    expect(fx.data).toMatchObject({ god: OBJ.SmallWealth, big: false, human: false, amount: want.amount, pull: SLOT_AUTO_PULL, end: want.end });
    for (const q of g.players.slice(1)) expect(before[q.id] - (q.cash + q.bank)).toBe(want.amount);
    expect(p.cash - cash).toBe(3 * want.amount);
    expect(events.some(e => e.t === 'fx' && e.kind === 'god-line')).toBe(want.amount > 700);
  });

  it('a human taps: the answer is the pull frame, and rand() is called for every 10 frames spun', () => {
    for (const pull of [3, 27]) {
      const g = newGame(11), p = onGod(g, OBJ.SmallPoor);
      g.current = 0;
      p.whoPlays = 1;
      const copy = new Rng(g.rng.seed), want = runSlotMachine(() => copy.rand(), false, pull);
      const before = g.players.map(q => q.bank);
      const { asks, events } = drive(g.objects.step(p, 0), a => (a.t === 'slot-machine' ? pull : undefined));
      expect(asks).toEqual([{ t: 'slot-machine', p: 0, god: OBJ.SmallPoor, big: false, ask: true }]);
      expect(slotFx(events)!.data).toMatchObject({ amount: want.amount, pull, human: true });
      // 小窮神: you pay every opponent, into their bank.
      for (const q of g.players.slice(1)) expect(q.bank - before[q.id]).toBe(want.amount);
    }
  });

  it('autopilot and sleepwalking humans are pulled for, like a computer', () => {
    for (const set of [{ autopilot: true }, { sleepwalk: 3 }]) {
      const g = newGame(13), p = onGod(g, OBJ.BigPoor);
      g.current = 0;
      Object.assign(p, { whoPlays: 1 }, set);
      const copy = new Rng(g.rng.seed), want = runSlotMachine(() => copy.rand(), true, SLOT_AUTO_PULL);
      const { asks, events } = drive(g.objects.step(p, 0));
      expect(asks).toEqual([]);
      expect(slotFx(events)!.data).toMatchObject({ big: true, amount: want.amount, human: false });
    }
  });

  it('the big wealth god pays 0..9999 into cash; from 5000 the line is [6] or [6 + rand() & 1]', () => {
    let lines = 0;
    for (let seed = 1; seed < 60; seed++) {
      const g = newGame(seed), p = onGod(g, OBJ.BigWealth);
      g.current = 0;
      const copy = new Rng(g.rng.seed), want = runSlotMachine(() => copy.rand(), true, SLOT_AUTO_PULL);
      const expectLine = want.amount >= 9000 ? 6 : want.amount >= 5000 ? 6 + (copy.rand() & 1) : undefined;
      const cash = p.cash;
      const { events } = drive(g.objects.step(p, 0));
      expect(p.cash - cash).toBe(want.amount);
      const line = events.find(e => e.t === 'fx' && e.kind === 'god-line') as Extract<GameEvent, { t: 'fx' }> | undefined;
      expect(line?.data?.line).toBe(expectLine);
      if (expectLine !== undefined) { lines++; expect(g.rng.seed).toBe(copy.seed); }
    }
    expect(lines).toBeGreaterThan(5);
  });
});

describe('slot bonus (house rule)', () => {
  it('doubles a set of equal digits, triples sevens, else 1', () => {
    expect(slotBonus([3, 3, 3])).toBe(2);
    expect(slotBonus([6, 6, 6, 6])).toBe(2);
    expect(slotBonus([7, 7, 7])).toBe(3);
    expect(slotBonus([7, 7, 7, 7])).toBe(3);
    expect(slotBonus([8, 7, 0, 1])).toBe(1);
    expect(slotBonus([7, 7, 1])).toBe(1);
  });
});
