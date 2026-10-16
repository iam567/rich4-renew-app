import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { Game } from './game';
import { pack } from './date';
import { loadGame, loadWorld, saveGame, saveWorld } from './save';
import { applyOverlay, TYCOON_MAPS, World, type TycoonOverlay, type TycoonSettings } from './world';
import { attachLedger, chipInputs, eventTone, FATE_TONE, ledgerOf, NEWS_TONE, sum, worldResults } from './stats';
import { FATE_COUNT, NEWS_COUNT } from './modules/events';
import type { GameSettings } from './types';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const have = existsSync(mapFile(1));

function setup(mapId: number, seed: number) {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(mapId), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  return new Game(settings, board);
}

/** Plays computer days; returns the step log (events as JSON) and the game. */
function play(g: Game, days: number) {
  const log: string[] = [];
  const flow = g.run();
  for (let r = flow.next(); !r.done && g.daysElapsed < days; r = flow.next()) log.push(JSON.stringify(r.value));
  return log;
}

describe('statistics tables', () => {
  it('classify every original news and fate entry', () => {
    expect(FATE_TONE.length).toBe(FATE_COUNT);
    expect(NEWS_TONE.length).toBe(NEWS_COUNT);
    expect(eventTone('fate', 20)).toBe('good');
    expect(eventTone('fate', 33)).toBe('bad');
    expect(eventTone('news', 26)).toBe('neutral');
  });
});

describe.skipIf(!have)('statistics ledger', () => {
  it('counts a simulated year and matches the board', () => {
    const g = setup(1, 4242);
    const ledger = attachLedger(g.players);
    const log = play(g, 365);
    ledger.finish(g);
    const events = log.map(l => JSON.parse(l) as { t: string; p?: number; kind?: string; from?: number; to?: number; reason?: string; amount?: number; price?: number; cost?: number });
    for (const p of g.players) {
      const x = ledger.of(p.id);
      // The buy squares' purchases, one by one.
      const buys = events.filter(e => e.t === 'buy' && e.p === p.id && (e as { kind?: string }).kind === 'land');
      expect(x.landsBought).toBeGreaterThanOrEqual(buys.length);
      expect(x.landSpent).toBeGreaterThanOrEqual(buys.reduce((a, e) => a + (e.price ?? 0), 0));
      const tolls = events.filter(e => e.t === 'pay' && e.to === p.id && e.reason === '過路費' && e.from !== undefined && e.from >= 0 && e.from < 4);
      expect(x.tollsReceived).toBeGreaterThanOrEqual(tolls.reduce((a, e) => a + (e.amount ?? 0), 0));
      expect(x.levelsAdded).toBeGreaterThanOrEqual(x.buildings);
      expect(x.maxAssets).toBeGreaterThan(0);
      expect(x.finalCash).toBe(p.cash);
      expect(x.finalBank).toBe(p.bank);
      expect(x.lucky + x.unlucky + x.neutral).toBe(Object.values(x.events).reduce((a, [b, c, d]) => a + b + c + d, 0));
    }
    const all = g.players.map(p => ledger.of(p.id));
    // A year of four computers: lots bought, buildings, tolls, news and fate, cards, shares and days in hospital happen.
    expect(all.reduce((a, x) => a + x.landsBought, 0)).toBeGreaterThan(10);
    expect(all.reduce((a, x) => a + x.buildings, 0)).toBeGreaterThan(5);
    expect(all.reduce((a, x) => a + x.tollsPaidCount, 0)).toBeGreaterThan(5);
    expect(all.reduce((a, x) => a + x.lucky, 0)).toBeGreaterThan(0);
    expect(all.reduce((a, x) => a + x.unlucky, 0)).toBeGreaterThan(0);
    expect(all.reduce((a, x) => a + sum(x.cardsUsed) + sum(x.cardsBought), 0)).toBeGreaterThan(0);
    expect(all.reduce((a, x) => a + x.sharesBought, 0)).toBeGreaterThan(0);
    // Toll money balances between the players.
    expect(all.reduce((a, x) => a + x.tollsPaid, 0)).toBe(all.reduce((a, x) => a + x.tollsReceived, 0));
    expect(ledger.days).toBe(g.daysElapsed);
    const chips = chipInputs(ledger, 0);
    expect(chips.finalMoney).toBe(g.players[0].cash + g.players[0].bank);
  }, 30_000);

  it('does not change the game (the same steps and save with or without a ledger)', () => {
    const a = setup(2, 77), b = setup(2, 77);
    attachLedger(b.players);
    expect(play(b, 150)).toEqual(play(a, 150));
    const sa = saveGame(a), sb = saveGame(b);
    expect(sa.stats).toBeUndefined();
    expect(sb.stats).toBeDefined();
    const { stats: _s, savedAt: _x, ...restB } = sb;
    const { savedAt: _y, ...restA } = sa;
    expect(restB).toEqual(restA);
  }, 30_000);

  it('is saved and loaded; old saves load without one', () => {
    const g = setup(3, 5);
    attachLedger(g.players);
    play(g, 60);
    const s = saveGame(g);
    const back = loadGame(JSON.parse(JSON.stringify(s)));
    expect(ledgerOf(back.players)?.save()).toEqual(g.stats!.save());
    const { stats: _drop, ...old } = s;
    expect(ledgerOf(loadGame(JSON.parse(JSON.stringify(old))).players)).toBeUndefined();
  }, 30_000);
});

