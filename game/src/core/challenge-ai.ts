/**
 * 挑戰模式's computer (docs/rules/26 §5): the smarter computer at 困難 (core/smart-ai.ts) with the stars in its sums. It
 * does not try to bankrupt anyone; a star still to earn is worth money in its valuations, so it
 *  - walks to the squares its tasks want (the kinds of square not yet seen this round, the places of its tours and
 *    named stops, the fate / news / magic squares while those tasks are open),
 *  - plays the cards and tools its tasks count (梦游卡 for 借刀殺人 …), more readily than for money alone,
 *  - buys the streets and plots its tasks name and builds the facility types they want.
 * It sees what any player sees (the board, its hand, the task list); never the dice or the decks (fair randomness).
 */
import type { Challenge, ChallengeTask } from './challenge';
import { fullStars } from './challenge';
import type { Flow } from './flow';
import type { Game } from './game';
import type { Player } from './types';

/** Task → the card ids it counts as used by the player (docs/rules/26-challenge-tasks.md). */
const CARD_TASKS: Record<number, string[]> = {
  1: ['G53'], 2: ['G54'], 3: ['G57'], 4: ['S14'], 6: ['W14'], 7: ['D19', 'O15'], 9: ['J11'], 11: ['D06'], 12: ['S18'],
  13: ['G55', 'D07', 'G25'], 15: ['W17', 'D15'], 16: ['W12'], 17: ['G49', 'W12'], 22: ['G44'], 23: ['G45'], 24: ['U10'],
  28: ['G56'], 29: ['G68', 'O07'], 30: ['N19'], 38: ['B12'],
};
/** Task → the tool ids it counts. */
const TOOL_TASKS: Record<number, string[]> = {
  1: ['G60'], 2: ['U15'], 3: ['G58', 'Z08'], 4: ['G59', 'G13'], 7: ['G12', 'G03'], 8: ['W15', 'Z10'], 9: ['J17', 'K13', 'P16', 'Q08', 'N12'],
  11: ['G62', 'U12'], 12: ['J17', 'K13', 'P16', 'Q08', 'N12'], 13: ['U09', 'G12', 'G03'], 18: ['B14'],
};
/** Square events (01 §7.2) → the tasks that want a stop there. */
const EVENT_TASKS: Record<number, string[]> = {
  2: ['G28', 'G29', 'G30', 'G34', 'G16', 'R13'], 3: ['G22', 'G24', 'G25', 'G26', 'G27', 'G67', 'G69', 'T11', 'C11', 'T16', 'C17', 'P19', 'S09', 'Z15', 'R12'],
  4: ['G61'], 5: ['G61'], 6: ['G64', 'R09', 'R10'], 7: ['G64', 'R10'], 8: ['G64', 'R10'], 9: ['G09'], 10: ['R19'], 13: ['R20'], 15: ['R08'], 16: ['G10', 'R11'],
};

/** What a star is worth in its money sums (× price index). */
const STAR = 15000;

export class ChallengeAi {
  /** `tasks`: the game's drawn tasks (default the tracker's; a simulation may track the whole pool). */
  constructor(private readonly g: Game, private readonly c: Challenge, private readonly tasks: ChallengeTask[] = c.tasks) {}

  private drawn(id: string): ChallengeTask | undefined { return this.tasks.find(t => t.id === id); }

  /** Stars still to earn on task `id` for p (0 when not drawn or full). */
  open(p: Player, id: string): number {
    const t = this.drawn(id);
    if (!t) return 0;
    const best = this.c.own[p.id].best[t.id] ?? 0;
    const full = fullStars(t);
    if (t.once) return best >= 1 ? 0 : full;
    const got = t.need.filter(n => best >= (n < 0 ? Infinity : n)).length;
    return full - got;
  }

  /** The money value of doing one more of what task `id` counts: a star spread over what is still needed for it. */
  private worth(p: Player, id: string): number {
    const t = this.drawn(id), left = this.open(p, id);
    if (!t || !left) return 0;
    const PI = this.g.priceIndex;
    if (t.once) return STAR * PI * t.stars;
    const best = this.c.own[p.id].best[t.id] ?? 0;
    const next = t.need.find(n => n >= 0 && best < n) ?? 1;
    return (STAR * PI) / Math.max(1, next - best);
  }

  private sum(p: Player, ids: string[] | undefined): number { return (ids ?? []).reduce((v, id) => v + this.worth(p, id), 0); }

  cardBonus(p: Player, id: number): number {
    let v = this.sum(p, CARD_TASKS[id]);
    // 購地卡 / 換地卡 on the lot under its feet when a task names that street or plot.
    if ((id === 3 || id === 4) && this.wantsPlace(p, this.c.placeName(p.node))) v += STAR * this.g.priceIndex;
    return v;
  }
  toolBonus(p: Player, id: number): number { return this.sum(p, TOOL_TASKS[id]); }

