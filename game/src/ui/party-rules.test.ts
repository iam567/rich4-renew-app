/**
 * 派對模式's room rules (issue #31): the host's 總資金/行進方式/土地權限/遊戲時間/勝利條件 reach every phone (live, to
 * a phone joining later, and past a host hand-over), and the game every phone starts from the host's StartMsg is the
 * same one. Over the in-memory PeerJS (peerjs-mock.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('peerjs', () => import('./peerjs-mock'));

import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import { saveGame } from '../core/save';
import { DAY_LIMITS, FUNDS, LAND_LIMIT_MONTHS, VICTORY_MULTIPLES, type GameSettings } from '../core/types';
import { cleanRules, DEFAULT_RULES, Room, startMsg, type PartyRules, type StartMsg } from './party-net';
import { RULE_ITEMS } from './rule-options';

const settle = async (ms = 0) => { for (let k = 0; k < 20; k++) await Promise.resolve(); if (ms) await new Promise(r => setTimeout(r, ms)); for (let k = 0; k < 20; k++) await Promise.resolve(); };
const open: Room[] = [];
const room = (character: number) => { const r = new Room({ name: `p${character}`, character }, '0.8.0'); open.push(r); return r; };
const PICKED: PartyRules = { fundIndex: 3, traffic: 2, landLimitIndex: 4, daysLimitIndex: 2, victoryIndex: 5 };

beforeAll(() => { vi.stubGlobal('window', globalThis); });
afterEach(() => { for (const r of open.splice(0)) r.close(); });

describe('rule values', () => {
  it('the defaults are what every party game started with before', () => {
    expect(DEFAULT_RULES).toEqual({ fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0 });
  });
  it('the options match the game tables', () => {
    expect(RULE_ITEMS.fundIndex.length).toBe(FUNDS.length);
    expect(RULE_ITEMS.landLimitIndex.length).toBe(LAND_LIMIT_MONTHS.length);
    expect(RULE_ITEMS.daysLimitIndex.length).toBe(DAY_LIMITS.length);
    expect(RULE_ITEMS.victoryIndex.length).toBe(VICTORY_MULTIPLES.length);
    expect(RULE_ITEMS.traffic.length).toBe(3);
  });
  it('bad or missing values fall back to the defaults', () => {
    expect(cleanRules(undefined)).toEqual(DEFAULT_RULES);
    expect(cleanRules({ fundIndex: 9, traffic: -1, landLimitIndex: 1.5, daysLimitIndex: '2', victoryIndex: 3 })).toEqual({ ...DEFAULT_RULES, victoryIndex: 3 });
  });
});

describe('the rules in a room (mocked PeerJS)', () => {
  it('untouched: every phone has the defaults, and the game starts with them', async () => {
    const host = room(0);
    const code = await host.create('2', false);
    const g = room(3);
    await g.join(code); await settle();
    expect(host.rules).toEqual(DEFAULT_RULES);
    expect(g.rules).toEqual(DEFAULT_RULES);
    let got: StartMsg | null = null;
    g.onStart = s => { got = s; };
    host.start(startMsg(host, 4, pack(2026, 10, 29), 1234));
    await settle();
    expect(got!.settings).toMatchObject({ ...DEFAULT_RULES, mapId: 2, party: true, seed: 1234 });
    expect(got!.settings.players.length).toBe(4);
  });

  it("the host's changes reach the guests live and a later joiner; a guest can't change them", async () => {
    const host = room(0);
    const code = await host.create('2', false);
    const a = room(3);
    await a.join(code); await settle();
    let redrawn = 0;
    a.onLobby = () => { redrawn++; };
    host.setRules({ fundIndex: 3 });
    await settle();
    expect(a.rules.fundIndex).toBe(3);
    expect(redrawn).toBeGreaterThan(0);
    host.setRules(PICKED);
    await settle();
    expect(a.rules).toEqual(PICKED);
    const b = room(5);
    await b.join(code); await settle();
    expect(b.rules).toEqual(PICKED);
    a.setRules({ fundIndex: 0 }); // not the host: nothing changes
    await settle();
    expect([host.rules, a.rules, b.rules]).toEqual([PICKED, PICKED, PICKED]);
  });

  it('a host hand-over before the start keeps the rules (and a phone joining the new host gets them)', async () => {
    const host = room(0);
    const code = await host.create('2', false);
    const a = room(1), b = room(2);
    await a.join(code); await settle();
    await b.join(code); await settle();
    host.setRules(PICKED);
    await settle();
    host.close();
    for (let k = 0; k < 40 && !(a.host && a.members.filter(m => !m.away).length === 2 && b.connected()); k++) await settle(250);
    expect(a.host).toBe(true);
    expect(a.rules).toEqual(PICKED);
    expect(b.rules).toEqual(PICKED);
    const c = room(4);
    await c.join(code); await settle();
    expect(c.rules).toEqual(PICKED);
    a.setRules({ traffic: 1 }); // the new host may change them
    await settle();
    expect(b.rules.traffic).toBe(1);
    expect(c.rules.traffic).toBe(1);
  }, 20000);

  const mapFile = fileURLToPath(new URL('../../../editor/site/assets/map-2.json', import.meta.url));
  it.skipIf(!existsSync(mapFile))('every phone starts and plays the same game with the picked rules (lockstep)', async () => {
    const host = room(0);
    const code = await host.create('2', false);
    const a = room(3), b = room(6);
    await a.join(code); await settle();
    await b.join(code); await settle();
    host.setRules(PICKED);
    await settle();
    const got = new Map<Room, GameSettings>();
    for (const r of [host, a, b]) r.onStart = s => { got.set(r, s.settings); };
    host.start(startMsg(host, 4, pack(2026, 10, 29), 4242));
    await settle();
    expect(got.size).toBe(3);
    const [sh, sa, sb] = [host, a, b].map(r => got.get(r)!);
    expect(sa).toEqual(sh);
    expect(sb).toEqual(sh);
    expect(sh).toMatchObject(PICKED);
    // The same game on each phone: the rules applied, and (every seat played by the computer here) the same days.
    const games = [sh, sa, sb].map(s => new Game({ ...s, players: s.players.map(p => ({ ...p, human: false })) }, parseBoard(JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap)));
    for (const g of games) {
      expect(g.fund).toBe(FUNDS[PICKED.fundIndex]);
      expect(g.daysLimit).toBe(DAY_LIMITS[PICKED.daysLimitIndex]);
      expect(g.victoryTarget).toBe(VICTORY_MULTIPLES[PICKED.victoryIndex] * FUNDS[PICKED.fundIndex]);
      expect(g.players.slice(0, 4).every(p => p.traffic === PICKED.traffic)).toBe(true);
      const flow = g.run();
      for (let r = flow.next(); !r.done && g.daysElapsed < 40; r = flow.next()) { /* computer days */ }
    }
    expect(games.every(g => g.daysElapsed >= 40 || !!g.over)).toBe(true);
    const saved = games.map(g => JSON.stringify({ ...saveGame(g), savedAt: 0 }));
    expect(saved[1]).toBe(saved[0]);
    expect(saved[2]).toBe(saved[0]);
  });
});