// 大富豪模式: the five cities share one ledger; it sees every city (the headless ones too) and changes nothing.
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const cityFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${KEYS[id]}.json`, import.meta.url));
const haveCities = TYCOON_MAPS.every(id => existsSync(cityFile(id)));
const cityBoards = () => TYCOON_MAPS.map(id => { const r = JSON.parse(readFileSync(cityFile(id), 'utf8')) as RawMap & { tycoon?: TycoonOverlay }; return applyOverlay(parseBoard(r), r.tycoon, id); });
const tycoon = (seed: number): TycoonSettings => ({
  mode: 'tycoon', maps: [...TYCOON_MAPS], players: Array.from({ length: 12 }, (_, i) => ({ character: i, human: false })),
  fundIndex: 1, traffic: 1, landLimitIndex: 0, startDate: pack(2026, 10, 16), seed,
});
function playWorld(w: World, days: number): string[] {
  const log: string[] = [];
  const flow = w.run();
  for (let r = flow.next(); !r.done && !w.over && w.daysElapsed < days; r = flow.next()) log.push(JSON.stringify(r.value));
  return log;
}

describe.skipIf(!haveCities)('statistics ledger in 大富豪模式', () => {
  it('counts the whole world and plays the same with or without it', () => {
    const a = new World(tycoon(11), cityBoards()), b = new World(tycoon(11), cityBoards());
    const ledger = attachLedger(b.players);
    expect(b.stats).toBe(ledger);
    expect(b.cities.every(c => c.stats === ledger)).toBe(true);
    expect(playWorld(b, 90)).toEqual(playWorld(a, 90));
    const sa = saveWorld(a), sb = saveWorld(b);
    expect(sa.stats).toBeUndefined();
    const { stats: _s, savedAt: _x, ...restB } = sb;
    const { savedAt: _y, ...restA } = sa;
    expect(restB).toEqual(restA);
    const res = worldResults(b, -1);
    expect(res.players).toHaveLength(12);
    expect(res.players.map(r => r.rank)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    const all = b.players.map(p => ledger.of(p.id));
    // Everyone has been in their starting city at least and the city they are in now; a trip adds a city.
    b.players.forEach((p, i) => {
      if (!p.bankrupt && p.map !== undefined && !p.trip) expect(all[i].cities).toContain(p.map);
      expect(all[i].cities.length).toBeGreaterThanOrEqual(Math.min(1, all[i].trips));
    });
    expect(all.reduce((s, x) => s + x.landsBought, 0)).toBeGreaterThan(20);
    // Saved and loaded with the world.
    const back = loadWorld(JSON.parse(JSON.stringify(sb)));
    expect(back.stats?.save()).toEqual(sb.stats);
  }, 60_000);
});
