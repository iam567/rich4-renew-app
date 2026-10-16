/**
 * The rules hand the map director what it needs for the original's reaction lines (docs/rules/15): who was hit
 * by a card, before / after values for the result boxes, and the fate lines outside the result box.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { Answer, Ask, GameEvent, GameSettings, PickSpot, Player } from '../types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

function makeGame(seed = 3): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  const g = new Game(settings, board);
  const start = g.board.nodes.find(n => n.adjacent.filter(Boolean).length === 2 && !n.ref)!;
  for (const p of g.players) {
    p.placed = true;
    p.whoPlays = p.human ? 1 : 2;
    p.node = start.id;
    p.lastNode = start.adjacent.find(Boolean)!;
    p.cash = 50000; p.bank = 50000;
  }
  return g;
}

function drive<T>(flow: Flow<T>, answer: (a: Ask) => Answer = () => undefined) {
  const events: GameEvent[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) r = flow.next(answer(s)); else { events.push(s); r = flow.next(); }
  }
  return events;
}

const spot = (a: Ask, at: PickSpot['at'], id: number): Answer | null => {
  if (a.t !== 'pick-map') return null;
  const i = a.spots.findIndex(s => s.at === at && s.id === id);
  if (i < 0) throw new Error(`no ${at} ${id}`);
  return i;
};
const script = (...steps: ((a: Ask) => Answer | null)[]) => {
  let i = 0;
  return (a: Ask): Answer => {
    while (i < steps.length) { const v = steps[i++](a); if (v !== null) return v; }
    return a.t === 'pick-node' ? 0 : a.t === 'yesno' ? false : -1;
  };
};
const choose0 = (a: Ask) => (a.t === 'choose' ? 0 : null);
const fx = (events: GameEvent[], kind: string) => events.filter((s): s is Extract<GameEvent, { t: 'fx' }> => s.t === 'fx' && s.kind === kind);
const says = (events: GameEvent[]) => events.filter(s => s.t === 'say').map(s => (s as { text: string }).text);

describe.skipIf(!haveMaps)('card reactions from the rules', () => {
  it('購地卡: the buyer speaks once the purchase goes through, the seller after the money moved', () => {
    const g = makeGame(), p = g.players[0];
    const node = g.board.nodes.find(n => n.ref > 2000 && n.ref < 4000)!;
    const land = g.board.lands[node.ref - 2001];
    land.owner = 2; land.level = 1;
    p.node = node.id;
    p.cards = [3];
    const ev = drive(g.cards.humanUse(p), script(choose0));
    const kinds = ev.map(s => (s.t === 'fx' ? `fx:${s.kind}` : s.t));
    expect(kinds.indexOf('fx:card-line')).toBeLessThan(kinds.indexOf('pay'));
    expect(kinds.indexOf('pay')).toBeLessThan(kinds.indexOf('fx:card-result'));
    expect(fx(ev, 'card-line')[0]).toMatchObject({ p: 0, data: { card: 3, role: 0 } });
    expect(fx(ev, 'card-result')[0]).toMatchObject({ p: 0, target: 1, data: { card: 3, ref: node.ref } });
  });

  it('購地卡 without the money says nothing of the buyer', () => {
    const g = makeGame(), p = g.players[0];
    const node = g.board.nodes.find(n => n.ref > 2000 && n.ref < 4000)!;
    g.board.lands[node.ref - 2001].owner = 2;
    p.node = node.id; p.cash = 0;
    p.cards = [3];
    const ev = drive(g.cards.humanUse(p), script(choose0));
    expect(fx(ev, 'card-line')).toHaveLength(0);
    expect(says(ev)).toContain('您的現金不足！');
  });

  it('均貧卡 and 均富卡 report the cash before; the target of 均貧 is named', () => {
    const g = makeGame(), p = g.players[0];
    p.cash = 1000; g.players[2].cash = 9000;
    p.cards = [2, 1];
    const ev = drive(g.cards.humanUse(p), script(choose0, x => spot(x, 'actor', 2)));
    expect(fx(ev, 'card-result')[0]).toMatchObject({ target: 2, data: { card: 2, before: [[0, 1000], [2, 9000]], avg: 5000 } });
    const ev2 = drive(g.cards.humanUse(p), script(choose0));
    expect(fx(ev2, 'card-result')[0].data).toMatchObject({ card: 1, before: [[0, 5000], [1, 50000], [2, 5000], [3, 50000]] });
  });

  it('搶奪卡 names the robbed player and the thing taken', () => {
    const g = makeGame(), p = g.players[0];
    g.players[1].cards = [9];
    p.cards = [13];
    const ev = drive(g.cards.humanUse(p), script(choose0, x => spot(x, 'actor', 1), x => (x.t === 'choose' ? 9 : null)));
    expect(fx(ev, 'card-result')[0]).toMatchObject({ target: 1, data: { card: 13, got: 9 } });
    expect(says(ev).some(t => t.startsWith('搶到'))).toBe(false);
  });

  it('查稅卡 names the one who paid, also after a frame card moved the bill', () => {
    const g = makeGame(), p = g.players[0];
    const t = g.players[1], other = g.players[2];
    t.cards = [19]; t.cash = 50000; t.hostility[2] = 1000; other.cash = 30000;
    p.cards = [26];
    const ev = drive(g.cards.humanUse(p), script(choose0, x => spot(x, 'actor', 1)));
    expect(fx(ev, 'card-result')[0]).toMatchObject({ target: 2, data: { card: 26, tax: 6000 } });
    // The frame card: its box, then the scapegoat's card[2][18] instead of an invented line.
    expect(says(ev)).toContain(`嫁禍給${g.name(2)}！`);
    expect(says(ev)).not.toContain('冤枉啊！');
    expect(fx(ev, 'card-line')).toContainEqual(expect.objectContaining({ p: 2, data: { card: 19, role: 2 } }));
  });

  it('陷害卡: the prisoner speaks after the prison; a revenge card makes the attacker speak first', () => {
    const g = makeGame(), p = g.players[0];
    g.players[1].cards = [18];
    p.cards = [17];
    const ev = drive(g.cards.humanUse(p), script(choose0, x => spot(x, 'actor', 1)));
    const lines = fx(ev, 'card-line').map(s => [s.p, s.data?.card]);
    expect(lines).toEqual([[1, 17], [0, 18]]);
    expect(g.players[1].prison).toBe(5);
    expect(g.players[0].prison).toBe(5);
    expect(says(ev).some(t => t.includes('使用復仇卡'))).toBe(false);
  });

  it('夢遊卡 revenge is marked so the attacker says no sleepwalk line', () => {
    const g = makeGame(), p = g.players[0];
    g.players[1].cards = [18];
    p.cards = [16];
    const ev = drive(g.cards.humanUse(p), script(choose0, x => spot(x, 'actor', 1)));
    const sw = fx(ev, 'sleepwalk');
    expect(sw.map(s => [s.p, s.target, !!s.data?.revenge])).toEqual([[0, 1, false], [1, 0, true]]);
  });

  it('換地卡 carries the owners and levels from before the swap', () => {
    const g = makeGame(), p = g.players[0];
    const lands = g.board.nodes.filter(n => n.ref > 2000 && n.ref < 4000);
    const a = lands[0], b = lands.find(n => n.ref !== a.ref)!;
    const la = g.board.lands[a.ref - 2001], lb = g.board.lands[b.ref - 2001];
    la.owner = 1; la.level = 1; lb.owner = 3; lb.level = 4;
    p.node = a.id;
    p.cards = [4];
    const ev = drive(g.cards.humanUse(p), script(choose0, x => spot(x, 'plot', b.ref)));
    expect(fx(ev, 'swap-land')[0].data).toEqual({ a: a.ref, b: b.ref, ownerA: 1, ownerB: 3, levelA: 1, levelB: 4 });
  });

  it('紅卡 / 黑卡 carry the price before and after and who holds the stock', () => {
    const g = makeGame(), p = g.players[0];
    g.stocks.holdings[1][0].shares = 300;
    p.cards = [24];
    const before = g.stocks.stocks[0].price;
    const ev = drive(g.cards.humanUse(p), script(choose0, x => (x.t === 'choose' ? 0 : null)));
    const s = fx(ev, 'stock-up')[0];
    expect(s.data).toMatchObject({ slot: 0, card: 24, before, after: g.stocks.stocks[0].price, holders: [[1, 300]] });
    expect(g.stocks.stocks[0].price).toBeGreaterThan(before);
  });
});

describe.skipIf(!existsSync(mapFile(0)))('fate lines outside the result box', () => {
  const newGame = () => {
    const g = makeGameOn(0);
    g.objects.luck = function* () { return 0; };
    g.cards.pardonOrFrame = function* (p: Player) { return p.id; };
    return g;
  };
  const run = (flow: Flow) => drive(flow);
  const result = (ev: GameEvent[]) => fx(ev, 'event-result')[0]?.data as { line?: string } | undefined;

  it('fate 1 (expropriation) has no line; fate 0 keeps the owner\'s cry', () => {
    const g = newGame(), p = g.players[0];
    const [a, b] = g.board.lands;
    a.owner = 1; a.level = 2; b.owner = 1; b.level = 0;
    expect(result(run(g.events.applyFate(p, 0)))?.line).toBe('cry');
    a.level = 0;
    expect(result(run(g.events.applyFate(p, 1)))?.line).toBeUndefined();
  });

  it('fate 32 makes the player lament with event[3]; escaping prison by luck says event[0]', () => {
    const g = newGame(), p = g.players[0];
    p.cards = [3]; p.tools[0] = 1;
    expect(fx(run(g.events.applyFate(p, 32)), 'lament')).toEqual([{ t: 'fx', kind: 'lament', p: 0, data: { slot: 3, face: 2 } }]);
    g.objects.luck = function* () { return 1; };
    expect(fx(run(g.events.applyFate(p, 33)), 'lament')).toEqual([{ t: 'fx', kind: 'lament', p: 0, data: { slot: 0, face: 0 } }]);
    // Other misfortunes escaped by luck have no line (fcn_0044c5d8 …).
    expect(fx(run(g.events.applyFate(p, 6)), 'lament')).toEqual([]);
  });
});

function makeGameOn(mapId: number): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const g = new Game({
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 99,
  }, board);
  g.players.forEach((p, i) => {
    Object.assign(p, { placed: true, whoPlays: 2, node: g.board.nodes[i * 7].id, traffic: 0, dice: 1, cash: 50000, bank: 50000, loan: 0, insurance: 0, god: 0, cards: [] as number[] });
    p.tools.fill(0);
  });
  for (const l of g.board.lands) { l.owner = 0; l.level = 0; l.chain = false; }
  return g;
}
