import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, landOf, type RawMap } from '../board';
import { Game } from '../game';
import { pack } from '../date';
import type { Flow } from '../flow';
import type { GameEvent, GameSettings, Player, Step } from '../types';
import { BOMB_STEPS, LUCK_BAD, LUCK_FATE, LUCK_MONEY, OBJ, SLOT_TYPES } from './objects';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

function newGame(seed = 99): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  return new Game(settings, board);
}

/** Runs a flow to the end (computer players never ask) and returns its events and result. */
function run<T>(flow: Flow<T>): { events: Step[]; value: T } {
  const events: Step[] = [];
  for (;;) {
    const r = flow.next();
    if (r.done) return { events, value: r.value };
    if ('ask' in r.value) throw new Error('unexpected question');
    events.push(r.value);
  }
}

/** Puts every player on the road at distinct free nodes, player 0 at `node` when given. */
function placeAll(g: Game) {
  for (const p of g.players) {
    const n = g.randomFreeNode();
    Object.assign(p, { placed: true, whoPlays: 2, node: n.id, lastNode: n.adjacent.find(Boolean)! });
  }
}

/** A road node with nothing on it and nobody standing there. */
function emptyNode(g: Game, pred: (id: number) => boolean = () => true): number {
  const taken = new Set([...g.players.filter(p => p.placed).map(p => p.node), ...g.objects.slots.map(o => o.node)]);
  const n = g.board.nodes.find(n => !taken.has(n.id) && n.adjacent.some(Boolean) && n.event !== 5 && n.event !== 4 && pred(n.id));
  return n!.id;
}

const onMap = (g: Game, type: number) => g.objects.slots.filter(o => o.type === type && o.node);

