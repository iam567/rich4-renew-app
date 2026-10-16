import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { runWheel, wheelValue, WHEEL_AUTO_STOP, WHEEL_CELLS, WHEEL_HOLD_FRAMES, WheelKind } from './wheel';

describe('wheel fcn_0043f7c6 (02 §4.4)', () => {
  it('a computer stops on the first numbered cell at or after start + 39 (= start + 3)', () => {
    for (let kind = 0; kind < 4; kind++) {
      for (let start = 0; start < 12; start++) {
        const run = runWheel(kind, start);
        let c = (start + 3) % 12;
        while (WHEEL_CELLS[kind][c] === 0xff) c = (c + 1) % 12;
        expect(run.cell).toBe(c);
        expect(run.value).toBe(WHEEL_CELLS[kind][c]);
        expect(run.value).toBe(wheelValue(kind, start));
      }
    }
  });

  it('turns one cell per frame until the stop, then 12 cells at 1,1,1,2,2,2,3,3,3,4,4,4 frames, then every 5', () => {
    // Hotel from cell 9, stopped at frame 11: frames 0..10 show 10, 11, 0 … 8; the stop frame does not move.
    const run = runWheel(WheelKind.hotel, 9, 11);
    expect(run.cells.slice(0, 12)).toEqual([10, 11, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8]);
    const moves: number[] = [];
    for (let f = 12; f < run.cells.length; f++) if (run.cells[f] !== run.cells[f - 1]) moves.push(f - 11);
    // 12 cells bring it back to 8 (empty) at stop + 30; then 9 (empty) at +35 and 10 = 2 days at +40.
    expect(moves).toEqual([1, 2, 3, 5, 7, 9, 12, 15, 18, 22, 26, 30, 35, 40]);
    expect(run.result).toBe(51);
    expect(run.cell).toBe(10);
    expect(run.value).toBe(2);
    // Cell 7 (3 days) itself: it stops as soon as the slow turn is over.
    expect(runWheel(WheelKind.hotel, 9, 10)).toMatchObject({ cell: 7, value: 3, result: 40 });
    expect(run.end).toBe(run.result + WHEEL_HOLD_FRAMES);
    expect(run.cells).toHaveLength(run.end + 1);
  });

  it('stops at once (after the full slow turn) when the stop cell is numbered', () => {
    const run = runWheel(WheelKind.shopping, 0, WHEEL_AUTO_STOP); // 0 + 39 = cell 3 (empty) → cell 4 = ×5
    expect(run.value).toBe(5);
    const fast = runWheel(WheelKind.shopping, 1, WHEEL_AUTO_STOP); // cell 4 directly
    expect(fast.result).toBe(WHEEL_AUTO_STOP + 30);
    expect(fast.value).toBe(5);
  });

  it("a human's stop frame picks the cell; a bad answer falls back to the computer's frame", () => {
    for (let stop = 1; stop < 40; stop++) expect(runWheel(WheelKind.insurance, 5, stop).value).toBe(wheelValue(WheelKind.insurance, 5, stop));
    expect(runWheel(WheelKind.travel, 2, NaN).stop).toBe(WHEEL_AUTO_STOP);
    expect(runWheel(WheelKind.travel, 2, 0).stop).toBe(1);
  });

  it('the computer outcome frequencies follow the empty cells before each number', () => {
    const count = new Map<number, number>();
    for (let start = 0; start < 12; start++) {
      const v = runWheel(WheelKind.hotel, start).value;
      count.set(v, (count.get(v) ?? 0) + 1);
    }
    // ·,·,1,·,·,4,·,3,·,·,2,· : 1 day 4/12, 4 days 3/12, 3 days 2/12, 2 days 3/12.
    expect(Object.fromEntries(count)).toEqual({ 1: 4, 4: 3, 3: 2, 2: 3 });
  });
});

describe('Game.spin', () => {
  it('makes one rand() call and asks only a human', async () => {
    const { Game } = await import('../game');
    const g = Object.create(Game.prototype) as InstanceType<typeof Game>;
    const human = { id: 0, whoPlays: 1, autopilot: false, sleepwalk: 0 };
    const cpu = { id: 1, whoPlays: 2, autopilot: false, sleepwalk: 0 };
    Object.assign(g, { rng: new Rng(77), players: [human, cpu], current: 1 });
    const r = new Rng(77), start = r.rand() % 12;
    const flow = g.spin(WheelKind.hotel, '阿土伯');
    const fx = flow.next().value as object;
    expect('ask' in fx).toBe(false);
    expect(fx).toMatchObject({ t: 'fx', kind: 'wheel', p: 1, data: { wheel: 1, name: '阿土伯', human: false, start, stop: WHEEL_AUTO_STOP } });
    const done = flow.next();
    expect(done).toEqual({ done: true, value: wheelValue(WheelKind.hotel, start) });
    expect(g.rng.seed).toBe(r.seed);

    g.current = 0;
    const h = g.spin(WheelKind.shopping, '孫小美');
    const q = h.next().value;
    const start2 = r.rand() % 12;
    expect(q).toEqual({ t: 'wheel', p: 0, kind: 2, name: '孫小美', start: start2, ask: true });
    h.next(7);
    expect(h.next()).toEqual({ done: true, value: wheelValue(WheelKind.shopping, start2, 7) });
  });
});
