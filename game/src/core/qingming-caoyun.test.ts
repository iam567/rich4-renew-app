import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard } from './board';
import { Game } from './game';
import { addDays, pack } from './date';
import type { Flow } from './flow';
import './qingming';
import { loadGame, saveGame } from './save';
import { CAOYUN, type QingmingRules } from './qingming';

// 汴河漕運's 董事長 (the user 2026-11-24): the 運輸費 at its building; the 東家 rides free and is asked passing a dock; others' fares go to him.
const raw = JSON.parse(readFileSync('../editor/site/assets/remake/qingming.json', 'utf8'));
const setup = (seed = 5) => {
  const start = pack(2026, 11, 19);
  const g = new Game({ mapId: 111, players: [0, 4, 9, 11].map(c => ({ character: c, human: true })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
    daysLimitIndex: 0, victoryIndex: 0, startDate: start, seed }, parseBoard(raw));
  g.date = addDays(start, 40);
  const r = g.rules as QingmingRules;
  for (const p of g.players) { p.placed = true; p.whoPlays = 1; p.cash = 50000; p.bank = 50000; }
  const c = g.board.companies.find(x => x.name === CAOYUN)!;
  c.controller = 1;   // player 0 runs it
  return { g, r, c, dock: r.nodesOf('boat')[0], land: r.nodesOf('land')[0] };
};
/** Runs a flow answering every question with `answer`; returns the steps and the questions. */
const run = <T>(f: Flow<T>, answer = 1) => {
  const steps: Record<string, unknown>[] = [], asks: Record<string, unknown>[] = [];
  let s = f.next();
  for (; !s.done; ) {
    const v = s.value as Record<string, unknown>;
    steps.push(v);
    if (v.ask || String(v.t).startsWith('qm-')) { asks.push(v); s = f.next(answer as never); } else s = f.next(undefined as never);
  }
  return { steps, asks, value: s.value };
};

describe('汴河漕運 東家', () => {
  it('passing an open dock the 東家 is asked; yes ends the walk there and the stop sails free, no second question', () => {
    const { g, r, dock, land } = setup(), p = g.players[0];
    p.node = dock;
    const passed = run(r.step(g, p, 3));
    expect(passed.asks).toHaveLength(1);
    expect(passed.asks[0]).toMatchObject({ boss: true, passing: true, free: true });
    expect(passed.value).toBe(0);
    const cash = p.cash, bank = p.bank;
    const sail = run(r.dock(g, p, g.node(dock)));
    expect(sail.asks).toHaveLength(0);
    expect(p.node).toBe(land);
    expect(p.cash + p.bank).toBe(cash + bank);
  });
  it('no: the walk goes on; before day 31, or not the 董事長: never asked', () => {
    const { g, r, dock } = setup(), p = g.players[0];
    p.node = dock;
    expect(run(r.step(g, p, 3), 0).value).toBe(3);
    expect(run(r.step(g, g.players[1], 3)).asks).toHaveLength(0);
    g.date = g.settings.startDate;
    expect(run(r.step(g, p, 3)).asks).toHaveLength(0);
  });
  it("someone else's fare goes to the 東家 (in cash); nobody running it: to the bank", () => {
    const { g, r, c, dock } = setup(), q = g.players[1], boss = g.players[0];
    q.node = dock;
    const before = boss.cash;
    const s = run(r.dock(g, q, g.node(dock)));
    expect(s.asks[0]).toMatchObject({ free: false });
    expect(boss.cash - before).toBe(2000 * g.priceIndex);
    const { g: g2, r: r2, c: c2, dock: d2 } = setup();
    c2.controller = 0;
    const b2 = g2.players[0].cash;
    g2.players[1].node = d2;
    run(r2.dock(g2, g2.players[1], g2.node(d2)));
    expect(g2.players[0].cash).toBe(b2);
    void c;
  });
  it('at its building anyone else pays the 運輸費 and is shipped to 梁山, back to that square; its 董事長 neither; before day 31 the fee only (the user 2026-11-25)', () => {
    for (const [traffic, k] of [[0, 1], [1, 1], [2, 2]]) {
      const { g, r, c, land } = setup(), q = g.players[1], n = g.board.nodes.find(x => x.ref === 6000 + c.id)!;
      q.node = n.id; q.traffic = traffic; g.diceTotal = 8;
      const cash = q.cash + q.bank;
      const s = run(g.stocks.landOnCompany(q, c), 0);
      expect(cash - q.cash - q.bank).toBe(c.baseFee * k * 8);
      expect(s.steps.some(x => String(x.text ?? '').includes('運輸費'))).toBe(true);
      expect(s.steps.some(x => x.kind === 'subscribe')).toBe(false);
      expect(q.node).toBe(land);
      g.date = addDays(g.date, 9);
      run(r.sailBack(g, q));
      expect(q.node).toBe(n.id);
    }
    const { g, c, land } = setup(), n = g.board.nodes.find(x => x.ref === 6000 + c.id)!, [boss, q] = g.players;
    boss.node = n.id; const had = boss.cash + boss.bank;
    const stay = run(g.stocks.landOnCompany(boss, c), 0);
    expect(stay.asks[0]).toMatchObject({ boss: true, free: true, fare: 0 });
    expect([boss.node, boss.cash + boss.bank]).toEqual([n.id, had]);
    run(g.stocks.landOnCompany(boss, c), 1);
    expect([boss.node, boss.cash + boss.bank]).toEqual([land, had]);
    g.date = g.settings.startDate; q.node = n.id; g.diceTotal = 8; const cash = q.cash + q.bank;
    run(g.stocks.landOnCompany(q, c), 0);
    expect(q.node).toBe(n.id);
    expect(q.cash + q.bank).toBeLessThan(cash);
  });
});

describe('清明上河 瓦舍勾欄 (長安\'s 博戲坊, the user 2026-11-24)', () => {
  it("someone else stopping bets 大 / 小 with the owner: 5,000 won or 10,000 lost; the owner's own stop is the original's", () => {
    const { g, r } = setup(), f = g.board.facilities[0], p = g.players[1], owner = g.players[0];
    expect(r.facilityNames?.[0]).toBe('瓦舍勾欄');
    Object.assign(f, { type: 0, level: 1, owner: 1 });
    const before = p.cash + p.bank;
    const s = run(r.landOnFacility(g, p, f));
    expect(s.value).toBe(true);
    expect(s.asks[0]).toMatchObject({ t: 'cn-dice-bet', owner: 0 });
    const roll = s.steps.find(x => x.kind === 'cn-dice-roll') as { data: { hit: boolean } };
    expect(p.cash + p.bank - before).toBe(roll.data.hit ? 5000 : -10000);
    expect(run(r.landOnFacility(g, owner, f)).value).toBe(false);
  });
});

describe('清明上河 景陽岡 / 野豬林 / 相撲 held out (the user 2026-11-24)', () => {
  const at = (g: ReturnType<typeof setup>['g'], kind: string) => Number(Object.entries(g.board.specials ?? {}).find(([, k]) => k === kind)![0]);
  it('a loss after 10 seconds stays on 梁山 (points kept); sooner is the hospital 3 days', () => {
    for (const [kind, f] of [['tiger', 'tiger'], ['pig', 'boar']] as const) {
      for (const [lasted, stays] of [[12, true], [5, false]] as const) {
        const { g, r } = setup(), p = g.players[1];
        p.node = at(g, kind);
        run((r as unknown as Record<string, (g: unknown, p: unknown) => Flow<unknown>>)[f](g, p), { hits: 3, points: 3, full: false, lasted } as never);
        expect(p.hospital > 0, `${f} ${lasted}s`).toBe(!stays);
        if (stays) expect(p.node).toBe(at(g, kind));
      }
    }
  });
  it("相撲: a loss with half of 燕青's strength taken stays; less is the hospital", () => {
    for (const [points, stays] of [[60, true], [30, false]] as const) {
      const { g, r } = setup(), p = g.players[1];
      p.node = at(g, 'wrestle');
      run(r.wrestle(g, p), { won: false, points } as never);
      expect(p.hospital > 0, `${points}%`).toBe(!stays);
    }
  });
});

describe('清明上河 十字坡 鬼手 (the user 2026-11-24)', () => {
  it('20 點券 a round read, 120 for all five; three rounds read stays on 梁山, fewer is the hospital 2 days', () => {
    for (const [cleared, pts, stays] of [[5, 120, true], [3, 60, true], [2, 40, false], [0, 0, false]] as const) {
      const { g, r } = setup(), p = g.players[1];
      p.node = Number(Object.entries(g.board.specials ?? {}).find(([, k]) => k === 'inn')![0]);
      const before = p.points;
      const s = run(r.inn(g, p), { cleared } as never);
      expect(s.asks[0]).toMatchObject({ t: 'qm-shell', bowls: [3, 4, 5, 6, 7] });
      expect(p.points - before, `${cleared}`).toBe(pts);
      expect(p.hospital > 0, `${cleared}`).toBe(!stays);
    }
  });
  it('a computer plays it by its level: never asked, its rounds drawn', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const { g, r } = setup(seed), p = g.players[1];
      p.whoPlays = 2;
      const s = run(r.inn(g, p));
      expect(s.asks).toHaveLength(0);
      seen.add((s.steps.find(x => x.kind === 'qm-game-result') as { data: { cleared: number } }).data.cleared);
    }
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe('清明上河 漕運處 (the user 2026-11-24)', () => {
  const office = (g: ReturnType<typeof setup>['g']) => {
    const f = g.board.facilities.find(x => g.board.nodes.some(n => n.ref === 4000 + x.id))!;
    Object.assign(f, { type: 3, level: 1, owner: 1 });
    return { f, node: g.board.nodes.find(n => n.ref === 4000 + f.id)!.id };
  };
  it("someone else pays the old 加油費 as 漕運費 to the owner and is shipped to 梁山; back from 金沙灘 they land on the 漕運處", () => {
    const { g, r, land } = setup(), q = g.players[1], owner = g.players[0];
    const { f, node } = office(g);
    q.node = node; q.traffic = 2; g.diceTotal = 7;
    const before = owner.cash + owner.bank;
    run(r.landOnFacility!(g, q, f));
    expect(owner.cash + owner.bank - before).toBe(500 * 2 * 7 * g.priceIndex);
    expect(q.node).toBe(land);
    g.date = addDays(g.date, 4);
    run(r.sailBack(g, q));
    expect(q.node).toBe(node);
  });
  it('on foot pays as on a motorbike and is shipped all the same; before day 31 only the fee, no boat', () => {
    const { g, r, land } = setup(), q = g.players[1], owner = g.players[0];
    const { f, node } = office(g);
    q.node = node; q.traffic = 0; g.diceTotal = 6;
    const before = owner.cash + owner.bank;
    run(r.landOnFacility!(g, q, f));
    expect(owner.cash + owner.bank - before).toBe(500 * 6 * g.priceIndex);
    expect(q.node).toBe(land);
    const s2 = setup(), q2 = s2.g.players[1], o2 = office(s2.g);
    s2.g.date = s2.g.settings.startDate;
    q2.node = o2.node; q2.traffic = 2; s2.g.diceTotal = 5;
    run(s2.r.landOnFacility!(s2.g, q2, o2.f));
    expect(q2.node).toBe(o2.node);
  });
  it('its owner is asked and may sail free, coming back to the 漕運處', () => {
    const { g, r, land } = setup(), p = g.players[0];
    const { f, node } = office(g);
    p.node = node;
    const cash = p.cash + p.bank;
    const s = run(r.landOnFacility!(g, p, f), 0);
    expect(s.asks[0]).toMatchObject({ t: 'qm-dock', office: true });
    expect(p.node).toBe(node);
    run(r.landOnFacility!(g, p, f), 1);
    expect(p.node).toBe(land);
    expect(p.cash + p.bank).toBe(cash);
    g.date = addDays(g.date, 4);
    run(r.sailBack(g, p));
    expect(p.node).toBe(node);
  });
  it('the fourth kind of large plot is called 漕運處 here', () => {
    expect(setup().r.facilityNames?.[3]).toBe('漕運處');
  });
});

describe('清明上河 黃泥岡 with 免罪卡 / 嫁禍卡 (the user 2026-11-24)', () => {
  const at = (g: ReturnType<typeof setup>['g']) => Number(Object.entries(g.board.specials ?? {}).find(([, k]) => k === 'gang')![0]);
  it('免罪卡: no prison, still on 梁山', () => {
    const { g, r } = setup(), p = g.players[1];
    p.node = at(g); p.cards = [21];
    run(r.gang(g, p));
    expect(p.prison).toBe(0);
    expect(p.node).toBe(at(g));
    expect(p.cards).not.toContain(21);
  });
  it('嫁禍卡: the one picked goes to the 開封府, the robber stays on 梁山', () => {
    const { g, r } = setup(), p = g.players[1], q = g.players[2];
    p.node = at(g); p.cards = [19];
    const f = r.gang(g, p);
    for (let s = f.next(); !s.done; ) {
      const v = s.value as { t: string; ask?: boolean };
      s = f.next((v.t === 'choose' ? q.id : v.t === 'yesno' ? true : undefined) as never);
    }
    expect(p.prison).toBe(0);
    expect(p.node).toBe(at(g));
    expect(q.prison).toBeGreaterThan(0);
  });
  it('no card: the 開封府 5 days', () => {
    const { g, r } = setup(), p = g.players[1];
    p.node = at(g); p.cards = [];
    run(r.gang(g, p));
    expect(p.prison).toBe(5);
  });
});

describe('清明上河 梁山令: a seat held is never drawn again (the user 2026-11-24)', () => {
  it('108 draws give all 108 seats once each; the 傳說 pool moves on when all six are held', async () => {
    const { drawSeat } = await import('./qingming-ling');
    const { g } = setup();
    const have = new Set<number>();
    for (let i = 0; i < 108; i++) { const s = drawSeat(g, 'any', have); expect(have.has(s), `draw ${i}`).toBe(false); have.add(s); }
    expect(have.size).toBe(108);
    const six = new Set([1, 2, 3, 4, 5, 6]);
    for (let i = 0; i < 50; i++) expect(six.has(drawSeat(g, 'legend', six))).toBe(false);
  });
});

describe('a save from before 清明上河 had its city wall shows the wall (the user 2026-11-24: 「城牆沒顯示出來」)', () => {
  it("loading takes the map's scenery as it is now", async () => {
    const S = await import('./save');
    const { g } = setup();
    const data = JSON.parse(JSON.stringify((S as unknown as { saveGame: (g: unknown) => unknown }).saveGame(g)));
    data.board.landscapes = data.board.landscapes.slice(0, 30);
    const map = parseBoard(raw);
    const h = S.loadGame(data, map);
    expect(h.board.landscapes.length).toBe(map.landscapes.length);
    expect(map.landscapes.length).toBeGreaterThan(100);
  });
});

describe('a save from before 梁山 was relaid takes the squares as they are now', () => {
  it("node events follow the map", async () => {
    const S = await import('./save');
    const { g } = setup();
    const data = JSON.parse(JSON.stringify(S.saveGame(g)));
    const map = parseBoard(raw);
    const i = map.nodes.findIndex(n => n.event === 11);
    data.board.nodes[i].event = 0;
    expect(S.loadGame(data, map).board.nodes[i].event).toBe(11);
  });
});

describe('a hotel blown up with guests inside (the user 2026-11-24)', () => {
  it('its guests go to the hospital', () => {
    const { g } = setup(), q = g.players[2];
    const f = g.board.facilities.find(x => g.board.nodes.some(n => n.ref === 4000 + x.id))!;
    Object.assign(f, { type: 1, level: 2, owner: 1 });
    const far = g.board.nodes.filter(n => n.adjacent.some(Boolean)).sort((x, y) => Math.hypot(y.x - f.x, y.y - f.y) - Math.hypot(x.x - f.x, x.y - f.y))[0];
    for (const p of g.players) p.node = far.id;
    q.node = g.board.nodes.find(n => n.ref === 4000 + f.id)!.id; q.hotel = 3; q.facility = f.id;
    run((g.tools as unknown as { blast: (p: unknown, x: number, y: number, h: number, nuke: boolean) => Flow<unknown> }).blast(g.players[0], f.x, f.y, 100, true));
    expect(f.level).toBe(0);
    expect(q.hotel).toBe(0);
    expect(q.hospital).toBeGreaterThan(0);
  });
});

describe('金沙灘 waits 3 days (the user 2026-11-24)', () => {
  it('back on 金沙灘 within 3 days of landing: no boat, walking past goes on; from the 4th day the boat home', () => {
    const { g, r, dock, land } = setup(), p = g.players[0];
    p.node = dock;
    run(r.sail(g, p, dock, 0, 'x'));
    expect(p.node).toBe(land);
    for (const d of [1, 2, 3]) {
      g.date = addDays(g.date, 1);
      expect(r.boatWait(p), `day ${d}`).toBe(4 - d);
      const s = run(r.sailBack(g, p));
      expect(p.node, `day ${d}`).toBe(land);
      expect(s.steps.some(x => x.t === 'say' && String(x.text).includes('天後再回金沙灘接人'))).toBe(true);
      expect(run(r.step(g, p, 3)).value).toBe(3);
    }
    g.date = addDays(g.date, 1);
    expect(run(r.step(g, p, 3)).value).toBe(0);
    run(r.sailBack(g, p));
    expect(p.node).toBe(dock);
  });
  it('the day of landing survives a save', () => {
    const { g, r, dock } = setup(), p = g.players[0];
    p.node = dock;
    run(r.sail(g, p, dock, 0, 'x'));
    const s = JSON.parse(JSON.stringify(r.saveState()));
    r.loadState({});
    expect(r.boatWait(p)).toBe(0);
    r.loadState(s);
    expect(r.boatWait(p)).toBe(4);
  });
});


describe('the user 2026-11-25: the fourth dock, the gods at 貢院, shop tools only', () => {
  it('has a fourth dock outside the city (node 219, its neighbours lots), which sails and brings back there', () => {
    const { g, r } = setup();
    expect(r.nodesOf('boat')).toEqual([138, 154, 205, 219]);
    const n = g.node(219), p = g.players[1];
    expect(n.event).toBe(0);
    for (const a of n.adjacent.filter(Boolean)) expect(g.node(a).ref).toBeGreaterThan(2000);
    p.node = 219;
    run(r.dock(g, p, n));
    expect(p.node).toBe(r.nodesOf('land')[0]);
    g.date = addDays(g.date, 9);
    run(r.sailBack(g, p));
    expect(p.node).toBe(219);
  });

  it('小福神 takes one wrong answer away, 大福神 two, 天使 three; no other god any', () => {
    const { g, r } = setup();
    const p = g.players[0];
    const asked = (type: number) => {
      p.god = 0;
      for (const o of g.objects.slots) if (o.owner === 1) o.owner = 0;
      if (type) { g.objects.slots[0].type = type; g.objects.slots[0].owner = 1; p.god = 1; }
      const f = r.exam(g, p) as Flow;
      for (let s = f.next(); !s.done; s = f.next(0 as never)) { const v = s.value as { t: string; off?: number[]; god?: string }; if (v.t === 'cn-exam') return v; }
      throw new Error('no question');
    };
    for (const [type, k] of [[0, 0], [1, 0], [3, 1], [4, 2], [9, 3], [8, 0], [10, 0]]) {
      const v = asked(type);
      expect(v.off ?? [], `god ${type}`).toHaveLength(k);
      expect(v.off ?? []).not.toContain(0);
      if (k) expect(v.god).toBeTruthy();
    }
  });
});

describe('清明上河 companies (the user 2026-11-25: 「東京車坊 官窯…停在前面沒有任何反應，也不讓買股票」)', () => {
  const at = (g: Game, name: string) => { const c = g.board.companies.find(x => x.name === name)!; return { c, n: g.board.nodes.find(x => x.ref === 6000 + c.id)! }; };
  const visit = (g: Game, name: string, p: Game['players'][number]) => {
    const { c } = at(g, name), seen: { t: string; kind?: string; text?: string; reason?: string; amount?: number }[] = [];
    const f = g.stocks.landOnCompany(p, c) as Flow;
    for (let s = f.next(), a: unknown; !s.done; s = f.next(a as never)) {
      const v = s.value as never as (typeof seen)[number] & { max?: number; options?: { value: unknown }[]; ids?: number[]; nodes?: number[] };
      seen.push(v);
      a = v.t === 'yesno' ? false : v.t === 'amount' ? v.max : v.t === 'pick-node' ? v.nodes?.[0] : v.t === 'wheel' ? 5 : undefined;
      if (seen.length > 80) break;
    }
    return seen;
  };
  it('every one is linked to the stock of its name, has its squares, and offers shares (bank and market: on the market)', () => {
    const { g } = setup();
    for (const [j, c] of g.board.companies.entries()) {
      c.controller = 0;
      const s = g.stocks.stocks[c.stockSlot];
      expect(s.name, c.name).toBe(c.name);
      expect(s.companyId, c.name).toBe(j + 1);
      expect(g.board.nodes.filter(n => n.ref === 6000 + c.id).length, c.name).toBeGreaterThan(0);
      expect(c.freeShares + s.floatPool, c.name).toBe(10000);
      if (c.category !== 7 && c.category !== 10) expect(visit(g, c.name, g.players[1]).some(x => x.kind === 'subscribe'), c.name).toBe(true);
    }
  });
  it('東京車坊 takes the fee of a motorbike or a car, none on foot nor from its 董事長', () => {
    const { g } = setup();
    const { c } = at(g, '東京車坊'), [boss, p] = g.players;
    c.controller = boss.id + 1; g.diceTotal = 6;
    const paid = (q: typeof p, traffic: number) => { q.traffic = traffic; const b = q.cash; visit(g, '東京車坊', q); return b - q.cash; };
    expect(paid(p, 0)).toBe(0);
    expect(paid(p, 1)).toBe(c.baseFee * 6);
    expect(paid(p, 2)).toBe(c.baseFee * 2 * 6);
    expect(paid(boss, 2)).toBe(0);
  });
  it('樊樓正店 is the shops\' company', () => {
    const { g } = setup();
    const c = at(g, '樊樓正店').c;
    expect(c.category).toBe(10);
    expect(g.board.companies.map(x => x.name)).toEqual(['汴河漕運', '常平倉', '交子務', '樊樓正店', '東京車坊', '將作監', '官窯']);
  });
  it('將作監: a visitor adds a floor to a building for 工程費, its 董事長 free', () => {
    const { g } = setup();
    const { c } = at(g, '將作監'), [boss, p] = g.players;
    c.controller = boss.id + 1;
    for (const l of g.board.lands.slice(0, 6)) { l.owner = p.id + 1; l.level = 1; }
    for (const l of g.board.lands.slice(6, 12)) { l.owner = boss.id + 1; l.level = 1; }
    const sum = (o: number) => g.board.lands.filter(l => l.owner === o + 1).reduce((t, l) => t + l.level, 0);
    let b = sum(p.id), cash = p.cash; visit(g, '將作監', p); expect(sum(p.id)).toBe(b + 1); expect(p.cash).toBeLessThan(cash);
    b = sum(boss.id); cash = boss.cash; visit(g, '將作監', boss); expect(sum(boss.id)).toBeGreaterThan(b); expect(boss.cash).toBe(cash);
  });
  it('官窯: 瓷器錢 at once as the computer companies (50 × the days), on foot too; its 董事長 nothing', () => {
    const { g } = setup();
    const { c } = at(g, '官窯'), [boss, p] = g.players;
    c.controller = boss.id + 1;
    expect([c.category, c.baseFee]).toEqual([3, 50]);
    g.daysElapsed = 40;
    for (const traffic of [0, 1, 2]) {
      p.traffic = traffic; const b = p.cash + p.bank, s = visit(g, '官窯', p);
      expect(b - p.cash - p.bank).toBe(50 * g.daysElapsed);
      expect(JSON.stringify(s)).toContain('瓷器錢'); expect(JSON.stringify(s)).not.toContain('電腦');
    }
    const b = boss.cash + boss.bank; visit(g, '官窯', boss); expect(boss.cash + boss.bank).toBe(b);
  });
  it('every stock can be bought on the market, 保留股份 too, down to none (the user 2026-11-25: 「所有股票都能自由買賣」); a 1.2 room as before', () => {
    const { g } = setup(), p = g.players[1];
    for (const c of g.board.companies) { c.controller = 0; expect(g.stocks.onMarket(c.stockSlot), c.name).toBe(10000); }
    const c = at(g, CAOYUN).c, s = g.stocks.stocks[c.stockSlot];
    g.stocks.refreshQuotas();
    expect(s.floatPool).toBe(0); expect(s.turnQuota).toBeGreaterThan(0);
    for (let i = 0; i < 400 && g.stocks.onMarket(c.stockSlot) > 0; i++) { g.stocks.refreshQuotas(); p.bank = 1e7; g.stocks.buyMarket(p, c.stockSlot, s.turnQuota); }
    expect([s.floatPool, c.freeShares, g.stocks.holdings[p.id][c.stockSlot].shares]).toEqual([0, 0, 10000]);
    expect(c.controller).toBe(p.id + 1);
    g.stocks.sell(p, c.stockSlot, 4000, true);
    expect([s.floatPool, c.freeShares]).toEqual([4000, 0]);
    const old = setup().g; (old.settings as { level?: string }).level = '1.2.5';
    old.stocks.refreshQuotas();
    expect(old.stocks.stocks[c.stockSlot].turnQuota).toBe(0);
  });
});

describe('相撲擂台: nobody is thrown about (the user 2026-11-25)', () => {
  it('won or lost, a human or a computer: the square stays, nothing to pick; only a loss under half goes to the hospital', () => {
    for (const human of [true, false]) for (const a of [{ won: true, points: 100 }, { won: false, points: 75 }, { won: false, points: 50 }, { won: false, points: 20 }]) for (let seed = 1; seed <= 12; seed++) {
      const { g, r } = setup(seed), p = g.players[1], ring = r.nodesOf('wrestle')[0];
      p.human = human; p.whoPlays = human ? 1 : 2; p.node = ring; p.lastNode = g.node(ring).adjacent.find(Boolean)!;
      const before = p.lastNode, s = run(g.rules!.landSquare!(g, p, g.node(ring)) as Flow<unknown>, a as never);
      expect(s.steps.some(x => x.t === 'pick-node' || x.t === 'teleport' && !p.hospital)).toBe(false);
      if (!p.hospital) expect([p.node, p.lastNode]).toEqual([ring, before]);
      if (human) expect(!!p.hospital).toBe(!a.won && a.points < 50);
    }
  });
});

describe('梁山 takes two at a time, 汴河漕運\'s 董事長 aside (the user 2026-11-25)', () => {
  const two = () => {
    const x = setup(), { g, land } = x;
    for (const i of [2, 3]) g.players[i].node = land;
    return { ...x, kiln: g.board.nodes.find(n => n.ref === 6000 + x.c.id)!.id };
  };
  it('a third finds the boat full at a dock (human told on the screen, computer says so), keeps the fare and stays', () => {
    for (const human of [true, false]) {
      const { g, r, dock } = two(), p = g.players[1];
      p.human = human; p.whoPlays = human ? 1 : 2; p.node = dock;
      const cash = p.cash + p.bank, s = run(r.dock(g, p, g.node(dock)), 1);
      expect([p.node, p.cash + p.bank]).toEqual([dock, cash]);
      if (human) expect(s.asks[0]).toMatchObject({ full: true, can: false }); else expect(JSON.stringify(s.steps)).toContain('船已滿');
    }
  });
  it('with one there the second sails; somebody in the hospital or out of the game does not count', () => {
    for (const set of [(g: Game) => { g.players[3].node = 1; }, (g: Game) => { g.players[3].whoPlays = 0; }]) {
      const { g, r, dock, land } = two(), p = g.players[1];
      set(g); p.node = dock;
      run(r.dock(g, p, g.node(dock)), 1);
      expect(p.node).toBe(land);
    }
  });
  it('at the company building the 運輸費 is paid but nobody is shipped', () => {
    const { g, c, kiln } = two(), p = g.players[1];
    p.node = kiln; g.diceTotal = 6;
    const cash = p.cash + p.bank, s = run(g.stocks.landOnCompany(p, c), 0);
    expect(p.node).toBe(kiln);
    expect(p.cash + p.bank).toBe(cash - c.baseFee * 6);
    expect(JSON.stringify(s.steps)).toContain('船已滿');
  });
  it('the 董事長 is asked about a boat of their own — stopping, passing, at the building — and goes', () => {
    for (const how of ['dock', 'pass', 'building']) {
      const { g, r, c, dock, land, kiln } = two(), p = g.players[0];
      p.node = how === 'building' ? kiln : dock;
      const s = how === 'dock' ? run(r.dock(g, p, g.node(dock)), 1) : how === 'pass' ? run(r.step(g, p, 3), 1) : run(g.stocks.landOnCompany(p, c), 1);
      expect(s.asks[0], how).toMatchObject({ boss: true, full: true, free: true });
      if (how === 'pass') run(r.dock(g, p, g.node(dock)), 1);
      expect(p.node, how).toBe(land);
    }
  });
});

describe('a save from before the open market (the user 2026-11-25, in the middle of a turn: 「為啥股票還是買不了」)', () => {
  it('every stock can be bought at once after loading; a save made since keeps its turn\'s volumes', () => {
    const { g } = setup(), board = parseBoard(raw);
    // as the old version left it: no companies linked past the first four, the volumes from the floating shares only
    for (const [i, st] of g.stocks.stocks.entries()) {
      const c = g.board.companies.find(x => x.stockSlot === i);
      if (i >= 4 && c) { st.companyId = 0; st.floatPool = 10000; c.freeShares = 0; }
      if (i === 4 || i === 5 || i === 6) c!.category = [1, 5, 11][i - 4];
      st.turnQuota = Math.trunc(st.floatPool / 5);
    }
    delete g.stocks.openQuotas; delete g.stocks.ownShares;
    const old = JSON.parse(JSON.stringify(saveGame(g)));
    const now = loadGame(old, board);
    for (const st of now.stocks.stocks) expect(st.turnQuota, st.name).toBeGreaterThan(0);
    expect(now.board.companies.slice(4).map(c => [c.name, c.category, c.baseFee, c.freeShares])).toEqual([['東京車坊', 6, 500, 5000], ['將作監', 11, 5000, 5000], ['官窯', 3, 50, 5000]]);
    const p = now.players[0], slot = now.stocks.stocks.findIndex(x => x.name === CAOYUN), n = now.stocks.stocks[slot].turnQuota;
    now.stocks.buyMarket(p, slot, n);
    expect([now.stocks.holdings[0][slot].shares, now.stocks.stocks[slot].turnQuota]).toEqual([n, 0]);
    expect(loadGame(JSON.parse(JSON.stringify(saveGame(now))), board).stocks.stocks[slot].turnQuota).toBe(0);
  });

  it('官窯 bought on the market before it was linked, even loaded once since: 保留股份 all the same, a stop asks, the biggest holder is its 董事長 (the user 2026-11-25)', () => {
    for (const linked of [false, true]) {
      const { g } = setup(), slot = 6, c = g.board.companies.find(x => x.stockSlot === slot)!, st = g.stocks.stocks[slot];
      st.companyId = linked ? 7 : 0; c.freeShares = 0; c.controller = 0; st.floatPool = 6800;
      g.stocks.holdings[2][slot] = { shares: 2000, avgCost: 100 }; g.stocks.holdings[3][slot] = { shares: 1200, avgCost: 100 };
      delete g.stocks.ownShares; if (!linked) delete g.stocks.openQuotas;
      const now = loadGame(JSON.parse(JSON.stringify(saveGame(g))), parseBoard(raw)), k = now.board.companies.find(x => x.stockSlot === slot)!;
      expect([k.name, k.freeShares, now.stocks.stocks[slot].floatPool, k.controller]).toEqual(['官窯', 5000, 1800, 3]);
      const p = now.players[0]; p.node = now.board.nodes.find(n => n.ref === 6000 + k.id)!.id; now.daysElapsed = 20;
      const s = run(now.stocks.landOnCompany(p, k), 0);
      expect(s.steps.some(x => x.kind === 'subscribe')).toBe(true);
      // and only once: shares all sold later stay sold
      k.freeShares = 0;
      expect(loadGame(JSON.parse(JSON.stringify(saveGame(now))), parseBoard(raw)).board.companies.find(x => x.stockSlot === slot)!.freeShares).toBe(0);
    }
  });
});
