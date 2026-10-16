/**
 * 大富翁城's chips (docs/rules/19 §2, the user's formula): a finalist enters the finale with 籌碼 counted from the whole
 * game (core/stats.ts, `chipInputs`), not with their money. One table here, easy to tune: every line is
 * ⌊figure / per⌋ × chips, then the badges. In the finale 1 chip = 100 元 (FINALE_CHIP): the engine keeps money in 元,
 * the screen shows 元 / 100 as chips, so every price there (hall costs, caps, 門票, the slot) is the same in chips.
 */
import type { ChipInputs, Ledger } from './stats';
import { chipInputs } from './stats';

/** 元 per chip in the finale. */
export const FINALE_CHIP = 100;

export interface ChipLine { key: string; label: string; per: number; chips: number; input: (i: ChipInputs) => number }
export interface ChipBadge { key: string; label: string; rule: string; chips: number; test: (i: ChipInputs, all: ChipInputs[]) => boolean }

/** The lines of the formula (the user's table, 2026-10-17). */
export const CHIP_LINES: ChipLine[] = [
  { key: 'money', label: '最後現金存款', per: 10000, chips: 2, input: i => Math.max(0, i.finalMoney) },
  { key: 'lands', label: '買下土地', per: 1, chips: 10, input: i => i.landsBought },
  { key: 'levels', label: '加蓋等級', per: 1, chips: 4, input: i => i.levelsAdded },
  { key: 'facilities', label: '蓋大型設施', per: 1, chips: 30, input: i => i.facilitiesBuilt },
  { key: 'stock', label: '股票實現獲利', per: 10000, chips: 3, input: i => Math.max(0, i.stockProfit) },
  { key: 'tolls', label: '收到過路費', per: 10000, chips: 1, input: i => i.tollIncome },
  { key: 'cards', label: '使用卡片', per: 1, chips: 3, input: i => i.cardsUsed },
  { key: 'tools', label: '使用道具', per: 1, chips: 3, input: i => i.toolsUsed },
  { key: 'lucky', label: '幸運事件', per: 1, chips: 5, input: i => i.luckyEvents },
  { key: 'unlucky', label: '倒楣事件', per: 1, chips: 3, input: i => i.unluckyEvents },
  { key: 'cities', label: '去過的城市', per: 1, chips: 20, input: i => fiveCities(i) },
  { key: 'rivals', label: '讓對手破產', per: 1, chips: 80, input: i => i.rivalsBankrupted },
  { key: 'overlord', label: '當過城市霸主', per: 1, chips: 100, input: i => i.overlordCities.length },
];

/** The badges (each once). 天選之人 / 倒楣蛋: the most among all twelve (ties all get it; none at 0). */
export const CHIP_BADGES: ChipBadge[] = [
  { key: 'tycoon', label: '地產大亨', rule: '買下 50 塊土地', chips: 80, test: i => i.landsBought >= 50 },
  { key: 'builder', label: '建築狂人', rule: '同時擁有 10 棟 5 級建築', chips: 60, test: i => i.maxLv5 >= 10 },
  { key: 'stocks', label: '股神', rule: '股票實現獲利 100 萬', chips: 100, test: i => i.stockProfit >= 1000000 },
  { key: 'cards', label: '卡片大師', rule: '使用 50 張卡片', chips: 50, test: i => i.cardsUsed >= 50 },
  { key: 'tools', label: '道具達人', rule: '使用 30 個道具', chips: 50, test: i => i.toolsUsed >= 30 },
  { key: 'japan', label: '環遊日本', rule: '去過 5 座城市', chips: 60, test: i => fiveCities(i) >= 5 },
  { key: 'lucky', label: '天選之人', rule: '幸運事件全場最多', chips: 50, test: (i, all) => i.luckyEvents > 0 && i.luckyEvents >= Math.max(...all.map(x => x.luckyEvents)) },
  { key: 'unlucky', label: '倒楣蛋', rule: '倒楣事件全場最多', chips: 50, test: (i, all) => i.unluckyEvents > 0 && i.unluckyEvents >= Math.max(...all.map(x => x.unluckyEvents)) },
  { key: 'killer', label: '富豪殺手', rule: '讓 3 位對手破產', chips: 80, test: i => i.rivalsBankrupted >= 3 },
  { key: 'prison', label: '牢獄常客', rule: '坐牢 30 天', chips: 30, test: i => i.prisonDays >= 30 },
];

/** The five cities only (大富翁城, index 5, does not count). */
const fiveCities = (i: ChipInputs) => i.citiesVisited.filter(c => c >= 0 && c < 5).length;

export interface ChipScore {
  lines: { key: string; label: string; figure: number; chips: number }[];
  badges: { key: string; label: string; rule: string; chips: number }[];
  total: number;
}

/** A player's chips from the ledger (call `ledger.finish(world)` first); `everyone` are all players' ids (12). */
export function chipScore(ledger: Ledger, p: number, everyone: number[]): ChipScore {
  const mine = chipInputs(ledger, p), all = everyone.map(q => chipInputs(ledger, q));
  const lines = CHIP_LINES.map(l => { const figure = l.input(mine); return { key: l.key, label: l.label, figure, chips: Math.floor(Math.max(0, figure) / l.per) * l.chips }; });
  const badges = CHIP_BADGES.filter(b => b.test(mine, all)).map(b => ({ key: b.key, label: b.label, rule: b.rule, chips: b.chips }));
  const total = lines.reduce((a, l) => a + l.chips, 0) + badges.reduce((a, b) => a + b.chips, 0);
  return { lines, badges, total };
}
