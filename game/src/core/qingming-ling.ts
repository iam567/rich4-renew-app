/**
 * 清明上河's 梁山令 (docs/rules/35-qingming.md §梁山令, the user 2026-11-20): 108 cards, one per hero, by the seats on the
 * stone tablet of chapter 71 — 天罡 36, 地煞 72. A draw picks the grade first (傳說 1 %: 天罡 1–6, 稀有 4 %: 7–18,
 * 高級 15 %: 19–36, 普通 80 %: 地煞 37–108), then a card of that grade evenly (the game's own rng: fair). The card's
 * effect happens at once in town (汴京 and the 出城 road: never on 梁山), and never sends the drawer back to town.
 * 聚義廳: the seats drawn are kept per player; an exact stop there cashes in every completed set not yet exchanged.
 *
 * Every effect is immediate: no question to anyone (a human or a computer gets the same), no dice duel, no waiting.
 * 「城裡的對手」 are the opponents standing in town now (not on 梁山); an effect with nothing to work on (no house, no
 * opponent in town, no free lot, no god …) gives 30 點券 instead. Time limits run in game days (lingDaily, from
 * QingmingRules.daily); the forced dice are QingmingRules.forced (its rollDice hook), the free boat QingmingRules.freeBoat.
 * The engine hooks used here (all absent on every other map): MapRules.guardPlot (拆不掉、炸不掉), tollPayee (過路費改收給你),
 * tollFactor (梁山旗 +50 %), cardShield (宋萬's 守寨).
 */
import type { Game } from './game';
import type { Facility, Land } from './board';
import type { Flow } from './flow';
import { LAND_LIMIT_MONTHS, type Player } from './types';
import type { QingmingRules } from './qingming';
import { addMonths } from './date';
import { BAD_GODS, OBJECT_NAMES } from './modules/objects';
import { adjustPrice } from './modules/stocks';
import { MAX_HELD, toolDef } from './modules/tools';
import { cardName } from './modules/cards';

export type LingGrade = 'legend' | 'rare' | 'high' | 'common';
/** A card: its seat (1..108), the hero, the nickname, the star (天魁星 …), its grade, and what it does (one line, shown on the card screen). */
export interface LingCard { seat: number; name: string; nick: string; star: string; grade: LingGrade; text: string }

export const gradeOf = (seat: number): LingGrade => (seat <= 6 ? 'legend' : seat <= 18 ? 'rare' : seat <= 36 ? 'high' : 'common');

/** (star, name, nickname, what it does) by seat, as tools/tycoon-art/liangshan_ling.py HEROES and the doc's table. */
const TABLE: [string, string, string, string][] = [
  ['天魁星', '宋江', '呼保義', '及時雨：自己城裡所有房子各升1級'],
  ['天罡星', '盧俊義', '玉麒麟', '自己城裡隨機一棟房子直接蓋到5級'],
  ['天機星', '吳用', '智多星', '智取：自己最便宜的一塊地和對手最貴的一塊地互換（房子跟著地走）'],
  ['天閒星', '公孫勝', '入雲龍', '呼風喚雨：自己最便宜的兩塊地和對手最貴的兩塊地互換（房子跟著地走）'],
  ['天勇星', '關勝', '大刀', '一刀：隨機一個對手城裡最高的一棟房子拆平（地還是他的）'],
  ['天雄星', '林沖', '豹子頭', '風雪山神廟：隨機一個對手的一條街每棟各降1級，再查封5天'],
  ['天猛星', '秦明', '霹靂火', '隨機一個對手的一條街每棟各降1級'],
  ['天威星', '呼延灼', '雙鞭', '連環馬：收回對手兩塊空地（沒蓋房子的），變成沒人買的地'],
  ['天英星', '花榮', '小李廣', '百步穿楊：城裡最有錢的對手，最高的一棟降2級'],
  ['天貴星', '柴進', '小旋風', '柴進莊上：城裡兩塊沒人買的小地白送給你'],
  ['天富星', '李應', '撲天鵰', '李家莊：自己城裡隨機一條街7天過路費翻倍'],
  ['天滿星', '朱仝', '美髯公', '自己城裡隨機兩棟各升1級'],
  ['天孤星', '魯智深', '花和尚', '倒拔垂楊柳：隨機一個對手城裡最高的一棟降3級'],
  ['天傷星', '武松', '行者', '景陽岡打虎：隨機一個對手城裡最高的兩棟各降2級'],
  ['天立星', '董平', '雙槍將', '兩個對手各隨機一棟降1級'],
  ['天捷星', '張清', '沒羽箭', '飛石：城裡每個對手各隨機一棟降1級'],
  ['天暗星', '楊志', '青面獸', '生辰綱：一大筆錢，{10000}'],
  ['天佑星', '徐寧', '金槍手', '鉤鐮槍：自己城裡所有房子30天拆不掉、炸不掉'],
  ['天空星', '索超', '急先鋒', '自己城裡隨機一棟升2級'],
  ['天速星', '戴宗', '神行太保', '神行法：接下來15回合強制擲5個骰子走'],
  ['天異星', '劉唐', '赤髮鬼', '城裡隨機一個對手的現金5%給你'],
  ['天殺星', '李逵', '黑旋風', '黑旋風：隨機一個對手城裡一棟降2級；砍得太猛，自己城裡一棟也降1級'],
  ['天微星', '史進', '九紋龍', '史家莊：自己一塊沒蓋房子的地直接蓋到2級（沒有空地就隨機一棟升1級）'],
  ['天究星', '穆弘', '沒遮攔', '揭陽鎮稱霸：城裡隨機一個對手的一條街，7天過路費改收給你'],
  ['天退星', '雷橫', '插翅虎', '插翅虎：城裡對手的兩塊空地歸你'],
  ['天壽星', '李俊', '混江龍', '混江龍：汴河兩岸自己的地全部升1級，空地也蓋出1級的房子'],
  ['天劍星', '阮小二', '立地太歲', '城裡隨機一塊沒人買的小地白送給你'],
  ['天平星', '張橫', '船火兒', '截江：城裡隨機20格各放一個路障'],
  ['天罪星', '阮小五', '短命二郎', '自己城裡隨機兩棟各升1級'],
  ['天損星', '張順', '浪裡白條', '把城裡隨機一個對手拖下汴河：進趙太丞家（醫院）3天'],
  ['天敗星', '阮小七', '活閻羅', '收回隨機一個對手的一塊空地，變成沒人買的地'],
  ['天牢星', '楊雄', '病關索', '城裡隨機一個對手押進開封府'],
  ['天慧星', '石秀', '拚命三郎', '一升一降：自己隨機一棟升1級，隨機一個對手隨機一棟降1級'],
  ['天暴星', '解珍', '兩頭蛇', '獵戶下套：隨機一個對手城裡最高的一棟降2級'],
  ['天哭星', '解寶', '雙尾蠍', '自己城裡最低的兩棟各升1級'],
  ['天巧星', '燕青', '浪子', '浪子：隨機一個對手最高的一棟降1級，自己最高的一棟升1級'],
  ['地魁星', '朱武', '神機軍師', '佈陣：自己城裡最低的一棟升1級'],
  ['地煞星', '黃信', '鎮三山', '自己隨機一棟30天拆不掉、炸不掉'],
  ['地勇星', '孫立', '病尉遲', '隨機一個對手城裡隨機一棟降1級'],
  ['地傑星', '宣贊', '醜郡馬', '醜郡馬：嚇到城裡隨機一個對手，接下來3回合只能擲1個骰子'],
  ['地雄星', '郝思文', '井木犴', '自己城裡隨機一棟升1級'],
  ['地威星', '韓滔', '百勝將', '自己城裡隨機一棟升1級'],
  ['地英星', '彭玘', '天目將', '天目：城裡最有錢的對手，隨機一棟降1級'],
  ['地奇星', '單廷珪', '聖水將', '水淹：汴河兩岸的房子全部降1級（不管是誰的，你的也算）'],
  ['地猛星', '魏定國', '神火將', '火攻：城裡隨機一條街每棟降1級（不管是誰的，你的也算）'],
  ['地文星', '蕭讓', '聖手書生', '假聖旨：城裡每個對手站的那一格旁邊的房子，奉旨就地拆平（不管是誰的，地還在）'],
  ['地正星', '裴宣', '鐵面孔目', '自己被查封的街馬上解封'],
  ['地闊星', '歐鵬', '摩雲金翅', '摩雲：接下來10回合強制擲5個骰子走'],
  ['地闔星', '鄧飛', '火眼狻猊', '火眼：收回隨機一個對手的一塊空地，變成沒人買的地'],
  ['地強星', '燕順', '錦毛虎', '剪徑所得：{2000}'],
  ['地暗星', '楊林', '錦豹子', '放出趙太丞家（醫院）裡躺著的間諜'],
  ['地軸星', '凌振', '轟天雷', '轟天雷：一陣炮打進城裡，城裡隨機20格各落一顆地雷'],
  ['地會星', '蔣敬', '神算子', '神算子：每個對手各給你現金的10%'],
  ['地佐星', '呂方', '小溫侯', '戟纏：兩個對手各隨機一棟降1級'],
  ['地佑星', '郭盛', '賽仁貴', '劫富：城裡最有錢的對手，現金的10%給你'],
  ['地靈星', '安道全', '神醫', '神醫：趙太丞家（醫院）裡的人全部出院'],
  ['地獸星', '皇甫端', '紫髯伯', '放狗：城裡隨機15格各放一隻惡犬'],
  ['地微星', '王英', '矮腳虎', '矮腳虎：複製你道具欄裡隨機一個道具'],
  ['地慧星', '扈三娘', '一丈青', '活捉：城裡對手的一塊空地歸你'],
  ['地暴星', '鮑旭', '喪門神', '喪門神：城裡多出5個大衰神'],
  ['地默星', '樊瑞', '混世魔王', '混世魔王：隨機一個對手城裡最高的一棟降1級'],
  ['地猖星', '孔明', '毛頭星', '毛頭星：自己城裡隨機一棟降1級'],
  ['地狂星', '孔亮', '獨火星', '火燭不慎：自己城裡隨機一條街查封3天'],
  ['地飛星', '項充', '八臂哪吒', '隨機一個對手城裡隨機一棟降1級'],
  ['地走星', '李袞', '飛天大聖', '飛天：城裡隨機一塊沒人買的小地白送給你'],
  ['地巧星', '金大堅', '玉臂匠', '刻印：複製你手裡隨機一張卡'],
  ['地明星', '馬麟', '鐵笛仙', '鐵笛：自己城裡最低的一棟升1級'],
  ['地進星', '童威', '出洞蛟', '出洞蛟：汴河兩岸隨機一塊空地歸你；兩岸沒有空地，就把對手的一塊地（連房子）歸你'],
  ['地退星', '童猛', '翻江蜃', '翻江蜃：汴河兩岸隨機一塊有主的地（不管是誰的）連房子沖走，變成沒人買的地'],
  ['地滿星', '孟康', '玉幡竿', '造船所得：{1000}'],
  ['地遂星', '侯健', '通臂猿', '縫旗：城裡隨機一個對手的一塊地插上梁山旗，7天過路費歸你'],
  ['地周星', '陳達', '跳澗虎', '被擒：交出贖金，現金的3%'],
  ['地隱星', '楊春', '白花蛇', '攔路：城裡每個對手前面各放一個路障'],
  ['地異星', '鄭天壽', '白面郎君', '城裡隨機一個對手的現金3%給你'],
  ['地理星', '陶宗旺', '九尾龜', '築牆：自己城裡隨機一棟升1級'],
  ['地俊星', '宋清', '鐵扇子', '排宴：{2000}'],
  ['地樂星', '樂和', '鐵叫子', '探監唱曲：放出開封府裡關著的流氓'],
  ['地捷星', '龔旺', '花項虎', '隨機一個對手城裡隨機一棟降1級'],
  ['地速星', '丁得孫', '中箭虎', '中箭：自己城裡最高的一棟降1級'],
  ['地鎮星', '穆春', '小遮攔', '收保護費：城裡每個對手各給你{1000}'],
  ['地羈星', '曹正', '操刀鬼', '操刀鬼：城裡隨機一個對手給你{1000}'],
  ['地魔星', '宋萬', '雲裡金剛', '守寨：自己城裡隨機兩棟30天拆不掉、炸不掉'],
  ['地妖星', '杜遷', '摸著天', '摸著天：城裡最高的一棟房子（不管是誰的）再加蓋1級'],
  ['地幽星', '薛永', '病大蟲', '賣藝：城裡隨機一個對手給你{1000}'],
  ['地伏星', '施恩', '金眼彪', '快活林：自己城裡隨機一條街3天過路費翻倍'],
  ['地僻星', '李忠', '打虎將', '賣膏藥虧本：交出現金的2%'],
  ['地空星', '周通', '小霸王', '被魯智深痛打：自己城裡隨機一棟降1級'],
  ['地孤星', '湯隆', '金錢豹子', '打鐵：自己隨機一棟30天拆不掉、炸不掉'],
  ['地全星', '杜興', '鬼臉兒', '鬼臉：隨機收回一塊有主的空地（不管是誰的，你的也算），變成沒人買的地'],
  ['地短星', '鄒淵', '出林龍', '放出趙太丞家（醫院）裡躺著的強盜'],
  ['地角星', '鄒潤', '獨角龍', '獨角龍：隨機一個對手城裡最高的一棟降1級'],
  ['地囚星', '朱貴', '旱地忽律', '開酒店：自己城裡隨機一棟升1級'],
  ['地藏星', '朱富', '笑面虎', '蒙汗酒劫囚：放出開封府裡關著的強盜'],
  ['地平星', '蔡福', '鐵臂膊', '押牢節級：城裡隨機一個對手押進開封府'],
  ['地損星', '蔡慶', '一枝花', '一枝花：城裡隨機20格各放一顆定時炸彈'],
  ['地奴星', '李立', '催命判官', '黑店：城裡隨機一個對手給你{2000}'],
  ['地察星', '李雲', '青眼虎', '監造：自己城裡隨機一棟升1級'],
  ['地惡星', '焦挺', '沒面目', '相撲：隨機一個對手城裡隨機一棟降1級'],
  ['地醜星', '石勇', '石將軍', '賭錢：一半機會贏{2000}，一半機會輸{1000}'],
  ['地數星', '孫新', '小尉遲', '登州劫牢：開封府（監獄）裡關著的人全部出獄'],
  ['地陰星', '顧大嫂', '母大蟲', '母大蟲：城裡隨機一個對手被打進趙太丞家2天'],
  ['地刑星', '張青', '菜園子', '剪徑：隨機一個對手的一條街查封3天'],
  ['地壯星', '孫二娘', '母夜叉', '蒙汗藥：城裡對手的一塊空地歸你'],
  ['地劣星', '王定六', '活閃婆', '活閃：接下來10回合強制擲4個骰子走'],
  ['地健星', '郁保四', '險道神', '梁山大旗：城裡你所有的房子插上梁山旗，5天過路費 +50%'],
  ['地耗星', '白勝', '白日鼠', '挑酒上岡：接下來10回合強制擲3個骰子走'],
  ['地賊星', '時遷', '鼓上蚤', '鼓上蚤：放出開封府裡關著的小偷'],
  ['地狗星', '段景住', '金毛犬', '盜馬：城裡路上的寶箱、禮物箱、路障、地雷、定時炸彈全部被你偷走（道具最多拿到9個）'],
];

