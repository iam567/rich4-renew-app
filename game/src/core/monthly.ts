/**
 * 挑戰模式's 每月任務 (docs/rules/27-monthly-tasks.md, the user 2026-11-02): on the 1st of every month one card is
 * drawn from these 100 for the whole table, worth ★★★ on top of the drawn tasks' 120. Three kinds:
 *  - 搶先 (race): the first to do it this month takes the stars, and the card closes;
 *  - 比拼 (most): at the end of the month the most of it takes them (a tie: all of the best);
 *  - 堅持 (keep): everyone who kept it the whole month takes them.
 * A month's measures are counted from its 1st: the tracker's counters bumped this month (`k`), and the ledger's or the
 * board's figures against their values when the card was drawn (`d`). The card is drawn from its own random stream
 * (the seed and the month), never the game's (fair randomness).
 */
import type { ChallengeTask } from './challenge-tasks';
import type { Game } from './game';

export type MonthlyKind = 'race' | 'most' | 'keep';

/** What a month's measure reads, for one player. */
export interface MonthX {
  /** The tracker's counter `key` bumped this month. */
  k(key: string): number;
  /** Sum / distinct keys of this month's counters starting with `prefix`. */
  kp(prefix: string): number;
  kd(prefix: string): number;
  /** The largest of this month's counters starting with `prefix`. */
  km(prefix: string): number;
  /** A figure (MONTH_STATS) now less its value when the card was drawn. */
  d(stat: string): number;
}

/** What the computer does for it (core/challenge-ai.ts). */
export interface MonthlyAi {
  cards?: number[]; tools?: number[]; events?: number[];
  /** 堅持 a month without tools / cards; keeping off others' property. */
  noTools?: boolean; noCards?: boolean; avoidOthers?: boolean;
}

export interface MonthlyTask extends ChallengeTask {
  kind: MonthlyKind;
  /** 搶先: the value to reach (−1 every rival); 比拼: the least that counts (1 = any). 堅持: unused. */
  goal: number;
  /** The measure is money (shown in 萬); a 搶先 goal is × the price index when drawn. */
  money?: boolean;
  /** 搶先 / 比拼: the measure; 堅持: what breaks it (must stay 0). */
  v: (x: MonthX) => number;
  /** 堅持: also needed at the end (measure ≥ value). */
  also?: [(x: MonthX) => number, number];
  /** The map has what it needs (stocks, plots, three players …). */
  when?: (g: Game) => boolean;
  ai?: MonthlyAi;
}

const stocks = (g: Game) => !g.rules?.casinoItems;
const plots = (g: Game) => g.board.facilities.length > 0;
const GOD_TYPES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

type Opt = Partial<Pick<MonthlyTask, 'money' | 'also' | 'when' | 'ai'>>;
const task = (kind: MonthlyKind, id: string, name: string, goal: number, desc: string, v: MonthlyTask['v'], o: Opt = {}): MonthlyTask =>
  ({ id, map: -2, name, stars: 3, once: true, need: [1], kind, goal, desc, v, ...o });
const race = (id: string, name: string, goal: number, desc: string, v: MonthlyTask['v'], o?: Opt) => task('race', id, name, goal, desc, v, o);
const most = (id: string, name: string, desc: string, v: MonthlyTask['v'], o?: Opt) => task('most', id, name, 1, desc, v, o);
const keep = (id: string, name: string, desc: string, v: MonthlyTask['v'], o?: Opt) => task('keep', id, name, 0, desc, v, o);

/** God types (06 §5.1) attached this month. */
const gods = (x: MonthX, ...t: number[]) => t.reduce((n, id) => n + x.d(`god:${id}`), 0);
const card = (x: MonthX, ...ids: number[]) => ids.reduce((n, id) => n + x.d(`card:${id}`), 0);
const tool = (x: MonthX, ...ids: number[]) => ids.reduce((n, id) => n + x.d(`tool:${id}`), 0);

