import { describe, expect, it } from 'vitest';
import { companyOf, parseBoard } from '../../core/board';
import { pack } from '../../core/date';
import { Game } from '../../core/game';
import type { GameSettings } from '../../core/types';
import { problems } from './check';
import { library } from '../../core/modules/general-cards';
import { STOCK_TABLE } from '../../core/modules/stocks';
import { records } from './compile';
import { gameDeck } from './deck';
import { G, newMap, type MakerMap } from './model';

// 自建地圖's 試玩: a map made in the editor becomes records the game reads and plays.
function loopMap(): MakerMap {
  const m = newMap('測試地圖', 24, 24, G['deep-sea']);
  for (let y = 3; y < 21; y++) for (let x = 3; x < 21; x++) m.cells[y * 24 + x] = G.grass;
  // a loop of road round a 12 × 12 box, as the editor's 方塊 makes it
  const ring: [number, number][] = [];
  for (let x = 6; x <= 17; x++) ring.push([x, 6]);
  for (let y = 7; y <= 17; y++) ring.push([17, y]);
  for (let x = 16; x >= 6; x--) ring.push([x, 17]);
  for (let y = 16; y >= 7; y--) ring.push([6, y]);
  for (const [cx, cy] of ring) m.nodes.push({ id: m.nextId++, cx, cy, links: [], ev: 0, style: 0 });
  m.nodes.forEach((n, i) => { const nx = m.nodes[(i + 1) % m.nodes.length]; n.links.push(nx.id); nx.links.push(n.id); });
  const at = (cx: number, cy: number) => m.nodes.find(n => n.cx === cx && n.cy === cy)!;
  at(6, 6).ev = 14; at(17, 6).ev = 5; at(17, 17).ev = 4; at(6, 17).ev = 15; at(12, 6).ev = 2; at(17, 11).ev = 3; at(11, 17).ev = 13;
  // small lots outside the top and bottom of the loop, a large plot inside
  for (let x = 7; x <= 15; x += 2) { m.lots.push({ id: m.nextId++, kind: 0, cx: x, cy: 5, nodes: [at(x, 6).id], price: 1000, name: `北街${x}` }); }
  for (let x = 8; x <= 14; x += 2) { m.lots.push({ id: m.nextId++, kind: 0, cx: x, cy: 18, nodes: [at(x, 17).id], price: 1500, name: `南街${x}` }); }
  m.lots.push({ id: m.nextId++, kind: 1, cx: 7, cy: 9, nodes: [at(6, 9).id, at(6, 10).id], price: 5000, name: '大型用地1' });
  return m;
}