/** The 108 cards by seat (LING[seat - 1]). */
export const LING: LingCard[] = TABLE.map(([star, name, nick, text], i) => ({ seat: i + 1, name, nick, star, grade: gradeOf(i + 1), text }));

/**
 * The amounts in the words: `{N}` is N × the price index, written out as it is now (the user 2026-11-24: 「物價指數不要寫
 * 出來，該多少錢多少錢」) — lingText at the draw, the same lingAmount paid.
 */
export const lingAmount = (n: number, pi: number): number => Math.round(n * pi);
export const lingText = (text: string, pi: number): string => text.replace(/\{(\d+)\}/g, (_, n: string) => `${lingAmount(Number(n), pi).toLocaleString('en-US')}元`);

/**
 * The map's 梁山令 state in a save: per player the seats drawn (each once) and the sets exchanged; the timed effects in
 * game days (missing in a save made before them): `guard` 拆不掉、炸不掉 by plot, `payee` a lot's toll to another player,
 * `flag` 梁山旗 on a lot (its planter, and `boost` the toll +50 %), `shield` 宋萬's 守寨 by player.
 */
export interface LingState {
  got: number[][];
  done: string[][];
  guard?: Record<number, number>;
  payee?: Record<number, { p: number; days: number }>;
  flag?: Record<number, { p: number; days: number; boost: boolean }>;
  shield?: number[];
}
export const newLingState = (): LingState => ({ got: [], done: [], guard: {}, payee: {}, flag: {}, shield: [] });

/** Completed sets of player `p` not yet exchanged (ids). */
export function readySets(s: LingState, p: number): string[] {
  const got = new Set(s.got[p] ?? []), done = new Set(s.done[p] ?? []);
  return JUYI_SETS.filter(x => !done.has(x.id) && x.seats.every(seat => got.has(seat))).map(x => x.id);
}

/** A 聚義廳 set: its id, its name (清風山夫妻 …), its group (夫妻檔 兄弟檔 主僕搭檔 山頭故事 大檔), the seats, the reward in words. */
export interface JuyiSet { id: string; name: string; group: string; seats: number[]; reward: string }

const seatOf = (name: string): number => {
  const i = LING.findIndex(c => c.name === name);
  if (i < 0) throw new Error(`梁山令: no hero ${name}`);
  return i + 1;
};
const set = (group: string, name: string, heroes: string | number[], reward: string): JuyiSet =>
  ({ id: name, name, group, seats: typeof heroes === 'string' ? heroes.split('、').map(seatOf) : heroes, reward });
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const JUYI_SETS: JuyiSet[] = [
  set('夫妻檔', '清風山夫妻', '王英、扈三娘', '喜酒禮金：城裡每個對手各送你{1000}'),
  set('夫妻檔', '十字坡夫妻', '張青、孫二娘', '黑店：城裡每個對手各昏睡2天'),
  set('夫妻檔', '登州夫妻', '孫新、顧大嫂', '免罪卡 ×2'),
  set('兄弟檔', '宋家兄弟', '宋江、宋清', '及時雨：現金{10000}'),
  set('兄弟檔', '阮氏三雄', '阮小二、阮小五、阮小七', '石碣村：城裡3塊沒人買的小地白送給你'),
  set('兄弟檔', '張家兄弟', '張橫、張順', '潯陽江：接下來整局遊戲乘坐汴河漕船全部免費'),
  set('兄弟檔', '解家兄弟', '解珍、解寶', '獵戶：地雷 ×3'),
  set('兄弟檔', '孔家兄弟', '孔明、孔亮', '請神符'),
  set('兄弟檔', '童家兄弟', '童威、童猛', '機車'),
  set('兄弟檔', '穆家兄弟', '穆弘、穆春', '揭陽鎮：自己城裡一條街15天過路費翻倍'),
  set('兄弟檔', '蔡家兄弟', '蔡福、蔡慶', '陷害卡 + 免罪卡'),
  set('兄弟檔', '朱家兄弟', '朱貴、朱富', '自己城裡兩棟各升1級'),
  set('兄弟檔', '孫家兄弟', '孫立、孫新', '拆除卡 + 改建卡'),
  set('兄弟檔', '鄒家叔侄', '鄒淵、鄒潤', '遙控骰子 ×2'),
  set('兄弟檔', '結義兄弟', '林沖、魯智深', '抽一張天罡令'),
  set('主僕搭檔', '盧府主僕', '盧俊義、燕青', '換地卡 + 換屋卡'),
  set('主僕搭檔', '李家莊主僕', '李應、杜興', '購地卡 ×2'),
  set('主僕搭檔', '快活林', '武松、施恩', '搶奪卡 ×2'),
  set('主僕搭檔', '神醫獸醫', '安道全、皇甫端', '趕走你身上的壞神仙，再請一位小福神附身'),
  set('主僕搭檔', '桃花山', '李忠、周通', '均富卡'),
  set('主僕搭檔', '祝家莊偷雞', '楊雄、石秀、時遷', '城裡每個對手各被偷一張卡給你'),
  set('主僕搭檔', '芒碭山', '樊瑞、項充、李袞', '惡魔卡'),
  set('主僕搭檔', '飲馬川', '裴宣、鄧飛、孟康', '汽車'),
  set('主僕搭檔', '清風山', '燕順、王英、鄭天壽', '抽一張天罡令'),
  set('山頭故事', '梁山元老', '宋萬、杜遷、朱貴', '梁山大旗：自己城裡所有房子插旗，15天過路費 +50%'),
  set('山頭故事', '少華山', '史進、朱武、陳達、楊春', '抽一張天罡令'),
  set('山頭故事', '黃門山', '歐鵬、蔣敬、馬麟、陶宗旺', '抽一張天罡令'),
  set('山頭故事', '江州劫法場', '宋江、戴宗、李逵、張順', '抽兩張天罡令'),
  set('山頭故事', '梁山巧匠', '蕭讓、金大堅、侯健、湯隆、孟康、陶宗旺', '工程車 + 機器工人 ×2'),
  set('山頭故事', '智取生辰綱', '吳用、公孫勝、劉唐、阮小二、阮小五、阮小七、白勝', '現金{20000}'),
  set('山頭故事', '二龍山', '魯智深、武松、楊志、施恩、曹正、張青、孫二娘', '核子飛彈'),
  set('大檔', '五虎將', '關勝、林沖、秦明、呼延灼、董平', '自己城裡所有房子各升1級'),
  set('大檔', '八驃騎', '花榮、徐寧、楊志、索超、張清、朱仝、史進、穆弘', '城裡每個對手最高的一棟各降2級'),
  set('大檔', '水軍八頭領', '李俊、張橫、張順、阮小二、阮小五、阮小七、童威、童猛', '汴河兩岸自己的房子各升2級'),
  set('大檔', '三十六天罡', range(1, 36), '抽一張傳說令 + 現金{30000}'),
  set('大檔', '七十二地煞', range(37, 108), '抽一張傳說令 + 現金{30000}'),
  set('大檔', '一百單八將（排座次）', range(1, 108), '自己城裡所有房子蓋到5級'),
];

