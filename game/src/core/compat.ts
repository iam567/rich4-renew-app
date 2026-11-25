/**
 * 不同版本聯機 (the user 2026-11-12): from 1.2.0 on, phones of the same big version (1.2.x, 1.3.x …) play together in
 * 派對模式 — many players cannot reach the in-game update, and a small update rarely touches the game. Each phone
 * works the game out itself, so a small update that changes what happens in the game lists it in CHANGES with the
 * version that brought it, and the code keeps the old way next to the new behind ruleOn(). A 派對 game plays at its
 * room's level (GameSettings.level, the oldest version in the room): what a newer phone has beyond it stays off, the
 * same as on the older phone, and every phone in the room is told what (the room's chat).
 *
 * Only what changes the game goes in CHANGES; looks, words and fixes on one phone's screen need nothing. A big version
 * (1.3) comes with new installers and plays only with its own family.
 */

/** The first version that plays with other versions of its family. */
export const COMPAT_FROM = '1.2.0';

/** A change a small update made to the game: `id` for ruleOn, `since` the version, `name` what players are told. */
export interface Change { id: string; since: string; name: string }

/** Every change from COMPAT_FROM on, oldest first. */
export const CHANGES: readonly Change[] = [
  // the user 2026-11-15 (「拍賣卡沒用，次次流拍」): a computer's ceiling was 3–3.5 × the land's price, the reserve of a
  // level-5 lot 3.5 × — so no computer ever bid on one; now 3–3.5 × the reserve (core/modules/places.ts aiCeiling)
  { id: 'auction-cap', since: '1.2.3', name: '拍賣：電腦出價上限跟著底價，蓋滿的地也拍得出去' },
  // the user 2026-11-16 (a posted recipe beat 地獄 every time): at 電腦地獄 the tools and the cards the players fight
  // with are as many in the whole game as there are players, lab tools are not sold, a chest is 100–500, the shares
  // move day by day, and the computers play harder at the humans (cards.ts HELL_*, tools.ts, stocks.ts, smart-ai.ts)
  { id: 'hell-rules', since: '1.2.3', name: '地獄難度：道具和卡片全場按人數限量、寶箱點數隨機、股票更難猜、電腦更兇' },
  // the user 2026-11-16: a player's map builds companies of its own (保險、電腦、加油站、航空、建設 …, ui/maker/stocks.ts
  // companySlots) on stocks the table does not flag for a company: those stocks are the companies' too (stocks.ts init)
  { id: 'maker-companies', since: '1.2.4', name: '自建地圖的企業大樓（加油站、航空公司、建設公司…）' },
  // the user 2026-11-16: a player's map's 特殊規則 may put many gift boxes on the road (MapSwitches.gifts, objects.ts)
  { id: 'map-gifts', since: '1.2.4', name: '自建地圖的道具禮物箱（多個禮物箱、每天補回）' },
  // the user 2026-11-17: a full hand was asked to drop a card after a 搶奪卡, and a 搶奪卡 taken from a rival (地獄: one
  // of a kind) was lost with one's own — now the 搶奪卡 goes first and the card taken takes its place (cards.ts case 13)
  { id: 'grab-swap', since: '1.2.5', name: '搶奪卡：先用掉搶奪卡再拿對方的卡，卡片欄滿也不用丟卡' },
  // the user 2026-11-23 (「很多玩家說一局太短」): 遊戲節奏 慢節奏 / 原版 / 快節奏 — the 物價指數, 慢's 資產清算, 快's prices
  // (core/game.ts PACE, paceOf); a room with a phone without it plays 原版
  { id: 'pace', since: '1.3.0', name: '遊戲節奏（慢節奏・快節奏）' },
  // the user 2026-11-25 (「所有股票都能自由買賣，不要非停到建築那裡才能買，全遊戲全局通用」): a company's 保留股份 is on the market
  // too, at the market's price (modules/stocks.ts onMarket); stopping at its building still offers it at its own
  { id: 'open-shares', since: '1.3.0', name: '股票：保留股份也能在股市直接買' },
];

/** Compares two versions part by part as numbers (1.0.1.5 < 1.2.0 < 1.2.10); a missing part is 0. */
export function cmpVer(a: string, b: string): number {
  const x = a.split('.').map(n => parseInt(n, 10) || 0), y = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}

/** The big version a version belongs to (1.2.3 → 1.2). */
export const family = (v: string) => v.split('.').slice(0, 2).map(n => parseInt(n, 10) || 0).join('.');

/** Whether phones of these two versions play together: the same version, or both 1.2.0 on and of one family. */
export const together = (a: string, b: string) =>
  a === b || (cmpVer(a, COMPAT_FROM) >= 0 && cmpVer(b, COMPAT_FROM) >= 0 && family(a) === family(b));

/** The oldest of the versions (none given: undefined). */
export const oldest = (vers: string[]) => vers.reduce<string | undefined>((o, v) => (o === undefined || cmpVer(v, o) < 0 ? v : o), undefined);

/** The changes a phone of version `mine` has that a game at `level` goes without. */
export const lacking = (level: string, mine: string, changes: readonly Change[] = CHANGES) =>
  changes.filter(c => cmpVer(c.since, level) > 0 && cmpVer(c.since, mine) <= 0);

/** Whether the change `id` is on in a game at `level` (none: a game alone, or a room of one version — all on). */
export function ruleOn(level: string | undefined, id: string, changes: readonly Change[] = CHANGES): boolean {
  if (!level) return true;
  const c = changes.find(x => x.id === id);
  return !c || cmpVer(c.since, level) <= 0;
}
