/**
 * The game's rule options as the new-game screen shows them (main.ts newGame), shared with 派對模式's room (party.ts,
 * issue #31): the values index core/types.ts FUNDS, LAND_LIMIT_MONTHS, DAY_LIMITS and VICTORY_MULTIPLES.
 */
export const RULE_ITEMS = {
  fundIndex: ['30萬', '20萬', '10萬', '5萬', '3萬', '1萬'],
  traffic: ['步行', '機車', '汽車'],
  landLimitIndex: ['無限期', '二年', '一年', '六個月', '三個月', '一個月'],
  daysLimitIndex: ['無限', '二年', '一年', '六個月', '三個月', '一個月'],
  victoryIndex: ['無限', '100倍', '50倍', '10倍', '5倍', '3倍'],
} as const;

export const RULE_LABELS: Record<keyof typeof RULE_ITEMS, string> = {
  fundIndex: '總資金', traffic: '行進方式', landLimitIndex: '土地權限', daysLimitIndex: '遊戲時間', victoryIndex: '勝利條件',
};