const GRADE_SEATS: Record<LingGrade, [number, number]> = { legend: [1, 6], rare: [7, 18], high: [19, 36], common: [37, 108] };

/**
 * A seat: the grade by its chance, then evenly within it. `tiangang` 高級 75 / 稀有 20 / 傳說 5 %; `legend` 傳說 only.
 * `have`: the seats the player already holds — never drawn again (the user 2026-11-24: 「抽過的角色就不會再次被抽到了吧，要不總有
 * 重複的，永遠也集不齊」); a grade all held gives the nearest grade with seats left (the rarer first), and only a player
 * holding all 108 draws one again.
 */
export function drawSeat(g: Game, pool: 'any' | 'tiangang' | 'legend', have: ReadonlySet<number> = new Set()): number {
  const r = g.rng.below(100);
  const grade: LingGrade = pool === 'legend' ? 'legend'
    : pool === 'tiangang' ? (r < 5 ? 'legend' : r < 25 ? 'rare' : 'high')
    : r < 1 ? 'legend' : r < 5 ? 'rare' : r < 20 ? 'high' : 'common';
  const order: LingGrade[] = ['legend', 'rare', 'high', 'common'];
  const at = order.indexOf(grade);
  const tries = [grade, ...order.map((x, i) => ({ x, d: Math.abs(i - at) * 2 + (i > at ? 1 : 0) })).filter(o => o.x !== grade).sort((a, b) => a.d - b.d).map(o => o.x)];
  for (const gr of tries) {
    const [lo, hi] = GRADE_SEATS[gr];
    const left: number[] = [];
    for (let s = lo; s <= hi; s++) if (!have.has(s)) left.push(s);
    if (left.length) return left[g.rng.below(left.length)];
  }
  const [lo, hi] = GRADE_SEATS[grade];
  return lo + g.rng.below(hi - lo + 1);
}

/** The consolation when an effect finds nothing to work on. */
export const LING_CONSOLATION = 30;
/** The 汴河 in map px (cells 30–31 after the map moved 3 rows down; CELL 48) and how far its banks reach. */
const RIVER_Y = 31 * 48, BANK = 140;
/** Days of the timed effects. */
const GUARD_DAYS = 30;

// ---------------------------------------------------------------- the timed effects (the engine's hooks)

const st = (r: QingmingRules): Required<LingState> => {
  const s = r.ling;
  s.guard ??= {}; s.payee ??= {}; s.flag ??= {}; s.shield ??= [];
  return s as Required<LingState>;
};

/** Each day (QingmingRules.daily): the timed effects run down. */
export function lingDaily(g: Game, r: QingmingRules): void {
  const s = st(r);
  for (const k of Object.keys(s.guard)) if (--s.guard[+k] <= 0) delete s.guard[+k];
  for (const k of Object.keys(s.payee)) if (--s.payee[+k].days <= 0) delete s.payee[+k];
  for (const k of Object.keys(s.flag)) if (--s.flag[+k].days <= 0) delete s.flag[+k];
  s.shield.forEach((d, i) => { if (d) s.shield[i] = d - 1; });
  void g;
}
/** MapRules.guardPlot: 徐寧 / 黃信 / 湯隆's buildings cannot be damaged. */
export const lingGuard = (r: QingmingRules, ref: number): boolean => (r.ling.guard?.[ref] ?? 0) > 0;
/** MapRules.tollPayee: 穆弘 / 侯健 — the toll of the lot goes to the card's drawer (not when they own it now). */
export function lingPayee(g: Game, r: QingmingRules, land: Land): number | undefined {
  const x = r.ling.payee?.[land.id + 2000];
  return x && x.days > 0 && x.p !== land.owner - 1 && g.players[x.p]?.whoPlays && !g.players[x.p].bankrupt ? x.p : undefined;
}
/** MapRules.tollFactor: 郁保四 / 梁山元老's 梁山旗 — +50 % on the planter's own lots. */
export function lingTollFactor(r: QingmingRules, land: Land): number {
  const f = r.ling.flag?.[land.id + 2000];
  return f && f.boost && f.days > 0 && f.p === land.owner - 1 ? 1.5 : 1;
}
/** MapRules.cardShield: 宋萬's 守寨. */
export const lingShield = (r: QingmingRules, q: Player): boolean => (r.ling.shield?.[q.id] ?? 0) > 0;

// ---------------------------------------------------------------- one card's (or set's) run

type Plot = Land | Facility;
interface Line { p?: number; text: string; amount?: number }
const lv = (x: Plot) => x.level;
const toolName = (t: number): string => toolDef(t)?.name ?? '道具';
const cardTitle = (c: number): string => cardName(c) || '卡片';
const NPC = ['小偷', '強盜', '流氓', '間諜'];

class Run {
  constructor(readonly g: Game, readonly p: Player, readonly r: QingmingRules, readonly src: 'qm-ling' | 'qm-juyi',
    readonly id: number | string, readonly title: string, readonly head: string) {}

  get pi(): number { return this.g.priceIndex; }
  /** N × the price index (lingAmount). */
  amt(n: number): number { return lingAmount(n, this.pi); }
  name(q: number): string { return this.g.name(q); }
  pick<T>(a: readonly T[]): T { return a[this.g.rng.below(a.length)]; }
  /** n distinct, drawn in turn. */
  some<T>(a: readonly T[], n: number): T[] {
    const left = [...a], out: T[] = [];
    while (out.length < n && left.length) out.push(left.splice(this.g.rng.below(left.length), 1)[0]);
    return out;
  }

  // ---- who

  opps(): Player[] { return this.g.players.filter(q => q.id !== this.p.id && q.whoPlays !== 0 && !q.bankrupt && q.placed); }
  inTown(q: Player): boolean { return !!q.node && this.r.inTown(this.g.node(q.node)); }
  /** The opponents in town now (`road`: on the road, not in the hospital / prison / a hotel). */
  townOpps(road = false): Player[] { return this.opps().filter(q => this.inTown(q) && (!road || !this.g.offRoad(q))); }

  // ---- what

  private refNodes?: Map<number, number>;
  /** The road square beside a plot (lots 2001.., facilities 4001.., companies 6001..), 0 none. */
  nodeOf(ref: number): number {
    if (!this.refNodes) { this.refNodes = new Map(); for (const n of this.g.board.nodes) if (n.ref && !this.refNodes.has(n.ref)) this.refNodes.set(n.ref, n.id); }
    return this.refNodes.get(ref) ?? 0;
  }
  plot(ref: number): Plot | undefined { return ref > 4000 && ref < 6000 ? this.g.board.facilities[ref - 4001] : ref > 2000 && ref < 4000 ? this.g.board.lands[ref - 2001] : undefined; }
  /** Every lot and facility in town (by a road square beside it), lots first. */
  refs(): number[] {
    const out: number[] = [];
    for (const l of this.g.board.lands) if (this.townRef(l.id + 2000)) out.push(l.id + 2000);
    for (const f of this.g.board.facilities) if (this.townRef(f.id + 4000)) out.push(f.id + 4000);
    return out;
  }
  townRef(ref: number): boolean { const n = this.nodeOf(ref); return !!n && this.r.inTown(this.g.node(n)); }
  owner(ref: number): number { return (this.plot(ref)?.owner ?? 0) - 1; }
  house(ref: number): boolean { const x = this.plot(ref); return !!x && x.level > 0; }
  guarded(ref: number): boolean { return lingGuard(this.r, ref); }
  /** A house that can be hit (not guarded). */
  hittable(ref: number): boolean { return this.house(ref) && !this.guarded(ref); }
  top(ref: number): number { const x = this.plot(ref)!; return ref > 4000 ? this.g.facilityTop(x as Facility) : 5; }
  canUp(ref: number): boolean {
    const x = this.plot(ref);
    if (!x || x.level < 1) return false;
    return ref > 4000 ? x.level < this.top(ref) : !(x as Land).chain && x.level < 5;
  }
  /** Player q's houses in town (built lots and facilities) that pass `ok`. */
  houses(q: number, ok: (ref: number) => boolean): number[] { return this.refs().filter(ref => this.owner(ref) === q && this.house(ref) && ok(ref)); }
  /** Owned empty plots (no house), lots and large plots. */
  empties(q: number): number[] { return this.refs().filter(ref => this.owner(ref) === q && !this.house(ref) && !(ref < 4000 && (this.plot(ref) as Land).chain)); }
  freeLots(): number[] { return this.refs().filter(ref => ref < 4000 && this.owner(ref) < 0); }
  /** Player q's streets in town: lots of one name (land refs), only q's. */
  streets(q: number): number[][] {
    const by = new Map<string, number[]>();
    for (const ref of this.refs()) if (ref < 4000 && this.owner(ref) === q) { const nm = this.plot(ref)!.name; by.set(nm, [...(by.get(nm) ?? []), ref]); }
    return [...by.values()];
  }
  bank(ref: number): boolean { const x = this.plot(ref)!; return Math.abs(x.y - RIVER_Y) <= BANK; }

  // ---- doing