describe('自建地圖 試玩', () => {
  it('the editor\'s check passes a proper loop', () => {
    expect(problems(loopMap())).toEqual([]);
  });

  it('becomes records the game parses: squares linked, lots on their squares, the hospital and prison found', () => {
    const m = loopMap(), raw = records(m);
    raw.map_id = 5000;
    const b = parseBoard(raw);
    expect(b.nodes.length).toBe(m.nodes.length);
    expect(b.nodes.every(n => n.adjacent.filter(Boolean).length === 2)).toBe(true);
    expect(b.lands.length).toBe(9);
    expect(b.facilities.length).toBe(1);
    expect(b.lands[0].name).toBe('北街7');
    expect(b.lands[0].price).toBe(1000);
    expect(b.nodes.filter(n => n.ref > 2000 && n.ref < 4000).length).toBe(9);
    expect(b.nodes.filter(n => n.ref > 4000 && n.ref < 6000).length).toBe(2);
    expect(b.nodes.find(n => n.ref === 8001)?.event).toBe(5);
    expect(b.nodes.find(n => n.ref === 8002)?.event).toBe(4);
  });

  it('plays: four computers go round it for 120 days without breaking a rule', () => {
    const raw = records(loopMap());
    raw.map_id = 5000;
    const settings: GameSettings = { mapId: 5000, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
      landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 3 } as GameSettings;
    const g = new Game(settings, parseBoard(raw));
    const flow = g.run();
    for (let r = flow.next(); !r.done && g.daysElapsed < 120 && !g.over; r = flow.next()) if ('ask' in r.value) throw new Error('a question for a computer');
    expect(g.daysElapsed >= 120 || !!g.over).toBe(true);
    expect(g.board.lands.some(l => l.owner)).toBe(true);
  });

  it('issue #104: names as written — Simplified, Japanese — not cut to what Big5 has', () => {
    const m = loopMap();
    const smalls = m.lots.filter(l => !l.kind), big = m.lots.find(l => l.kind)!;
    smalls[0].name = '水乐广场'; smalls[1].name = 'たこ焼き屋'; smalls[2].name = '林布兰博物馆长廊'; big.name = '龙门发财';
    for (const l of smalls.slice(0, 3)) l.street = undefined;
    const raw = records(m);
    raw.map_id = 5000;
    const b = parseBoard(raw);
    expect(b.lands.slice(0, 3).map(l => l.name)).toEqual(['水乐广场', 'たこ焼き屋', '林布兰博物馆长廊']);
    expect(b.facilities[0].name).toBe('龙门发财');
    // the Big5 copy in the record: a Simplified character as its Traditional one
    const old = parseBoard({ ...raw, lands: raw.lands.map(({ name: _n, ...r }) => r) });
    expect(old.lands[0].name).toBe('水樂廣場');
  });

  it('its own stocks: a template picked, a few renamed, the rest and every price the template\'s', () => {
    const m = loopMap();
    m.stocks = { group: 5, names: ['萊陽銀行', '', '梨花百貨'] };
    const raw = records(m);
    raw.map_id = 5003;                       // 5003 % 8 = 3 (美國): the map's own pick wins
    const g = new Game({ mapId: 5003, players: [0, 4].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
      landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 2 } as GameSettings, parseBoard(raw));
    const names = g.stocks.stocks.map(x => x.name);
    expect(names.slice(0, 4)).toEqual(['萊陽銀行', STOCK_TABLE[5][1].name, '梨花百貨', STOCK_TABLE[5][3].name]);
    expect(g.stocks.stocks.map(x => x.basePrice)).toEqual(STOCK_TABLE[5].map(d => Math.fround(d.price)));
    m.stocks = { group: 2, names: [] };
    expect(records(m).stock_names).toBeUndefined();
  });

  it('its own news and fate cards: too few is a problem; a deck of 12 + 12 with a renamed card plays', () => {
    const m = loopMap(), news = library('news').slice(30, 42).map(c => c.id), fate = library('fate').slice(30, 42).map(c => c.id);
    m.deck = { news: news.slice(0, 5), fate: [] };
    expect(problems(m).some(p => p.includes('新聞卡只選了 5 張'))).toBe(true);
    m.deck = { news, fate, words: { [news[0]]: '本地大新聞' } };
    expect(problems(m)).toEqual([]);
    expect(gameDeck(m)).toEqual({ news, fate, words: { [news[0]]: '本地大新聞' } });
    const raw = records(m);
    raw.map_id = 5000;
    const g = new Game({ mapId: 5000, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
      landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 5, deck: gameDeck(m) } as GameSettings, parseBoard(raw));
    const flow = g.run();
    for (let r = flow.next(); !r.done && g.daysElapsed < 120 && !g.over; r = flow.next()) if ('ask' in r.value) throw new Error('a question for a computer');
    expect(g.daysElapsed >= 120 || !!g.over).toBe(true);
  });
});

