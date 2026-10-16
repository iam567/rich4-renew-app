/**
 * Map targets of the tools and cards a human picks on the map (05 §2.6 select flags, 04 §2.4): every kind of thing
 * the original's selector accepts is offered, so whatever shows on the screen can be picked (the screen itself
 * is the board view's business: ui/pick-hit.ts).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { Answer, Ask, GameSettings, Player } from '../types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

function newGame(): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 7,
  };
  return new Game(settings, board);
}

const road = (g: Game) => g.board.nodes.filter(n => n.adjacent.some(Boolean) && !n.noDrop);

function put(g: Game, p: Player, node: number) {
  p.placed = true;
  p.whoPlays = p.human ? 1 : 2;
  p.node = node;
  p.lastNode = g.node(node).adjacent.find(Boolean)!;
}

/** Runs a flow, answering with `answer`; returns every question asked. */
function asks<T>(flow: Flow<T>, answer: (a: Ask, i: number) => Answer): Ask[] {
  const out: Ask[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) { out.push(s); r = flow.next(answer(s, out.length - 1)); } else r = flow.next();
  }
  return out;
}

/** A board with something of every kind on it: players, an NPC on the road, a god, a roadblock, a carried bomb. */
function scene() {
  const g = newGame(), [me, a, b, c] = g.players, free = road(g);
  put(g, me, free[0].id); put(g, a, free[3].id); put(g, b, free[6].id); put(g, c, free[9].id);
  const npc = g.places.npcs[0];
  npc.where = 0; npc.node = free[12].id;
  g.objects.place(12, free[15].id); // 土地公 lying on the road
  g.objects.place(16, free[18].id); // roadblock
  g.objects.place(18, free[21].id); // a time bomb carried by a player (it moves with them: not a road target)
  const slot = g.objects.slots.findIndex(o => o.type === 18 && o.node === free[21].id);
  Object.assign(g.objects.slots[slot], { owner: a.id + 1, node: 0 });
  a.bomb = slot + 1;
  return { g, me, free, npc, god: free[15].id, block: free[18].id };
}