  /** The value of stopping on `node` for p's open tasks. */
  stopBonus(p: Player, node: number): number {
    const g = this.g, n = g.node(node), PI = g.priceIndex;
    if (!n) return 0;
    let v = 0;
    const o = this.c.own[p.id];
    // 全圖打卡 (G06): a kind of square not yet seen this round.
    if (n.event > 1 && this.open(p, 'G06') && !o.n[`ev:${n.event}`]) v += STAR * PI;
    v += this.sum(p, EVENT_TASKS[n.event]) * 0.3;
    const name = this.c.placeName(node);
    if (name) {
      // Tours and named stops: a place not yet stopped at.
      for (const t of this.tasks) {
        const places = TOUR_PLACES[t.id];
        if (places?.includes(name) && this.open(p, t.id) && !o.n[`stop:${name}`]) v += (STAR * PI) / places.length * 2;
      }
      for (const id of NAMED_STOPS[name] ?? []) v += this.worth(p, id) * 0.5;
      // Rivals' hotels / malls when a task wants the stay or the spin there.
      const f = this.c.facilityAt(node);
      if (f && f.owner && f.owner !== p.id + 1) {
        if (f.type === 1) v += this.sum(p, ['G63', ...(STAY_AT[f.name] ?? [])]) * 0.5;
        if (f.type === 2) v += this.sum(p, ['S06']) * 0.5;
      }
    }
    return v;
  }

  /** Shop wishes (kind, id, how many to hold) for the open tasks: kinds not yet held for 集卡狂 / 百寶袋, the counted ones. */
  shopWishes(p: Player): ['card' | 'tool', number, number][] {
    const out: ['card' | 'tool', number, number][] = [];
    for (const [id, tasks] of Object.entries(TOOL_TASKS)) if (tasks.some(t => this.open(p, t))) out.push(['tool', Number(id), 2]);
    for (const [id, tasks] of Object.entries(CARD_TASKS)) if (tasks.some(t => this.open(p, t))) out.push(['card', Number(id), 1]);
    if (this.open(p, 'G08')) for (let id = 1; id <= 12; id++) if (!p.tools[id - 1]) out.push(['tool', id, 1]);
    if (this.open(p, 'G07')) for (let id = 1; id <= 30; id++) if (!p.cards.includes(id)) out.push(['card', id, 1]);
    return out;
  }

  /** Shares toward an open 董事長 task: enough of the company's stock to hold the most (from the deposit, as anyone). */
  *shares(p: Player): Flow {
    const g = this.g, st = g.stocks;
    for (const [id, names] of Object.entries(CHAIR_TASKS)) {
      if (!this.open(p, id)) continue;
      for (const c of g.board.companies) {
        if (!(names.length === 0 || names.includes(c.name)) || c.controller === p.id + 1 || c.stockSlot >= 12) continue;
        const slot = c.stockSlot, s = st.stocks[slot];
        if (!s || s.price <= 0) continue;
        const mine = st.holdings[p.id][slot]?.shares ?? 0;
        const top = Math.max(0, ...g.players.filter(q => q.id !== p.id).map(q => st.holdings[q.id][slot]?.shares ?? 0));
        const need = top - mine + 1;
        if (need > 0 && need * s.price <= p.bank * 0.6) { yield* st.trade(p, slot, true, need); return; }
      }
    }
  }

  /** Buy a lot / plot a task names (even below the usual money margin)? */
  wantsPlace(p: Player, name: string): boolean {
    for (const t of this.tasks) if (PLACE_TASKS[t.id]?.includes(name) && this.open(p, t.id)) return true;
    return false;
  }

  /** The facility type an open task wants on plot `name` (undefined: the usual choice). */
  facilityType(p: Player, name: string): number | undefined {
    for (const [id, want] of Object.entries(FAC_WANT)) {
      if (!this.open(p, id)) continue;
      if (want.names && !want.names.includes(name)) continue;
      return want.type;
    }
    return undefined;
  }
}

/** 董事長 tasks: task → its companies ([] any company). */
const CHAIR_TASKS: Record<string, string[]> = {
  T12: ['大宇百貨'], C10: ['中國石油'], J07: ['ＳＥＧＡ'], W06: ['逍遙客棧'], Z19: ['宇宙百貨'], D13: ['飛龍百貨'], S16: ['狂徒大飯店'], K12: ['ＳＥＧＡ'], O08: ['卡普空'],
  O13: ['阪急百貨'], P05: ['哈德森'], P15: ['丸井今井'], Q07: ['ＬＥＶＥＬ５'], Q12: ['岩田屋'], N15: ['ＯＣＣ'], N20: ['琉貿百貨'],
  W01: ['蜀山派', '武當派', '嵩山派', '恆山派', '泰山派', '衡山派', '少林派', '華山派'], S01: ['狂徒大飯店', '豪華大飯店', '金金大飯店', '第一大飯店', '世界大飯店'], G33: [], R17: [],
};

