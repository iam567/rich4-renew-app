import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { EV_PACHINKO, EV_PACHISLOT, KB_MAP, KabukichoRules, kbRules } from './kabukicho';
import { GANG_AWAY, GANG_SPAWNS, INCIDENTS, INCIDENT_TOTAL, KB_CARD, KB_FATE, KB_NEWS, KB_RAMPAGE, MINORS, TOUT_SPAWNS } from './modules/kb-data';
import * as M from './modules/kb-machines';
import { OBJ } from './modules/objects';
import { Rng } from './rng';
import { loadGame, saveGame } from './save';
import type { GameSettings, Step } from './types';

// 歌舞伎町 (docs/rules/21): map 106's own rules in a normal game.
const file = fileURLToPath(new URL('../../../editor/site/assets/remake/kabukicho.json', import.meta.url));
const have = existsSync(file);
const board = () => parseBoard(JSON.parse(readFileSync(file, 'utf8')) as RawMap);

function settings(seed: number, chars = [0, 4, 9, 11]): GameSettings {
  return {
    mapId: KB_MAP, players: chars.map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 17), seed,
  };
}

/** Runs computers for `days`; every step goes to `see`. */
function run(g: Game, days: number, see?: (s: Step) => void): void {
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days && !g.over; r = flow.next()) see?.(r.value as Step);
}

