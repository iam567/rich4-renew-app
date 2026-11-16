import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { haveSimMaps, simMapFile } from './ai-sim';
import { Realtime, RT, RT_HITS } from './realtime';
import { loadGame, saveGame } from './save';
import type { Ask } from './types';

// 即時制 (docs/rules/31): lanes side by side on one logical clock.
/** Seats played by the computer are humans on 托管, as in the simulations: the game goes on to the last one standing. */
function make(mapId = 0, seed = 11, humans: boolean[] = [false, false, false, false]) {
  const g = new Game({ mapId, players: [0, 4, 9, 11].map(character => ({ character, human: true })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed }, parseBoard(JSON.parse(readFileSync(simMapFile(mapId), 'utf8')) as RawMap));
  g.players.forEach((p, i) => { p.autopilot = !humans[i]; });
  return g;
}
const digest = (g: Game) => JSON.stringify([g.rng.seed, g.daysElapsed, g.priceIndex, g.players.map(p => [p.cash, p.bank, p.node, p.bankrupt, p.cards.length, p.points]), g.board.lands.map(l => [l.owner, l.level])]);
/** Answers every question of a human the plain way: roll, decline. */
function autoAnswer(q: Ask) { return q.t === 'turn' ? { dice: 1 } : q.t === 'yesno' ? false : undefined; }

describe.skipIf(!haveSimMaps([0, 2, 3, 7]))('即時制 clock', () => {
  it('computers play 20 minutes on each map: days pass every 12 s, everyone moves many times', () => {
    for (const map of [0, 2, 3, 7]) {
      const g = make(map, 100 + map), rt = new Realtime(g, { length: 20 * 60_000 });
      const moves = [0, 0, 0, 0];
      for (let t = 0; !g.over && t <= 20 * 60_000 + 1000; t += 250) for (const e of rt.advance(t)) if (e.step.t === 'dice') moves[(e.step as { p: number }).p]++;
      expect(g.over).not.toBeNull();
      // to the time's end, unless all but one went bankrupt first
      if (g.players.filter(p => p.bankrupt).length < 3) expect(g.daysElapsed).toBeGreaterThanOrEqual(95);
      expect(g.daysElapsed).toBeLessThanOrEqual(100);
      // a computer moves every 4–5.5 s and a walk: about 110–130 moves in 20 minutes
      for (const n of moves) expect(n).toBeGreaterThan(80);
    }
  });

  it('the same game whatever the screen’s frame rate (16 ms or 1 s steps)', () => {
    const a = make(2, 7), b = make(2, 7);
    const ra = new Realtime(a, { length: 5 * 60_000 }), rb = new Realtime(b, { length: 5 * 60_000 });
    for (let t = 0; t <= 5 * 60_000 + 100; t += 16) ra.advance(t);
    for (let t = 0; t <= 5 * 60_000 + 100; t += 1000) rb.advance(t);
    expect(digest(a)).toBe(digest(b));
    const c = make(2, 8), rc = new Realtime(c, { length: 5 * 60_000 });
    for (let t = 0; t <= 5 * 60_000 + 100; t += 1000) rc.advance(t);
    expect(digest(c)).not.toBe(digest(a));
  });

  it('a human not answering holds only their own lane: the days and the computers go on', () => {
    const g = make(0, 5, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    rt.advance(20_000);
    expect(rt.asks().map(x => [x.lane, x.q.t])).toEqual([[0, 'turn']]);
    expect(g.players[0].placed).toBe(true);   // airdropped, then asked
    const moved = g.players.slice(1).map(p => p.node);
    rt.advance(25_000);
    expect(g.players.slice(1).map(p => p.node)).not.toEqual(moved);
    // the answer goes on at once; a stale id is refused
    const [{ id }] = rt.asks();
    expect(rt.answer(id, { dice: 1 })).toBe(true);
    expect(rt.answer(id, { dice: 1 })).toBe(false);
    const ev = rt.advance(26_000);
    expect(ev.some(e => e.lane === 0 && e.step.t === 'dice')).toBe(true);
  });

  it('a turn not moved for RT.move rolls by itself, and says so', () => {
    const g = make(0, 5, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    rt.advance(1_000);
    const [ask] = rt.asks();
    expect(ask.q.t).toBe('turn');
    // the card screen opened from the turn: closed when the time is up (from the turn's start), then the dice
    rt.answer(ask.id, { action: 'card' });
    rt.advance(RT.move - 1_000);
    expect(rt.asks().some(a => a.lane === 0)).toBe(true);
    const ev = rt.advance(RT.move + 2_000);
    expect(ev.some(e => e.lane === 0 && e.step.t === 'fx' && e.step.kind === 'rt-timeout')).toBe(true);
    expect(ev.some(e => e.lane === 0 && e.step.t === 'dice')).toBe(true);
  });

  it('a shop not left for RT.indoors closes by itself; meanwhile the player is indoors', () => {
    const g = make(0, 6, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    rt.advance(1_000);
    const [ask] = rt.asks();
    expect(ask.q.t).toBe('turn');
    // one step (烏龜) from a square next to the shop onto it
    const shop = g.board.nodes.find(n => n.event === 15 && g.board.nodes.some(m => m.adjacent.filter(Boolean).length === 2 && m.adjacent.includes(n.id)))!;
    const before = g.board.nodes.find(m => m.adjacent.filter(Boolean).length === 2 && m.adjacent.includes(shop.id))!;
    const a = g.players[0];
    a.node = before.id; a.lastNode = before.adjacent.find(x => x && x !== shop.id)!; a.turtle = 3;
    rt.answer(ask.id, { dice: 1 });
    rt.advance(3_000);
    expect(a.node).toBe(shop.id);
    expect(rt.asks().find(x => x.lane === 0)?.q.t).toBe('shop');
    expect(g.rt!.isIndoors(0)).toBe(true);
    const lim = rt.limitOf(0)!;
    expect(lim.what).toBe('indoors');
    rt.advance(lim.at - 100);
    expect(g.rt!.isIndoors(0)).toBe(true);
    const ev = rt.advance(lim.at + 1_000);
    expect(ev.some(e => e.lane === 0 && e.step.t === 'fx' && e.step.kind === 'rt-timeout' && (e.step.data as { what: string }).what === 'indoors')).toBe(true);
    expect(g.rt!.isIndoors(0)).toBe(false);
    expect(rt.asks().some(x => x.lane === 0 && x.q.t === 'shop')).toBe(false);
  });

  it('簡單: hit once, then 保護中 till their roll; 中等 twice; 困難 no limit', () => {
    for (const [level, hits] of [[0, 1], [1, 2], [2, 5]] as const) {
      const g = make(0, 6, [true, false, false, false]);
      g.settings.aiLevel = level;
      const rt = new Realtime(g, { length: 0 });
      for (const p of g.players) { p.placed = true; p.whoPlays = p.human && !p.autopilot ? 1 : 2; }
      const roads = g.board.nodes.filter(n => n.adjacent.some(Boolean));
      g.players.forEach((p, i) => { p.node = roads[10 + 15 * i].id; });
      const [a, b] = g.players;
      const play = (id: number) => { b.cards = [id]; const f = g.cards.playAs(b, id, a.id); let r = f.next(); while (!r.done) r = f.next(); return r.value; };
      const got: boolean[] = [];
      for (let k = 0; k < 5; k++) { a.prison = 0; a.sleepwalk = 0; got.push(play(26)); } // 查稅卡 five times
      expect(got.filter(Boolean).length).toBe(hits);
      expect(rt.guarded(a.id)).toBe(Number.isFinite(RT_HITS[level]));
    }
    // 派對模式: no limit at any level
    const g = make(0, 6, [true, false, false, false]);
    g.settings.aiLevel = 0; g.settings.party = true;
    const rt = new Realtime(g, { length: 0 });
    for (const p of g.players) { p.placed = true; p.whoPlays = p.human && !p.autopilot ? 1 : 2; }
    for (let k = 0; k < 4; k++) g.rt!.struck(0);
    expect(rt.guarded(0)).toBe(false);
  });

  it('indoors (a shop …): out of reach of cards and missile locks, and out by itself after RT.indoors', () => {
    const g = make(0, 6, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    for (const p of g.players) { p.placed = true; p.whoPlays = p.human && !p.autopilot ? 1 : 2; }
    const [a, b] = g.players;
    const roads = g.board.nodes.filter(n => n.adjacent.some(Boolean));
    g.players.forEach((p, i) => { p.node = roads[10 + 15 * i].id; });
    g.rt!.indoors(a.id, 1);
    expect(g.rt!.isIndoors(a.id)).toBe(true);
    // 陷害卡 by the computer at a: not played, kept
    b.cards = [17];
    const play = g.cards.playAs(b, 17, a.id);
    let r = play.next();
    while (!r.done) r = play.next();
    expect(r.value).toBe(false);
    expect(b.cards).toEqual([17]);
    // a missile has nobody to lock on but the computers
    b.tools[6] = 1;
    const fire = g.tools.use(b, 7, a.node);
    for (let s = fire.next(); !s.done; s = fire.next()) expect((s.value as { kind?: string }).kind).not.toBe('missile-lock');
    g.rt!.indoors(a.id, -1);
    expect(g.rt!.isIndoors(a.id)).toBe(false);
    void rt;
  });

  it('a human answering at once moves about every 5–6 s', () => {
    const g = make(0, 9, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    let rolls = 0;
    for (let t = 0; t <= 120_000; t += 50) {
      for (const e of rt.advance(t)) if (e.lane === 0 && e.step.t === 'dice') rolls++;
      for (const a of rt.asks()) if (a.lane === 0 || a.q.p === 0) rt.answer(a.id, autoAnswer(a.q));
    }
    expect(rolls).toBeGreaterThan(10);
    expect(rolls).toBeLessThan(40);
  });

  it('a stay lasts its days at 6 s each; a move is followed by the 2 s cooldown', () => {
    const g = make(0, 3), rt = new Realtime(g, { length: 0 });
    let t = 10_000;
    rt.advance(t);
    while (rt.busy(1)) rt.advance(t += 10);
    g.players[1].hotel = 2; g.players[1].facility = 0;
    const turns: { at: number; moved: boolean }[] = [];
    for (; t < 80_000; t += 10) for (const e of rt.advance(t)) {
      if (e.lane !== 1) continue;
      if (e.step.t === 'turn') turns.push({ at: e.at, moved: false });
      if (e.step.t === 'dice' && turns.length) turns[turns.length - 1].moved = true;
    }
    const stays = turns.findIndex(x => x.moved);
    expect(stays).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < stays; k++) expect(turns[k].at - turns[k - 1].at).toBe(RT.stay);
    // the turn that leaves starts a day later too (its 'turn' comes after the check-out)
    expect(turns[stays].at - turns[stays - 1].at).toBeGreaterThanOrEqual(RT.stay);
    expect(turns[stays].at - turns[stays - 1].at).toBeLessThan(RT.stay + 1000);
    // after a move: the 2 s cooldown and a computer's 0.8–1.8 s
    const gap = turns[stays + 1].at - turns[stays].at;
    expect(gap).toBeGreaterThan(RT.cool);
  });

  it('a save goes on from its clock: days, the time limit and the turns', () => {
    const g = make(0, 13), rt = new Realtime(g, { length: 10 * 60_000 });
    rt.advance(100_000);
    g.rtNow = rt.now;
    const h = loadGame(saveGame(g));
    expect(h.rtNow).toBe(100_000);
    const r2 = new Realtime(h, { length: 10 * 60_000 });
    expect(r2.now).toBe(100_000);
    const day = h.daysElapsed;
    let rolls = 0;
    for (let t = 100_000; t <= 125_000; t += 100) for (const e of r2.advance(t)) if (e.step.t === 'dice') rolls++;
    expect(h.daysElapsed).toBe(day + 2);   // 108 s and 120 s
    expect(rolls).toBeGreaterThan(4);
    for (let t = 125_000; !h.over && t <= 10 * 60_000 + 1000; t += 1000) r2.advance(t);
    expect(h.over).not.toBeNull();
    expect(h.daysElapsed).toBeLessThanOrEqual(50);
  });

  it('each bankruptcy doubles the price index', () => {
    const g = make(3, 21), rt = new Realtime(g, { length: 0 });
    let last = g.priceIndex, broke = 0;
    for (let t = 0; t < 4 * 3600_000 && !g.over; t += 1000) {
      const before = g.priceIndex;
      rt.advance(t);
      const n = g.players.filter(p => p.bankrupt).length;
      if (n > broke) { expect(g.priceIndex).toBeGreaterThanOrEqual(before * 2 ** (n - broke)); broke = n; }
      last = g.priceIndex;
    }
    expect(g.over).not.toBeNull();
    expect(broke).toBe(3);
    expect(last).toBeGreaterThanOrEqual(8);
  });
});

describe.skipIf(!haveSimMaps([0]))('即時制 rules', () => {
  /** Drives a flow by hand: answers in order, returns the steps. */
  const drive = (flow: Generator<import('./types').Step, unknown, unknown>, answers: unknown[] = []) => {
    const out: import('./types').Step[] = [];
    let r = flow.next();
    while (!r.done) { out.push(r.value); r = flow.next('ask' in r.value ? answers.shift() as never : undefined); }
    return out;
  };

  it('two on one lot: the first has 5 s, the second queues, then buys; the first’s late yes buys nothing', () => {
    const g = make(0, 4, [true, true, false, false]), rt = new Realtime(g, { length: 0 });
    for (const p of g.players) { p.placed = true; p.whoPlays = p.human && !p.autopilot ? 1 : 2; p.cash = 1e6; }
    const land = g.board.lands.find(l => !l.owner)!;
    const [a, b] = g.players;
    const first = g.landOnLot(a, land);
    expect(first.next().value).toMatchObject({ t: 'yesno', p: 0 });   // a decides (no answer yet)
    const second = g.landOnLot(b, land);
    expect(second.next().value).toMatchObject({ t: 'choose', p: 1 });   // b: 排隊等 / 繼續走
    expect(second.next(1 as never).value).toMatchObject({ t: 'fx', kind: 'rt-wait' });
    rt.now += 5_000;                                                      // a's 5 s are over
    expect(second.next().value).toMatchObject({ t: 'yesno', p: 1 });
    drive(second as never, []);                                           // (the yes below)
    expect(land.owner).toBe(0);
    const third = g.landOnLot(b, land);
    expect(third.next().value).toMatchObject({ t: 'yesno', p: 1 });       // a is past its 5 s: b is offered at once
    const s3 = third.next(true as never);
    expect(land.owner).toBe(2);
    expect(s3.value).toMatchObject({ t: 'buy', p: 1 });
    const cash = a.cash;
    const late: unknown[] = [first.next(true as never).value];
    for (let r = first.next(); !r.done; r = first.next()) late.push(r.value);
    expect(late.some(x => (x as { t?: string }).t === 'say' && /買走/.test((x as { text: string }).text))).toBe(true);
    expect(land.owner).toBe(2);
    expect(a.cash).toBe(cash);
  });

  it('a computer finding a lot someone decides on walks on', () => {
    const g = make(0, 4, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    for (const p of g.players) { p.placed = true; p.whoPlays = p.human && !p.autopilot ? 1 : 2; p.cash = 1e6; }
    const land = g.board.lands.find(l => !l.owner)!;
    const first = g.landOnLot(g.players[0], land);
    first.next();
    expect(drive(g.landOnLot(g.players[1], land) as never)).toEqual([]);
    expect(land.owner).toBe(0);
    void rt;
  });

  it('the missile locks on a player and falls 3 s later where they stand then', () => {
    const g = make(0, 4, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    for (const p of g.players) { p.placed = true; p.whoPlays = p.human && !p.autopilot ? 1 : 2; }
    const [a, b] = g.players;
    a.tools[6] = 1;
    const roads = g.board.nodes.filter(n => n.adjacent.some(Boolean));
    b.node = roads[5].id;
    const flow = g.tools.use(a, 7);
    expect(flow.next().value).toMatchObject({ t: 'choose' }); // a spot on the road, or a player
    expect(flow.next(1 as never).value).toMatchObject({ t: 'pick-player', anywhere: true });
    expect(flow.next(1 as never).value).toMatchObject({ t: 'fx', kind: 'missile-lock', target: 1 });
    let waits = 0, r = flow.next();
    while (!r.done && (r.value as { kind?: string }).kind === 'rt-wait') { waits++; if (waits === 6) b.node = roads[40].id; r = flow.next(); }
    expect(waits * 250).toBe(RT.missile);
    const n = g.node(roads[40].id);
    expect(r.value).toMatchObject({ t: 'fx', kind: 'missile', data: { x: n.x, y: n.y } });
    expect(a.tools[6]).toBe(0);
    void rt;
  });

  it('a card outside the turn: opened on the second lane, then 5 s before the next', () => {
    const g = make(0, 4, [true, false, false, false]), rt = new Realtime(g, { length: 0 });
    rt.advance(30_000);
    const a = g.players[0];
    a.cards = [1, 1];
    expect(rt.act(0, 'card')).toBe(0);
    const q = rt.asks().find(x => x.side)!;
    expect(q.q).toMatchObject({ t: 'choose', title: '使用卡片' });
    rt.answer(q.id, 0);
    rt.advance(30_100);
    expect(a.cards.length).toBe(1);
    expect(rt.act(0, 'card')).toBeGreaterThan(4_000);
    rt.advance(35_200);
    expect(rt.act(0, 'card')).toBe(0);
    // the market is never held back
    const m = rt.asks().find(x => x.side)!;
    rt.answer(m.id, -1);
    rt.advance(35_300);
    expect(rt.act(0, 'stock')).toBe(0);
  });
});
