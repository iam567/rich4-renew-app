import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard, type Board } from './board';
import { Game } from './game';
import { pack } from './date';
import type { Flow } from './flow';
import type { Step } from './types';
import './qingming'; // registers map 111's rules
import type { QingmingRules } from './qingming';
import { GODS } from './modules/objects';
import { JUYI_SETS, LING, LING_CONSOLATION, applyLing, drawSeat, exchangeJuyi, gradeOf, lingText, readySets } from './qingming-ling';

const raw = JSON.parse(readFileSync('../editor/site/assets/remake/qingming.json', 'utf8'));
let board: Board | undefined;
const newGame = (seed = 7) => {
  board ??= parseBoard(raw);
  const g = new Game({ mapId: 111, players: [0, 4, 9, 11].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 19), seed }, board);
  return { g, r: g.rules as QingmingRules };
};

/** Runs a flow to the end; any question fails the test. Checks money and points after every step. */
function drive(g: Game, f: Flow<unknown>, seen: Step[] = []): Step[] {
  for (let s = f.next(); !s.done; s = f.next(undefined as never)) {
    const v = s.value as Step & { ask?: boolean };
    if (v.ask) throw new Error('asked: ' + JSON.stringify(v));
    for (const p of g.players) {
      expect(p.cash, `cash of ${p.id}`).toBeGreaterThanOrEqual(0);
      expect(p.bank, `bank of ${p.id}`).toBeGreaterThanOrEqual(0);
      expect(p.points, `points of ${p.id}`).toBeGreaterThanOrEqual(0);
    }
    seen.push(v);
  }
  return seen;
}

const townRoad = (g: Game, r: QingmingRules) => g.board.nodes.filter(n => r.inTown(n) && n.adjacent.filter(Boolean).length && n.ref < 8001 && !n.noDrop);

/** A town full of things: everyone owns streets with houses (the last lot of each street left empty), cards, cash. */
function richWorld(seed = 7) {
  const { g, r } = newGame(seed);
  r.daily(g); // (the gods of a new game may start outside the wall: Objects.init runs before Game.rules is set)
  const ls = [...r.liangshan()].filter(id => g.board.specials?.[id] === 'ling');
  for (const p of g.players) { p.placed = true; p.whoPlays = p.id ? 2 : 1; }
  const names = [...new Set(g.board.lands.map(l => l.name))];
  names.forEach((nm, i) => {
    const owner = i % 5;                     // 4: nobody's
    const lots = g.board.lands.filter(l => l.name === nm);
    lots.forEach((l, j) => { if (owner < 4) { l.owner = owner + 1; l.level = j === lots.length - 1 ? 0 : (j % 3) + 1; } });
  });
  g.board.facilities.forEach((f, i) => { if (i < 4) { f.owner = i + 1; f.type = 2; f.level = 2; } });
  // a sealed lot of p0's (裴宣)
  g.board.lands.find(l => l.owner === 1 && l.level)!.tmpState = 0x51;
  // where they stand: p0 on 梁山, the others in town beside someone's house
  const p0 = g.players[0];
  p0.node = ls[0]; p0.lastNode = g.node(ls[0]).adjacent.find(Boolean)!;
  const besideHouse = townRoad(g, r).filter(n => n.ref > 2000 && n.ref < 4000 && g.board.lands[n.ref - 2001].level > 0);
  [1, 2, 3].forEach((id, k) => {
    const n = besideHouse[k * 7], q = g.players[id];
    q.node = n.id; q.lastNode = n.adjacent.find(Boolean)!;
  });
  Object.assign(p0, { cash: 50000, bank: 20000, cards: [3, 6, 12] });
  Object.assign(g.players[1], { cash: 80000, cards: [13, 17], traffic: 1, dice: 2 });
  Object.assign(g.players[2], { cash: 30000, cards: [21] });
  Object.assign(g.players[3], { cash: 10000, cards: [14] });
  const slot = g.stocks.stocks.findIndex((_, i) => g.stocks.companyOf(i));
  g.stocks.holdings[0][slot] = { shares: 1000, avgCost: g.stocks.stocks[slot].price };
  g.current = 0;
  return { g, r, p0 };
}