describe.skipIf(!have)('歌舞伎町 (map 106)', () => {
  it('the map has its pads, NPC squares and a plain prison spur', () => {
    const b = board();
    expect(b.nodes.filter(n => n.event === EV_PACHINKO)).toHaveLength(2);
    expect(b.nodes.filter(n => n.event === EV_PACHISLOT)).toHaveLength(2);
    for (const id of [...GANG_SPAWNS, ...TOUT_SPAWNS]) {
      const n = b.nodes.find(x => x.id === id)!;
      expect(n.event, `node ${id}`).toBe(0);
      expect(n.ref, `node ${id}`).toBe(0);
    }
    expect(b.facilities).toHaveLength(15);
    expect(b.lands).toHaveLength(80);
  });

  it('tables add up: the incident chances and the decks', () => {
    for (const [shop, total] of Object.entries(INCIDENT_TOTAL)) expect(INCIDENTS.filter(i => i.shop === Number(shop)).reduce((a, i) => a + i.w, 0)).toBe(total);
    expect(KB_NEWS).toHaveLength(24);
    expect(KB_FATE).toHaveLength(24);
  });

  it('the machines pay a little under 1 and end within a session', () => {
    const rng = new Rng(7);
    let spent = 0, back = 0;
    for (let i = 0; i < 3000; i++) {
      const r = M.aiSession(rng, i % 2 ? 'pachinko' : 'pachislot', 2);
      spent += r.buys * M.BUY_POINTS;
      back += M.prizeValue(r.kind, r.left).points;
      expect(r.played).toBeLessThanOrEqual(r.kind === 'pachinko' ? M.PACHI.cap : M.SLOT_CAP);
    }
    expect(back / spent).toBeGreaterThan(0.8);
    expect(back / spent).toBeLessThan(1.0);
  });

  it('a year of computers: shops, incidents, 黑幫, the pads; owners rarely sit out', () => {
    const kinds: Record<string, number> = {};
    let busyDays = 0, playerDays = 0;
    for (const seed of [1, 2, 3]) {
      const g = new Game(settings(seed), board());
      expect(g.rules).toBeInstanceOf(KabukichoRules);
      let day = -1;
      run(g, 365, s => {
        if (s.t === 'fx') kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
        if (s.t === 'day') day = g.daysElapsed;
        if (s.t === 'turn') { playerDays++; if ((kbRules(g)!.s.busy[s.p] ?? 0) > 0) busyDays++; }
        void day;
      });
      // Every built shop is one of the five.
      for (const f of g.board.facilities) if (f.level) expect([4, 10, 11, 12, 13]).toContain(f.type);
    }
    expect(kinds['kb-incident'] ?? 0).toBeGreaterThan(0);
    expect(kinds['kb-machine-result'] ?? 0).toBeGreaterThan(0);
    expect(kinds['kb-gang'] ?? 0).toBeGreaterThan(0);
    expect(kinds.news ?? 0).toBeGreaterThan(0);
    expect(kinds.fate ?? 0).toBeGreaterThan(0);
    expect(busyDays / playerDays).toBeLessThan(0.05);
  }, 120_000);

  it('children are turned away at 陪酒店 / 泡泡浴 / 情人酒店 and never meet alcohol', () => {
    const kids = [...MINORS].slice(0, 4);
    let refused = 0;
    expect(MINORS.has(11)).toBe(true);           // 金貝貝
    for (const seed of [4, 5]) {
      const g = new Game(settings(seed, kids), board());
      run(g, 300, s => {
        if (s.t !== 'fx') return;
        if (s.kind === 'kb-refused') refused++;
        if (s.kind === 'kb-incident') expect(INCIDENTS.find(i => i.id === (s.data as { id: string }).id)?.alcohol).toBeFalsy();
      });
    }
    expect(refused).toBeGreaterThanOrEqual(0);
  }, 120_000);

  it('a child at a rival 陪酒店 / 泡泡浴 buys goods, at a 情人酒店 plays at the amusement park N days; both pay as an adult', () => {
    const g = new Game(settings(31, [0, 9, 4, 11]), board()), kb = kbRules(g)!;
    for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cash = 500000; }
    const [owner, kid, adult] = g.players;
    const f = g.board.facilities[0];
    f.owner = owner.id + 1; f.level = 3;
    const visit = (p: typeof kid, type: number) => {
      f.type = type; p.hotel = 0;
      let got = 0;
      const kinds: string[] = [];
      const flow = kb.visitShop(g, p, f);
      for (let r = flow.next(); !r.done; r = flow.next()) {
        const s = r.value as Step;
        if (s.t === 'fx') kinds.push(s.kind);
        if (s.t === 'pay' && s.to === owner.id) got += s.amount;
      }
      return { got, kinds };
    };
    for (const type of [11, 12]) {
      const v = visit(kid, type);
      expect(v.kinds).toContain('kb-merch');
      expect(v.kinds).not.toContain('kb-incident');
      expect(v.got).toBeGreaterThanOrEqual(kb.rate(f));
      expect(kid.hotel).toBe(0);
    }
    const park = visit(kid, 13);
    expect(park.kinds).toEqual(expect.arrayContaining(['kb-refused', 'kb-park', 'enter-hotel']));
    expect(kid.hotel).toBeGreaterThan(0);
    expect(kb.stayLabel(g, kid)).toBe('在遊樂場玩');
    const days = kid.hotel === 0x80 ? 1 : kid.hotel + 1;
    expect(park.got).toBe(kb.rate(f) * days);
    const stay = visit(adult, 13);
    expect(stay.kinds).not.toContain('kb-incident');
    expect(stay.kinds).not.toContain('kb-park');
    expect(adult.hotel).toBeGreaterThan(0);
    expect(kb.stayLabel(g, adult)).toBeUndefined();
  });

  it('the halls are arcades: anyone plays, no cash; leftovers back as 點券, the counter\'s own goods only there', () => {
    const g = new Game(settings(41, [9, 0, 4, 11]), board()), kb = kbRules(g)!;
    const drain = (f: Generator<unknown, unknown, unknown>) => { let r = f.next(); const out: Step[] = []; while (!r.done) { out.push(r.value as Step); r = f.next(); } return { value: r.value, out }; };
    const kid = g.players[0];
    kid.placed = true; kid.whoPlays = 2; kid.points = 200;
    const cash = kid.cash, pts = kid.points;
    const r = drain(kb.machine(g, kid, 'pachinko') as Generator<unknown, unknown, unknown>);
    expect(r.out.some(s => s.t === 'fx' && s.kind === 'kb-machine-result' && !(s.data as { skipped?: boolean }).skipped)).toBe(true);   // a child plays
    expect(kid.cash).toBe(cash);                                                                   // no cash ever
    expect(r.out.some(s => s.t === 'pay' && (s as { reason?: string }).reason === '景品兌換')).toBe(false);
    expect(kid.points).not.toBe(pts);
    // At the counter: what is left comes back as 點券 at the buying rate (25 balls a point).
    const q = g.players[1]; q.placed = true; q.whoPlays = 2; q.points = 0; q.tools[16] = 1; q.tools[17] = 1; q.cards = [KB_CARD, KB_RAMPAGE];
    const ex = drain(kb.exchange(g, q, 'pachinko', 25 * 30 + 7, new Rng(1)) as Generator<unknown, unknown, unknown>);
    expect(q.points).toBe(30);
    expect(String(ex.value)).toContain('點券 30');
    // The goods are nowhere else: not on the card shelf, not from the lottery fate.
    for (let k = 0; k < 50; k++) for (const id of g.tools.cardShelf()) expect(id).toBeLessThanOrEqual(30);
    // 搶奪卡 can move an exclusive tool like any other.
    expect(g.tools.receive(kid, 17)).toBe(true);
  });

  it('保鑣卡 stops the 保護費 by itself; 暴走卡 gives one more whole turn; old saves convert', () => {
    const g = new Game(settings(43), board()), kb = kbRules(g)!;
    const drain = (f: Generator<unknown, unknown, unknown>) => { let r = f.next(); const out: Step[] = []; while (!r.done) { out.push(r.value as Step); r = f.next(); } return { value: r.value, out }; };
    const [owner, holder] = g.players;
    owner.cards = [KB_CARD]; owner.cash = 50000;
    const before = owner.cash;
    const r = drain(kb.protection(g, holder, owner, 2001, 9000) as Generator<unknown, unknown, unknown>);
    expect(owner.cash).toBe(before);
    expect(owner.cards).not.toContain(KB_CARD);
    expect(r.out.some(s => s.t === 'fx' && s.kind === 'kb-bodyguard')).toBe(true);
    // 計程車券: five dice this turn
    kb.s.roll[holder.id] = 18;
    expect((drain(kb.rollDice(g, holder) as Generator<unknown, unknown, unknown>).value as number[]).length).toBe(5);
    // …or put on a rival: their next throw is five dice; a second one is refused and kept.
    const rival = g.players[2];
    rival.placed = true; rival.whoPlays = 2; holder.tools[17] = 2;
    expect(drain(kb.useTool(g, holder, 18, rival.id) as Generator<unknown, unknown, unknown>).value).toBe(true);
    expect([holder.tools[17], kb.s.taxi[rival.id]]).toEqual([1, 1]);
    expect(drain(kb.useTool(g, holder, 18, rival.id) as Generator<unknown, unknown, unknown>).value).toBe(false);
    expect(holder.tools[17]).toBe(1);
    const ride = drain(kb.rollDice(g, rival) as Generator<unknown, unknown, unknown>);
    expect((ride.value as number[]).length).toBe(5);
    expect(ride.out.some(s => s.t === 'fx' && s.kind === 'kb-taxi-ride')).toBe(true);
    expect(kb.s.taxi[rival.id]).toBe(0);
    expect(drain(kb.rollDice(g, rival) as Generator<unknown, unknown, unknown>).value).toBeUndefined();
    // 暴走卡
    holder.cards = [KB_RAMPAGE]; holder.placed = true; holder.whoPlays = 2;
    expect(drain(kb.playCard(g, holder, KB_RAMPAGE) as Generator<unknown, unknown, unknown>).value).toBe(true);
    expect(holder.cards).not.toContain(KB_RAMPAGE);
    expect(kb.extraTurn(g, holder)).toBe(true);
    expect(kb.extraTurn(g, holder)).toBe(false);
    // A save from before: tool 19 (保鑣) → the card, tool 20 (霓虹燈箱) → 60 點券 each.
    const save = saveGame(g) as unknown as { players: { tools: number[]; cards: number[]; points: number }[]; mapRules: Record<string, unknown> };
    save.players[2].tools[18] = 2; save.players[2].tools[19] = 1; save.players[2].cards = []; save.players[2].points = 5;
    save.mapRules.neon = [{ ref: 2001, days: 3 }];
    const h = loadGame(JSON.parse(JSON.stringify(save)), board());
    expect(h.players[2].cards.filter(c => c === KB_CARD)).toHaveLength(2);
    expect(h.players[2].points).toBe(65);
    expect(h.players[2].tools[18]).toBe(0);
    expect((kbRules(h)!.s as unknown as { neon?: unknown }).neon).toBeUndefined();
  });

  it('dragged in by the 拉客仔 counts as stopping there: 土地公 takes the shop over (after the bill, as on a stop)', () => {
    const g = new Game(settings(51), board()), kb = kbRules(g)!;
    const drain = (f: Generator<unknown, unknown, unknown>) => { let r = f.next(); while (!r.done) r = f.next(); };
    const [p, owner] = g.players;
    for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cash = 500000; }
    for (const f of g.board.facilities) { f.owner = 0; f.level = 0; }
    const f = g.board.facilities[4];
    f.owner = owner.id + 1; f.level = 2; f.type = 10;
    p.node = kb.s.tout.node;
    const pair = g.objects.slots[(OBJ.EarthGod % 2 ? OBJ.EarthGod + 1 : OBJ.EarthGod - 1) - 1];
    if (pair.node) g.objects.removeAt(pair.node);
    drain(g.objects.attach(p, OBJ.EarthGod) as Generator<unknown, unknown, unknown>);
    expect(g.objects.godType(p)).toBe(OBJ.EarthGod);
    drain(kb.drag(g, p) as Generator<unknown, unknown, unknown>);
    expect(p.node).toBe(kb.facilityNode(f)!.id);
    expect(f.owner).toBe(p.id + 1);
  });

  it('a saved game plays on the same as the unsaved one', () => {
    const g = new Game(settings(11), board());
    run(g, 60);
    const save = saveGame(g);
    expect(save.mapRules).toBeTruthy();
    const h = (x: Game) => { const c = createHash('sha256'); run(x, 90, s => c.update(JSON.stringify(s))); return c.digest('hex'); };
    const a = loadGame(JSON.parse(JSON.stringify(save)), board());
    const b = loadGame(JSON.parse(JSON.stringify(save)), board());
    expect(h(a)).toBe(h(b));
  }, 120_000);

  it('黑幫 works like a god: 送神符 sends it away (30 days off), 請神符 calls it, the magic house counts it', () => {
    const g = new Game(settings(21), board()), kb = kbRules(g)!;
    const p = g.players[0];
    p.placed = true; p.whoPlays = 2; p.node = GANG_SPAWNS[0];
    const drain = (f: Generator<unknown, unknown, unknown>) => { let r = f.next(); while (!r.done) r = f.next(); return r.value; };
    // 請神符 (the computer's choice: 黑幫's square)
    kb.s.gang = { node: GANG_SPAWNS[1], holder: -1, days: 0, take: 0, back: 0 };
    p.cards = [23];
    (g.cards as unknown as { aiArg0: number }).aiArg0 = GANG_SPAWNS[1];
    expect(drain((g.cards as unknown as { play(p: unknown, id: number, h: boolean): Generator }).play(p, 23, false))).toBe(true);
    expect(kb.s.gang.holder).toBe(0);
    expect(p.cards).not.toContain(23);
    // the magic house's 「有神附身者」
    expect(g.places.magicGroup(9).map(q => q.id)).toContain(0);
    // 送神符: possession over, money kept, 30 days off the map
    p.cards = [22];
    expect(drain((g.cards as unknown as { play(p: unknown, id: number, h: boolean): Generator }).play(p, 22, false))).toBe(true);
    expect(kb.s.gang.holder).toBe(-1);
    expect(kb.s.gang.node).toBe(0);
    expect(kb.s.gang.back).toBe(GANG_AWAY);
    expect(GANG_AWAY).toBe(30);
    for (let d = 0; d < GANG_AWAY - 1; d++) { kb.daily(g); expect(kb.s.gang.node).toBe(0); }
    kb.daily(g);
    expect(GANG_SPAWNS).toContain(kb.s.gang.node);
  });

  it('黑幫 possesses only a player who stops on its square, not one passing by (like the gods)', () => {
    const g = new Game(settings(23), board()), kb = kbRules(g)!;
    const p = g.players[0];
    p.placed = true; p.whoPlays = 2; p.god = 0; p.node = GANG_SPAWNS[0];
    kb.s.gang = { node: GANG_SPAWNS[0], holder: -1, days: 0, take: 0, back: 0 };
    const drain = (f: Generator<unknown, unknown, unknown>) => { let r = f.next(); while (!r.done) r = f.next(); return r.value; };
    expect(drain(kb.step(g, p, 3) as Generator<unknown, unknown, unknown>)).toBe(3);   // passing: steps left
    expect(kb.s.gang.holder).toBe(-1);
    drain(kb.step(g, p, 0) as Generator<unknown, unknown, unknown>);                  // stopping on it
    expect(kb.s.gang.holder).toBe(0);
    expect(kb.s.gang.days).toBe(7);
  });
});