describe.skipIf(!haveMaps)('objects', () => {
  it('places the starting objects on distinct free nodes in fixed slots', () => {
    const g = newGame();
    expect(g.objects.slots.map(o => o.type)).toEqual(SLOT_TYPES);
    expect(SLOT_TYPES.slice(0, 16)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15]);
    const placed = g.objects.slots.filter(o => o.node);
    expect(placed.map(o => o.type)).toEqual([1, 3, 5, 7, 9, 11, 13, 14]);
    expect(new Set(placed.map(o => o.node)).size).toBe(8);
    for (const o of placed) {
      const n = g.node(o.node);
      expect(n.noDrop).toBe(false);
      expect(g.objects.at(o.node)).toBe(o);
    }
  });

  it('attaches a god only when stopping, with its luck values and 7 days', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0], angel = g.objects.slots[OBJ.Angel - 1];
    p.node = angel.node;
    expect(run(g.objects.step(p, 2)).value).toBe(2);
    expect(p.god).toBe(0);
    expect(run(g.objects.step(p, 0)).value).toBe(0);
    expect(p.god).toBe(OBJ.Angel);
    expect(g.objects.godType(p)).toBe(OBJ.Angel);
    expect([p.luckBad, p.luckMoney, p.luckFate]).toEqual([-100, 60, 60]);
    expect(angel).toMatchObject({ node: 0, owner: 1, life: 7 });
    expect(g.objects.at(p.node)).toBeUndefined();
  });

  it('small wealth god: every opponent pays the slot machine amount into cash', () => {
    const g = newGame(5);
    placeAll(g);
    const p = g.players[0], before = g.players.map(q => q.cash + q.bank), cash = p.cash;
    p.node = g.objects.slots[0].node;
    run(g.objects.step(p, 0));
    const paid = before[1] - (g.players[1].cash + g.players[1].bank);
    expect(paid).toBeGreaterThanOrEqual(0);
    expect(paid).toBeLessThanOrEqual(999);
    for (const q of g.players.slice(1)) expect(before[q.id] - (q.cash + q.bank)).toBe(paid);
    expect(p.cash - cash).toBe(3 * paid);
  });

  it('a god leaves after 7 turn starts and its pair appears far away', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0];
    p.node = g.objects.slots[OBJ.SmallBadLuck - 1].node;
    run(g.objects.step(p, 0));
    expect(g.objects.godType(p)).toBe(OBJ.SmallBadLuck);
    expect(p.luckFate).toBe(-60);
    for (let i = 0; i < 6; i++) run(g.objects.turnStart(p));
    expect(p.god).toBe(OBJ.SmallBadLuck);
    expect(onMap(g, OBJ.BigBadLuck)).toHaveLength(0);
    const { events } = run(g.objects.turnStart(p));
    expect(p.god).toBe(0);
    expect([p.luckBad, p.luckMoney, p.luckFate]).toEqual([0, 0, 0]);
    expect(events.some(e => e.t === 'say')).toBe(true); // bad gods announce leaving
    expect(g.objects.slots[OBJ.SmallBadLuck - 1]).toMatchObject({ node: 0, owner: 0 });
    const [big] = onMap(g, OBJ.BigBadLuck);
    const a = g.node(big.node), b = g.node(p.node);
    expect(Math.abs(a.x - b.x) >= 300 || Math.abs(a.y - b.y) >= 300).toBe(true);
  });

  it('a new god replaces the old one; each pair always has exactly one member', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0];
    p.node = g.objects.slots[OBJ.SmallPoor - 1].node;
    run(g.objects.step(p, 0));
    p.node = g.objects.slots[OBJ.Angel - 1].node;
    run(g.objects.step(p, 0));
    expect(g.objects.godType(p)).toBe(OBJ.Angel);
    expect([p.luckBad, p.luckMoney, p.luckFate]).toEqual([LUCK_BAD[8], LUCK_MONEY[8], LUCK_FATE[8]]);
    expect(onMap(g, OBJ.BigPoor)).toHaveLength(1);
    for (let t = 1; t <= 12; t += 2) {
      const pair = g.objects.slots.slice(t - 1, t + 1).filter(o => o.node || o.owner);
      expect(pair).toHaveLength(1);
    }
  });

  it('luck(): bands and the rand()&1 50% band', () => {
    const g = newGame();
    const p = g.players[0];
    const check = (money: number, fate: number) => {
      p.luckMoney = money; p.luckFate = fate;
      return [run(g.objects.luck(p, 0, 0)).value, run(g.objects.luck(p, 0, 1)).value, run(g.objects.luck(p, 1, 0)).value];
    };
    expect(check(150, 150)).toEqual([2, 1, 1]);
    expect(check(101, 101)).toEqual([2, 1, 1]);
    expect(check(50, 50)).toEqual([0, 0, 0]);
    expect(check(0, 0)).toEqual([0, 0, 0]);
    expect(check(-60, -60)).toEqual([1, 2, 2]);
    expect(check(-200, -200)).toEqual([1, 2, 2]);
    // Outside the band no random number is drawn.
    const seed = g.rng.seed;
    check(150, -60);
    expect(g.rng.seed).toBe(seed);
    // Inside the band: one rand() each, result decided by its low bit.
    p.luckMoney = 100;
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      const probe = new (g.rng.constructor as new (s: number) => typeof g.rng)(g.rng.seed);
      const expected = probe.rand() & 1 ? 2 : 0;
      const r = run(g.objects.luck(p, 0, 0)).value;
      expect(r).toBe(expected);
      expect(g.rng.seed).toBe(probe.seed);
      seen.add(r);
    }
    expect(seen).toEqual(new Set([0, 2]));
  });

  it('roadblock stops on any step and goes back to the supply', () => {
    const g = newGame();
    placeAll(g);
    g.tools.shopStock = [0, 0, 0, 0, 0, 0, 0, 0];
    const p = g.players[0], node = emptyNode(g);
    expect(g.objects.place(OBJ.Roadblock, node)).toBe(true);
    expect(g.objects.place(OBJ.Mine, node)).toBe(false); // one object per node
    expect(g.objects.slots[16]).toMatchObject({ type: 16, node });
    p.node = node;
    expect(run(g.objects.step(p, 4)).value).toBe(0);
    expect(g.objects.at(node)).toBeUndefined();
    expect(g.tools.shopStock[1]).toBe(1);
  });

  it('only 10 roadblocks fit', () => {
    const g = newGame();
    const nodes = g.board.nodes.filter(n => !g.objects.at(n.id)).slice(0, 11);
    expect(nodes.map(n => g.objects.place(OBJ.Roadblock, n.id))).toEqual([...Array(10).fill(true), false]);
  });

  it('mine: passing is safe, stopping sends to hospital for 3 days', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0], node = emptyNode(g);
    g.objects.place(OBJ.Mine, node);
    p.node = node;
    expect(run(g.objects.step(p, 2)).value).toBe(2);
    expect(g.objects.at(node)?.type).toBe(OBJ.Mine);
    p.traffic = 1; p.dice = 2;
    expect(run(g.objects.step(p, 0)).value).toBe(0);
    expect(g.objects.at(node)).toBeUndefined();
    expect(p.hospital).toBe(3);
    expect(p.node).toBe(g.hospitalNode().id);
    expect(p.traffic).toBe(0);
  });

  it('dog bites walkers only, and the earth god appears', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0];
    p.node = g.objects.slots[OBJ.Dog - 1].node;
    p.traffic = 2;
    run(g.objects.step(p, 0));
    expect(p.hospital).toBe(0);
    expect(onMap(g, OBJ.Dog)).toHaveLength(0);
    expect(onMap(g, OBJ.EarthGod)).toHaveLength(1);
  });

  it('time bomb: picked up when stopping, counts every step, passes on, explodes', () => {
    const g = newGame();
    placeAll(g);
    g.tools.shopStock = [0, 0, 0, 0, 0, 0, 0, 0];
    const [p, q] = g.players;
    const bombNode = emptyNode(g);
    g.objects.place(OBJ.TimeBomb, bombNode);
    p.node = bombNode;
    run(g.objects.step(p, 3)); // passing does not pick it up
    expect(p.bomb).toBe(0);
    run(g.objects.step(p, 0));
    expect(p.bomb).toBe(37);
    expect(g.objects.slots[36]).toMatchObject({ node: 0, owner: 1, life: BOMB_STEPS });
    // Walk on an empty node: every step counts.
    p.node = emptyNode(g);
    run(g.objects.step(p, 5));
    run(g.objects.step(p, 4));
    expect(g.objects.slots[36].life).toBe(BOMB_STEPS - 2);
    // Passing a player hands it over without resetting the timer.
    p.node = q.node;
    run(g.objects.step(p, 3));
    expect(p.bomb).toBe(0);
    expect(q.bomb).toBe(37);
    expect(g.objects.slots[36]).toMatchObject({ owner: 2, life: BOMB_STEPS - 3 });
    // It explodes on the lot: building damaged, steps to 0, hospital 5 days.
    const lotNode = g.board.nodes.find(n => landOf(g.board, n) && !g.objects.at(n.id) && !g.players.some(x => x.node === n.id))!;
    const land = landOf(g.board, lotNode)!;
    land.owner = 3; land.level = 3;
    q.node = lotNode.id;
    g.objects.slots[36].life = 1;
    expect(run(g.objects.step(q, 4)).value).toBe(0);
    expect(land.level).toBe(2);
    expect(q.bomb).toBe(0);
    expect(q.hospital).toBe(5);
    expect(g.objects.slots[36]).toMatchObject({ node: 0, owner: 0 });
    expect(g.tools.shopStock[3]).toBe(1);
  });

  it('gift and chest when stopping; monthly moves both back onto the map', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0];
    (g.tools as unknown as { receiveRandom: () => Flow<number> }).receiveRandom = function* () { return 5; };
    p.node = g.objects.slots[OBJ.Gift - 1].node;
    run(g.objects.step(p, 0));
    expect(onMap(g, OBJ.Gift)).toHaveLength(0);
    const points = p.points;
    p.node = g.objects.slots[OBJ.Chest - 1].node;
    const { events } = run(g.objects.step(p, 0));
    expect(p.points).toBe(points + 500);
    expect(events.some(e => (e as GameEvent).t === 'points')).toBe(true);
    expect(onMap(g, OBJ.Chest)).toHaveLength(0);
    const chestOld = g.objects.slots[OBJ.Chest - 1].node;
    expect(chestOld).toBe(0);
    run(g.objects.monthly());
    expect(onMap(g, OBJ.Gift)).toHaveLength(1);
    expect(onMap(g, OBJ.Chest)).toHaveLength(1);
  });

  it('Death: 13 days, worst luck, pays others\' fees, only one on the field', () => {
    const g = newGame();
    placeAll(g);
    const [p0, p1, p2] = g.players;
    run(g.objects.callDeath(p2));
    expect(g.objects.godType(p2)).toBe(OBJ.Death);
    expect(g.objects.slots[14]).toMatchObject({ owner: 3, life: 13 });
    expect([p2.luckBad, p2.luckMoney, p2.luckFate]).toEqual([1000, -200, -200]);
    expect(g.objects.deathPayer(p0)).toBe(2);
    expect(g.objects.deathPayer(p2)).toBeNull();
    run(g.objects.callDeath(p1));
    expect(p2.god).toBe(0);
    expect(p2.luckMoney).toBe(0);
    expect(g.objects.godType(p1)).toBe(OBJ.Death);
    expect(g.objects.slots.filter(o => o.type === OBJ.Death && o.owner)).toHaveLength(1);
    expect(g.objects.deathPayer(p0)).toBe(1);
  });

  it('送神符 sends away bad gods and bombs only; 请神符 calls the nearest god', () => {
    const g = newGame();
    placeAll(g);
    const p = g.players[0];
    p.node = g.objects.slots[OBJ.SmallFortune - 1].node;
    run(g.objects.step(p, 0));
    expect(run(g.objects.sendAwayGod(p)).value).toBe(false);
    expect(g.objects.godType(p)).toBe(OBJ.SmallFortune);
    p.node = g.objects.slots[OBJ.SmallPoor - 1].node;
    run(g.objects.step(p, 0));
    expect(run(g.objects.sendAwayGod(p)).value).toBe(true);
    expect(p.god).toBe(0);
    expect(onMap(g, OBJ.BigPoor)).toHaveLength(1);
    const target = g.objects.nearestInvitable(p);
    expect(target).not.toBe(0);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15]).toContain(g.objects.at(target)!.type);
    const type = g.objects.at(target)!.type;
    expect(run(g.objects.inviteGod(p, target)).value).toBe(true);
    expect(g.objects.godType(p)).toBe(type);
    const dog = g.objects.slots[OBJ.Dog - 1];
    if (dog.node) expect(run(g.objects.inviteGod(p, dog.node)).value).toBe(false);
  });

  it('landing effects: angel builds, devil demolishes, earth god takes the lot', () => {
    const g = newGame();
    placeAll(g);
    const [p, q] = g.players;
    const lotNode = g.board.nodes.find(n => landOf(g.board, n) && !g.players.some(x => x.node === n.id))!;
    const land = landOf(g.board, lotNode)!;
    land.owner = 2; land.level = 1;
    p.node = lotNode.id;
    const attachType = (type: number) => {
      const pair = g.objects.slots[(type % 2 ? type + 1 : type - 1) - 1];
      if (pair.node) g.objects.removeAt(pair.node);
      run(g.objects.attach(p, type));
    };
    attachType(OBJ.Angel);
    run(g.objects.landEffect(p));
    expect(land.level).toBe(2);
    attachType(OBJ.Devil);
    expect(g.objects.godType(p)).toBe(OBJ.Devil);
    run(g.objects.landEffect(p));
    expect(land.level).toBe(1);
    expect(q.hostility[0]).toBe(30);
    attachType(OBJ.EarthGod);
    expect(g.objects.godType(p)).toBe(OBJ.EarthGod);
    run(g.objects.landEffect(p));
    expect(land.owner).toBe(1);
    expect(land.level).toBe(1);
    expect(q.hostility[0]).toBe(30 + Math.trunc((land.price * 3) / 5));
  });

  it('bankruptcy detaches god and bomb', () => {
    const g = newGame();
    placeAll(g);
    const p: Player = g.players[0];
    p.node = g.objects.slots[OBJ.Angel - 1].node;
    run(g.objects.step(p, 0));
    const node = emptyNode(g);
    g.objects.place(OBJ.TimeBomb, node);
    p.node = node;
    run(g.objects.step(p, 0));
    g.objects.detachAll(p);
    expect([p.god, p.bomb, p.luckMoney]).toEqual([0, 0, 0]);
    expect(onMap(g, OBJ.Devil)).toHaveLength(1);
  });
});