/** The 100 cards. `{n}` in a description is the goal (money as 萬). */
export const MONTHLY_TASKS: MonthlyTask[] = [
  // ---------------------------------------------------------------- 搶先: the first to do it
  race('M001', '收租日', 8, '收到 {n} 次過路費', x => x.d('tollRecvN')),
  race('M002', '財源滾滾', 30000, '收過路費合計 {n}', x => x.d('tollRecv'), { money: true }),
  race('M003', '圈地運動', 4, '買下 {n} 塊地', x => x.d('lands')),
  race('M004', '蓋樓比賽', 6, '花錢加蓋 {n} 層樓', x => x.d('builds')),
  race('M005', '摩天大樓', 1, '多出一棟 5 級建築', x => x.d('lv5')),
  race('M006', '一條龍', 1, '買齊一整條路段（本月新買齊的）', x => x.d('streets')),
  race('M007', '卡片連發', 4, '用了 {n} 張卡片', x => x.d('cardsUsed')),
  race('M008', '道具連發', 4, '用了 {n} 次道具', x => x.d('toolsUsed')),
  race('M009', '命運大師', 3, '停在命運 {n} 次', x => x.k('ev:3'), { ai: { events: [3] } }),
  race('M010', '新聞人物', 3, '停在新聞 {n} 次', x => x.k('ev:2'), { ai: { events: [2] } }),
  race('M011', '魔法學徒', 2, '停在魔法屋 {n} 次', x => x.k('ev:16'), { ai: { events: [16] } }),
  race('M012', '遊戲王', 2, '玩 {n} 次小遊戲', x => x.d('mini'), { ai: { events: [6, 7, 8] } }),
  race('M013', '樂透幸運兒', 1, '中一次樂透', x => x.d('lotto'), { ai: { events: [9] } }),
  race('M014', '股市贏家', 10000, '賣股票賺了 {n}', x => x.d('stockProfit'), { money: true, when: stocks }),
  race('M015', '豹子號', 1, '開汽車擲出三顆一樣的點數', x => x.k('leopard')),
  race('M016', '雙響炮', 2, '騎機車擲出對子 {n} 次', x => x.k('pair')),
  race('M017', '財神到', 1, '被財神附身（小財神、大財神都算）', x => gods(x, 1, 2)),
  race('M018', '福星高照', 1, '被福神附身（小福神、大福神都算）', x => gods(x, 3, 4)),
  race('M019', '天使降臨', 1, '被天使附身', x => gods(x, 9)),
  race('M020', '土地公來了', 1, '被土地公附身', x => gods(x, 12)),
  race('M021', '燙手山芋', 1, '身上的炸彈傳給別人，在別人身上爆炸', x => x.k('bombOnOther')),
  race('M022', '地雷陣', 1, '對手踩中你放的地雷', x => x.k('mineGot'), { ai: { tools: [3] } }),
  race('M023', '飛彈命中', 1, '用飛彈或核子飛彈把對手送進醫院', x => x.k('missileHit'), { ai: { tools: [7, 13] } }),
  race('M024', '此路不通', 1, '用路障擋下對手', x => x.k('blocked'), { ai: { tools: [2] } }),
  race('M025', '鐵窗風雲', 1, '把對手送進監獄', x => x.k('sentPrison'), { ai: { cards: [17] } }),
  race('M026', '全員收押', -1, '每個對手都被你送進過監獄', x => x.kd('jailed:'), { ai: { cards: [17] } }),
  race('M027', '救護車', 2, '把對手送進醫院 {n} 次', x => x.k('hurt'), { ai: { tools: [3, 7, 13] } }),
  race('M028', '全員掛號', -1, '每個對手都被你送進過醫院', x => x.kd('hurt:'), { ai: { tools: [3, 7, 13] } }),
  race('M029', '雨露均霑', -1, '每個對手都付過你過路費', x => x.kd('tollFrom:')),
  race('M030', '搶劫', 1, '用搶奪卡搶到東西', x => x.k('grab'), { ai: { cards: [13] } }),
  race('M031', '查稅員', 1, '用查稅卡', x => card(x, 26), { ai: { cards: [26] } }),
  race('M032', '劫富濟貧', 1, '用均富卡或均貧卡', x => card(x, 1, 2), { ai: { cards: [1, 2] } }),
  race('M033', '陷害', 1, '用陷害卡或嫁禍卡', x => card(x, 17, 19), { ai: { cards: [17] } }),
  race('M034', '整人專家', 2, '用夢遊、烏龜、轉向、停留卡 {n} 次', x => card(x, 16, 30, 6, 14), { ai: { cards: [16, 30, 6, 14] } }),
  race('M035', '冬眠', 1, '用冬眠卡', x => card(x, 15), { ai: { cards: [15] } }),
  race('M036', '天使與惡魔', 1, '用天使卡或惡魔卡', x => card(x, 9, 10), { ai: { cards: [9, 10] } }),
  race('M037', '拆遷大隊', 1, '用怪獸卡或拆除卡', x => card(x, 11, 12), { ai: { cards: [11, 12] } }),
  race('M038', '娃娃出巡', 2, '放出機器娃娃 {n} 次', x => tool(x, 1), { ai: { tools: [1] } }),
  race('M039', '遙控人生', 2, '用遙控骰子 {n} 次', x => tool(x, 8), { ai: { tools: [8] } }),
  race('M040', '買買買', 150, '在商店花掉 {n} 點', x => x.d('shopPoints'), { ai: { events: [13, 15] } }),
  race('M041', '銀行常客', 3, '經過或停在銀行 {n} 次', x => x.k('bank')),
  race('M042', '卡片收藏', 2, '停在卡片屋 {n} 次', x => x.k('ev:13'), { ai: { events: [13] } }),
  race('M043', '道具迷', 2, '停在道具屋 {n} 次', x => x.k('ev:15'), { ai: { events: [15] } }),
  race('M044', '點數獵人', 3, '停在點數格 {n} 次', x => x.k('ev:10') + x.k('ev:11') + x.k('ev:12'), { ai: { events: [10, 11, 12] } }),
  race('M045', '好事成雙', 6, '碰上 {n} 次好事', x => x.d('lucky')),
  race('M046', '狹路相逢', 2, '和對手停在同一格 {n} 次', x => x.k('sumo')),
  race('M047', '神明巡禮', 2, '被 {n} 位不同的神明附身', x => GOD_TYPES.filter(t => x.d(`god:${t}`) > 0).length),
  race('M048', '客滿', 1, '對手住進你的旅館', x => x.kp('guest:'), { when: plots }),
  race('M049', '大型投資', 1, '在大型用地上蓋好一座設施', x => x.d('facs'), { when: plots }),
  race('M050', '存錢筒', 50000, '存款增加 {n}', x => x.d('bank'), { money: true }),
  race('M051', '小金庫', 50000, '現金增加 {n}', x => x.d('cash'), { money: true }),
  race('M052', '身價暴漲', 100000, '總資產增加 {n}', x => x.d('wealth'), { money: true }),
  race('M053', '遠行', 120, '走了 {n} 步', x => x.k('steps')),
  race('M054', '骰神', 100, '擲出的點數加起來 {n}', x => x.k('pips')),
  race('M055', '看遍風景', 12, '停過 {n} 個不同的地方', x => x.kd('stop:')),
  race('M056', '走透透', 6, '停過 {n} 種不同的格子', x => x.kd('ev:')),
  race('M057', '投資組合', 3, '買進 {n} 家公司的股票', x => x.kd('buyCo:'), { when: stocks }),
  race('M058', '鴻運當頭', 2, '抽到 {n} 次好命運', x => x.k('goodFate'), { ai: { events: [3] } }),
  race('M059', '送神', 1, '用送神符送走身上的壞神', x => x.k('sendBadGod'), { ai: { cards: [22] } }),
  race('M060', '請神', 1, '用請神符請到好神', x => x.k('prayGot'), { ai: { cards: [23] } }),
  race('M061', '轉運', 1, '身上是壞神時碰上好神，把壞神換走', x => x.k('turnLuck')),
  race('M062', '保險理賠', 1, '拿到保險理賠金', x => x.k('insurance')),
  race('M063', '土地公搶地', 1, '土地公幫你佔到地', x => x.k('earthGod')),
  race('M064', '點數進帳', 100, '從點數格、小遊戲拿到 {n} 點', x => x.k('ptsGot'), { ai: { events: [6, 7, 8, 10, 11, 12] } }),
  race('M065', '路霸', 3, '向同一個對手收到 {n} 次過路費', x => x.km('tollFrom:')),
  race('M066', '開張大吉', 3, '有 {n} 塊地從空地蓋起房子', x => x.k('newHouse')),
  race('M067', '雙喜臨門', 2, '同一天收到 {n} 次過路費', x => x.km('tollDay:')),
  race('M068', '神射手', 2, '用飛彈或核子飛彈 {n} 次', x => tool(x, 7, 13), { ai: { tools: [7, 13] } }),
  race('M069', '炸彈客', 2, '放定時炸彈 {n} 次', x => tool(x, 4), { ai: { tools: [4] } }),
  race('M070', '換屋高手', 1, '用換地卡、換屋卡或購地卡', x => card(x, 3, 4, 5), { ai: { cards: [3, 4, 5] } }),
  // ---------------------------------------------------------------- 比拼: the most at the end of the month
  most('M071', '收租王', '收過路費最多', x => x.d('tollRecv'), { money: true }),
  most('M072', '冤大頭', '付過路費最多（安慰獎）', x => x.d('tollPaid'), { money: true }),
  most('M073', '資產成長王', '總資產增加最多', x => x.d('wealth'), { money: true }),
  most('M074', '現金王', '現金增加最多', x => x.d('cash'), { money: true }),
  most('M075', '存款王', '存款增加最多', x => x.d('bank'), { money: true }),
  most('M076', '地產王', '買地最多（塊）', x => x.d('lands')),
  most('M077', '建築王', '花錢加蓋最多層', x => x.d('builds')),
  most('M078', '卡片王', '用卡片最多', x => x.d('cardsUsed')),
  most('M079', '道具王', '用道具最多', x => x.d('toolsUsed')),
  most('M080', '股神', '賣股票賺最多', x => x.d('stockProfit'), { money: true, when: stocks }),
  most('M081', '命運之子', '停在命運最多次', x => x.k('ev:3'), { ai: { events: [3] } }),
  most('M082', '頭條王', '停在新聞最多次', x => x.k('ev:2'), { ai: { events: [2] } }),
  most('M083', '小遊戲之王', '小遊戲得分最多', x => x.d('miniPts'), { ai: { events: [6, 7, 8] } }),
  most('M084', '幸運星', '碰上好事最多次', x => x.d('lucky')),
  most('M085', '倒楣鬼', '碰上倒楣事最多次（安慰獎）', x => x.d('unlucky')),
  most('M086', '醫院VIP', '住院天數最多（安慰獎）', x => x.d('hospDays')),
  most('M087', '牢頭', '坐牢天數最多（安慰獎）', x => x.d('prisonDays')),
  most('M088', '神明最愛', '被神明附身最多次', x => x.d('gods')),
  most('M089', '萬里長征', '走最多步', x => x.k('steps')),
  most('M090', '旅行家', '停過最多不同的地方', x => x.kd('stop:')),
  most('M091', '購物狂', '在商店花最多點數', x => x.d('shopPoints'), { ai: { events: [13, 15] } }),
  most('M092', '惡霸', '把對手送進醫院、監獄最多次', x => x.k('hurt') + x.k('sentPrison')),
  most('M093', '包租公', '擁有的地增加最多', x => x.d('owned')),
  most('M094', '點數王', '從點數格、小遊戲拿到最多點', x => x.k('ptsGot'), { ai: { events: [6, 7, 8, 10, 11, 12] } }),
  // ---------------------------------------------------------------- 堅持: kept the whole month
  keep('M095', '道具封印', '整個月一次道具都不用', x => x.d('toolsUsed'), { ai: { noTools: true } }),
  keep('M096', '卡片封印', '整個月一張卡片都不用', x => x.d('cardsUsed'), { ai: { noCards: true } }),
  keep('M097', '奉公守法', '整個月沒進醫院、沒坐牢', x => x.d('hospStays') + x.d('prisonStays')),
  keep('M098', '忍者', '整個月沒付過一次過路費', x => x.d('tollPaidN'), { ai: { avoidOthers: true } }),
  keep('M099', '好神保佑', '整個月沒被窮神、衰神、惡魔附身', x => gods(x, 5, 6, 7, 8, 10)),
  keep('M100', '一直第一', '整個月每天總資產都是第一', x => x.k('notTop')),
];