  up(ref: number, n: number): string {
    const x = this.plot(ref)!, was = lv(x);
    for (let k = 0; k < n; k++) if (this.g.freeUpgrade(ref) < 0) break;
    return `${x.name} ${was}→${lv(x)}級`;
  }
  down(ref: number, n: number | 'flat'): string {
    const x = this.plot(ref)!, was = lv(x);
    if (n === 'flat') this.g.damageProperty(ref, 2);
    else for (let k = 0; k < n && this.plot(ref)!.level > 0; k++) this.g.damageProperty(ref, 0);
    return n === 'flat' ? `${x.name}拆平` : `${x.name} ${was}→${lv(x)}級`;
  }
  give(ref: number) {
    const x = this.plot(ref)!, months = LAND_LIMIT_MONTHS[this.g.settings.landLimitIndex];
    x.owner = this.p.id + 1;
    x.expire = months ? addMonths(this.g.date, months) : 0;
  }
  /** What a plot is worth (its price and its houses): 吳用 / 公孫勝's swaps. */
  worth(ref: number): number { const a = this.plot(ref)!; return a.price + a.level * (ref > 4000 ? (a as Facility).fees[0] : (a as Land).perLevel); }
  lowest(refs: number[]): number {
    const m = Math.min(...refs.map(ref => this.plot(ref)!.level));
    return this.pick(refs.filter(ref => this.plot(ref)!.level === m));
  }
  highest(refs: number[]): number {
    const m = Math.max(...refs.map(ref => this.plot(ref)!.level));
    return this.pick(refs.filter(ref => this.plot(ref)!.level === m));
  }

  /** The result box (the camera to `node` / the lots `refs`, in town), then the line. */
  *show(fx: string, lines: Line[], say: string, at: { node?: number; refs?: number[] } = {}): Flow {
    const node = at.node || (at.refs?.length ? this.nodeOf(at.refs[0]) : 0);
    yield { t: 'board' };
    yield {
      t: 'fx', kind: 'event-result', p: this.p.id, ...(node ? { node } : {}),
      data: { src: this.src, id: this.id, fx, title: this.title, head: this.head, lines, ...(at.refs?.length ? { refs: at.refs } : {}) },
    };
    yield* this.g.say(this.p.id, say);
  }

  /** Nothing to work on: 30 點券 instead. */
  *consolation(): Flow {
    this.p.points += LING_CONSOLATION;
    yield { t: 'points', p: this.p.id, amount: LING_CONSOLATION };
    yield* this.g.say(this.p.id, `${this.title}：城裡找不到對象，改得${LING_CONSOLATION}點券`);
  }

  *gain(amount: number, reason: string): Flow<boolean> {
    if (amount <= 0) return false;
    this.g.gain(this.p, amount, 1);
    yield { t: 'pay', from: -1, to: this.p.id, amount, reason, quiet: true };
    yield* this.show('gain', [{ p: this.p.id, text: reason, amount }], `${this.name(this.p.id)}得到${amount}元`);
    return true;
  }
  /** q pays `amount` (never more than q has: nobody goes bankrupt by a card) to `to` (-1 the lottery pool). */
  *pay(q: Player, to: number, amount: number, reason: string): Flow<number> {
    const n = Math.max(0, Math.min(Math.trunc(amount), q.cash + q.bank));
    if (!n) return 0;
    yield* this.g.transfer(q.id, to, n, 1, reason, true);
    return n;
  }

  // ---- building blocks

  /** Own houses +n (count: how many, at random; 'all'). */
  *upOwn(n: number, count: number | 'all', filter: (ref: number) => boolean = () => true): Flow<boolean> {
    const mine = this.houses(this.p.id, ref => this.canUp(ref) && filter(ref));
    if (!mine.length) return false;
    const refs = count === 'all' ? mine : this.some(mine, count);
    const lines = refs.map(ref => ({ p: this.p.id, text: this.up(ref, n) }));
    yield* this.show('price-up', lines, refs.length > 1 ? `${refs.length}棟房子加蓋了` : `${this.plot(refs[0])!.name}加蓋了`, { refs });
    return true;
  }
  /** Own houses +1, the lowest first (count of them). */
  *upLowest(count: number): Flow<boolean> {
    const left = this.houses(this.p.id, ref => this.canUp(ref)), refs: number[] = [];
    while (refs.length < count && left.length) { const ref = this.lowest(left); refs.push(ref); left.splice(left.indexOf(ref), 1); }
    if (!refs.length) return false;
    const lines = refs.map(ref => ({ p: this.p.id, text: this.up(ref, 1) }));
    yield* this.show('price-up', lines, refs.length > 1 ? `${refs.length}棟房子加蓋了` : `${this.plot(refs[0])!.name}加蓋了`, { refs });
    return true;
  }
  /**
   * 吳用 / 公孫勝: p's n cheapest plots in town for the opponents' n dearest (by worth), pair by pair — the houses go with
   * the land (the user 2026-11-24: 「把自己最便宜的地跟對方最貴的地一換，然後把自己最便宜的2塊地跟對方最貴的2塊地一換」).
   */
  *swapLands(n: number): Flow<boolean> {
    const by = (a: number, b: number) => this.worth(a) - this.worth(b) || a - b;
    const mine = this.refs().filter(ref => this.owner(ref) === this.p.id && !this.guarded(ref)).sort(by);
    const theirs = this.refs().filter(ref => { const o = this.owner(ref); return o >= 0 && o !== this.p.id && !this.g.players[o].bankrupt && !this.guarded(ref); }).sort(by).reverse();
    const k = Math.min(n, mine.length, theirs.length), lines: Line[] = [], refs: number[] = [];
    for (let i = 0; i < k; i++) {
      const a = mine[i], b = theirs[i];
      if (this.worth(b) <= this.worth(a)) break;   // (never a swap for the worse)
      const pa = this.plot(a)!, pb = this.plot(b)!, q = pb.owner - 1;
      [pa.owner, pb.owner] = [pb.owner, pa.owner];
      [pa.expire, pb.expire] = [pb.expire, pa.expire];
      lines.push({ p: this.p.id, text: `換得${pb.name}` }, { p: q, text: `換得${pa.name}` });
      refs.push(b, a);
    }
    if (!lines.length) return false;
    yield* this.show('steal', lines, refs.length > 2 ? `${refs.length / 2}塊地換了對手最貴的地` : `${this.plot(refs[1])!.name}換${this.plot(refs[0])!.name}`, { refs });
    return true;
  }
  /** Opponents' empty plots (no house) in town made p's, n of them. */
  *seize(n: number): Flow<boolean> {
    const all = this.opps().flatMap(q => this.empties(q.id).filter(ref => !this.guarded(ref)));
    if (!all.length) return false;
    const refs = this.some(all, n), lines = refs.map(ref => ({ p: this.owner(ref), text: `${this.plot(ref)!.name}歸了${this.name(this.p.id)}` }));
    for (const ref of refs) this.give(ref);
    yield* this.show('steal', lines, `拿到${refs.length}塊地`, { refs });
    return true;
  }
  /** One opponent (random, in town) gives p `amount` (never more than they have). */
  *takeFrom(amount: number, reason: string, fromAmong: Player[] = this.townOpps()): Flow<boolean> {
    const qs = fromAmong.filter(q => q.cash + q.bank > 0);
    if (!qs.length) return false;
    const q = this.pick(qs), n = yield* this.pay(q, this.p.id, amount, reason);
    yield* this.show('steal', [{ p: q.id, text: reason, amount: -n }, { p: this.p.id, text: '進帳', amount: n }], `${this.name(q.id)}給了${n}元`, { node: q.node });
    return true;
  }
  /** One opponent's house(s) down: `who` picks the opponent among those with a hittable house in town. */
  *hitOne(n: number | 'flat', which: 'highest' | 'random', fromAmong: Player[] = this.opps()): Flow<boolean> {
    const cands = fromAmong.filter(q => this.houses(q.id, ref => this.hittable(ref)).length);
    if (!cands.length) return false;
    const q = this.pick(cands), hs = this.houses(q.id, ref => this.hittable(ref));
    const ref = which === 'highest' ? this.highest(hs) : this.pick(hs);
    const text = this.down(ref, n);
    yield* this.show('demolish', [{ p: q.id, text }], `${this.name(q.id)}的${text}`, { refs: [ref] });
    return true;
  }
  /** A street of q (lots of one name) down 1 each; `seal` days then 查封. */
  *hitStreet(q: Player, refs: number[], n: number, seal: number): Flow {
    const lines: Line[] = [];
    if (n) for (const ref of refs) if (this.hittable(ref)) lines.push({ p: q.id, text: this.down(ref, n) });
    if (seal) { for (const ref of refs) this.plot(ref)!.tmpState = (seal << 4) | 1; lines.push({ p: q.id, text: `${this.plot(refs[0])!.name}查封${seal}天` }); }
    yield* this.show(n ? 'demolish' : 'fine', lines, `${this.name(q.id)}的${this.plot(refs[0])!.name}${seal ? `查封${seal}天` : '每棟降了一級'}`, { refs });
  }
  /** Own street (random) with tmpState: 漲價 (toll ×2) or 查封, for `days`. */
  *ownStreet(kind: 0 | 1, days: number): Flow<boolean> {
    const ss = this.streets(this.p.id);
    if (!ss.length) return false;
    const refs = this.pick(ss), nm = this.plot(refs[0])!.name;
    for (const ref of refs) this.plot(ref)!.tmpState = (days << 4) | kind;
    yield* this.show(kind ? 'fine' : 'price-up', [{ p: this.p.id, text: kind ? `${nm}查封${days}天` : `${nm}${days}天過路費翻倍` }], kind ? `${nm}被查封${days}天` : `${nm}過路費翻倍${days}天`, { refs });
    return true;
  }
  *guard(refs: number[]): Flow<boolean> {
    if (!refs.length) return false;
    const s = st(this.r);
    for (const ref of refs) s.guard[ref] = GUARD_DAYS;
    yield* this.show('blessed', refs.map(ref => ({ p: this.p.id, text: `${this.plot(ref)!.name}${GUARD_DAYS}天拆不掉、炸不掉` })), `${refs.length > 1 ? `${refs.length}棟房子` : this.plot(refs[0])!.name}${GUARD_DAYS}天拆不掉、炸不掉`, { refs });
    return true;
  }
  *flag(refs: number[], days: number, boost: boolean, payee: boolean): Flow<boolean> {
    if (!refs.length) return false;
    const s = st(this.r);
    for (const ref of refs) {
      s.flag[ref] = { p: this.p.id, days, boost };
      if (payee) s.payee[ref] = { p: this.p.id, days };
    }
    const nm = this.plot(refs[0])!.name;
    yield* this.show('price-up', refs.map(ref => ({ p: this.owner(ref), text: `${this.plot(ref)!.name}插上梁山旗：${days}天${boost ? '過路費 +50%' : `過路費歸${this.name(this.p.id)}`}` })),
      boost ? `${refs.length}棟房子插上梁山旗` : `${nm}插上梁山旗，過路費歸${this.name(this.p.id)}`, { refs });
    return true;
  }
  *forced(q: Player, n: number, turns: number): Flow<boolean> {
    this.r.forced[q.id] = { n, turns };
    yield* this.show('jam', [{ p: q.id, text: `接下來${turns}回合擲${n}個骰子` }], `${this.name(q.id)}接下來${turns}回合擲${n}個骰子`, { node: q.node });
    return true;
  }
  *sleep(qs: Player[], days: number): Flow<boolean> {
    if (!qs.length) return false;
    for (const q of qs) { q.sleepwalk = 0; q.sleep = days; q.monthBadDays += days; }
    yield* this.show('jam', qs.map(q => ({ p: q.id, text: `昏睡${days}天` })), `${qs.map(q => this.name(q.id)).join('、')}昏睡${days}天`, { node: qs[0].node });
    return true;
  }
  *send(q: Player | undefined, place: 'hospital' | 'prison', days: number): Flow<boolean> {
    if (!q) return false;
    const at = q.node;
    yield* this.g.sendTo(q, place, days);
    yield* this.show(place, [{ p: q.id, text: place === 'hospital' ? `進趙太丞家${days}天` : `押進開封府${days}天` }], `${this.name(q.id)}${place === 'hospital' ? '進了趙太丞家' : '押進了開封府'}`, { node: at });
    return true;
  }