describe.skipIf(!haveMaps)('map targets (05 §2.6)', () => {
  it('傳送機 offers people, NPCs, every object on the road, lots and facilities (0x1200036), on screen', () => {
    const { g, me, god, block } = scene();
    me.tools[10] = 1;
    const q = asks(g.tools.humanUse(me), (a, i) => (i === 0 ? 11 : a.t === 'pick-map' ? -1 : -1));
    const pick = q.find(a => a.t === 'pick-map');
    expect(pick?.t).toBe('pick-map');
    if (pick?.t !== 'pick-map') return;
    expect(pick.onScreen).toBe(true);
    const has = (at: string, id: number) => pick.spots.some(s => s.at === at && s.id === id);
    for (const p of g.players) expect(has('actor', p.id)).toBe(true);
    expect(has('actor', 4)).toBe(true);                 // the NPC standing on the road
    expect(has('node', god)).toBe(true);                // the god lying on the road
    expect(has('node', block)).toBe(true);              // a roadblock
    expect(pick.spots.find(s => s.at === 'node' && s.id === god)?.label).toBe('土地公');
    // The carried bomb is not a spot of its own: its carrier is what is tapped.
    const lying = g.objects.slots.filter(o => o.type && o.node && !o.owner).map(o => o.node);
    expect(pick.spots.filter(s => s.at === 'node').map(s => s.id).sort()).toEqual(lying.sort());
    for (const l of g.board.lands) expect(has('plot', l.id + 2000)).toBe(true);
    for (const f of g.board.facilities) expect(has('plot', f.id + 4000)).toBe(true);
  });

  it('傳送機: an object goes to any empty road node on screen; a lot to an empty unowned lot', () => {
    const { g, me, god } = scene();
    me.tools[10] = 2;
    let srcSpots: number[] = [];
    const q = asks(g.tools.humanUse(me), (a, i) => {
      if (i === 0) return 11;
      if (a.t === 'pick-map') { srcSpots = [a.spots.findIndex(s => s.at === 'node' && s.id === god)]; return srcSpots[0]; }
      if (a.t === 'pick-node') return 0;
      return -1;
    });
    const dest = q.find(a => a.t === 'pick-node');
    expect(dest?.t === 'pick-node' && dest.onScreen).toBe(true);
    if (dest?.t !== 'pick-node') return;
    const occupied = new Set([...g.players.map(p => p.node), g.places.npcs[0].node, ...g.objects.slots.filter(o => o.type && o.node && !o.owner).map(o => o.node)]);
    expect(dest.nodes.length).toBeGreaterThan(10);
    for (const n of dest.nodes) expect(occupied.has(n)).toBe(false);
  });

  it('路障 / 地雷 / 定時炸彈: every empty road node (0x1), on screen', () => {
    for (const tool of [2, 3, 4]) {
      const { g, me } = scene();
      const q = asks(g.tools.humanUse(me), (a, i) => (i === 0 ? tool : a.t === 'pick-node' ? 0 : -1));
      const pick = q.find(a => a.t === 'pick-node');
      expect(pick?.t === 'pick-node' && pick.onScreen).toBe(true);
      if (pick?.t !== 'pick-node') continue;
      const roadNodes = g.board.nodes.filter(n => n.adjacent.some(Boolean));
      const empty = roadNodes.filter(n => !g.players.some(p => p.node === n.id) && !g.objects.at(n.id) && !g.places.npcs.some(c => c.where === 0 && c.node === n.id));
      expect(new Set(pick.nodes)).toEqual(new Set(empty.map(n => n.id)));
    }
  });

  it('機器工人: every lot and facility by the road (0x2090006), shown on the plot, on screen', () => {
    const { g, me } = scene();
    me.tools[8] = 1;
    const q = asks(g.tools.humanUse(me), (a, i) => (i === 0 ? 9 : a.t === 'pick-node' ? 0 : -1));
    const pick = q.find(a => a.t === 'pick-node');
    expect(pick?.t === 'pick-node' && pick.onScreen && pick.plot).toBe(true);
    if (pick?.t !== 'pick-node') return;
    const refs = new Set(pick.nodes.map(n => g.node(n).ref));
    const want = new Set(g.board.nodes.map(n => n.ref).filter(r => (r > 2000 && r < 4000) || (r > 4000 && r < 6000)));
    expect(refs).toEqual(want);
  });

  it('飛彈 / 核子飛彈: any road node of the whole map, scrolling (0x300c0 / 0x400c0)', () => {
    for (const tool of [7, 13]) {
      const { g, me } = scene();
      me.tools[tool - 1] = 1;
      const q = asks(g.tools.humanUse(me), (a, i) => (i === 0 ? tool : a.t === 'pick-node' ? 0 : -1));
      const pick = q.find(a => a.t === 'pick-node');
      expect(pick?.t).toBe('pick-node');
      if (pick?.t !== 'pick-node') continue;
      expect(pick.onScreen).toBeFalsy();
      expect(pick.nodes.length).toBe(g.board.nodes.filter(n => n.adjacent.some(Boolean)).length);
    }
  });

  it('拆除卡: built lots not one\'s own, roadblocks / mines / bombs on the road, on screen', () => {
    const { g, me, block } = scene();
    const mine = g.board.lands[0], other = g.board.lands[1];
    mine.owner = me.id + 1; mine.level = 2;
    other.owner = 2; other.level = 1;
    me.cards = [12];
    const q = asks(g.cards.humanUse(me), (_a, i) => (i === 0 ? 0 : -1));
    const pick = q.find(a => a.t === 'pick-map');
    expect(pick?.t === 'pick-map' && pick.onScreen).toBe(true);
    if (pick?.t !== 'pick-map') return;
    const has = (at: string, id: number) => pick.spots.some(s => s.at === at && s.id === id);
    expect(has('plot', other.id + 2000)).toBe(true);
    expect(has('plot', mine.id + 2000)).toBe(false);
    expect(has('node', block)).toBe(true);
  });
});