/** Every figure a month's `d` reads (its value now): the ledger's, and the board's for the player. */
export const MONTH_STATS: Record<string, (g: Game, p: import('./types').Player, s: import('./stats').PlayerStats | undefined) => number> = {
  tollRecvN: (_g, _p, s) => s?.tollsReceivedCount ?? 0,
  tollRecv: (_g, _p, s) => s?.tollsReceived ?? 0,
  tollPaidN: (_g, _p, s) => s?.tollsPaidCount ?? 0,
  tollPaid: (_g, _p, s) => s?.tollsPaid ?? 0,
  lands: (_g, _p, s) => (s?.landsBought ?? 0) + (s?.plotsBought ?? 0),
  builds: (_g, _p, s) => s?.buildings ?? 0,
  facs: (_g, _p, s) => Object.values(s?.facilitiesBuilt ?? {}).reduce((a, b) => a + b, 0),
  cardsUsed: (_g, _p, s) => Object.values(s?.cardsUsed ?? {}).reduce((a, b) => a + b, 0),
  toolsUsed: (_g, _p, s) => Object.values(s?.toolsUsed ?? {}).reduce((a, b) => a + b, 0),
  shopPoints: (_g, _p, s) => s?.shopPoints ?? 0,
  stockProfit: (_g, _p, s) => s?.stockProfit ?? 0,
  lucky: (_g, _p, s) => s?.lucky ?? 0,
  unlucky: (_g, _p, s) => s?.unlucky ?? 0,
  gods: (_g, _p, s) => Object.values(s?.gods ?? {}).reduce((a, b) => a + b, 0),
  lotto: (_g, _p, s) => s?.lotteryWins ?? 0,
  mini: (_g, _p, s) => s?.miniGames ?? 0,
  miniPts: (_g, _p, s) => s?.miniGamePoints ?? 0,
  hospDays: (_g, _p, s) => s?.hospitalDays ?? 0,
  prisonDays: (_g, _p, s) => s?.prisonDays ?? 0,
  hospStays: (_g, _p, s) => s?.hospitalStays ?? 0,
  prisonStays: (_g, _p, s) => s?.prisonStays ?? 0,
  cash: (_g, p) => p.cash,
  bank: (_g, p) => p.bank,
  wealth: (g, p) => g.wealth(p),
  owned: (g, p) => g.board.lands.filter(l => l.owner === p.id + 1).length + g.board.facilities.filter(f => f.owner === p.id + 1).length,
  lv5: (g, p) => g.board.lands.filter(l => l.owner === p.id + 1 && l.level >= 5).length + g.board.facilities.filter(f => f.owner === p.id + 1 && f.level >= 5).length,
  streets: (g, p) => new Set(g.board.lands.map(l => l.name)).size - new Set(g.board.lands.filter(l => l.owner !== p.id + 1).map(l => l.name)).size,
};
for (const id of GOD_TYPES) MONTH_STATS[`god:${id}`] = (_g, _p, s) => s?.gods[id] ?? 0;
for (let id = 1; id <= 38; id++) MONTH_STATS[`card:${id}`] = (_g, _p, s) => s?.cardsUsed[id] ?? 0;
for (let id = 1; id <= 16; id++) MONTH_STATS[`tool:${id}`] = (_g, _p, s) => s?.toolsUsed[id] ?? 0;