  /** Free squares in town for objects (no player, no object; not the hospital / prison building). */
  freeSquares(): number[] {
    const g = this.g;
    const taken = new Set([...g.players.filter(q => q.placed && q.whoPlays).map(q => q.node), ...g.objects.slots.filter(o => o.node).map(o => o.node)]);
    return g.board.nodes.filter(n => !n.noDrop && n.ref < 8001 && n.adjacent.some(Boolean) && !taken.has(n.id) && this.r.inTown(n)).map(n => n.id);
  }
  /** A free slot of an object type, added when all are out (the map has 10 roadblocks and one dog: 張橫 puts out 20). */
  spare(type: number) {
    if (!this.g.objects.slots.some(o => o.type === type && !o.node && !o.owner)) this.g.objects.slots.push({ type, node: 0, dir: 0, life: 0, owner: 0 });
  }
  /** Objects (roadblocks 16, mines 17, time bombs 18, dogs 11) on n random free squares in town. */
  *scatter(type: number, n: number): Flow<boolean> {
    // (no 'place-object' each: that is a tool's, its user's portrait and a throw from 梁山 ten times over; the box shows them)
    const nodes = this.some(this.freeSquares(), n), put: number[] = [];
    for (const node of nodes) {
      this.spare(type);
      if (this.g.objects.place(type, node)) put.push(node);
    }
    if (!put.length) return false;
    yield { t: 'fx', kind: 'qm-rain', p: this.p.id, node: put[0], data: { type, nodes: put } };
    const what = OBJECT_NAMES[type - 1];
    yield* this.show('none', [{ text: `城裡${put.length}格放了${what}` }], `城裡${put.length}格放了${what}`, { node: put[0] });
    return true;
  }
  /** The square q walks onto next (forks by q's own arrows), 0 none. */
  ahead(q: Player): number {
    const g = this.g, n = g.node(q.node);
    const exits = n.adjacent.filter((a, j) => a && a !== q.lastNode && !(n.oneWay & (8 >> j)));
    if (g.forks.isFork(q.node)) return g.forks.follow(q.id, q.node, q.lastNode);
    return exits[0] ?? 0;
  }
  *roadblocks(qs: Player[]): Flow<boolean> {
    const put: { q: Player; node: number }[] = [];
    for (const q of qs) {
      const node = this.ahead(q);
      if (node && this.r.inTown(this.g.node(node))) this.spare(16);
      if (node && this.r.inTown(this.g.node(node)) && this.g.objects.place(16, node)) put.push({ q, node });
    }
    if (!put.length) return false;
    yield { t: 'fx', kind: 'qm-rain', p: this.p.id, node: put[0].node, data: { type: 16, nodes: put.map(x => x.node) } };
    yield* this.show('jam', put.map(x => ({ p: x.q.id, text: '前面多了一個路障' })), `${put.map(x => this.name(x.q.id)).join('、')}前面多了路障`, { node: put[0].node });
    return true;
  }
  /** q walked back n squares (the way q came), then on as before. */
  back(q: Player, n: number): number {
    const g = this.g;
    let at = q.node, from = q.lastNode || g.node(at).adjacent.find(Boolean) || at;
    const behind = (a: number, b: number) => g.node(b).adjacent.find(x => x && x !== a) ?? a;   // past b, coming from a
    for (let k = 0; k < n && from && from !== at; k++) { const nx = behind(at, from); at = from; from = nx; }
    q.node = at; q.lastNode = from;
    return at;
  }
  *move(q: Player, node: number, last: number): Flow {
    q.node = node; q.lastNode = last;
    yield { t: 'teleport', p: q.id, node };
  }

  // ---- gods

  /** Gods lying in town (slot ids) of the given types. */
  mapGods(types: Set<number>): number[] {
    return this.g.objects.slots.map((o, i) => ({ o, id: i + 1 })).filter(({ o }) => o.node && !o.owner && types.has(o.type) && this.r.inTown(this.g.node(o.node))).map(x => x.id);
  }
  /** Bad gods out of 汴京 (they come back as gods do when their pair leaves someone). */
  evict(ids: number[]): Line[] {
    return ids.map(id => {
      const o = this.g.objects.slots[id - 1], t = o.type;
      Object.assign(o, { node: 0, life: 0, owner: 0 });
      return { text: `${OBJECT_NAMES[t - 1]}離開了汴京` };
    });
  }
  *attach(q: Player, id: number): Flow {
    yield* this.g.objects.attach(q, id, true);
  }

  // ---- cards and tools

  /** A tool into p's hand outside the shop (a reward): over the shop's stock if need be; false at 9 held. */
  giveTool(q: Player, tool: number): boolean {
    if (this.g.tools.receive(q, tool)) return true;
    if (q.tools[tool - 1] >= MAX_HELD) return false;
    q.tools[tool - 1] += 1;
    return true;
  }
  *rewardItems(cards: number[], tools: number[]): Flow<boolean> {
    const lines: Line[] = [];
    for (const c of cards) if (this.g.cards.receive(this.p, c)) lines.push({ p: this.p.id, text: `得到${cardTitle(c)}` });
    for (const t of tools) if (this.giveTool(this.p, t)) lines.push({ p: this.p.id, text: `得到${toolName(t)}` });
    if (!lines.length) return false;
    yield* this.show('cards', lines, `${this.name(this.p.id)}${lines.map(l => l.text).join('、')}`, { node: this.p.node });
    return true;
  }
  /** A random tool of q's to p. */
  stealTool(q: Player): string {
    const held = q.tools.map((n, i) => (n > 0 && i < 13 ? i + 1 : 0)).filter(Boolean);
    const t = this.pick(held);
    q.tools[t - 1] -= 1;
    if (this.p.tools[t - 1] < MAX_HELD) this.p.tools[t - 1] += 1;
    else if (t <= 8) this.g.tools.shopStock[t - 1] += 1;
    return toolName(t);
  }
  stealCard(q: Player): string {
    const c = this.pick(q.cards);
    this.g.cards.consume(q, c);
    this.g.cards.receive(this.p, c);
    return cardTitle(c);
  }
  hasTool(q: Player): boolean { return q.tools.some((n, i) => n > 0 && i < 13); }

  /** An NPC (0 小偷 1 強盜 2 流氓 3 間諜) out of the prison (where 1) or hospital (2), working for p, on a square in town. */
  *freeNpc(i: number, where: 1 | 2): Flow<number> {
    const g = this.g, n = g.places.npcs[i];
    if (!n || n.where !== where) return 0;
    yield* g.places.releaseNpc(g.npcBase + i, this.p.id);
    const squares = this.freeSquares();
    if (squares.length) {
      const to = this.pick(squares);
      n.node = to; n.lastNode = g.node(to).adjacent.find(Boolean) ?? 0;
    }
    // (out of the 開封府 / 趙太丞家 and dropped from the sky onto the square — the user 2026-11-24)
    yield { t: 'fx', kind: 'qm-npc-drop', p: this.p.id, node: n.node, data: { actor: g.npcBase + i } };
    return n.node;
  }
  *release(where: 1 | 2, only?: number): Flow<boolean> {
    const g = this.g, place = where === 1 ? 'prison' : 'hospital';
    const lines: Line[] = [];
    let at = 0;
    if (only === undefined) for (const q of g.players) if (q.whoPlays && q[place] && q[place] !== 0x80) { q[place] = 0x80; lines.push({ p: q.id, text: where === 1 ? '出獄了' : '出院了' }); }
    for (let i = 0; i < 4; i++) {
      if (only !== undefined && i !== only) continue;
      const node = yield* this.freeNpc(i, where);
      if (node) { lines.push({ text: `${NPC[i]}放出來了，在城裡亂竄` }); at ||= node; }
    }
    if (!lines.length) return false;
    yield* this.show('release', lines, lines.map(l => (l.p !== undefined ? this.name(l.p) : '') + l.text).join('；'), at ? { node: at } : {});
    return true;
  }

  /** p's shares of town companies, or one company's stock, +10 %. */
  *stocksUp(slots: number[]): Flow<boolean> {
    if (!slots.length) return false;
    const m = this.g.stocks, today = (m.cursor + 143) % 144;
    const lines: Line[] = [];
    for (const slot of slots) {
      const s = m.stocks[slot], was = s.price;
      s.price = adjustPrice(s.price, 10);
      s.history[today] = s.price;
      lines.push({ text: `${s.name} 漲10%（${Math.round(was * 10) / 10}→${Math.round(s.price * 10) / 10}）` });
    }
    yield { t: 'fx', kind: 'stocks-updated' };
    const c = m.companyOf(slots[0]), node = c ? this.nodeOf(6001 + this.g.board.companies.indexOf(c)) : 0;
    yield* this.show('stock-up', lines, lines.length > 1 ? `${lines.length}支股票漲了10%` : lines[0].text, node ? { node } : {});
    return true;
  }
  /** Stock slots linked to a company in town. */
  townStocks(): number[] {
    const m = this.g.stocks;
    return m.stocks.map((_, slot) => slot).filter(slot => {
      const c = m.companyOf(slot);
      if (!c) return false;
      const n = this.nodeOf(6001 + this.g.board.companies.indexOf(c));
      return !n || this.r.inTown(this.g.node(n));
    });
  }
}