/** Tours: task → its places (as the measures in challenge.ts). */
const TOUR_PLACES: Record<string, string[]> = {
  T20: ['台北市', '桃園市', '新竹市', '台中市', '彰化市', '台南市', '高雄市', '屏東市', '台東縣', '花蓮縣', '花蓮市', '太魯閣', '宜蘭市'],
  Z01: ['魔羯座區', '獅子座區', '雙子座區', '水瓶座區', '白羊座區', '天秤座區', '巨蟹座區', '射手座區', '雙魚座區', '金牛座區', '處女座區', '天蠍座區'],
  D01: ['凸頭龍區', '腕龍區', '角蓋龍區', '火山區', '暴爪龍區', '迅猛龍區', '三觭龍區', '劍龍區'],
  K01: ['上野', '池袋', '新宿', '澀谷', '品川'], O01: ['道頓堀', '黑門市場', '新世界', '鶴橋'], O19: ['京橋', '天王寺', '梅田', '難波'],
};
/** A named place → tasks counting a stop there (in some state the measure checks). */
const NAMED_STOPS: Record<string, string[]> = {
  成都: ['C12'], 宮島: ['J10'], 水星區: ['Z05'], 射手座區: ['Z10'], 花園: ['B20'], 國際通: ['N18'], 大通西: ['P01'], 大通東: ['P01'], 澀谷: ['K05'], 華山派: ['W04'],
  紐約: ['U01'], 洛杉磯: ['U01'],
};
/** A hotel's name → the tasks counting a stay there. */
const STAY_AT: Record<string, string[]> = { 墾丁: ['T07'] };
/** Tasks that want lots / plots by name (streets of street tasks, plots of plot tasks). */
const PLACE_TASKS: Record<string, string[]> = {
  T02: ['台北市'], T03: ['桃園市', '新竹市', '台中市', '彰化市', '台南市'], T04: ['宜蘭市', '花蓮縣', '台東縣'], T05: ['高雄市'], T06: ['知本'], T08: ['基隆市'], T09: ['花蓮市'],
  C02: ['北京', '天津', '承德'], C03: ['成都', '重慶'], C04: ['桂林'], C05: ['歸綏', '銀川', '蘭州'], C07: ['康定'], C08: ['上海'], C09: ['武漢'], C19: ['昆明'],
  J02: ['盛岡', '仙台', '福島', '秋田'], J03: ['京都', '大阪', '神戶'], J04: ['姬路'], J05: ['青森'], J06: ['廣島'],
  U02: ['波士頓', '紐約', '華盛頓'], U03: ['西雅圖', '洛杉磯', '聖地牙哥'], U04: ['拉斯維加斯'], U05: ['奧蘭度'], U06: ['邁阿密'], U07: ['鳳凰城'], U14: ['華盛頓'], U18: ['新紐奧良'],
  Z13: ['獅子座區'], Z04: ['地球區'], W02: ['嵩山派', '恆山派', '泰山派', '衡山派', '華山派'], W10: ['長安城'],
  S02: ['新香港', '北澳門', '新東京都', '小巴黎', '小紐約', '上海街'], S03: ['凱薩大道', '陽光大道', '日落大道', '狂徒大道'], S10: ['千禧城'], S11: ['北海岸', '東北角', '南灣道', '南海街', '珊瑚城'], S12: ['星月城', '流星城'],
  K04: ['歌舞伎町'], K09: ['阿美橫町', '淺草雷門通', '押上', '兩國國技館通'], K18: ['表參道', '惠比壽', '道玄坡'],
  O04: ['黑門市場', '鶴橋', '新世界'], O11: ['心齋橋筋'], P03: ['狸小路'], P14: ['豐平', '平岸', '月寒'], P18: ['藻岩山麓'],
  Q02: ['別府溫泉', '黑川溫泉', '由布院', '嬉野'], Q15: ['荷蘭風車村'], Q19: ['有田', '唐津', '嬉野'],
  N01: ['國際通'], N04: ['古宇利島', '伊江島', '瀨底島', '慶良間'], N05: ['那霸新都心', '美國村', '瀨底島', '慶良間'], N09: ['首里', '南城', '壺屋'],
  B19: ['黃金街'],
};
/** Tasks that want a facility type (on named plots, or any). Types: 0 公園, 1 旅館, 2 購物中心, 3 加油站, 4 研究所. */
const FAC_WANT: Record<string, { type: number; names?: string[] }> = {
  T06: { type: 1, names: ['知本'] }, T08: { type: 2, names: ['基隆市'] }, T09: { type: 3, names: ['花蓮市'] }, C07: { type: 1, names: ['康定'] }, C08: { type: 2, names: ['上海'] },
  J05: { type: 1, names: ['青森'] }, J06: { type: 4, names: ['廣島'] }, U04: { type: 2, names: ['拉斯維加斯'] }, U05: { type: 2, names: ['奧蘭度'] }, U06: { type: 1, names: ['邁阿密'] },
  U07: { type: 3, names: ['鳳凰城'] }, W10: { type: 2, names: ['長安城'] }, S12: { type: 1, names: ['星月城', '流星城'] }, P18: { type: 1, names: ['藻岩山麓'] },
  Q15: { type: 0, names: ['荷蘭風車村'] }, N05: { type: 1, names: ['那霸新都心', '美國村', '瀨底島', '慶良間'] },
  D05: { type: 0 }, S08: { type: 0 }, S05: { type: 3 }, S07: { type: 4 }, U11: { type: 4 }, R15: { type: 1 }, R16: { type: 2 },
};
