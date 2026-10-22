import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { DOOR_STEP, Game } from '../game';
import { Rng } from '../rng';
import type { Answer, Ask, GameEvent, GameSettings } from '../types';
import { OBJ } from './objects';
import { BAIL, LOTTERY_PRICE } from './places';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

/** A placed game on map 1; characters chosen per test, everyone on the road at a plain node. */
function newGame(players: { character: number; human: boolean }[], seed = 1): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players, fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0,
    startDate: pack(2026, 10, 14), seed,
  };
  const g = new Game(settings, board);
  const road = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref))!;
  for (const p of g.players) {
    p.placed = true; p.whoPlays = p.human ? 1 : 2;
    p.node = road.id; p.lastNode = road.adjacent.find(Boolean)!;
  }
  for (const o of g.objects.slots) o.node = 0;
  return g;
}

/** Runs a flow to the end, answering questions with `answer`. */
function drive<T>(flow: Flow<T>, answer: (a: Ask) => Answer = () => undefined) {
  const events: GameEvent[] = [], asks: Ask[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) { asks.push(s); r = flow.next(answer(s)); } else { events.push(s); r = flow.next(); }
  }
  return { events, asks, value: r.value };
}

/** A seed whose next rand() satisfies a predicate (to steer the computer's coin flips). */
function seedWhere(pred: (r: Rng) => boolean): number {
  for (let s = 1; ; s++) if (pred(new Rng(s))) return s;
}