// 企業大樓 (the user 2026-11-16): companies of the map's own, each on two squares, a stock of the map, paying its fee.
describe('自建地圖 企業大樓', () => {
  it('a 加油站 takes the template\'s oil stock, an airline a free stock; both are played as companies', () => {
    const m = loopMap();
    m.stocks = { group: 1, names: [] };                 // 中國大陸: 石油 is slot 3, slots 4.. are market stocks
    const at = (cx: number, cy: number) => m.nodes.find(n => n.cx === cx && n.cy === cy)!;
    m.lots.push({ id: m.nextId++, kind: 2, cx: 18, cy: 8, nodes: [at(17, 8).id, at(17, 9).id], price: 0, name: '加油站', co: 6, style: 143 });
    m.lots.push({ id: m.nextId++, kind: 2, cx: 18, cy: 13, nodes: [at(17, 13).id, at(17, 14).id], price: 0, name: '航空公司', co: 1, style: 140 });
    const raw = records(m);
    raw.map_id = 5002;
    const b = parseBoard(raw);
    const oil = b.companies.find(c => c.category === 6)!, air = b.companies.find(c => c.category === 1)!;
    expect([oil.stockSlot, oil.resource, air.resource]).toEqual([3, 143, 140]);
    expect(STOCK_TABLE[1][air.stockSlot].linked).toBe(false);
    expect(air.name).toBe('航空公司');
    const sq = (cx: number, cy: number) => b.nodes[m.nodes.indexOf(at(cx, cy))];
    expect(companyOf(b, sq(17, 8))).toBe(oil);
    expect(companyOf(b, sq(17, 14))).toBe(air);
    const g = new Game({ mapId: 5002, players: [0, 4].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
      landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 3 } as GameSettings, b);
    void g.run().next();
    // the airline's stock is the airline's (not only the flagged ones), so shares make a chairman
    const air2 = g.board.companies.find(c => c.category === 1)!;
    expect(g.stocks.slotOf(air2)).toBe(air.stockSlot);
    expect(g.stocks.stocks[air.stockSlot].name).toBe('航空公司');
    const p = g.players[0];
    p.bank = 10_000_000;
    g.stocks.buyPrimary(p, air2, 1); g.stocks.rerank(p.id, air2.stockSlot);
    expect(air2.controller).toBe(p.id + 1);
  });

  it('refuses a 13th company: 12 stocks', async () => {
    const { companySlots } = await import('./stocks');
    const m = loopMap();
    for (let i = 0; i < 14; i++) m.lots.push({ id: m.nextId++, kind: 2, cx: 0, cy: 0, nodes: [], price: 0, name: '', co: 3 });
    // 台灣: three template companies (bank, store, insurer) leave 9 stocks for buildings
    expect(companySlots(m).size).toBe(9);
  });
});

// The sample map 萊陽 (editor/maker_laiyang.py), where it is built on this machine.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMap } from './model';
const sample = fileURLToPath(new URL('../../../../editor/site/assets/remake/maker/sample-laiyang.json', import.meta.url));
describe.skipIf(!existsSync(sample))('自建地圖 示例地圖 萊陽', () => {
  it('passes the check and plays 200 days with four computers', () => {
    const m = parseMap(JSON.parse(readFileSync(sample, 'utf8')))!;
    expect(problems(m)).toEqual([]);
    const raw = records(m);
    raw.map_id = 5001;
    const g = new Game({ mapId: 5001, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
      landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 9 } as GameSettings, parseBoard(raw));
    const flow = g.run();
    for (let r = flow.next(); !r.done && g.daysElapsed < 200 && !g.over; r = flow.next()) if ('ask' in r.value) throw new Error('a question for a computer');
    expect(g.board.lands.filter(l => l.owner).length).toBeGreaterThan(10);
    // its bank and department store are companies of the map, on every 銀行 and 道具店 square (the user 2026-11-13:
    // 萊陽商城's largest holder had no gift at the 道具店, 萊陽農商行's no 融資 at the bank)
    const g2 = new Game({ mapId: 5001, players: [0, 4].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
      landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 9 } as GameSettings, parseBoard(raw));
    expect(g2.board.companies.map(c => [c.name, c.stockSlot, c.category])).toEqual([['五龍石化', 3, 6], ['萊陽人壽', 1, 4], ['萊陽農商行', 0, 7], ['萊陽商城', 2, 10]]);
    const p = g2.players[0];
    p.bank = 10_000_000;
    for (const c of g2.board.companies) { g2.stocks.buyPrimary(p, c, 1); g2.stocks.rerank(p.id, c.stockSlot); }
    expect(g2.board.companies.every(c => c.controller === p.id + 1)).toBe(true);
    for (const n of g2.board.nodes.filter(x => x.event === 14 || x.event === 15)) expect(companyOf(g2.board, n)?.category).toBe(n.event === 14 ? 7 : 10);
    // its own stocks (the 中國大陸 table renamed: 萊陽's firms)
    expect(g.stocks.stocks.map(x => x.name).slice(0, 5)).toEqual(['萊陽農商行', '萊陽人壽', '萊陽商城', '五龍石化', '魯花集團']);
  });
});
