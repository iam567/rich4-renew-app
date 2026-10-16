import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { Game } from '../game';
import { pack } from '../date';
import type { Flow } from '../flow';
import type { Answer, Ask, GameEvent, GameSettings, Player, Step } from '../types';
import { cardPrice } from './cards';
import { CONSTRUCTION_TRAFFIC, TOOLS, sellPrice, type ShopAnswer } from './tools';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

function newGame(opts: { traffic?: 0 | 1 | 2; seed?: number; characters?: number[]; humans?: boolean[] } = {}) {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const chars = opts.characters ?? [0, 4, 9, 11];
  const settings: GameSettings = {
    mapId: 1, players: chars.map((character, i) => ({ character, human: opts.humans?.[i] ?? false })),
    fundIndex: 1, traffic: opts.traffic ?? 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0,
    startDate: pack(2026, 10, 14), seed: opts.seed ?? 99,
  };
  return new Game(settings, board);
}

/** Puts a player on the road at a node, as after the first landing. */
function put(g: Game, p: Player, node: number) {
  const n = g.node(node);
  p.placed = true;
  p.whoPlays = p.human ? 1 : 2;
  p.node = node;
  p.lastNode = n.adjacent.find(Boolean)!;
}

/** Runs a flow, answering questions in order; returns the events, the questions and the result. */
function drain<T>(flow: Flow<T>, answers: Answer[] = []) {
  const events: GameEvent[] = [], asks: Step[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) { asks.push(s); r = flow.next(answers.shift()); } else { events.push(s as GameEvent); r = flow.next(); }
  }
  return { events, asks, result: r.value };
}

/** The node whose road neighbour is a given land lot. */
const nodeOfLand = (g: Game, ref: number) => g.board.nodes.find(n => n.ref === ref)!;

