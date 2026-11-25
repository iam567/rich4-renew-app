import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import type { Flow } from './flow';
import { Game } from './game';
import type { GameSettings } from './types';
import { CARDS, HELL_PER_HEAD, HELL_RARE } from './modules/cards';
import { OBJ } from './modules/objects';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

/** 地獄 (the user 2026-11-16): one human and `n - 1` computers on map 1; `level` a party room's oldest version. */
function hellGame(n = 4, aiLevel: 0 | 1 | 2 | 3 = 3, level?: string): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: Array.from({ length: n }, (_, i) => ({ character: i, human: i === 0 })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 16), seed: 7, aiLevel, ...(level ? { level } : {}),
  };
  const g = new Game(settings, board);
  for (const p of g.players) { p.placed = true; p.whoPlays = p.human ? 1 : 2; }
  return g;
}
function run<T>(flow: Flow<T>): T {
  let r = flow.next();
  while (!r.done) r = flow.next(undefined as never);
  return r.value;
}

describe.skipIf(!haveMaps)('地獄 rules (the user 2026-11-16)', () => {
  it('tools 1-8: as many in the game as players, the starting ones out of them', () => {
    const g = hellGame(4);
    expect(g.hellRules()).toBe(true);
    // everyone starts with 機器娃娃, 路障, 地雷, 定時炸彈, 遙控骰子: all four of each are in hands
    for (const t of [1, 2, 3, 4, 8]) expect(g.tools.shopStock[t - 1]).toBe(0);
    expect(g.tools.shopStock[4]).toBe(4); // 機車
    expect(g.tools.toolShelf()).not.toContain(8);
    // used: back in the pool, one on the shelf
    g.tools.consume(g.players[1], 8);
    expect(g.tools.shopStock[7]).toBe(1);
    expect(g.tools.toolShelf()).toContain(8);
    // a gift can't make a fifth
    const p = g.players[0];
    expect(g.tools.receive(p, 2)).toBe(false);
  });
  it('cards: rare ones one each, the fighting ones one per player, one of a kind in a hand', () => {
    const g = hellGame(3);
    for (const c of CARDS) {
      if (HELL_RARE.has(c.id)) expect(g.cards.remaining[c.id - 1]).toBe(1);
      else if (HELL_PER_HEAD.has(c.id)) expect(g.cards.remaining[c.id - 1]).toBe(3);
    }
    const [a, b] = g.players;
    expect(g.cards.receive(a, 17)).toBe(true);
    expect(g.cards.receive(a, 17)).toBe(false); // one 陷害卡 in a hand
    expect(g.cards.room(a, 17)).toBe(false);
    expect(g.cards.receive(b, 24)).toBe(true);
    expect(g.cards.receive(g.players[2], 24)).toBe(false); // the one 紅卡 is out
    g.cards.consume(b, 24);
    expect(g.cards.receive(g.players[2], 24)).toBe(true); // back in the pool, taken again
    // draws skip what the hand has
    for (let i = 0; i < 40; i++) { const id = run(g.cards.receiveRandom(a)); if (HELL_RARE.has(id) || HELL_PER_HEAD.has(id)) expect(a.cards.filter(c => c === id).length).toBe(1); }
  });
  it("a lab's tools are not sold back; tools 1-8 are", () => {
    const g = hellGame(4), p = g.players[0];
    expect(p.tools[8]).toBeGreaterThan(0); // 機器工人, a starting tool
    expect(g.tools.sellTool(p, 9)).toBe(0);
    expect(p.tools[8]).toBeGreaterThan(0);
    expect(g.tools.sellTool(p, 2)).toBeGreaterThan(0);
  });
  it('a chest gives 100 to 500 points', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 30; k++) {
      const g = hellGame(4), p = g.players[1], node = g.board.nodes.find(n => n.event === 1 || (n.event === 0 && !n.ref))!;
      const o = g.objects.slots.find(x => x.type === OBJ.Chest) ?? g.objects.slots[0];
      for (const x of g.objects.slots) x.node = 0;
      Object.assign(o, { type: OBJ.Chest, node: node.id, owner: 0 });
      p.node = node.id; p.points = 0;
      for (let i = 0; i < k; i++) g.rng.rand();
      run(g.objects.step(p, 0));
      expect(p.points).toBeGreaterThanOrEqual(100);
      expect(p.points).toBeLessThanOrEqual(500);
      seen.add(p.points);
    }
    expect(seen.size).toBeGreaterThan(5);
  });
  it('魔法屋: the computer picks what hurts the human most', () => {
    const g = hellGame(4), [h, c] = g.players;
    h.cards = [1, 2, 17]; // a hand worth a lot
    expect(g.smart.magicSpell(c, [h])).toBe(0);
    h.cards = []; h.tools.fill(0); h.tools[12] = 2; // two 核子飛彈
    expect(g.smart.magicSpell(c, [h])).toBe(8);
    h.tools.fill(0);
    expect(g.smart.magicSpell(c, [h])).toBe(10); // nothing to sell: the hospital
    expect(g.smart.magicSpell(c, [g.players[2]])).toBe(6); // only a fellow computer: a card for it
  });
  it('other levels and older rooms keep the old rules', () => {
    for (const g of [hellGame(4, 2), hellGame(4, 3, '1.2.2')]) {
      expect(g.hellRules()).toBe(false);
      expect(g.tools.shopStock[7]).toBe(10 - 4);
      expect(g.cards.remaining[0]).toBe(2); // 均富卡: the remake's 2
      const p = g.players[0];
      expect(g.tools.sellTool(p, 9)).toBeGreaterThan(0);
    }
  });
  it('shares: no long runs up or down', () => {
    // over a year, the longest run of days the same way, per share, on average
    const runs = (g: Game) => {
      let total = 0;
      const n = g.stocks.stocks.length;
      const last = new Array(n).fill(0), len = new Array(n).fill(0), best = new Array(n).fill(0);
      for (let d = 0; d < 360; d++) {
        g.stocks.restDays = 0;
        g.stocks.update();
        g.stocks.stocks.forEach((s, i) => {
          const dir = Math.sign(s.price - s.prevClose);
          len[i] = dir && dir === last[i] ? len[i] + 1 : 1;
          last[i] = dir;
          best[i] = Math.max(best[i], len[i]);
        });
      }
      for (const b of best) total += b;
      return total / n;
    };
    const hell = runs(hellGame(4)), hard = runs(hellGame(4, 2));
    // (2026-11-16: 困難 17.5 days, 地獄 9 — about a coin's longest run in 360 throws)
    expect(hell).toBeLessThan(hard * 0.7);
    expect(hell).toBeLessThan(12);
  });
});