describe.skipIf(!haveMaps)('places', () => {
  it('starts with thief and robber in prison, hooligan and spy in hospital', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    expect(g.places.npcs.map(n => n.where)).toEqual([1, 1, 2, 2]);
    expect(g.places.npcs[0].node).toBe(g.prisonNode().id);
    expect(g.places.npcs[3].node).toBe(g.hospitalNode().id);
    for (const a of [4, 5, 6, 7]) expect(g.places.npcActive(a)).toBe(false);
    expect(g.places.lottery).toHaveLength(36);
  });

  it('human bails a player for 30 points; hostility falls by days × 100 × F', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    const [p, q] = g.players;
    p.points = 100;
    q.prison = 5;
    q.hostility[0] = 1000;
    const { asks } = drive(g.places.prisonStop(p), a => (a.t === 'choose' ? 1 : undefined));
    expect(asks).toHaveLength(1);
    expect(q.prison).toBe(0x80);
    expect(p.points).toBe(100 - BAIL.player);
    expect(q.hostility[0]).toBe(500);
  });

  it('human bails an NPC for 300 points and becomes its master', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    const p = g.players[0];
    p.points = 350;
    drive(g.places.prisonStop(p), () => 5);
    expect(p.points).toBe(50);
    expect(g.places.npcActive(5)).toBe(true);
    expect(g.places.npcs[1]).toMatchObject({ where: 0, owner: 0, origin: 1 });
    // Not enough points for a second NPC: the option is disabled and nothing happens.
    const { asks } = drive(g.places.prisonStop(p), () => 4);
    expect(asks[0].t === 'choose' && asks[0].options.find(o => o.value === 4)?.disabled).toBe(true);
    expect(g.places.npcs[0].where).toBe(1);
  });

  it('computer bail follows the coin, personality and points rules', () => {
    // 約翰喬 (personality 2) only bails NPCs and needs at least 700 points.
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    const p = g.players[0];
    g.players[1].prison = 3;
    const seed = seedWhere(r => (r.rand() & 1) === 1);
    const mirror = new Rng(seed);
    mirror.rand();
    const pick = [4, 5][mirror.rand() % 2];
    p.points = 699;
    g.rng.reseed(seed);
    drive(g.places.prisonStop(p));
    expect(p.points).toBe(699);
    p.points = 700;
    g.rng.reseed(seed);
    drive(g.places.prisonStop(p));
    expect(p.points).toBe(400);
    expect(g.places.npcs[pick - 4]).toMatchObject({ where: 0, owner: 0 });
    // The computer's bail is announced 「保釋%s」 (ui_prison.asm:1068-1076).
    p.points = 700;
    g.places.npcTo(pick, 'prison');
    g.rng.reseed(seed);
    expect(drive(g.places.prisonStop(p)).events).toContainEqual({ t: 'say', p: undefined, text: `保釋${['小偷', '強盜'][pick - 4]}` });
    expect(g.players[1].prison).toBe(3); // never bails players

    // Coin 0: no bail at all.
    const g2 = newGame([{ character: 7, human: false }, { character: 4, human: false }]);
    g2.players[1].hospital = 3;
    g2.players[0].points = 100;
    g2.rng.reseed(seedWhere(r => (r.rand() & 1) === 0));
    drive(g2.places.hospitalStop(g2.players[0]));
    expect(g2.players[1].hospital).toBe(3);
    // 糖糖 (personality 0) bails a player when it has more than 30 points.
    g2.rng.reseed(seedWhere(r => (r.rand() & 1) === 1));
    drive(g2.places.hospitalStop(g2.players[0]));
    expect(g2.players[1].hospital).toBe(0x80);
    expect(g2.players[0].points).toBe(70);
  });

  it('lottery: computer buys one ticket into the pool; draw pays the whole pool', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    const [p, q] = g.players;
    p.cash = 5000;
    drive(g.places.lotteryStop(p));
    expect(p.cash).toBe(4000);
    expect(g.lotteryPool).toBe(LOTTERY_PRICE);
    expect(g.places.lottery.filter(b => b === 1)).toHaveLength(1);
    q.cash = 1000; // must be more than 1000
    drive(g.places.lotteryStop(q));
    expect(g.places.lottery.filter(b => b === 2)).toHaveLength(0);

    // Holding 11 or more tickets: the number comes from the sold ones, so someone always wins.
    g.places.lottery.fill(0);
    for (let i = 0; i < 11; i++) g.places.lottery[i * 3] = 2;
    g.lotteryPool = 50000;
    const cash = q.cash;
    drive(g.places.lotteryDraw());
    expect(q.cash).toBe(cash + 50000);
    expect(g.lotteryPool).toBe(0);
    expect(g.places.lottery.every(b => b === 0)).toBe(true);

    // Otherwise a uniform number 1..36; no winner keeps the pool and the tickets.
    g.places.lottery[0] = 1;
    g.lotteryPool = 7000;
    const seed = seedWhere(r => r.rand() % 36 + 1 !== 1);
    g.rng.reseed(seed);
    drive(g.places.lotteryDraw());
    expect(g.lotteryPool).toBe(7000);
    expect(g.places.lottery[0]).toBe(1);
    g.rng.reseed(seedWhere(r => r.rand() % 36 + 1 === 1));
    const before = p.cash;
    drive(g.places.lotteryDraw());
    expect(p.cash).toBe(before + 7000);
  });

  it('human lottery: picks an unsold number or cancels', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    const p = g.players[0];
    p.cash = 3000;
    drive(g.places.lotteryStop(p), () => -1);
    expect(p.cash).toBe(3000);
    drive(g.places.lotteryStop(p), () => 17);
    expect(g.places.lottery[16]).toBe(1);
    expect(p.cash).toBe(2000);
    // The ticket screen's question: sold numbers, the pool and the price; a sold number buys nothing.
    g.places.lottery[2] = 2;
    const { asks } = drive(g.places.lotteryStop(p), () => 3);
    expect(asks).toEqual([{ t: 'lottery', p: 0, taken: [3, 17], pool: g.lotteryPool, price: LOTTERY_PRICE, ask: true }]);
    expect(p.cash).toBe(2000);
    expect(g.places.lottery[2]).toBe(2);
  });

  it('lottery draw announces the number, the winner and the prize', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    for (let i = 0; i < 11; i++) g.places.lottery[i] = 2;
    g.lotteryPool = 12000;
    const { events } = drive(g.places.lotteryDraw());
    const fx = events.find(e => e.t === 'fx' && e.kind === 'lottery-draw');
    expect(fx && fx.t === 'fx' && fx.data).toMatchObject({ winner: 1, prize: 12000, pool: 12000 });
    const n = fx && fx.t === 'fx' ? Number(fx.data?.number) : 0;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(11);
  });

  it('bail and magic house questions carry their screen tags', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    const [p, q] = g.players;
    p.points = 100; q.hospital = 2;
    const bail = drive(g.places.hospitalStop(p), () => -1).asks[0];
    expect(bail).toMatchObject({ t: 'choose', screen: 'bail', title: '探病' });
    expect(q.hospital).toBe(2);
    const magic = drive(g.places.magicHouse(p), a => (a.t === 'choose' ? 7 : undefined)).asks[0];
    expect(magic).toMatchObject({ t: 'choose', screen: 'magic', title: '魔法屋' });
  });

  it('mini games: a human plays (the screen answers the score), added to the points as u16', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    const p = g.players[0];
    p.points = 100;
    for (const kind of [6, 7, 8]) {
      const before = p.points, seed = g.rng.seed;
      const { asks, events } = drive(g.places.miniGame(p, kind), a => (a.t === 'mini-game' ? 123 : undefined));
      expect(asks).toEqual([{ t: 'mini-game', p: 0, game: kind, ask: true }]);
      expect(p.points).toBe(before + 123);
      expect(events).toEqual([{ t: 'points', p: 0, amount: 123 }]);
      expect(g.rng.seed).toBe(seed); // the game's own randomness is the screen's, not the rules'
    }
    // The balloons' ×2 is not capped: a big score wraps the u16 points like the original's `add word`.
    p.points = 0xfff0;
    drive(g.places.miniGame(p, 7), () => 0x20);
    expect(p.points).toBe(0x10);
    // Nothing (or nonsense) answered: no points.
    p.points = 5;
    expect(drive(g.places.miniGame(p, 6), () => -1).events).toEqual([{ t: 'points', p: 0, amount: 0 }]);
    expect(p.points).toBe(5);
  });

  it('mini games: computers, autopilot and animation off take rand() % 20 + 50 without asking', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }]);
    const [p, q] = g.players;
    const auto = (who: typeof p, kind: number) => {
      const before = who.points, expected = new Rng(g.rng.seed).below(20) + 50;
      const { asks, events } = drive(g.places.miniGame(who, kind), () => { throw new Error('asked'); });
      expect(asks).toEqual([]);
      expect(events).toEqual([
        { t: 'fx', kind: 'mini-game', p: who.id, data: { game: kind, points: expected } },
        { t: 'points', p: who.id, amount: expected },
      ]);
      expect(who.points).toBe(before + expected);
      expect(expected).toBeGreaterThanOrEqual(50);
      expect(expected).toBeLessThanOrEqual(69);
    };
    auto(q, 6);
    p.autopilot = true;
    auto(p, 7);
    p.autopilot = false;
    g.animation = false;
    auto(p, 8);
  });

  it('auction: a single computer bidder raises by the largest step within its ceiling', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }, { character: 9, human: false }]);
    const land = g.board.lands[0];
    land.owner = 0; land.level = 2;
    const ref = land.id + 2000;
    const start = g.places.reservePrice(ref);
    expect(start).toBe(Math.trunc(land.price * 2) * g.priceIndex);
    const [a, b, c] = g.players;
    a.cash = 100000; b.cash = start; c.cash = 0; // b and c cannot bid (cash <= reserve)
    g.rng.reseed(99);
    // Mirror fcn_00439f0d for a.
    const m = new Rng(99);
    const r = (m.rand() / 32767) * 0.3 + 0.5;
    const free = g.board.lands.filter(l => l.owner === 0).length;
    const scarcity = 6 - (4 * free) / g.board.lands.length;
    const value = Math.trunc(((land.level >> 1) + 1) * start * scarcity * r);
    const cap = Math.trunc(land.price * (m.rand() / 65536 + 3));
    const max = Math.min(value, cap, a.cash);
    const step = [10000, 5000, 1000, 500, 100].find(v => start + v <= max)!;
    const { value: buyer } = drive(g.places.auction(-1, ref));
    expect(buyer).toBe(0);
    expect(land.owner).toBe(1);
    expect(a.cash).toBe(100000 - start - step);
    expect(g.lotteryPool).toBe(start + step);
  });

  it('auction AI bidding is deterministic for a seed and stays within cash', () => {
    const run = (seed: number) => {
      const g = newGame([{ character: 0, human: false }, { character: 4, human: false }, { character: 9, human: false }, { character: 11, human: false }]);
      const land = g.board.lands[5];
      land.owner = 0; land.level = 3;
      g.players.forEach((p, i) => { p.cash = 20000 + i * 15000; });
      const cash = g.players.map(p => p.cash);
      g.rng.reseed(seed);
      const { value: buyer, events } = drive(g.places.auction(-1, land.id + 2000));
      const bids = events.filter(e => e.t === 'fx' && e.kind === 'auction-bid').map(e => (e as unknown as { data: { price: number } }).data.price);
      return { buyer, bids, pool: g.lotteryPool, cash, owner: land.owner, start: g.places.reservePrice(land.id + 2000) };
    };
    const x = run(5), y = run(5);
    expect(x).toEqual(y);
    if (x.buyer >= 0) {
      expect(x.owner).toBe(x.buyer + 1);
      expect(x.pool).toBe(x.bids[x.bids.length - 1]);
      expect(x.pool).toBeLessThanOrEqual(x.cash[x.buyer]);
      expect(x.pool).toBeGreaterThan(x.start);
    }
    for (let i = 1; i < x.bids.length; i++) expect(x.bids[i]).toBeGreaterThan(x.bids[i - 1]);
  });

  it('auction: the seller and absent players never bid; no bid means unsold', () => {
    const g = newGame([{ character: 0, human: true }, { character: 4, human: true }, { character: 9, human: true }]);
    const land = g.board.lands[2];
    land.owner = 1; land.level = 0;
    const [a, b, c] = g.players;
    a.cash = b.cash = c.cash = 100000;
    b.prison = 3;
    // c bids once, a (seller) and b (in prison) are never asked even after the raise clears marks.
    const { asks, value, events } = drive(g.places.auction(0, land.id + 2000), q => (q.p === 2 ? 100 : 0));
    expect(asks.every(q => q.p === 2 && q.t === 'choose' && q.screen === 'auction')).toBe(true);
    const price0 = g.places.reservePrice(land.id + 2000) + 100;
    expect(events.find(e => e.t === 'fx' && e.kind === 'auction-end')).toMatchObject({ data: { buyer: 2, price: price0 } });
    expect(value).toBe(2);
    expect(land.owner).toBe(3);
    const price = g.places.reservePrice(land.id + 2000) + 100;
    expect(c.cash).toBe(100000 - price);
    expect(a.bank).toBe(g.fund - a.cash + price);
    // Nobody bids: unsold, ownership unchanged.
    const { value: none, events: ev2 } = drive(g.places.auction(2, land.id + 2000), () => 0);
    expect(none).toBe(-1);
    expect(ev2.find(e => e.t === 'fx' && e.kind === 'auction-end')).toMatchObject({ data: { buyer: -1 } });
    expect(land.owner).toBe(3);
  });

  it('a bankrupt computer\'s lots go to three public auctions that pay the lottery pool without a payment box', () => {
    // Regression: 「沙隆巴斯付給樂透獎池 拍賣 8,200 元」 popped up after each of the three auctions. The original moves
    // the auction money silently (rich4_ui_auction.asm:3244, transfer after 「…得標」), so the pay events are quiet.
    const g = newGame([{ character: 0, human: true }, { character: 4, human: false }, { character: 9, human: false }]);
    const [human, loser, rich] = g.players;
    g.board.lands.slice(0, 6).forEach(l => { l.owner = loser.id + 1; l.level = 1; });
    human.cash = 0; rich.cash = 500000;
    const pool = g.lotteryPool;
    const { events } = drive(g.bankrupt(loser), () => -1);
    const auctions = events.filter(e => e.t === 'fx' && e.kind === 'auction');
    const pays = events.filter((e): e is Extract<GameEvent, { t: 'pay' }> => e.t === 'pay' && e.reason === '拍賣');
    expect(auctions).toHaveLength(3);
    expect(pays).toHaveLength(3);
    for (const p of pays) expect(p).toMatchObject({ from: rich.id, to: -1, quiet: true });
    expect(g.lotteryPool - pool).toBe(pays.reduce((a, p) => a + p.amount, 0));
    // A card auction pays the seller just as quietly.
    const land = g.board.lands[10];
    land.owner = rich.id + 1;
    const { events: ev2 } = drive(g.places.auction(rich.id, land.id + 2000), () => -1);
    expect(ev2.filter(e => e.t === 'pay').every(e => (e as { quiet?: boolean }).quiet)).toBe(true);
  });

  it('NPC turn moves 2..10 steps along the road', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    g.players[0].points = 1000;
    drive(g.places.releaseNpc(6, 0));
    expect(g.places.npcActive(6)).toBe(true);
    for (let t = 0; t < 20; t++) {
      g.places.npcs[2].origin = 0; // keep it on the map
      const { events } = drive(g.places.npcTurn(6));
      const steps = events.filter(e => e.t === 'actor-step');
      expect(steps.length).toBeGreaterThanOrEqual(1);
      expect(steps.length).toBeLessThanOrEqual(10);
      for (const s of steps) if (s.t === 'actor-step') expect(g.node(s.from).adjacent).toContain(s.to);
    }
    // Stay: no movement this turn.
    g.places.npcs[2].stay = 1;
    expect(drive(g.places.npcTurn(6)).events.filter(e => e.t === 'actor-step')).toHaveLength(0);
    // Turtle: exactly one step.
    g.places.npcs[2].turtle = 2;
    g.places.npcs[2].origin = 0;
    expect(drive(g.places.npcTurn(6)).events.filter(e => e.t === 'actor-step')).toHaveLength(1);
  });

  it('thief takes half the points (rounded down) of the first other player on its node for its master', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }, { character: 9, human: false }]);
    drive(g.places.releaseNpc(4, 0));
    const thief = g.places.npcs[0];
    const at = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref && n.id !== g.prisonNode().id))!;
    thief.node = at.id; thief.origin = 0;
    const [m, v, w] = g.players;
    m.points = 10; v.points = 101; w.points = 80;
    v.node = at.id; w.node = at.id; m.node = at.id;
    const { events: steps } = drive(g.places.npcStepDone(4, 3));
    // core_actions:3600-3640: di = points >> 1; victim −= di; master += di.
    expect(v.points).toBe(51);
    expect(w.points).toBe(80);
    expect(m.points).toBe(10 + 50);
    expect(steps).toContainEqual(expect.objectContaining({ t: 'fx', kind: 'npc-steal', p: v.id, target: m.id, data: expect.objectContaining({ points: 50 }) }));
  });

  it('robber passing the bank takes 20% of other players\' deposits into the master\'s cash', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }, { character: 9, human: false }]);
    drive(g.places.releaseNpc(5, 1));
    const robber = g.places.npcs[1];
    const bank = g.board.nodes.find(n => n.event === 14)!;
    robber.node = bank.id; robber.origin = 0;
    const [a, m, c] = g.players;
    a.node = c.node = m.node = g.board.nodes.find(n => n.id !== bank.id)!.id;
    a.bank = 10000; m.bank = 5000; c.bank = 999;
    const cash = m.cash;
    const { events } = drive(g.places.npcStepDone(5, 4));
    expect(a.bank).toBe(8000);
    expect(c.bank).toBe(999 - 199);
    expect(m.bank).toBe(5000);
    expect(m.cash).toBe(cash + 2000 + 199);
    // The money moves without boxes of its own; one 「強盜搶奪銀行…」 box with the total follows.
    expect(events.filter(e => e.t === 'pay').every(e => e.t === 'pay' && e.quiet)).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ t: 'fx', kind: 'npc-rob-bank', p: m.id, data: { actor: 5, total: 2199 } }));
  });

  it('hooligan extorts the street worth × F, spy takes the last toll (core_actions:3770-4035)', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    const [m, o] = g.players;
    const land = g.board.lands.find(l => g.board.lands.filter(x => x.name === l.name).length >= 2)!;
    const street = g.board.lands.filter(x => x.name === land.name);
    for (const l of street) l.owner = o.id + 1;
    street[street.length - 1].owner = 0; // not the owner's: not counted
    const node = g.board.nodes.find(n => n.ref === land.id + 2000)!;
    const worth = street.filter(l => l.owner === o.id + 1).reduce((a, l) => a + l.price, 0) * g.priceIndex;
    drive(g.places.releaseNpc(6, m.id));
    const hooligan = g.places.npcs[2];
    hooligan.node = node.id; hooligan.origin = 0;
    o.cash = 10_000_000; o.bank = 0;
    const before = m.bank;
    const { events } = drive(g.places.npcStepDone(6, 0));
    expect(events).toContainEqual({ t: 'say', p: undefined, text: `勒索${g.name(o.id)}\n\n${worth}元保護費！` });
    expect(events).toContainEqual(expect.objectContaining({ t: 'pay', from: o.id, to: m.id, amount: worth, quiet: true }));
    expect(m.bank).toBe(before + worth);
    // The spy: the lot's last toll, nothing when none was paid yet.
    drive(g.places.releaseNpc(7, m.id));
    const spy = g.places.npcs[3];
    spy.node = node.id; spy.origin = 0;
    land.lastToll = 0;
    expect(drive(g.places.npcStepDone(7, 0)).events.some(e => e.t === 'say' || e.t === 'pay')).toBe(false);
    land.lastToll = 1234;
    expect(drive(g.places.npcStepDone(7, 0)).events).toContainEqual({ t: 'say', p: undefined, text: '取走過路費\n\n1234元！' });
  });

  it('thief pickups announce the object, the chest also its 500 points (core_actions:3020-3330)', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    drive(g.places.releaseNpc(4, 0));
    const thief = g.places.npcs[0];
    const at = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref && n.id !== g.prisonNode().id))!;
    thief.node = at.id; thief.origin = 0;
    for (const p of g.players) p.node = g.board.nodes.find(n => n.id !== at.id)!.id;
    Object.assign(g.objects.slots.find(o => o.type === 14)!, { node: at.id, owner: 0 });
    const pts = g.players[0].points;
    const { events } = drive(g.places.npcStepDone(4, 2));
    expect(events.map(e => e.t === 'fx' ? e.kind : e.t)).toEqual(['npc-pickup', 'points']);
    expect(events[0]).toMatchObject({ p: 0, data: { actor: 4, obj: 14 } });
    expect(g.players[0].points).toBe(pts + 500);
  });

  it('a released NPC returns to prison on its second pass over the prison tile', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    drive(g.places.releaseNpc(4, 0));
    const thief = g.places.npcs[0];
    thief.node = g.board.nodes.find(n => n.event === 4)!.id; // the prison tile, not the cell node (ref 8002)
    expect(drive(g.places.npcStepDone(4, 5)).value).toBe(5);
    expect(thief.where).toBe(0);
    expect(thief.origin).toBe(0x81);
    expect(drive(g.places.npcStepDone(4, 5)).value).toBe(0);
    expect(thief.where).toBe(1);
    expect(thief.node).toBe(g.prisonNode().id);
    expect(g.places.npcActive(4)).toBe(false);
  });

  it('a bankrupt master\'s NPCs go back to prison and hospital', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    for (const a of [4, 5, 6, 7]) drive(g.places.releaseNpc(a, 1));
    expect(g.places.npcs.every(n => n.where === 0)).toBe(true);
    g.places.returnNpcsOf(g.players[1]);
    expect(g.places.npcs.map(n => n.where)).toEqual([1, 1, 2, 2]);
    expect(g.places.npcs.every(n => n.owner === -1)).toBe(true);
  });

  it('released from the hospital, the patient first steps onto the door square: a mine there sends them back in (issue #2)', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    const p = g.players[0], door = g.hospitalNode().id;
    g.current = 0;
    drive(g.sendTo(p, 'hospital', 1));
    expect(p.node).toBe(door);
    drive(g.turnStart(p)); // 1 → 0x80: still inside this turn
    expect(p.hospital).toBe(0x80);
    expect(drive(g.playerTurn(p)).events.some(e => e.t === 'dice')).toBe(false);
    expect(g.objects.place(OBJ.Mine, door)).toBe(true); // the classic mine at the door
    p.turtle = 2;
    drive(g.turnStart(p)); // released: who_plays 0x10, the byte stays 0x80 until the walk out
    expect(p.leaving).toBe('hospital');
    expect(p.hospital).toBe(0x80);
    expect(p.turtle).toBe(2); // not counted at this turn start (+50..+53 still non-zero, core_actions.asm:4199)
    const { events } = drive(g.playerTurn(p));
    const kinds = events.map(e => (e.t === 'fx' ? e.kind : e.t));
    expect(kinds.indexOf('leave-hospital')).toBeLessThan(kinds.indexOf('mine'));
    expect(kinds).not.toContain('dice'); // back in: the turn is over
    expect(p.leaving).toBeUndefined();
    expect(p.hospital).toBe(3);
    expect(p.node).toBe(door);
    expect(g.objects.at(door)).toBeUndefined();
  });

  it('released from prison, the door square is resolved before the turn (a roadblock there is taken away)', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    const p = g.players[0], door = g.prisonNode().id;
    g.current = 0;
    drive(g.sendTo(p, 'prison', 2));
    p.prison = 0x80; // bailed out (06 §9.5)
    expect(g.objects.place(OBJ.Roadblock, door)).toBe(true);
    drive(g.turnStart(p));
    expect(p.leaving).toBe('prison');
    const { events } = drive(g.playerTurn(p));
    const kinds = events.map(e => (e.t === 'fx' ? e.kind : e.t));
    expect(kinds.indexOf('leave-prison')).toBeGreaterThanOrEqual(0);
    expect(kinds.indexOf('leave-prison')).toBeLessThan(kinds.indexOf('roadblock'));
    expect(kinds.indexOf('roadblock')).toBeLessThan(kinds.indexOf('dice')); // then the turn as usual
    expect(p.prison).toBe(0);
    expect(p.leaving).toBeUndefined();
    expect(g.objects.at(door)).toBeUndefined();
  });

  it('with DOOR_STEP off the earlier release stands: out at the turn start, the door square not resolved', () => {
    DOOR_STEP.on = false;
    try {
      const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
      const p = g.players[0], door = g.hospitalNode().id;
      g.current = 0;
      drive(g.sendTo(p, 'hospital', 1));
      p.hospital = 0x80;
      g.objects.place(OBJ.Mine, door);
      drive(g.turnStart(p));
      expect(p.hospital).toBe(0);
      expect(p.leaving).toBeUndefined();
      const kinds = drive(g.playerTurn(p)).events.map(e => (e.t === 'fx' ? e.kind : e.t));
      expect(kinds).not.toContain('mine');
      expect(kinds).toContain('dice');
      expect(g.objects.at(door)?.type).toBe(OBJ.Mine);
    } finally { DOOR_STEP.on = true; }
  });

  it('mini games give a computer 50..69 points', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    for (const p of g.players) {
      for (let i = 0; i < 20; i++) for (const kind of [6, 7, 8]) {
        const before = p.points;
        drive(g.places.miniGame(p, kind));
        expect(p.points - before).toBeGreaterThanOrEqual(50);
        expect(p.points - before).toBeLessThanOrEqual(69);
      }
    }
  });

  it('magic house: groups and sample spells', () => {
    const g = newGame([{ character: 0, human: false }, { character: 3, human: false }, { character: 9, human: true }]);
    const [a, b, c] = g.players;
    // Groups: cash maximum with ties, women, walkers.
    a.cash = 500; b.cash = 900; c.cash = 900;
    expect(g.places.magicGroup(3).map(p => p.id)).toEqual([1, 2]);
    expect(g.places.magicGroup(11).map(p => p.id)).toEqual([1, 2]);
    a.traffic = 1;
    expect(g.places.magicGroup(6).map(p => p.id)).toEqual([1, 2]);
    expect(g.places.magicGroup(7).map(p => p.id)).toEqual([0]);
    for (const p of g.players) p.points = 0;
    expect(g.places.magicGroup(5)).toEqual([]);

    // 4: deposit all cash.
    b.bank = 100;
    drive(g.places.castMagic(a, 4, [b]));
    expect(b).toMatchObject({ cash: 0, bank: 1000 });
    // 3: stay one more turn, stacking.
    drive(g.places.castMagic(a, 3, [b, c]));
    drive(g.places.castMagic(a, 3, [b]));
    expect(b.stay).toBe(2);
    expect(c.stay).toBe(1);
    // 7: turn around (only when idle).
    const dir = c.dir;
    drive(g.places.castMagic(a, 7, [c]));
    expect(c.dir).toBe((dir + 4) & 7);
    c.hospital = 2;
    drive(g.places.castMagic(a, 7, [c]));
    expect(c.dir).toBe((dir + 4) & 7);
    c.hospital = 0;
    // 0: cards at full price into points.
    c.points = 0; c.cards = [1, 3, 30];
    drive(g.places.castMagic(a, 0, [c]));
    expect(c.cards).toEqual([]);
    expect(c.points).toBe(200 + 35 + 70);
    // 8: vehicle and tools at full price into points; walking afterwards.
    b.points = 0; b.traffic = 2; b.dice = 3; b.tools = new Array(15).fill(0); b.tools[1] = 2;
    drive(g.places.castMagic(a, 8, [b]));
    expect(b.points).toBe(150 + 2 * 30);
    expect(b).toMatchObject({ traffic: 0, dice: 1 });
    expect(b.tools.every(n => n === 0)).toBe(true);
    // 2: prison three days; the target resents the visitor.
    drive(g.places.castMagic(a, 2, [b]));
    expect(b.prison).toBe(3);
    expect(b.node).toBe(g.prisonNode().id);
    expect(b.hostility[0]).toBe(90 * g.priceIndex);
    expect(g.current).toBe(0);
    // 9 and 5 on a lot: damage, then free upgrade, without an owner check.
    const lot = g.board.lands[0];
    const lotNode = g.board.nodes.find(n => n.ref === lot.id + 2000)!;
    lot.owner = 2; lot.level = 2; lot.chain = false;
    c.node = lotNode.id;
    drive(g.places.castMagic(a, 9, [c]));
    expect(lot.level).toBe(1);
    drive(g.places.castMagic(a, 5, [c]));
    expect(lot.level).toBe(2);
    expect(lot.owner).toBe(2);
  });

  it('magic house: a computer inside the group always picks 6, otherwise never 6 or 11', () => {
    const g = newGame([{ character: 0, human: false }, { character: 4, human: false }]);
    for (let s = 1; s <= 60; s++) {
      g.rng.reseed(s);
      const { events } = drive(g.places.magicHouse(g.players[0]));
      const fx = events.find(e => e.t === 'fx' && e.kind === 'magic') as unknown as { data: { magic: number; targets: number[] } };
      if (fx.data.targets.includes(0)) expect(fx.data.magic).toBe(6);
      else expect([6, 11]).not.toContain(fx.data.magic);
      for (const p of g.players) { p.prison = 0; p.hospital = 0; p.stay = 0; p.whoPlays = 2; p.bankrupt = false; }
    }
  });
});
