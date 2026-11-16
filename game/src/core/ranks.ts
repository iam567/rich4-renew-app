/**
 * 排行榜 (the user 2026-11-16): a game won alone against three computers goes on the boards of its map and difficulty.
 *
 *   最富榜  the most total assets at the end
 *   最快榜  the least real time played (the game on screen, across saves; ties: fewer days)
 *   最狠榜  the most 狠分: rivals broken, attacks made, good gods, luck, tolls taken
 *   最慘榜  the most 慘分: bad gods, attacks suffered, days in hospital / prison, bad luck, tolls paid — and won anyway
 *
 * Only a game of 開始遊戲: one human, three computers, every computer bankrupt; not 派對, 試玩, 即時制, 大富豪 or a game with
 * 挑戰模式 / 每月任務 on; only the game's own maps (no player's map, 創作樂園's neither).
 */
import type { Game } from './game';
import type { PlayerStats } from './stats';

export const BOARDS = ['rich', 'fast', 'fierce', 'woe'] as const;
export type BoardKey = (typeof BOARDS)[number];
export const BOARD_NAMES: Record<BoardKey, string> = { rich: '最富榜', fast: '最快榜', fierce: '最狠榜', woe: '最慘榜' };
export const LEVEL_NAMES = ['簡單', '中等', '困難', '地獄'];

/** 狠分 / 慘分's weights (shown to the players on the board's 說明). */
export const FIERCE = { broke: 100, card: 20, tool: 15, god: 30, lucky: 5, toll: 1 } as const;
export const WOE = { god: 30, attacked: 20, day: 3, unlucky: 5, toll: 1 } as const;
const GOOD_GODS = [1, 2, 3, 4], BAD_GODS = [5, 6, 7, 8];
const sumOf = (r: Record<number, number>, ok: (id: number) => boolean) => Object.entries(r).reduce((s, [k, n]) => s + (ok(Number(k)) ? n : 0), 0);
/**
 * The cards and tools that hurt others (cards.ts CARDS' f7 > 0: 均富 均貧 購地 拍賣 惡魔 怪獸 拆除 搶奪 冬眠 夢遊 陷害 黑卡 查稅
 * 查封; tools 路障 地雷 定時炸彈 飛彈 工程車 核子飛彈 洲際飛彈), listed here: importing the tables made a cycle with game.ts.
 */
const HOSTILE_CARDS = new Set([1, 2, 3, 8, 10, 11, 12, 13, 15, 16, 17, 25, 26, 28]);
const HOSTILE_TOOLS = new Set([2, 3, 4, 7, 12, 13, 15]);
const hostileCard = (id: number) => HOSTILE_CARDS.has(id);
const hostileTool = (id: number) => HOSTILE_TOOLS.has(id);

/** 狠分 and 慘分 of a player's ledger. */
export function scores(x: PlayerStats): { fierce: number; woe: number } {
  const fierce = FIERCE.broke * x.rivalsBankrupted + FIERCE.card * sumOf(x.cardsUsed, hostileCard) + FIERCE.tool * sumOf(x.toolsUsed, hostileTool)
    + FIERCE.god * sumOf(x.gods, id => GOOD_GODS.includes(id)) + FIERCE.lucky * x.lucky + FIERCE.toll * Math.floor(x.tollsReceived / 10000);
  const woe = WOE.god * sumOf(x.gods, id => BAD_GODS.includes(id)) + WOE.attacked * (x.attacked ?? 0) + WOE.day * (x.hospitalDays + x.prisonDays)
    + WOE.unlucky * x.unlucky + WOE.toll * Math.floor(x.tollsPaid / 10000);
  return { fierce, woe };
}

/** Which board set a game's map is: `m<id>`, the game's own maps only (the user 2026-11-16: 玩家自創的地圖不算); '' none. */
export function mapKey(g: Game): string {
  return g.settings.myMap ? '' : `m${g.settings.mapId}`;
}

/** Why a finished game cannot go on the boards ('' it can). `winner` the winning player's index. */
export function notRanked(g: Game, winner: number): string {
  const s = g.settings;
  if (s.party || s.trial || s.realtime || g.world) return 'mode';
  if (s.challenge || s.monthTasks) return 'challenge';
  if (g.players.length !== 4 || g.players.filter(p => p.human).length !== 1) return 'players';
  const me = g.players[winner];
  if (!me?.human) return 'lost';
  if (g.players.some(p => p !== me && !p.bankrupt)) return 'not all broke';
  if (!mapKey(g)) return 'own map';
  if (g.stats?.loaded) return 'loaded';
  return '';
}

/** What a won game sends: the board set, its figures and what it was played with (the server checks them). */
export interface RankEntry {
  map: string; level: number; rich: number; ms: number; days: number; fierce: number; woe: number;
  char: number; fund: number; seed: number; v: string;
}
