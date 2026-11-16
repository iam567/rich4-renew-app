/**
 * 重慶's board (docs/rules/33, map 109): three plates stacked over the river island. The map JSON's `levels`
 * (editor/build_chongqing.py build) says which level every square, plot, landmark and plant is on; the board draws
 * the levels bottom to top, each one's ground then its own buildings and people (so an upper plate hides what is
 * under it), and never the levels above the one the camera follows (§1: 「你在第幾層，就畫這層和下面露出來的部分」).
 *
 * The buildings on lots and plots are 重慶's own (tools/tokyo-landmarks/chongqing_models.py), each turned square on
 * its plot: plots turn in 22.5° steps, a building on a half step draws its '-h' views (`half_of`).
 */
import { CQ_MAP } from '../core/chongqing'; // also registers map 109's rules for a normal game
import type { Game } from '../core/game';

export { CQ_MAP };

export interface CqLevels {
  node: number[];
  lands: number[];
  facilities: number[];
  companies: number[];
  landscapes: number[];
  decorations: number[];
  escalator: [number, number];
  elevator: [number, number, number];
  ramp: number[];
  layers: Record<string, string>;
  layer_box: Record<string, [number, number, number, number]>;
  plot_angle: { lands: number[]; facilities: number[]; companies: number[] };
  facing: { lands: [number, number][]; facilities: [number, number][]; companies: [number, number][] };
  lot_style: string[];
  lot_sprites: Record<string, number[]>;
  fac_sprites: Record<string, number[]>;
  half_of: Record<string, number>;
  viaduct: { res: number; x: number; y: number };
  /** Set in the map editor (editor/site/remake.html): a plot's own frame size [width, depth] (default 54 / 104 square)… */
  plot_size?: { lands?: ([number, number] | null)[]; facilities?: ([number, number] | null)[]; companies?: ([number, number] | null)[] };
  /** …a landmark's size (1 = as drawn) and its facing (0–7, instead of its record's). */
  landscape_scale?: (number | null)[];
  landscape_face?: (number | null)[];
}

export const LEVEL_NAMES = ['', '第一層', '第二層', '第三層'];

const half = (lv: CqLevels, res: number, on: number) => (on ? lv.half_of[String(res)] ?? res : res);

/** A lot's house on 重慶 (lot_style × level), its half-step views when its plot is on a half step. */
export function cqHouseSprite(lv: CqLevels, li: number, level: number): number | undefined {
  const row = lv.lot_sprites[lv.lot_style[li]];
  const res = row?.[Math.min(5, Math.max(1, level)) - 1];
  return res === undefined ? undefined : half(lv, res, lv.facing.lands[li]?.[1] ?? 0);
}

/** A large plot's building on 重慶 (麻將館 0, 夜市小吃街 2, 火鍋店 3, 研究所 4; the hotel keeps the game's own). */
export function cqFacSprite(lv: CqLevels, fi: number, fa: { type: number; level: number }): number | undefined {
  const row = lv.fac_sprites[String(fa.type)];
  const res = row?.[Math.min(row.length, Math.max(1, fa.level)) - 1];
  return res === undefined ? undefined : half(lv, res, lv.facing.facilities[fi]?.[1] ?? 0);
}

/** A company's building turned square on its plot. */
export function cqCompanySprite(lv: CqLevels, ci: number, res: number): number {
  return half(lv, res, lv.facing.companies[ci]?.[1] ?? 0);
}

/** The level a square is on (the 公路's squares: 1). */
export function nodeLevel(lv: CqLevels, id: number): number { return lv.node[id - 1] ?? 1; }

/** Whether this game is on 重慶's stacked board. */
export function isCq(g: Game): boolean { return g.settings.mapId === CQ_MAP && !!g.board.levels; }