// ---------------------------------------------------------------- the 108 effects

type Effect = (x: Run) => Flow<boolean>;

/** Own houses: one at random +n. */
const ownUp = (n: number, count: number | 'all' = 1): Effect => x => x.upOwn(n, count);
/** An opponent's house (random, any opponent with one in town) −1. */
const oppDown1: Effect = x => x.hitOne(1, 'random');
const money = (k: number, reason: string): Effect => x => x.gain(x.amt(k), reason);
/** Forced dice (戴宗 歐鵬 王定六 白勝 — kept by the user 2026-11-24: 「擲4個骰子擲5個骰這種玩法不要改，強制的」). */
const forcedSelf = (n: number, turns: number): Effect => x => x.forced(x.p, n, turns);
/** An NPC out (楊林 樂和 鄒淵 朱富 時遷 — kept by the user 2026-11-24: 「放出間諜、小偷、流氓…這個還是留著」). */
const freeOne = (npc: number, where: 1 | 2): Effect => x => x.release(where, npc);
const jail = (place: 'hospital' | 'prison', days: number): Effect => function* (x) { const qs = x.townOpps(true); return qs.length ? yield* x.send(x.pick(qs), place, days) : false; };
const guardOne: Effect = function* (x) {
  const hs = x.houses(x.p.id, ref => !x.guarded(ref)), all = hs.length ? hs : x.houses(x.p.id, () => true);
  return all.length ? yield* x.guard([x.pick(all)]) : false;
};
const cashCut = (pct: number): Effect => function* (x) {
  const qs = x.townOpps().filter(q => Math.trunc(q.cash * pct) > 0);
  if (!qs.length) return false;
  const q = x.pick(qs), n = yield* x.pay(q, x.p.id, q.cash * pct, '梁山令');
  yield* x.show('steal', [{ p: q.id, text: `給了${x.name(x.p.id)}`, amount: -n }, { p: x.p.id, text: '進帳', amount: n }], `${x.name(q.id)}給了${n}元`, { node: q.node });
  return true;
};
const selfPay = (pct: number, reason: string): Effect => function* (x) {
  const n = yield* x.pay(x.p, -1, x.p.cash * pct, reason);
  if (!n) return false;
  yield* x.show('fine', [{ p: x.p.id, text: reason, amount: -n }], `${reason}${n}元`, { node: x.p.node });
  return true;
};
const ownDown: Effect = function* (x) {
  const hs = x.houses(x.p.id, ref => x.hittable(ref));
  if (!hs.length) return false;
  const ref = x.pick(hs), text = x.down(ref, 1);
  yield* x.show('demolish', [{ p: x.p.id, text }], text, { refs: [ref] });
  return true;
};
const freeLots = (n: number): Effect => function* (x) {
  const lots = x.freeLots();
  if (!lots.length) return false;
  const refs = x.some(lots, n);
  for (const ref of refs) x.give(ref);
  yield* x.show('gain', refs.map(ref => ({ p: x.p.id, text: `得到${x.plot(ref)!.name}` })), `白得${refs.length}塊地`, { refs });
  return true;
};
const reclaim = (n: number): Effect => function* (x) {
  const all = x.opps().flatMap(q => x.empties(q.id).filter(ref => !x.guarded(ref)));
  if (!all.length) return false;
  const refs = n === 1 ? [x.pick(all)] : x.some(all, n);
  const lines = refs.map(ref => ({ p: x.owner(ref), text: `${x.plot(ref)!.name}被收回，成了沒人買的地` }));
  for (const ref of refs) x.g.damageProperty(ref, 1);
  yield* x.show('demolish', lines, lines.map(l => l.text).join('；'), { refs });
  return true;
};
/** Own houses on the 汴河's banks +1 (`one`: one of them, else any one). */
/** 燕青 / 時遷: an opponent's house −1 and one of p's +1 (`top`: the highest of each, else p's at random). */
const stealFloor = (top: boolean): Effect => function* (x) {
  const a = yield* x.hitOne(1, 'highest');
  const mine = x.houses(x.p.id, ref => x.canUp(ref));
  if (!mine.length) return a;
  const ref = top ? x.highest(mine) : x.pick(mine), text = x.up(ref, 1);
  yield* x.show('price-up', [{ p: x.p.id, text }], `${x.plot(ref)!.name}加蓋了`, { refs: [ref] });
  return true;
};
const ownTopDown: Effect = function* (x) {
  const hs = x.houses(x.p.id, ref => x.hittable(ref));
  if (!hs.length) return false;
  const ref = x.highest(hs), text = x.down(ref, 1);
  yield* x.show('demolish', [{ p: x.p.id, text }], text, { refs: [ref] });
  return true;
};
const richestDown: Effect = function* (x) {
  const qs = x.townOpps().filter(q => x.houses(q.id, ref => x.hittable(ref)).length);
  if (!qs.length) return false;
  return yield* x.hitOne(1, 'random', [qs.reduce((a, b) => (b.cash > a.cash ? b : a))]);
};

