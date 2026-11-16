/** 隨機創建 (random.ts): every theme, several seeds and sizes — the editor's check passes and four computers play it. */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBoard } from '../../core/board';
import { pack } from '../../core/date';
import { Game } from '../../core/game';
import type { GameSettings } from '../../core/types';
import { problemList } from './check';
import { records } from './compile';
import { G, newMap } from './model';
import { randomize, THEMES } from './random';

const pub = fileURLToPath(new URL('../../../public/assets/maps/remake/', import.meta.url));
const pieces: number[] = existsSync(`${pub}maker/pieces.json`) ? JSON.parse(readFileSync(`${pub}maker/pieces.json`, 'utf8')) : [];
const frames = async (res: number) => { const f = `${pub}sprites/${res}/frames.json`; if (!existsSync(f)) return null; const j = JSON.parse(readFileSync(f, 'utf8')); return { frames: Array.isArray(j) ? j : j.frames }; };

describe('隨機創建', () => {
  for (const th of THEMES) for (const [w, h, seed] of [[40, 40, 1], [48, 36, 2], [28, 28, 3], [64, 56, 4], [20, 20, 5]] as const) {
    it(`${th.name} ${w}×${h} #${seed}: passes the check${seed === 1 ? ', plays' : ''}`, async () => {
      const m = newMap('隨機', w, h, G.grass);
      await randomize(m, { theme: th, seed, pieces, frames });
      expect(problemList(m).map(p => p.text)).toEqual([]);
      expect(m.lots.length).toBeGreaterThanOrEqual(4);
      expect(new Set(m.lots.flatMap(l => l.nodes)).size).toBe(m.lots.flatMap(l => l.nodes).length);
      expect(m.lots.every(l => l.nodes.every(id => !m.nodes.find(n => n.id === id)!.ev))).toBe(true);
      if (pieces.length) expect(m.things.length).toBeGreaterThan(5);
      if (seed !== 1) return;
      const raw = records(m);
      raw.map_id = 5010;
      const g = new Game({ mapId: 5010, players: [0, 4, 9, 11].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0,
        landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 1, 1), seed: 7 } as GameSettings, parseBoard(raw));
      const flow = g.run();
      for (let r = flow.next(); !r.done && g.daysElapsed < 150 && !g.over; r = flow.next()) if ('ask' in r.value) throw new Error('a question for a computer');
      expect(g.board.lands.filter(l => l.owner).length).toBeGreaterThan(3);
    }, 30000);
  }
});
