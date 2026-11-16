import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { OBJ } from './modules/objects';
import { simMapFile } from './ai-sim';
import type { GameSettings, MapSwitches } from './types';

// 自建地圖's 道具禮物箱 (the user 2026-11-16): many gift boxes on the road, a taken one back by chance each new day.
const game = (sw?: MapSwitches, level?: string) => new Game({ mapId: 0, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
  landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 5, ...(sw ? { mapRules: sw } : {}), ...(level ? { level } : {}) } as GameSettings,
  parseBoard(JSON.parse(readFileSync(simMapFile(0), 'utf8')) as RawMap));
const onRoad = (g: Game) => g.objects.slots.filter(o => o.type === OBJ.Gift && o.node).length;

describe('道具禮物箱', () => {
  it('the original: one gift box; then 5, 10, 15 on the road from the start, each on its own square', () => {
    expect(onRoad(game())).toBe(1);
    for (const [lv, n] of [[1, 5], [2, 10], [3, 15]] as const) {
      const g = game({ gifts: lv });
      expect(onRoad(g)).toBe(n);
      const nodes = g.objects.slots.filter(o => o.node).map(o => o.node);
      expect(new Set(nodes).size).toBe(nodes.length);
    }
  });
  it("at a month's start all 15 are on the road again, the taken ones too; none with 沒有禮物寶箱 or in an older room", () => {
    const g = game({ gifts: 3 });
    for (const o of g.objects.slots) if (o.type === OBJ.Gift) o.node = 0;
    const f = g.objects.monthly();
    for (let r = f.next(); !r.done; r = f.next());
    expect(onRoad(g)).toBe(15);
    expect(onRoad(game({ gifts: 3, noChests: true }))).toBe(0);
    expect(onRoad(game({ gifts: 3 }, '1.2.3'))).toBe(1);
  });
  it('a game on it plays to its end', () => {
    const g = game({ gifts: 3 });
    for (const p of g.players) p.autopilot = true;
    g.animation = false;
    const flow = g.run();
    let r = flow.next(), n = 0;
    while (!r.done && g.daysElapsed < 200 && n++ < 3_000_000) r = flow.next('ask' in (r.value as object) ? 0 : undefined);
    expect(g.daysElapsed).toBeGreaterThan(50);
    expect(onRoad(g)).toBeGreaterThan(0);
  });
});