const EFFECTS: Record<number, Effect> = {
  1: ownUp(1, 'all'),
  2: function* (x) {
    const hs = x.houses(x.p.id, ref => x.canUp(ref));
    if (!hs.length) return false;
    const ref = x.pick(hs);
    const text = x.up(ref, x.top(ref));
    yield* x.show('price-up', [{ p: x.p.id, text }], `${x.plot(ref)!.name}直接蓋到頂了`, { refs: [ref] });
    return true;
  },
  3: x => x.swapLands(1),
  4: x => x.swapLands(2),
  5: x => x.hitOne('flat', 'highest'),
  6: function* (x) {
    const qs = x.opps().filter(q => x.streets(q.id).length);
    if (!qs.length) return false;
    const q = x.pick(qs);
    yield* x.hitStreet(q, x.pick(x.streets(q.id)), 1, 5);
    return true;
  },
  7: function* (x) {
    const qs = x.opps().filter(q => x.streets(q.id).some(s => s.some(ref => x.hittable(ref))));
    if (!qs.length) return false;
    const q = x.pick(qs);
    yield* x.hitStreet(q, x.pick(x.streets(q.id).filter(s => s.some(ref => x.hittable(ref)))), 1, 0);
    return true;
  },
  8: reclaim(2),
  9: function* (x) {
    const qs = x.townOpps();
    if (!qs.length) return false;
    const rich = qs.reduce((a, b) => (b.cash > a.cash ? b : a));
    return yield* x.hitOne(2, 'highest', [rich]);
  },
  10: freeLots(2),
  11: x => x.ownStreet(0, 7),
  12: ownUp(1, 2),
  13: x => x.hitOne(3, 'highest'),
  14: function* (x) {
    const qs = x.opps().filter(q => x.houses(q.id, ref => x.hittable(ref)).length);
    if (!qs.length) return false;
    const q = x.pick(qs), hs = x.houses(q.id, ref => x.hittable(ref)), a = x.highest(hs), rest = hs.filter(ref => ref !== a);
    // (the two highest, not the highest twice)
    const refs = rest.length ? [a, x.highest(rest)] : [a], lines = refs.map(ref => ({ p: q.id, text: x.down(ref, 2) }));
    yield* x.show('demolish', lines, `${x.name(q.id)}的${lines.map(l => l.text).join('、')}`, { refs });
    return true;
  },
  15: function* (x) {
    const qs = x.opps().filter(q => x.houses(q.id, ref => x.hittable(ref)).length);
    if (!qs.length) return false;
    for (const q of x.some(qs, 2)) yield* x.hitOne(1, 'random', [q]);
    return true;
  },
  16: function* (x) {
    const qs = x.townOpps().filter(q => x.houses(q.id, ref => x.hittable(ref)).length);
    if (!qs.length) return false;
    for (const q of qs) yield* x.hitOne(1, 'random', [q]);
    return true;
  },
  17: money(10000, '生辰綱'),
  18: x => x.guard(x.houses(x.p.id, () => true)),
  19: ownUp(2),
  20: forcedSelf(5, 15),
  21: cashCut(0.05),
  22: function* (x) {
    if (!(yield* x.hitOne(2, 'random'))) return false;
    const hs = x.houses(x.p.id, ref => x.hittable(ref));
    if (hs.length) { const ref = x.pick(hs), text = x.down(ref, 1); yield* x.show('demolish', [{ p: x.p.id, text }], `砍得太猛，自己的${text}`, { refs: [ref] }); }
    return true;
  },
  23: function* (x) {
    const lots = x.empties(x.p.id).filter(ref => ref < 4000);
    if (!lots.length) return yield* x.upOwn(1, 1);
    const ref = x.pick(lots), nm = x.plot(ref)!.name;
    x.plot(ref)!.level = 2;
    yield* x.show('price-up', [{ p: x.p.id, text: `${nm} 0→2級` }], `${nm}直接蓋到2級`, { refs: [ref] });
    return true;
  },
  24: function* (x) {
    const qs = x.townOpps().filter(q => x.streets(q.id).length);
    if (!qs.length) return false;
    const q = x.pick(qs);
    return yield* x.flag(x.pick(x.streets(q.id)), 7, false, true);
  },
  25: x => x.seize(2),
  26: function* (x) {
    // 李俊 (the user 2026-11-24: 「汴河兩岸所有的房子升一級，空地的話也生出一個小房子出來」): own lots and houses on the banks
    const mine = x.refs().filter(ref => x.bank(ref) && x.owner(ref) === x.p.id);
    const empty = mine.filter(ref => ref < 4000 && !x.house(ref) && !(x.plot(ref) as Land).chain), houses = mine.filter(ref => x.canUp(ref));
    if (!empty.length && !houses.length) return false;
    const lines: Line[] = [];
    for (const ref of empty) { x.plot(ref)!.level = 1; lines.push({ p: x.p.id, text: `${x.plot(ref)!.name} 0→1級` }); }
    for (const ref of houses) lines.push({ p: x.p.id, text: x.up(ref, 1) });
    const refs = [...empty, ...houses];
    yield* x.show('price-up', lines, `汴河兩岸${refs.length}塊地加蓋了`, { refs });
    return true;
  },
  27: freeLots(1),
  28: x => x.scatter(16, 20),   // (kept, 10 → 20: the user 2026-11-24 「10格還是有點少」)
  29: ownUp(1, 2),
  30: jail('hospital', 3),
  31: reclaim(1),
  32: jail('prison', 3),
  33: function* (x) {
    const a = yield* x.upOwn(1, 1);
    const b = yield* x.hitOne(1, 'random');
    return a || b;
  },
  34: x => x.hitOne(2, 'highest'),
  35: x => x.upLowest(2),
  36: stealFloor(true),
  37: x => x.upLowest(1),
  38: guardOne,
  39: oppDown1,
  40: function* (x) { const qs = x.townOpps(); return qs.length ? yield* x.forced(x.pick(qs), 1, 3) : false; },
  41: ownUp(1),
  42: ownUp(1),
  43: richestDown,
  44: function* (x) {
    const refs = x.refs().filter(ref => x.bank(ref) && x.hittable(ref));
    if (!refs.length) return false;
    const lines = refs.map(ref => ({ p: x.owner(ref), text: x.down(ref, 1) }));
    yield* x.show('flood', lines, `汴河水淹，兩岸${refs.length}棟房子各降1級`, { refs });
    return true;
  },
  45: function* (x) {
    const by = new Map<string, number[]>();
    for (const ref of x.refs()) if (ref < 4000) { const nm = x.plot(ref)!.name; by.set(nm, [...(by.get(nm) ?? []), ref]); }
    const streets = [...by.values()].filter(s => s.some(ref => x.hittable(ref)));
    if (!streets.length) return false;
    const s = x.pick(streets), hit = s.filter(ref => x.hittable(ref));
    const lines = hit.map(ref => ({ p: x.owner(ref), text: x.down(ref, 1) }));
    yield* x.show('demolish', lines, `${x.plot(s[0])!.name}起火，${hit.length}棟各降1級`, { refs: s });
    return true;
  },
  46: function* (x) {
    const refs = [...new Set(x.townOpps(true).map(q => x.g.node(q.node).ref).filter(ref => x.plot(ref) && x.hittable(ref)))];
    if (!refs.length) return false;
    const lines = refs.map(ref => ({ p: x.owner(ref), text: x.down(ref, 'flat') }));
    yield* x.show('demolish', lines, `奉旨拆屋：${lines.map(l => l.text).join('、')}`, { refs });
    return true;
  },
  47: function* (x) {
    const refs = x.refs().filter(ref => x.owner(ref) === x.p.id && x.plot(ref)!.tmpState >> 4 && x.plot(ref)!.tmpState & 0xf);
    if (!refs.length) return false;
    for (const ref of refs) x.plot(ref)!.tmpState = 0;
    yield* x.show('release', [{ p: x.p.id, text: `${[...new Set(refs.map(ref => x.plot(ref)!.name))].join('、')}解封了` }], '查封的街解封了', { refs });
    return true;
  },
  48: forcedSelf(5, 10),
  49: reclaim(1),
  50: money(2000, '剪徑所得'),
  51: freeOne(3, 2),
  52: x => x.scatter(17, 20),   // (kept, 10 → 20 mines: the user 2026-11-24)
  53: function* (x) {
    // 蔣敬 (the user 2026-11-24: 「神算的獎金改成每個人抽10%的現金給你」): every opponent, wherever they are
    const lines: Line[] = [];
    for (const q of x.opps()) { const n = yield* x.pay(q, x.p.id, q.cash * 0.1, '神算子'); if (n) lines.push({ p: q.id, text: '給了現金的10%', amount: -n }); }
    if (!lines.length) return false;
    const sum = lines.reduce((t, l) => t - (l.amount ?? 0), 0);
    yield* x.show('steal', [...lines, { p: x.p.id, text: '進帳', amount: sum }], `每個對手各給了現金的10%，共${sum}元`, { node: x.p.node });
    return true;
  },
  54: function* (x) {
    const qs = x.opps().filter(q => x.houses(q.id, ref => x.hittable(ref)).length);
    if (!qs.length) return false;
    for (const q of x.some(qs, 2)) yield* x.hitOne(1, 'random', [q]);
    return true;
  },
  55: function* (x) {
    const qs = x.townOpps();
    if (!qs.length) return false;
    const rich = qs.reduce((a, b) => (b.cash > a.cash ? b : a));
    return Math.trunc(rich.cash * 0.1) > 0 ? yield* x.takeFrom(rich.cash * 0.1, '劫富', [rich]) : false;   // (3 → 10 %: the user 2026-11-24)
  },
  56: x => x.release(2),   // (kept: the user 2026-11-24)
  57: x => x.scatter(11, 15),   // (kept, 3 → 15 dogs: the user 2026-11-24)
  58: function* (x) {
    // 王英 (the user 2026-11-24: 「複製自己道具欄裡面的任何一個道具」)
    const held = x.p.tools.map((n, i) => (n > 0 && i < 13 ? i + 1 : 0)).filter(Boolean);
    if (!held.length) return false;
    const t = x.pick(held);
    if (!x.giveTool(x.p, t)) return false;
    yield* x.show('cards', [{ p: x.p.id, text: `多了一個${toolName(t)}` }], `複製了一個${toolName(t)}`, { node: x.p.node });
    return true;
  },
  59: x => x.seize(1),
  60: x => x.scatter(8, 5),   // (鮑旭: five 大衰神 more in town — the user 2026-11-24)
  61: x => x.hitOne(1, 'highest'),
  62: ownDown,
  63: x => x.ownStreet(1, 3),
  64: oppDown1,
  65: freeLots(1),
  66: function* (x) {
    // (kept: the user 2026-11-24)
    if (!x.p.cards.length) return false;
    const c = x.pick(x.p.cards);
    if (!x.g.cards.receive(x.p, c)) return false;
    yield* x.show('cards', [{ p: x.p.id, text: `複製了一張${cardTitle(c)}` }], `刻了一張${cardTitle(c)}`, { node: x.p.node });
    return true;
  },
  67: x => x.upLowest(1),
  68: function* (x) {
    // 童威 (the user 2026-11-24: 「汴河兩岸有空地的話就歸你…佔據汴河兩岸的任意一塊空地」): nobody's, or another's without a house
    const ok = (ref: number) => ref < 4000 && x.owner(ref) !== x.p.id && !x.guarded(ref) && !(x.plot(ref) as Land).chain;
    const opp = (ref: number) => { const w = x.owner(ref); return w >= 0 && !x.g.players[w].bankrupt; };
    // no empty one there: an opponent's lot, its house with it — by the river first, else anywhere in town
    const free = x.refs().filter(ref => ok(ref) && x.bank(ref) && !x.house(ref));
    const byRiver = x.refs().filter(ref => ok(ref) && opp(ref) && x.bank(ref));
    const lots = free.length ? free : byRiver.length ? byRiver : x.refs().filter(ref => ok(ref) && opp(ref));
    if (!lots.length) return false;
    const ref = x.pick(lots), was = x.owner(ref);
    x.give(ref);
    yield* x.show('steal', [{ p: was >= 0 ? was : x.p.id, text: `${x.plot(ref)!.name}歸了${x.name(x.p.id)}` }], `佔了汴河邊的${x.plot(ref)!.name}`, { refs: [ref] });
    return true;
  },
  69: function* (x) {
    // 童猛 (the user 2026-11-24: 「汴河兩岸任何隨機選一個有主的地變成空地，流失土地」): anyone's, the drawer's too
    const lots = x.refs().filter(ref => ref < 4000 && x.bank(ref) && x.owner(ref) >= 0 && !x.guarded(ref));
    if (!lots.length) return false;
    const ref = x.pick(lots), was = x.owner(ref), nm = x.plot(ref)!.name;
    x.g.damageProperty(ref, 1);
    yield* x.show('flood', [{ p: was, text: `${nm}被汴河沖走，成了沒人買的地` }], `${x.name(was)}的${nm}被汴河沖走了`, { refs: [ref] });
    return true;
  },
  70: money(1000, '造船所得'),
  71: function* (x) {
    const qs = x.townOpps().filter(q => x.streets(q.id).length);
    if (!qs.length) return false;
    const q = x.pick(qs);
    return yield* x.flag([x.pick(x.streets(q.id).flat())], 7, false, true);
  },
  72: selfPay(0.03, '交出贖金'),
  73: x => x.roadblocks(x.townOpps(true)),   // (雷橫's roadblocks, moved to a 地煞 — the user 2026-11-24)
  74: cashCut(0.03),
  75: ownUp(1),
  76: money(2000, '排宴'),
  77: freeOne(2, 1),
  78: oppDown1,
  79: ownTopDown,
  80: function* (x) {
    const qs = x.townOpps();
    if (!qs.length) return false;
    const lines: Line[] = [];
    for (const q of qs) { const n = yield* x.pay(q, x.p.id, x.amt(1000), '保護費'); if (n) lines.push({ p: q.id, text: '交保護費', amount: -n }); }
    if (!lines.length) return false;
    yield* x.show('steal', lines, `收了${lines.length}份保護費`, { node: qs[0].node });
    return true;
  },
  81: x => x.takeFrom(x.amt(1000), '操刀鬼'),
  82: function* (x) {
    const hs = x.houses(x.p.id, ref => !x.guarded(ref));
    return yield* x.guard(x.some(hs.length ? hs : x.houses(x.p.id, () => true), 2));
  },
  83: function* (x) {
    const hs = x.refs().filter(ref => x.canUp(ref));
    if (!hs.length) return false;
    const ref = x.highest(hs), text = x.up(ref, 1);
    yield* x.show('price-up', [{ p: x.owner(ref), text }], `${x.plot(ref)!.name}又加蓋了一層`, { refs: [ref] });
    return true;
  },
  84: x => x.takeFrom(x.amt(1000), '看賣藝打賞'),
  85: x => x.ownStreet(0, 3),
  86: selfPay(0.02, '賣膏藥虧本'),
  87: ownDown,
  88: guardOne,
  89: function* (x) {
    // 杜興 (the user 2026-11-24: 「隨機收回任何一塊空地，不管是自己的還是敵方的」)
    const all = x.g.players.filter(q => q.whoPlays && !q.bankrupt).flatMap(q => x.empties(q.id).filter(ref => !x.guarded(ref)));
    if (!all.length) return false;
    const ref = x.pick(all), was = x.owner(ref), nm = x.plot(ref)!.name;
    x.g.damageProperty(ref, 1);
    yield* x.show('demolish', [{ p: was, text: `${nm}被收回，成了沒人買的地` }], `${x.name(was)}的${nm}被收回了`, { refs: [ref] });
    return true;
  },
  90: freeOne(1, 2),
  91: x => x.hitOne(1, 'highest'),
  92: ownUp(1),
  93: freeOne(1, 1),
  94: jail('prison', 3),
  95: x => x.scatter(18, 20),   // (kept, 10 → 20 time bombs: the user 2026-11-24)
  96: x => x.takeFrom(x.amt(2000), '黑店'),
  97: ownUp(1),
  98: oppDown1,
  99: function* (x) {
    if (x.g.rng.below(2) === 0) return yield* x.gain(x.amt(2000), '賭贏了');
    const n = yield* x.pay(x.p, -1, x.amt(1000), '賭輸了');
    yield* x.show('fine', [{ p: x.p.id, text: '賭輸了', amount: -n }], n ? `賭輸了${n}元` : '賭輸了，好在身上沒錢', { node: x.p.node });
    return true;
  },
  100: x => x.release(1),   // (kept: the user 2026-11-24)
  101: jail('hospital', 2),
  102: function* (x) {
    const qs = x.opps().filter(q => x.streets(q.id).length);
    if (!qs.length) return false;
    const q = x.pick(qs);
    yield* x.hitStreet(q, x.pick(x.streets(q.id)), 0, 3);
    return true;
  },
  103: x => x.seize(1),
  104: forcedSelf(4, 10),
  105: x => x.flag(x.houses(x.p.id, ref => ref < 4000), 5, true, false),
  106: forcedSelf(3, 10),
  107: freeOne(0, 1),
  108: function* (x) {
    // 段景住 (the user 2026-11-24: 「城裡路上有的點券和禮物箱全部被你所偷走」): each as if the drawer had stopped on it
    const g = x.g, slots = g.objects.slots;
    const ids = slots.map((o, i) => ({ o, id: i + 1 })).filter(({ o }) => [13, 14, 16, 17, 18].includes(o.type) && o.node && !o.owner && x.r.inTown(g.node(o.node)));
    if (!ids.length) return false;
    const lines: Line[] = [];
    let pts = 0, at = 0;
    const took = new Map<number, number>();
    for (const { o, id } of ids) {
      const node = o.node;
      if (o.type >= 16) {
        // roadblocks, mines and time bombs into the drawer's tools (roadblock 2, mine 3, bomb 4): up to 9 held, the
        // rest stay where they are (the user 2026-11-24: 「最大9，你只能偷滿9個，超的那個東西你偷不走」)
        const tool = o.type - 14;
        if (x.p.tools[tool - 1] >= MAX_HELD) continue;
        x.p.tools[tool - 1] += 1;
        Object.assign(o, { node: 0, life: 0, owner: 0 });
        took.set(tool, (took.get(tool) ?? 0) + 1);
        at ||= node;
      } else if (o.type === 14) {
        g.objects.remove(id);
        const n = g.hellRules() ? 100 + 10 * g.rng.below(41) : 500;
        x.p.points = (x.p.points + n) & 0xffff;
        pts += n; at ||= node;
      } else {
        const tool = yield* g.tools.receiveRandom(x.p);
        if (!tool) continue;
        g.objects.remove(id);
        lines.push({ p: x.p.id, text: `禮物箱：${toolName(tool)}` });
        at ||= node;
      }
    }
    if (pts) { lines.unshift({ p: x.p.id, text: `寶箱：${pts}點券` }); yield { t: 'points', p: x.p.id, amount: pts }; }
    for (const [tool, n] of took) lines.push({ p: x.p.id, text: `${toolName(tool)} ×${n}` });
    if (!lines.length) return false;
    yield { t: 'board' };
    yield* x.show('steal', lines, `偷走了城裡路上的東西：${lines.map(l => l.text).join('、')}`, at ? { node: at } : {});
    return true;
  },
};