describe.skipIf(!haveMaps)('tools', () => {
  it('gives the starting tools and takes them and the vehicles from the stock', () => {
    const g = newGame();
    expect(g.tools.shopStock).toEqual([6, 6, 6, 6, 10, 10, 10, 6]);
    for (const p of g.players) expect(p.tools.slice(0, 13)).toEqual([1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 0]);
    const car = newGame({ traffic: 2 });
    expect(car.tools.shopStock).toEqual([6, 6, 6, 6, 10, 6, 10, 6]);
    expect(car.players[0].tools[5]).toBe(0);
  });

  it('caps each tool at 9 and needs stock for tools 1-8', () => {
    const g = newGame(), p = g.players[0];
    p.tools[1] = 9;
    expect(g.tools.receive(p, 2)).toBe(false);
    expect(g.tools.shopStock[1]).toBe(6);
    g.tools.shopStock[6] = 0;
    expect(g.tools.receive(p, 7)).toBe(false);
    expect(g.tools.receive(p, 13)).toBe(true);
    expect(p.tools[12]).toBe(1);
    g.tools.shopStock[6] = 1;
    expect(g.tools.receive(p, 7)).toBe(true);
    expect(g.tools.shopStock[6]).toBe(0);
  });

  it('draws a random tool by the stock, without rand() when the stock is empty', () => {
    const g = newGame(), p = g.players[0];
    g.tools.shopStock = [0, 0, 0, 0, 0, 0, 0, 0];
    const seed = g.rng.seed;
    expect(drain(g.tools.receiveRandom(p)).result).toBe(0);
    expect(g.rng.seed).toBe(seed);
    g.tools.shopStock = [0, 0, 0, 0, 0, 0, 3, 0];
    expect(drain(g.tools.receiveRandom(p)).result).toBe(7);
    expect(p.tools[6]).toBe(1);
    expect(g.tools.shopStock[6]).toBe(2);
  });

  it('rides, switches and gets off vehicles, keeping the stock balanced', () => {
    const g = newGame(), p = g.players[0];
    put(g, p, 1);
    g.tools.receive(p, 5); g.tools.receive(p, 6);
    const total = (t: number) => g.tools.shopStock[t - 1] + g.players.reduce((s, q) => s + q.tools[t - 1] + ((q.traffic & 3) === t - 4 ? 1 : 0), 0);
    expect(drain(g.tools.use(p, 5)).result).toBe(true);
    expect([p.traffic, p.dice, p.tools[4]]).toEqual([1, 2, 0]);
    expect(drain(g.tools.use(p, 6)).result).toBe(true);
    expect([p.traffic, p.dice, p.tools[4], p.tools[5]]).toEqual([2, 3, 1, 0]);
    g.tools.receive(p, 6);
    expect(drain(g.tools.use(p, 6)).result).toBe(false);
    expect(p.tools[5]).toBe(1);
    expect(total(5)).toBe(10);
    expect(total(6)).toBe(10);
    g.tools.getOff(p);
    expect([p.traffic, p.dice, p.tools[5]]).toEqual([0, 1, 2]);
    drain(g.tools.use(p, 6));
    expect(g.tools.destroyVehicle(p)).toBe(true);
    expect([p.traffic, p.dice]).toEqual([0, 1]);
    expect(total(6)).toBe(10);
    expect(g.tools.shopStock[5]).toBe(9);
    p.hospital = 2;
    expect(g.tools.destroyVehicle(p)).toBe(false);
  });

  it('rides the construction vehicle for 7 turns and gets the scooter back', () => {
    const g = newGame(), p = g.players[0];
    put(g, p, 1);
    g.tools.receive(p, 12); g.tools.receive(p, 5);
    drain(g.tools.use(p, 5));
    expect(drain(g.tools.use(p, 12)).result).toBe(true);
    expect([p.traffic, p.dice, p.tools[4], p.tools[11]]).toEqual([CONSTRUCTION_TRAFFIC, 1, 1, 0]);
    g.tools.receive(p, 12);
    expect(drain(g.tools.use(p, 12)).result).toBe(false);
    for (let i = 0; i < 6; i++) { drain(g.tools.turnStart(p)); expect(p.traffic & 3).toBe(3); }
    drain(g.tools.turnStart(p));
    expect([p.traffic, p.dice, p.tools[4]]).toEqual([1, 2, 0]);
  });

  it('demolishes another player\'s building after stopping on the construction vehicle', () => {
    const g = newGame(), p = g.players[0];
    const land = g.board.lands[0], n = nodeOfLand(g, land.id + 2000);
    put(g, p, n.id);
    land.owner = 2; land.level = 3;
    p.traffic = CONSTRUCTION_TRAFFIC;
    drain(g.tools.construction(p));
    expect([land.owner, land.level]).toEqual([2, 0]);
    expect(g.players[1].hostility[0]).toBe(30);
  });

  it('places a roadblock on a picked empty node: the inventory drops, the stock does not refill', () => {
    const g = newGame({ humans: [true] }), p = g.players[0];
    put(g, p, 1);
    const place = vi.spyOn(g.objects, 'place').mockReturnValue(true);
    vi.spyOn(g.objects, 'at').mockReturnValue(undefined);
    const { asks, result } = drain(g.tools.humanUse(p), [2, 2]);
    expect(result).toBeUndefined();
    const pick = asks[1] as Step & { nodes: number[] };
    expect(pick.nodes).toContain(2);
    expect(pick.nodes).not.toContain(1); // the player stands there
    expect(place).toHaveBeenCalledWith(16, 2);
    expect(p.tools[1]).toBe(0);
    expect(g.tools.shopStock[1]).toBe(6);
  });

  it('cancelling a target keeps the tool and reopens the panel', () => {
    const g = newGame({ humans: [true] }), p = g.players[0];
    put(g, p, 1);
    const { asks } = drain(g.tools.humanUse(p), [3, 0, -1]);
    expect(asks.map(a => a.t)).toEqual(['choose', 'pick-node', 'choose']);
    expect(p.tools[2]).toBe(1);
  });

  it('walks the robot doll 9 steps and clears the objects it reaches', () => {
    const g = newGame(), p = g.players[0];
    put(g, p, 1);
    const removed: number[] = [];
    vi.spyOn(g.objects, 'at').mockImplementation(node => (node !== 1 && !removed.includes(node) ? { type: 16, node, dir: 0, life: 0, owner: 0 } : undefined));
    vi.spyOn(g.objects, 'removeAt').mockImplementation(node => { removed.push(node); });
    const { events } = drain(g.tools.use(p, 1));
    const steps = events.filter(e => e.t === 'actor-step');
    expect(steps).toHaveLength(9);
    expect(steps.every(e => e.t === 'actor-step' && e.actor === 8)).toBe(true);
    expect(removed.length).toBeGreaterThan(0);
    expect(p.tools[0]).toBe(0);
    expect(g.tools.shopStock[0]).toBe(7);
    expect(p.node).toBe(1);
  });

  it('missile: lots lose a level, hit players lose their vehicle and go to hospital', () => {
    const g = newGame(), [a, b] = g.players;
    const land = g.board.lands[0], n = nodeOfLand(g, land.id + 2000);
    const far = g.board.nodes.find(m => Math.abs(m.x - n.x) > 400 || Math.abs(m.y - n.y) > 400)!;
    put(g, a, far.id); put(g, b, n.id);
    land.owner = 3; land.level = 2;
    b.traffic = 2; b.dice = 3;
    g.tools.receive(a, 7);
    drain(g.tools.use(a, 7, n.id));
    expect(land.level).toBe(1);
    expect(b.traffic).toBe(0);
    expect(b.hospital).toBeGreaterThan(0);
    expect(b.node).toBe(g.hospitalNode().id);
    expect(b.hostility[0]).toBe(90);
    expect(g.players[2].hostility[0]).toBe(30);
    expect(a.hospital).toBe(0);
    expect(g.tools.shopStock[5]).toBe(11); // the car was scrapped into the stock
  });

  it('nuclear missile confiscates lots on the screen', () => {
    const g = newGame(), [a] = g.players;
    const land = g.board.lands[0], n = nodeOfLand(g, land.id + 2000);
    const far = g.board.nodes.find(m => Math.abs(m.x - n.x) > 600 || Math.abs(m.y - n.y) > 600)!;
    put(g, a, far.id);
    land.owner = 2; land.level = 3;
    a.tools[12] = 1;
    drain(g.tools.use(a, 13, land.id + 2000));
    expect([land.owner, land.level]).toEqual([0, 0]);
    expect(g.players[1].hostility[0]).toBe(90);
    expect(a.tools[12]).toBe(0);
  });

  it('remote dice: the value is set for departure and the die returns to the stock', () => {
    const g = newGame({ humans: [true] }), p = g.players[0];
    put(g, p, 1);
    const { result } = drain(g.tools.use(p, 8), [4]);
    expect(result).toBe(true);
    expect([g.tools.remoteDice, g.tools.pending, p.tools[7], g.tools.shopStock[7]]).toEqual([4, 'depart', 0, 7]);
    // The snapshot was taken before the die was used, and the departure's own store is skipped once.
    expect(g.tools.snapshots[0]!.players[0].tools[7]).toBe(1);
    g.tools.storeState(p);
    expect(g.tools.snapshots[0]!.players[0].tools[7]).toBe(1);
  });

  it('robot worker builds one free level, on anyone\'s lot', () => {
    const g = newGame(), p = g.players[0];
    const land = g.board.lands.find(l => !l.chain)!;
    put(g, p, nodeOfLand(g, land.id + 2000).id);
    land.owner = 0; land.level = 0;
    drain(g.tools.use(p, 9, land.id + 2000));
    expect([land.owner, land.level, p.tools[8]]).toEqual([0, 1, 0]);
  });

  it('time machine restores the human\'s last snapshot, which stays usable', () => {
    const g = newGame({ humans: [true] }), p = g.players[0];
    put(g, p, 1);
    g.tools.receive(p, 10);
    expect(drain(g.tools.use(p, 10)).result).toBe(false); // no snapshot yet
    g.tools.storeState(p);
    const cash = p.cash, date = g.date, land = g.board.lands[0];
    p.cash = 1; p.node = 5; g.date += 1; land.owner = 3; g.players[1].cash = 7; g.tools.shopStock[0] = 0;
    expect(drain(g.tools.use(p, 10)).result).toBe(true);
    expect([p.cash, p.node, g.date, land.owner, g.tools.shopStock[0]]).toEqual([cash, 1, date, 0, 6]);
    expect(g.players[1].cash).not.toBe(7);
    expect(p.tools[9]).toBe(0);
    expect(g.tools.snapshots[0]).not.toBeNull();
    // Computers never get a snapshot.
    g.tools.storeState(g.players[1]);
    expect(g.tools.snapshots[1]).toBeNull();
  });

  it('teleports oneself to a node and asks the core to run the stop there', () => {
    const g = newGame(), p = g.players[0];
    put(g, p, 1);
    p.tools[10] = 1;
    drain(g.tools.use(p, 11, 3));
    expect([p.node, g.tools.pending, p.tools[10]]).toEqual([3, 'land', 0]);
    expect(g.node(3).adjacent).toContain(p.lastNode);
  });

  it('labs: a computer orders its top tool, a damaged lab cancels, delivery respects the cap', () => {
    const g = newGame(), p = g.players[0];
    put(g, p, 1);
    const f = g.board.facilities[0];
    f.type = 4; f.owner = 1; f.level = 3;
    drain(g.tools.labStop(p, f.id));
    expect([f.labTool, f.labDays]).toEqual([3, 5]);
    f.level = 2;
    drain(g.tools.turnStart(p));
    expect(f.labDays).toBe(0);
    drain(g.tools.labDone(p, 11));
    expect(p.tools[10]).toBe(1);
  });

  it('shop: sells at 90% and lets a human buy one of each tool on the shelf', () => {
    expect([15, 25, 30, 80, 100, 150, 250].map(x => sellPrice(x))).toEqual([13, 22, 27, 72, 90, 135, 225]);
    const g = newGame({ humans: [true] }), p = g.players[0];
    put(g, p, 1);
    g.cards.remaining = new Array(30).fill(0);
    p.points = 200;
    const shelf = g.tools.toolShelf();
    expect(shelf).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const missile: ShopAnswer = { buy: 'tool', index: shelf.indexOf(7) };
    const answers: ShopAnswer[] = [missile, missile, { sell: 'tool', id: 9 }, -1];
    drain(g.tools.shop(p), answers as unknown as Answer[]);
    expect(p.tools[6]).toBe(1); // the second click on the same cell does nothing
    expect(p.tools[8]).toBe(0);
    expect(p.points).toBe(100 + sellPrice(TOOLS[8].price));
    expect(g.tools.shopStock[6]).toBe(9);
  });

  it('shop question: shelves, points, buying and selling cards, refusals and leaving', () => {
    const g = newGame({ humans: [true] }), p = g.players[0];
    put(g, p, 1);
    p.points = 300;
    p.cards = [1];
    const pool = [...g.cards.remaining];
    const answers: ShopAnswer[] = [
      { buy: 'card', index: 0 }, // bought and greyed out
      { buy: 'card', index: 0 }, // already sold: nothing
      { sell: 'card', index: 0 }, // 均富卡 200 → 180
      { buy: 'tool', index: 99 }, // no such cell: nothing
      { sell: 'tool', id: 13 }, // not held: nothing
      -1,
    ];
    const { asks, events } = drain(g.tools.shop(p), answers as unknown as Answer[]);
    const shops = asks.filter(s => 't' in s && s.t === 'shop') as unknown as Extract<Ask, { t: 'shop' }>[];
    expect(shops).toHaveLength(6);
    const first = shops[0];
    expect(first.p).toBe(0);
    expect(first.points).toBe(300);
    expect(first.cards.length).toBeGreaterThanOrEqual(6);
    expect(first.cards.length).toBeLessThanOrEqual(15);
    expect(first.tools).toEqual(g.tools.toolShelf());
    const id = first.cards[0], price = cardPrice(id);
    const bought = price <= 300;
    expect(shops[1].cards[0]).toBe(bought ? 0 : id);
    expect(shops[1].points).toBe(bought ? 300 - price : 300);
    expect(shops[1].cards.slice(1)).toEqual(first.cards.slice(1)); // the shelf stays fixed for the visit
    expect(p.cards).toEqual(bought ? [id] : []);
    expect(p.points).toBe((bought ? 300 - price : 300) + 180);
    expect(shops[3].points).toBe(p.points);
    // The sold 均富卡 is back in the pool; the bought card is taken from it.
    expect(g.cards.remaining[0]).toBe(pool[0] + 1 - (bought && id === 1 ? 1 : 0));
    expect(events.filter(e => e.t === 'fx' && e.kind === 'shop')).toHaveLength(bought ? 2 : 1);
  });

  it('computer shopping follows the fixed budget rules without random numbers', () => {
    const g = newGame({ characters: [7, 4, 9, 11] }), p = g.players[0]; // 糖糖: personality 0
    put(g, p, 1);
    g.cards.remaining = new Array(30).fill(0);
    p.tools[6] = 2; p.tools[12] = 1; // hated: sold at 90%
    p.points = 120;
    const seed = g.rng.seed;
    drain(g.tools.shop(p));
    expect(g.rng.seed).toBe(seed);
    // 120 + 2×90 + 225 = 525 → tools budget 263: scooter 80, car 150, then 8 (30); 2 does not fit.
    expect([p.tools[6], p.tools[12], p.tools[4], p.tools[5], p.tools[7], p.tools[1]]).toEqual([0, 0, 1, 1, 2, 1]);
    expect(p.points).toBe(525 - 80 - 150 - 30);
  });

  it('computer tool use is deterministic for a seed', () => {
    const run = (seed: number) => {
      const g = newGame({ seed });
      for (const [i, p] of g.players.entries()) { put(g, p, 1 + i * 20); p.tools = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 0]; p.hostility = [5, 5, 5, 5]; }
      const out: unknown[] = [];
      for (let k = 0; k < 6; k++) for (const p of g.players) out.push(drain(g.tools.aiUse(p)).events, p.tools.join(), p.traffic);
      return { out, seed: g.rng.seed };
    };
    expect(run(5)).toEqual(run(5));
  });

  it('keeps the supply of tools 1-8 at 10 through computer-only play', () => {
    const g = newGame({ seed: 2024 });
    const used = new Set<string>();
    const total = (t: number) => g.tools.shopStock[t - 1]
      + g.players.reduce((s, q) => s + q.tools[t - 1] + ((t === 5 || t === 6) && q.traffic === t - 4 ? 1 : 0), 0)
      + (t >= 2 && t <= 4 ? g.objects.slots.filter(o => o.type === t + 14 && (o.node || o.owner)).length : 0);
    const flow = g.run();
    for (let r = flow.next(); !r.done && g.daysElapsed < 200; r = flow.next()) {
      const s = r.value;
      if (s.t === 'say' && s.text.startsWith('使用')) used.add(s.text);
      for (let t = 1; t <= 8; t++) expect(total(t), `tool ${t} on day ${g.daysElapsed}`).toBe(10);
    }
    expect(used.size).toBeGreaterThan(2);
  });
});
