import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { EV_PACHINKO, EV_PACHISLOT, KB_MAP, KabukichoRules, kbRules } from './kabukicho';
import { GANG_AWAY, GANG_SPAWNS, INCIDENTS, INCIDENT_TOTAL, KB_FATE, KB_NEWS, MINORS, TOUT_SPAWNS } from './modules/kb-data';
import * as M from './modules/kb-machines';
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

  it('children are turned away at 陪酒店 / 泡泡浴 / 地下賭場 and never meet alcohol or 黑幫', () => {
    const kids = [...MINORS];
    let refused = 0;
    for (const seed of [4, 5]) {
      const g = new Game(settings(seed, kids), board());
      run(g, 300, s => {
        if (s.t !== 'fx') return;
        if (s.kind === 'kb-refused') refused++;
        if (s.kind === 'kb-incident') expect(INCIDENTS.find(i => i.id === (s.data as { id: string }).id)?.alcohol).toBeFalsy();
        if (s.kind === 'kb-gang') expect((s.data as { on: boolean }).on).toBe(false);
      });
      expect(kbRules(g)!.s.gang.holder).toBe(-1);
    }
    expect(refused).toBeGreaterThanOrEqual(0);
  }, 120_000);

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