/** Draws seat `seat` for p: the card shown, kept in p's 聚義廳 record, its effect in town (or 30 點券). */
export function* applyLing(g: Game, p: Player, seat: number, r: QingmingRules): Flow {
  const got = (r.ling.got[p.id] ??= []);
  if (!got.includes(seat)) got.push(seat);
  const card = LING[seat - 1];
  const text = lingText(card.text, g.priceIndex);
  yield { t: 'fx', kind: 'qm-ling', p: p.id, data: { seat, grade: gradeOf(seat), human: g.isHuman(p), text } };
  const x = new Run(g, p, r, 'qm-ling', seat, `${card.nick}${card.name}`, text);
  const ok = yield* EFFECTS[seat](x);
  if (g.over) return;
  if (!ok) yield* x.consolation();
}

// ---------------------------------------------------------------- 聚義廳

const REWARDS: Record<string, Effect> = {
  清風山夫妻: function* (x) {
    const qs = x.townOpps();
    if (!qs.length) return false;
    const lines: Line[] = [];
    for (const q of qs) { const n = yield* x.pay(q, x.p.id, x.amt(1000), '喜酒禮金'); if (n) lines.push({ p: q.id, text: '送上喜酒禮金', amount: -n }); }
    if (!lines.length) return false;
    yield* x.show('gain', lines, `收到${lines.length}份喜酒禮金`, { node: qs[0].node });
    return true;
  },
  十字坡夫妻: x => x.sleep(x.townOpps(true), 2),
  登州夫妻: x => x.rewardItems([21, 21], []),
  宋家兄弟: money(10000, '及時雨'),
  阮氏三雄: freeLots(3),
  張家兄弟: function* (x) {
    x.r.freeBoat[x.p.id] = true;
    yield* x.show('gain', [{ p: x.p.id, text: '這局坐汴河漕船全部免費' }], '潯陽江：以後坐漕船免費', { node: x.p.node });
    return true;
  },
  解家兄弟: x => x.rewardItems([], [3, 3, 3]),
  孔家兄弟: x => x.rewardItems([23], []),
  童家兄弟: x => x.rewardItems([], [5]),
  穆家兄弟: x => x.ownStreet(0, 15),
  蔡家兄弟: x => x.rewardItems([17, 21], []),
  朱家兄弟: ownUp(1, 2),
  孫家兄弟: x => x.rewardItems([12, 7], []),
  鄒家叔侄: x => x.rewardItems([], [8, 8]),
  結義兄弟: function* (x) { yield* x.r.drawLing(x.g, x.p, 'tiangang'); return true; },
  盧府主僕: x => x.rewardItems([4, 5], []),
  李家莊主僕: x => x.rewardItems([3, 3], []),
  快活林: x => x.rewardItems([13, 13], []),
  神醫獸醫: function* (x) {
    const g = x.g, bad = BAD_GODS.has(g.objects.godType(x.p)), free = !g.objects.slots[2].owner;
    if (!bad && !free) return false;
    if (bad) yield* g.objects.detachGod(x.p);
    if (free) {
      yield* x.show('blessed', [{ p: x.p.id, text: '小福神附身' }], '請來小福神', { node: g.objects.slots[2].node || x.p.node });
      yield* x.attach(x.p, 3);
    }
    return true;
  },
  桃花山: x => x.rewardItems([1], []),
  祝家莊偷雞: function* (x) {
    const qs = x.townOpps().filter(q => q.cards.length);
    if (!qs.length) return false;
    const lines = qs.map(q => ({ p: q.id, text: `被偷走${x.stealCard(q)}` }));
    yield* x.show('steal', lines, `偷到${lines.length}張卡`, { node: qs[0].node });
    return true;
  },
  芒碭山: x => x.rewardItems([10], []),
  飲馬川: x => x.rewardItems([], [6]),
  清風山: function* (x) { yield* x.r.drawLing(x.g, x.p, 'tiangang'); return true; },
  梁山元老: x => x.flag(x.houses(x.p.id, ref => ref < 4000), 15, true, false),
  少華山: function* (x) { yield* x.r.drawLing(x.g, x.p, 'tiangang'); return true; },
  黃門山: function* (x) { yield* x.r.drawLing(x.g, x.p, 'tiangang'); return true; },
  江州劫法場: function* (x) {
    yield* x.r.drawLing(x.g, x.p, 'tiangang');
    if (!x.g.over) yield* x.r.drawLing(x.g, x.p, 'tiangang');
    return true;
  },
  梁山巧匠: x => x.rewardItems([], [12, 9, 9]),
  智取生辰綱: money(20000, '智取生辰綱'),
  二龍山: x => x.rewardItems([], [13]),
  五虎將: ownUp(1, 'all'),
  八驃騎: function* (x) {
    const qs = x.townOpps().filter(q => x.houses(q.id, ref => x.hittable(ref)).length);
    if (!qs.length) return false;
    for (const q of qs) yield* x.hitOne(2, 'highest', [q]);
    return true;
  },
  水軍八頭領: x => x.upOwn(2, 'all', ref => x.bank(ref)),
  三十六天罡: function* (x) { yield* x.r.drawLing(x.g, x.p, 'legend'); if (!x.g.over) yield* x.gain(x.amt(30000), '三十六天罡'); return true; },
  七十二地煞: function* (x) { yield* x.r.drawLing(x.g, x.p, 'legend'); if (!x.g.over) yield* x.gain(x.amt(30000), '七十二地煞'); return true; },
  '一百單八將（排座次）': function* (x) {
    const hs = x.houses(x.p.id, ref => x.canUp(ref));
    if (!hs.length) return false;
    const lines = hs.map(ref => ({ p: x.p.id, text: x.up(ref, x.top(ref)) }));
    yield* x.show('price-up', lines, `排座次：${hs.length}棟房子全部蓋到頂`, { refs: hs });
    return true;
  },
};

/** 聚義廳: every completed set not yet exchanged, cashed in now (each set's reward in turn). Returns how many. */
export function* exchangeJuyi(g: Game, p: Player, r: QingmingRules): Flow<number> {
  const ready = readySets(r.ling, p.id);
  const sets = ready.map(id => JUYI_SETS.find(s => s.id === id)!);
  yield { t: 'fx', kind: 'qm-juyi', p: p.id, data: { got: [...(r.ling.got[p.id] ?? [])], ready, human: g.isHuman(p), rewards: sets.map(s => lingText(s.reward, g.priceIndex)) } };
  if (!ready.length) { yield* g.say(p.id, '聚義廳：還沒有湊齊的檔口'); return 0; }
  const done = (r.ling.done[p.id] ??= []);
  for (const s of sets) {
    if (g.over || !p.whoPlays) break;
    done.push(s.id);
    const reward = lingText(s.reward, g.priceIndex);
    yield* g.say(p.id, `聚義廳：${s.name}湊齊了！\n${reward}`);
    const x = new Run(g, p, r, 'qm-juyi', s.id, s.name, reward);
    const ok = yield* REWARDS[s.id](x);
    if (g.over) break;
    if (!ok) yield* x.consolation();
  }
  return ready.length;
}
