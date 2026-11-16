import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import { describe as info } from './map-info';

const mapFile = fileURLToPath(new URL('../../../editor/site/assets/map-0.json', import.meta.url));

describe.skipIf(!existsSync(mapFile))('the map info box', () => {
  it('a lot and a large plot show their name first (the user 2026-11-03: the task cards name them)', () => {
    const g = new Game({ mapId: 0, players: [0, 4].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 11, 3), seed: 1 },
      parseBoard(JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap));
    const l = g.board.lands[0];
    l.owner = 2; l.level = 4;
    const a = info(g, { x: l.x, y: l.y }, () => undefined)!;
    expect(a.lines[0]).toBe(l.name);
    expect(a.lines).toContain(g.name(1));
    expect(a.lines.join('|')).toMatch(/商業大樓 四級/);
    const f = g.board.facilities[0];
    if (f) { const b = info(g, { x: f.x, y: f.y }, () => undefined)!; expect(b.lines[0]).toBe(f.name); }
  });

  it('歌舞伎町\'s 柏青哥店 and 拉霸店 pads say what they are (issue #61: an empty box)', () => {
    const g = new Game({ mapId: 0, players: [0, 4].map(c => ({ character: c, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 17), seed: 1 },
      parseBoard(JSON.parse(readFileSync(mapFile, 'utf8')) as RawMap));
    g.board.lands.length = 0; g.board.facilities.length = 0; g.board.companies.length = 0; g.board.landscapes.length = 0;
    const n = g.board.nodes[0];
    n.event = 19;
    expect(info(g, { x: n.x, y: n.y }, () => undefined)!.lines[0]).toBe('柏青哥店');
    n.event = 20;
    expect(info(g, { x: n.x, y: n.y }, () => undefined)!.lines[0]).toBe('拉霸店');
  });
});
