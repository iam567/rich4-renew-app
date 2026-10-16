import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addDays, daysInMonth, pack } from '../core/date';
import { parseBoard, type RawMap } from '../core/board';
import { Game } from '../core/game';
import type { GameSettings } from '../core/types';
import { CLIMATES, climateOf, type ClimateId } from './climate';
import { monthOdds, todayWeather, WEATHER_KINDS, weatherOf, type WeatherKind } from './weather';

/** Share of each kind over every day of month `m` in `years` years for `seeds` games. */
function share(mapId: number, m: number, seeds = 60, years = 8) {
  const count: Record<string, number> = {};
  let n = 0;
  for (let s = 0; s < seeds; s++) {
    const seed = (s * 2654435761) >>> 0;
    for (let y = 2001; y < 2001 + years; y++) {
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const w = weatherOf(seed, mapId, pack(y, m, d))!;
        count[w.kind] = (count[w.kind] ?? 0) + 1;
        n++;
      }
    }
  }
  const out = {} as Record<WeatherKind, number>;
  for (const k of WEATHER_KINDS) out[k] = (count[k] ?? 0) / n;
  return out;
}

describe('daily weather (docs/rules/16)', () => {
  it('month odds are a distribution for every climate and month', () => {
    for (const id of Object.keys(CLIMATES) as ClimateId[]) {
      for (let m = 1; m <= 12; m++) {
        const o = monthOdds(CLIMATES[id], m);
        let sum = 0;
        for (const k of WEATHER_KINDS) { expect(o[k]).toBeGreaterThanOrEqual(0); sum += o[k]; }
        expect(sum).toBeCloseTo(1, 6);
      }
    }
  });

  it('is deterministic from seed, map and date (a loaded game shows the same sky)', () => {
    for (const map of [0, 1, 2, 3, 100, 101, 102, 103, 104, 3945789]) {
      for (let i = 0; i < 200; i++) {
        const d = addDays(pack(2026, 1, 1), i * 3);
        expect(weatherOf(1234, map, d)).toEqual(weatherOf(1234, map, d));
      }
    }
    // Different seeds give different sequences.
    const a = Array.from({ length: 60 }, (_, i) => weatherOf(1, 100, addDays(pack(2026, 6, 1), i))!.kind).join();
    const b = Array.from({ length: 60 }, (_, i) => weatherOf(2, 100, addDays(pack(2026, 6, 1), i))!.kind).join();
    expect(a).not.toEqual(b);
  });

  it('has no weather on the four theme maps, a temperate one on workshop maps', () => {
    for (const m of [4, 5, 6, 7]) expect(weatherOf(9, m, pack(2026, 1, 1))).toBeNull();
    expect(climateOf(3945789)).toBe('temperate');
    expect(weatherOf(9, 3945789, pack(2026, 1, 1))).not.toBeNull();
  });

  it('follows each map\'s climate', () => {
    const sapJan = share(102, 1);
    expect(sapJan.snow).toBeGreaterThanOrEqual(0.4); // 札幌 January: snow on most days
    expect(share(102, 7).snow).toBe(0); // and never in July
    for (const m of [1, 2, 8, 12]) expect(share(104, m).snow).toBe(0); // 沖繩: never snow
    expect(share(104, 8).typhoon).toBeGreaterThan(0.02); // typhoon season
    expect(share(104, 8).typhoon).toBeLessThan(0.12); // but rare
    expect(share(100, 1).sunny).toBeGreaterThan(0.6); // 東京 winter: dry and sunny
    expect(share(100, 6).rain + share(100, 6).storm).toBeGreaterThan(0.3); // 梅雨
    expect(share(103, 7).storm).toBeGreaterThan(share(100, 1).storm * 5); // 九州 summer thunderstorms
    expect(share(100, 1).snow).toBeLessThan(0.15); // 東京 snow is rare
    for (const m of [6, 7, 8]) expect(share(0, m).snow).toBe(0); // 台灣 summer
  });

  it('keeps each month\'s long-run mix (spells do not skew it)', () => {
    for (const [map, m] of [[100, 6], [102, 1], [104, 9], [1, 7]] as const) {
      const id = climateOf(map)!, want = monthOdds(CLIMATES[id], m), got = share(map, m, 80, 10);
      for (const k of WEATHER_KINDS) expect(Math.abs(got[k] - want[k])).toBeLessThan(0.04);
    }
  });

  it('has spells: wet days follow wet days more often than chance', () => {
    let wetWet = 0, wet = 0, wetAny = 0, n = 0;
    for (let s = 0; s < 40; s++) {
      for (let i = 0; i < 365; i++) {
        const d = addDays(pack(2026, 1, 1), i);
        const a = weatherOf(s, 100, d)!.kind, b = weatherOf(s, 100, addDays(d, 1))!.kind;
        const wa = a === 'rain' || a === 'storm', wb = b === 'rain' || b === 'storm';
        n++; if (wb) wetAny++;
        if (wa) { wet++; if (wb) wetWet++; }
      }
    }
    expect(wetWet / wet).toBeGreaterThan((wetAny / n) * 1.3);
  });
});

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));

describe.skipIf(!existsSync(mapFile(1)))('weather and the rules', () => {
  /** A computer-only game; `look` asks for the weather at every step (as the screen does). */
  function play(look: boolean) {
    const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
    const settings: GameSettings = {
      mapId: 1, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
      fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 777,
    };
    const game = new Game(settings, board);
    const flow = game.run(), log: string[] = [], skies: string[] = [];
    for (let r = flow.next(); !r.done && game.daysElapsed < 150; r = flow.next()) {
      if (look) { const w = todayWeather(game); if (w) skies.push(w.kind); }
      log.push(JSON.stringify(r.value));
    }
    return { log, skies, cash: game.players.map(p => [p.cash, p.bank]), rng: (game as unknown as { rng: { seed: number } }).rng.seed };
  }

  it('a full computer game is identical with the weather on or off', () => {
    const off = play(false), on = play(true);
    expect(on.skies.length).toBeGreaterThan(100);
    expect(on.log).toEqual(off.log);
    expect(on.cash).toEqual(off.cash);
    expect(on.rng).toBe(off.rng);
  }, 30_000);
});