/** Nothing anywhere: nobody owns anything, everyone on 梁山, no gods or people in town, the drawer broke. */
function emptyWorld(seed = 7) {
  const { g, r } = newGame(seed);
  const ls = [...r.liangshan()].filter(id => g.board.specials?.[id] === 'ling');
  for (const p of g.players) {
    p.placed = true; p.whoPlays = p.id ? 2 : 1;
    p.node = ls[p.id]; p.lastNode = g.node(ls[p.id]).adjacent.find(Boolean)!;
    p.cards = []; p.tools.fill(0);
  }
  Object.assign(g.players[0], { cash: 0, bank: 0 });
  for (const o of g.objects.slots) if (GODS.has(o.type)) Object.assign(o, { node: 0, owner: 0 });
  for (const n of g.places.npcs) n.where = 3;
  g.current = 0;
  return { g, r, p0: g.players[0] };
}

const consoled = (steps: Step[]) => steps.some(s => s.t === 'say' && s.text.includes(`改得${LING_CONSOLATION}點券`));

describe('梁山令', () => {
  it('the table: 108 heroes by seat, their stars and grades', () => {
    expect(LING).toHaveLength(108);
    expect(LING[0]).toMatchObject({ seat: 1, name: '宋江', nick: '呼保義', star: '天魁星', grade: 'legend' });
    expect(LING[107]).toMatchObject({ seat: 108, name: '段景住', nick: '金毛犬', star: '地狗星', grade: 'common' });
    expect(LING.filter(c => c.grade === 'legend')).toHaveLength(6);
    expect(LING.filter(c => c.grade === 'rare')).toHaveLength(12);
    expect(LING.filter(c => c.grade === 'high')).toHaveLength(18);
    for (const c of LING) { expect(c.text.length).toBeGreaterThan(4); expect(c.grade).toBe(gradeOf(c.seat)); }
    expect(new Set(JUYI_SETS.map(s => s.id)).size).toBe(JUYI_SETS.length);
    expect(JUYI_SETS).toHaveLength(37);
    for (const s of JUYI_SETS) expect(['夫妻檔', '兄弟檔', '主僕搭檔', '山頭故事', '大檔']).toContain(s.group);
  });

  it('drawSeat: the grades by their chances', () => {
    const { g } = newGame(3);
    const n = 200000, c = { legend: 0, rare: 0, high: 0, common: 0 }, t = { legend: 0, rare: 0, high: 0, common: 0 };
    for (let i = 0; i < n; i++) { c[gradeOf(drawSeat(g, 'any'))]++; t[gradeOf(drawSeat(g, 'tiangang'))]++; }
    expect(c.legend / n).toBeCloseTo(0.01, 2);
    expect(c.rare / n).toBeCloseTo(0.04, 2);
    expect(c.high / n).toBeCloseTo(0.15, 2);
    expect(c.common / n).toBeCloseTo(0.80, 2);
    expect(t.common).toBe(0);
    expect(t.high / n).toBeCloseTo(0.75, 2);
    expect(t.rare / n).toBeCloseTo(0.20, 2);
    for (let i = 0; i < 1000; i++) expect(drawSeat(g, 'legend')).toBeLessThanOrEqual(6);
  });

  it('every card in a full town: something happens, no question, nobody below 0, the drawer stays on 梁山', () => {
    for (let seat = 1; seat <= 108; seat++) {
      const { g, r, p0 } = richWorld(seat);
      if (seat === 77) g.places.npcTo(g.npcBase + 2, 'prison');     // 流氓 in the 開封府
      if (seat === 90) g.places.npcTo(g.npcBase + 1, 'hospital');   // 強盜 at 趙太丞家
      const steps = drive(g, applyLing(g, p0, seat, r));
      expect(steps[0], `seat ${seat}`).toMatchObject({ t: 'fx', kind: 'qm-ling', data: { seat, grade: gradeOf(seat), human: true, text: lingText(LING[seat - 1].text, g.priceIndex) } });
      expect(consoled(steps), `seat ${seat} found nothing in a full town`).toBe(false);
      expect(r.liangshan().has(p0.node), `seat ${seat} moved the drawer`).toBe(true);
      expect(steps.some(s => s.t === 'teleport' && s.p === 0), `seat ${seat} teleported the drawer`).toBe(false);
      expect(p0.hospital || p0.prison, `seat ${seat}`).toBe(0);
      expect(r.ling.got[0]).toContain(seat);
      // the camera goes to town: a result box with a square or lots there (the drawer's own ones excepted)
      const box = steps.find(s => s.t === 'fx' && s.kind === 'event-result') as { node?: number; data: { refs?: number[] } } | undefined;
      expect(box, `seat ${seat} shows no result`).toBeTruthy();
    }
  }, 120000);

  it('every card with nothing to work on: 30 點券 instead (and no question)', () => {
    const always = new Set([10, 17, 20, 27, 28, 48, 50, 52, 53, 57, 60, 68, 95, 65, 70, 76, 99, 104, 106, 108]);
    for (let seat = 1; seat <= 108; seat++) {
      const { g, r, p0 } = emptyWorld(seat);
      const before = p0.points;
      const steps = drive(g, applyLing(g, p0, seat, r));
      expect(r.liangshan().has(p0.node), `seat ${seat}`).toBe(true);
      expect(consoled(steps), `seat ${seat}`).toBe(!always.has(seat));
      if (!always.has(seat)) expect(p0.points - before, `seat ${seat}`).toBe(LING_CONSOLATION);
    }
  });

  it('a computer drawer is asked nothing either', () => {
    for (let seat = 1; seat <= 108; seat++) {
      const { g, r, p0 } = richWorld(1000 + seat);
      p0.whoPlays = 2;
      drive(g, applyLing(g, p0, seat, r));
    }
  }, 120000);

  it('宋江: every own house in town one level up', () => {
    const { g, r, p0 } = richWorld();
    const mine = g.board.lands.filter(l => l.owner === 1);
    const was = mine.map(l => l.level);
    drive(g, applyLing(g, p0, 1, r));
    mine.forEach((l, i) => expect(l.level).toBe(was[i] > 0 && was[i] < 5 && !l.chain ? was[i] + 1 : was[i]));
    expect(g.board.facilities[0].level).toBe(3);
  });

  it('盧俊義: one own house straight to 5', () => {
    const { g, r, p0 } = richWorld();
    const mine = g.board.lands.filter(l => l.owner === 1), was = mine.map(l => l.level);
    const fac = g.board.facilities[0].level;
    drive(g, applyLing(g, p0, 2, r));
    const changed = mine.filter((l, i) => l.level !== was[i]);
    const facChanged = g.board.facilities[0].level !== fac;
    expect(changed.length + (facChanged ? 1 : 0)).toBe(1);
    if (changed.length) expect(changed[0].level).toBe(5);
  });

  it('no card or set writes the price index: the amounts as they are now', () => {
    for (const t of [...LING.map(c => c.text), ...JUYI_SETS.map(x => x.reward)]) expect(t).not.toMatch(/指數/);
    expect(lingText(LING[16].text, 1)).toBe('生辰綱：一大筆錢，10,000元');
    expect(lingText(LING[16].text, 2.5)).toBe('生辰綱：一大筆錢，25,000元');
    const { g, r, p0 } = richWorld();
    g.priceIndex = 2;
    const was = p0.cash;
    const steps = drive(g, applyLing(g, p0, 17, r));
    expect(steps[0]).toMatchObject({ data: { text: '生辰綱：一大筆錢，20,000元' } });
    expect(p0.cash - was).toBe(20000);
  });

  it('吳用 / 公孫勝: own cheapest plots for the opponents\' dearest, one and two of them, houses with the land', () => {
    for (const [seat, n] of [[3, 1], [4, 2]] as const) {
      const { g, r, p0 } = richWorld();
      const owned = () => g.board.lands.filter(l => l.owner === 1).map(l => l.id).sort((a, b) => a - b);
      const before = owned(), lv = new Map(g.board.lands.map(l => [l.id, l.level]));
      drive(g, applyLing(g, p0, seat, r));
      const after = owned(), gained = after.filter(id => !before.includes(id)), lost = before.filter(id => !after.includes(id));
      expect(gained.length + lost.length, `seat ${seat}`).toBeGreaterThan(0);
      for (const l of g.board.lands) expect(l.level).toBe(lv.get(l.id));
      expect(gained.length).toBeLessThanOrEqual(n);
    }
  });

  it('張橫: 20 roadblocks on squares in town', () => {
    const { g, r, p0 } = richWorld();
    const before = g.objects.slots.filter(o => o.type === 16 && o.node).length;
    drive(g, applyLing(g, p0, 28, r));
    const blocks = g.objects.slots.filter(o => o.type === 16 && o.node);
    expect(blocks.length - before).toBe(20);
    for (const o of blocks) expect(r.inTown(g.node(o.node))).toBe(true);
  });

  it('時遷 / 楊林: the NPCs come out and walk in town for the drawer (kept)', () => {
    const { g, r, p0 } = richWorld();
    drive(g, applyLing(g, p0, 51, r));
    drive(g, applyLing(g, p0, 107, r));
    for (const i of [3, 0]) { const n = g.places.npcs[i]; expect(n.where).toBe(0); expect(r.inTown(g.node(n.node))).toBe(true); }
  });

  it('凌振: 20 mines in town; 蔣敬: every opponent gives 10 % of their cash', () => {
    const { g, r, p0 } = richWorld();
    const before = g.objects.slots.filter(o => o.type === 17 && o.node).length;
    drive(g, applyLing(g, p0, 52, r));
    expect(g.objects.slots.filter(o => o.type === 17 && o.node).length - before).toBe(20);
    const cash = g.players.map(q => q.cash), mine = p0.cash + p0.bank;
    drive(g, applyLing(g, p0, 53, r));
    const paid = [1, 2, 3].map(i => cash[i] - g.players[i].cash);
    [1, 2, 3].forEach((i, k) => expect(paid[k]).toBe(Math.trunc(cash[i] * 0.1)));
    expect(p0.cash + p0.bank - mine).toBe(paid.reduce((a, b) => a + b, 0));
  });

  it('安道全: everyone out of the hospital; 皇甫端: 15 dogs in town', () => {
    const { g, r, p0 } = richWorld();
    const q = g.players[2];
    drive(g, g.sendTo(q, 'hospital', 3));
    drive(g, applyLing(g, p0, 56, r));
    expect(q.hospital).toBe(0x80);
    const before = g.objects.slots.filter(o => o.type === 11 && o.node).length;
    drive(g, applyLing(g, p0, 57, r));
    expect(g.objects.slots.filter(o => o.type === 11 && o.node).length - before).toBe(15);
  });

  it('王英: one of the drawer\'s own tools copied; 鮑旭: five 大衰神 more in town', () => {
    const { g, r, p0 } = richWorld();
    p0.tools.fill(0); p0.tools[2] = 1;
    drive(g, applyLing(g, p0, 58, r));
    expect(p0.tools[2]).toBe(2);
    const bad = () => g.objects.slots.filter(o => o.type === 8 && o.node && r.inTown(g.node(o.node))).length;
    const before = bad();
    drive(g, applyLing(g, p0, 60, r));
    expect(bad() - before).toBe(5);
  });

  it('童威: a free lot on the 汴河\'s banks made the drawer\'s; 童猛: an owned one there washed away', () => {
    const { g, r, p0 } = richWorld();
    const bank = (l: { y: number; id: number }) => Math.abs(l.y - 31 * 48) <= 140 && g.board.nodes.some(n => n.ref === l.id + 2000 && r.inTown(n));
    const mine = () => g.board.lands.filter(l => bank(l) && l.owner === 1).length, owned = () => g.board.lands.filter(l => bank(l) && l.owner > 0).length;
    const m0 = mine();
    drive(g, applyLing(g, p0, 68, r));
    expect(mine()).toBe(m0 + 1);
    const o0 = owned();
    drive(g, applyLing(g, p0, 69, r));
    expect(owned()).toBe(o0 - 1);
  });

  it('童威 with no empty lot by the 汴河: an opponent\'s lot there, its house with it', () => {
    const { g, r, p0 } = richWorld();
    const bank = (l: { y: number; id: number }) => Math.abs(l.y - 31 * 48) <= 140 && g.board.nodes.some(n => n.ref === l.id + 2000 && r.inTown(n));
    for (const l of g.board.lands) if (bank(l) && (l.owner === 0 || l.level === 0)) { l.owner = 2; l.level = 1; }
    const theirs = g.board.lands.filter(l => bank(l) && l.owner > 1).length, mine = g.board.lands.filter(l => bank(l) && l.owner === 1).length;
    drive(g, applyLing(g, p0, 68, r));
    expect(g.board.lands.filter(l => bank(l) && l.owner === 1).length).toBe(mine + 1);
    expect(g.board.lands.filter(l => bank(l) && l.owner > 1).length).toBe(theirs - 1);
  });

  it('段景住: every chest and gift box on the town\'s road is the drawer\'s', () => {
    const { g, r, p0 } = richWorld();
    const road = g.board.nodes.filter(n => r.inTown(n) && n.adjacent.some(Boolean) && n.ref < 8001 && !n.noDrop && !g.objects.at(n.id) && !g.occupants(n.id).length);
    for (const t of [13, 14]) { const o = g.objects.slots.find(x => x.type === t)!; Object.assign(o, { node: road[t].id, owner: 0 }); }
    p0.tools.fill(0);
    const pts = p0.points;
    drive(g, applyLing(g, p0, 108, r));
    expect(g.objects.slots.filter(o => (o.type === 13 || o.type === 14) && o.node && r.inTown(g.node(o.node)))).toHaveLength(0);
    expect(p0.points - pts).toBe(500);
    expect(p0.tools.reduce((a, b) => a + b, 0)).toBe(1);
    // roadblocks, mines, bombs on the road: into the tools, 9 at most
    p0.tools.fill(0); p0.tools[1] = 8;
    const free = g.board.nodes.filter(n => r.inTown(n) && n.adjacent.some(Boolean) && n.ref < 8001 && !n.noDrop && !g.objects.at(n.id) && !g.occupants(n.id).length);
    for (let k = 0; k < 3; k++) { if (!g.objects.slots.some(o => o.type === 16 && !o.node && !o.owner)) g.objects.slots.push({ type: 16, node: 0, dir: 0, life: 0, owner: 0 }); g.objects.place(16, free[k].id); }
    g.objects.place(17, free[5].id);
    r.ling.got[0] = [];
    drive(g, applyLing(g, p0, 108, r));
    expect(p0.tools[1]).toBe(9);
    expect(p0.tools[2]).toBe(1);
    expect(g.objects.slots.filter(o => o.type === 16 && o.node && r.inTown(g.node(o.node)))).toHaveLength(2);
  });

  it('李俊: every own lot on the 汴河\'s banks one up, an empty one built to 1', () => {
    const { g, r, p0 } = richWorld();
    const near = (y: number) => Math.abs(y - 31 * 48) <= 140;
    const mine = g.board.lands.filter(l => l.owner === 1 && near(l.y) && g.board.nodes.some(n => n.ref === l.id + 2000 && r.inTown(n)));
    expect(mine.some(l => l.level === 0)).toBe(true);
    const was = mine.map(l => l.level);
    drive(g, applyLing(g, p0, 26, r));
    mine.forEach((l, i) => expect(l.level).toBe(l.chain ? was[i] : Math.min(5, was[i] + 1)));
  });

  it('阮小五 … 扈三娘: an opponent\'s empty lot made the drawer\'s', () => {
    const { g, r, p0 } = richWorld();
    const empties = () => g.board.lands.filter(l => l.owner > 1 && l.level === 0).length;
    const was = empties(), mine = g.board.lands.filter(l => l.owner === 1).length;
    drive(g, applyLing(g, p0, 25, r));
    expect(was - empties()).toBe(2);
    expect(g.board.lands.filter(l => l.owner === 1).length - mine).toBe(2);
  });

  it('戴宗: 5 dice for 15 turns; 宣贊: an opponent 1 die for 3 (the forced dice kept)', () => {
    const { g, r, p0 } = richWorld();
    drive(g, applyLing(g, p0, 20, r));
    expect(r.forced[0]).toEqual({ n: 5, turns: 15 });
    drive(g, applyLing(g, p0, 40, r));
    expect(r.forced.filter((f, i) => f && i > 0)).toEqual([{ n: 1, turns: 3 }]);
  });

  it('no card moves, turns or sleeps anyone, and none but 楊春 and 張橫 puts things on the road', () => {
    for (let seat = 1; seat <= 108; seat++) {
      const { g, r, p0 } = richWorld(300 + seat);
      const at = g.players.map(q => [q.node, q.lastNode]);
      const things = g.objects.slots.filter(o => o.node).length;
      drive(g, applyLing(g, p0, seat, r));
      g.players.forEach((q, i) => { if (!q.hospital && !q.prison) expect(q.node, `seat ${seat}`).toBe(at[i][0]); expect(q.sleep, `seat ${seat}`).toBe(0); });
      if (![28, 52, 57, 60, 73, 95].includes(seat)) expect(g.objects.slots.filter(o => o.node).length, `seat ${seat}`).toBeLessThanOrEqual(things);
      if (![20, 40, 48, 104, 106].includes(seat)) expect(r.forced.filter(Boolean), `seat ${seat}`).toHaveLength(0);
    }
  }, 120000);

  it('徐寧: own houses cannot be damaged for 30 days; then they can', () => {
    const { g, r, p0 } = richWorld();
    drive(g, applyLing(g, p0, 18, r));
    const l = g.board.lands.find(x => x.owner === 1 && x.level >= 2)!, ref = l.id + 2000, lvl = l.level;
    g.damageProperty(ref, 0); g.damageProperty(ref, 1);
    expect(l.level).toBe(lvl);
    expect(l.owner).toBe(1);
    for (let d = 0; d < 30; d++) r.daily(g);
    g.damageProperty(ref, 0);
    expect(l.level).toBe(lvl - 1);
  });

  it('穆弘: an opponent\'s street pays its toll to the drawer for 7 days', () => {
    const { g, r, p0 } = richWorld();
    drive(g, applyLing(g, p0, 24, r));
    const refs = Object.keys(r.ling.payee ?? {}).map(Number);
    expect(refs.length).toBeGreaterThan(0);
    const lot = g.board.lands[refs.find(ref => g.board.lands[ref - 2001].level > 0)! - 2001] ?? g.board.lands[refs[0] - 2001];
    const owner = g.players[lot.owner - 1];
    const walker = g.players.find(q => q.id !== 0 && q.id !== owner.id)!;
    const n = g.board.nodes.find(x => x.ref === lot.id + 2000)!;
    walker.node = n.id;
    const p0Was = p0.bank + p0.cash, ownerWas = owner.bank + owner.cash;
    g.current = walker.id;
    drive(g, g.land(walker));
    expect(p0.bank + p0.cash).toBeGreaterThan(p0Was);
    expect(owner.bank + owner.cash).toBe(ownerWas);
    for (let d = 0; d < 7; d++) r.daily(g);
    expect(Object.keys(r.ling.payee ?? {})).toHaveLength(0);
  });

  it('郁保四: the drawer\'s lots +50 % toll for 5 days', () => {
    const { g, r, p0 } = richWorld();
    drive(g, applyLing(g, p0, 105, r));
    const lot = g.board.lands.find(l => l.owner === 1 && l.level > 0)!;
    expect(r.tollFactor(g, lot)).toBe(1.5);
    for (let d = 0; d < 5; d++) r.daily(g);
    expect(r.tollFactor(g, lot)).toBe(1);
  });

  it('聚義廳: 張橫 + 張順 make the boat free; every set cashes in once, each with its reward', () => {
    const { g, r, p0 } = richWorld();
    r.ling.got[0] = [28, 30];
    expect(readySets(r.ling, 0)).toEqual(['張家兄弟']);
    const steps = drive(g, exchangeJuyi(g, p0, r));
    expect(steps[0]).toMatchObject({ t: 'fx', kind: 'qm-juyi', data: { ready: ['張家兄弟'], rewards: ['潯陽江：接下來整局遊戲乘坐汴河漕船全部免費'] } });
    expect(r.freeBoat[0]).toBe(true);
    expect(r.ling.done[0]).toEqual(['張家兄弟']);
    expect(readySets(r.ling, 0)).toEqual([]);
    // all 108: every set at once
    const all = richWorld(11);
    all.r.ling.got[0] = Array.from({ length: 108 }, (_, i) => i + 1);
    expect(drive(all.g, exchangeJuyi(all.g, all.p0, all.r)).length).toBeGreaterThan(0);
    expect(all.r.ling.done[0]).toHaveLength(JUYI_SETS.length);
    expect(all.r.liangshan().has(all.p0.node)).toBe(true);
    // the cards and tools came in
    expect(all.p0.cards).toContain(21);
    expect(all.p0.tools[12]).toBeGreaterThan(0); // 核子飛彈
  });

  it('a computer\'s 聚義廳 with every set, and with nothing in town', () => {
    for (const make of [richWorld, emptyWorld]) {
      const { g, r, p0 } = make(5);
      p0.whoPlays = 2;
      r.ling.got[0] = Array.from({ length: 108 }, (_, i) => i + 1);
      drive(g, exchangeJuyi(g, p0, r));
      expect(r.liangshan().has(p0.node)).toBe(true);
    }
  });

  it('the state survives a save', () => {
    const { g, r, p0 } = richWorld();
    drive(g, applyLing(g, p0, 18, r));
    drive(g, applyLing(g, p0, 82, r));
    const { g: g2 } = newGame();
    const r2 = g2.rules as QingmingRules;
    r2.loadState(JSON.parse(JSON.stringify(r.saveState())));
    expect(r2.ling.guard).toEqual(r.ling.guard);
    expect(r2.ling.shield).toEqual(r.ling.shield);
  });
});