export const monthlyById = new Map(MONTHLY_TASKS.map(t => [t.id, t]));

/** The cards a game can draw on its map. */
export const monthlyPool = (g: Game) => MONTHLY_TASKS.filter(t => !t.when || t.when(g));

/**
 * The month's card (`seq` the month's number in this game): the map's cards shuffled once from the seed (their own
 * random stream, as drawTasks), dealt in order — no card twice before all have come.
 */
export function drawMonthly(g: Game, seq: number): MonthlyTask {
  let s = (g.settings.seed ^ 0x3a7c1b05) >>> 0;
  const rnd = () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const deck = monthlyPool(g).slice();
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck[seq % deck.length];
}

/** The goal of the month's card for the screen: money in 萬 (and 元 below), −1 every rival. */
export function monthlyDesc(t: MonthlyTask, goal: number): string {
  const n = t.money ? (goal >= 10000 ? `${+(goal / 10000).toFixed(1)} 萬` : `${goal} 元`) : String(goal);
  return t.desc.replace('{n}', n);
}

/** How a kind is won (the task list, the card). */
export const MONTHLY_RULE: Record<MonthlyKind, string> = {
  race: '搶先：第一個做到的拿 ★★★',
  most: '比拼：月底最多的拿 ★★★，平手同拿',
  keep: '堅持：整月做到的都拿 ★★★',
};
