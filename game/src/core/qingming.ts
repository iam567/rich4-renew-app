/**
 * 清明上河's own rules (docs/rules/35-qingming.md, the user 2026-11-20/21), for a game on map 111 (the editor's format,
 * editor/maker_qingming.py; GameSettings.ruleSet 'qingming'). Two parts that no road joins: 汴京 (the city, its lots,
 * and the 出城 road out of 東水門 by 虹橋) and 梁山泊 (one ring round the 水泊, no lots: 梁山令, 點券, the 水滸 squares).
 *
 * - 汴河漕運 (four docks, the fourth outside the city since 2026-11-25): an exact stop opens the dock screen. The first 30 days of a game no boat sails (the screen
 *   says how many days are left); from day 31 the boat to 梁山 costs 2,000 × the price index (free for a player who
 *   exchanged 張家兄弟). Aboard, the player lands on 金沙灘 and walks the ring from there.
 *   At most two players are on 梁山 at a time (LS_MAX): a third finds the boat full; the 董事長 is not bound by it.
 * - 汴河漕運's 董事長 (the company of that name, the user 2026-11-24/25): anyone else stopping at its building pays the 運輸費
 *   and is shipped to 梁山 (companyShip), the 東家 there is asked and goes free; the 東家 rides free both
 *   ways, and passing a dock (open) the boatman asks 「東家，要不要小的帶您去一趟梁山？」 — yes ends the walk there and sails;
 *   everyone else's fare goes to the 東家 (to the bank when nobody runs the company).
 * - 瓦舍勾欄 (the large plots' first kind, the park's place): 長安's 博戲坊 dice hall (changan.ts diceHall), the user 2026-11-24.
 * - 金沙灘: reached on foot (any way round, a stop or passing by) the walk ends there and the boat takes the player back
 *   to the dock they boarded at, free.
 * - 景陽岡 / 野豬林 / 相撲擂台: mini-games (the human plays the screen; a computer's result is drawn by its level, fair);
 *   losing is the hospital for 3 days unless one held out (HOLD_SECS / HOLD_WRESTLE: then one stays on 梁山). 相撲擂台 won: stays there too.
 * - 十字坡: 孫二娘's 鬼手 bowls (SHELL_BOWLS): three rounds read stays on 梁山, fewer is the drugged wine, the hospital 2 days.
 *   黃泥岡: a five-reel slot 0..99,999 in cash (not × the index),
 *   then the prison for 5 days.
 * - 梁山令 / 聚義廳: core/qingming-ling.ts (the 108 cards, the sets).
 * - 貢院: 長安's examination hall with the Song banks (maps/remake/qingming/exam/tierN.json).
 * - 小事件 (27 of the 點券 squares, the user 2026-11-23): 長安's move engine (core/move-events.ts) over QM_MOVES, kept to
 *   the part one stands in: on 梁山 no 'lot' event (no lots there), the whirlwind blows within 梁山 or within the town, a
 *   swap only with a rival in the same part; a walk onto or past 金沙灘 ends there and the boat takes the player home.
 * - Where things fall: the players' first landing never on 梁山; the gods only inside the city wall; the gift boxes only
 *   outside it (the 出城 road and 梁山); the treasure chest anywhere (the user 2026-11-24: 「宝箱城里也放吧」).
 */
import { MAP_RULES, RULE_SETS, type Game, type MapRules } from './game';
import type { BoardNode } from './board';
import { ask, type Flow } from './flow';
import type { Player } from './types';
import { serial } from './date';
import { GODS } from './modules/objects';
import { diceHall, drawCnDeck, EXAM_PRIZE, EXAM_RANKS, EXAM_SECS, examHelp, examRate, examTitle } from './changan';
import { QINGMING_FATE, QINGMING_NEWS } from './qingming-events';
import { applyLing, drawSeat, exchangeJuyi, lingDaily, lingGuard, lingPayee, lingShield, lingTollFactor, newLingState, type LingState } from './qingming-ling';
import type { Facility, Land } from './board';
import { MoveEngine, type MoveArea } from './move-events';
import { QM_MOVES } from './qingming-moves';

export const QINGMING_MAP = 111;
/** The large plots' five kinds by the map's buildings (tools/tycoon-art/qingming_pieces.py FACS): 公園 旅館 購物中心 加油站 研究所. */
export const QM_FAC_NAMES = ['瓦舍勾欄', '客店', '交易市樓', '漕運處', '書院'];   // (漕運處 instead of 油炭鋪 since 2026-11-24)
/** The Song banks (docs/qingming-exam, after the cross-tier dedupe). */
export const QM_EXAM_COUNTS = [400, 300, 250, 183, 186];
export const DOCK_FARE = 2000;
/** The docks open on this day of the game (the user 2026-11-20: 「30天以後渡口才開」). */
export const DOCK_OPEN_DAY = 31;
/**
 * The boat home from 金沙灘 waits this many days after one lands on 梁山 (the user 2026-11-24: 「從渡口一出來…踩著小事件
 * 後退4步…又給我送回去了…頭3天是不會被送回去的…提示漕運3天以後再回來接你」): until then 金沙灘 is a plain square.
 */
export const LS_STAY_DAYS = 3;
/** A computer's chance to fail a mini-game by its level (簡單 中等 困難 地獄). */
// (景陽岡 is the first game on 梁山, right past the 金沙滩: gentler — the user 2026-11-24: 「上來就容易踩到打虎…電腦基本上很少能挺過那一輪」;
// it was 60 / 50 / 20 / 10 %, its hospital AI_HOSPITAL's half: TIGER_HOSPITAL)
export const TIGER_FAIL = [0.35, 0.3, 0.15, 0.08];
export const WRESTLE_FAIL = [0.6, 0.5, 0.2, 0.1];
export const BOAR_FAIL = [0.85, 0.75, 0.55, 0.35];
// (the user 2026-11-23: 打虎 5 點券 a spot; the boars 3 / 5 / 10)
/**
 * Holding out (the user 2026-11-24: 「打虎 野豬林 相撲 撐過10秒或幾個回合，輸了就不回去住院，沒撐到就還是回去住院」): a loss after
 * this many seconds (景陽岡, 野豬林) or with this much of 燕青's strength taken (相撲, whose loss always comes at the end)
 * stays on 梁山; sooner is the hospital 3 days. A computer's loss holds out one time in three (the game's own dice).
 */
export const HOLD_SECS = 10, HOLD_WRESTLE = 50;
/**
 * A computer's chance to end a 梁山 mini-game in the hospital, by its level (簡單 中等 困難 地獄), the same in all four
 * (the user 2026-11-24: 「電腦進梁山之後在小遊戲裡面太容易進醫院了」 — it was 40–70 % 簡單, 7–30 % 地獄, 十字坡 and 野豬林 the worst).
 */
export const AI_HOSPITAL = [0.3, 0.25, 0.15, 0.08];
export const TIGER_HOSPITAL = AI_HOSPITAL.map(h => h / 2);
/**
 * 十字坡's 鬼手 (the user 2026-11-24): 孫二娘 shows the one bowl without 蒙汗藥 and shuffles; five rounds of 3 … 7 bowls, ever
 * faster (gentle for three, harder from the fourth); 20 點券 a bowl read right and 20 more for all five (120); a wrong bowl
 * ends it — after three rounds read one stays on 梁山, sooner one wakes in 汴京's hospital (2 days). A computer reads a round
 * by its level, the same each of the first three rounds (so three read: 1 − AI_HOSPITAL) and 25 less from the fourth.
 */
export const SHELL_BOWLS = [3, 4, 5, 6, 7], SHELL_PER = 20, SHELL_ALL = 20, SHELL_HOLD = 3;
export const SHELL_AI = AI_HOSPITAL.map(h => Math.cbrt(1 - h));   // (≈ 89 / 91 / 95 / 97 %)
export const shellPoints = (cleared: number) => cleared * SHELL_PER + (cleared >= SHELL_BOWLS.length ? SHELL_ALL : 0);
export const TIGER_PER_HIT = 5, BOAR_FULL_BONUS = 30, WRESTLE_WIN = 100;
/** A computer's 點券 from any of the three mini-games, win or lose, by its level (the user 2026-11-23): 簡單 50–70, 中等 50–80, 困難 50–90, 地獄 60–100. */
export const AI_GAME_POINTS: [number, number][] = [[50, 70], [50, 80], [50, 90], [60, 100]];
/** A human's mini-game answer is trusted within these (疑罪從無: never more than the screen can give). */
export const TIGER_MAX_HITS = 60, BOAR_MAX_POINTS = 400;
export const SLOT_MAX = 100000;

/** The questions (human only; a computer's result is drawn here). */
export interface DockAsk { t: 'qm-dock'; p: number; open: boolean; daysLeft: number; fare: number; free: boolean; can: boolean;
  /** 汴河漕運's 董事長 (東家): free, the boatman's own words; `passing`: asked while walking by. */
  boss?: boolean; passing?: boolean; /** at one's own 漕運處 */ office?: boolean; /** 梁山 is full (LS_MAX): nothing to board; for the 董事長 a boat of their own */ full?: boolean }
/** The company whose 董事長 runs the boats. */
export const CAOYUN = '汴河漕運';
/**
 * 梁山 takes this many players at a time by boat (the user 2026-11-25: 「梁山最多只能兩個人進…漕運的董事長不受限制」); with it full
 * nobody else sails, the 董事長 is asked about a boat of their own.
 */
export const LS_MAX = 2, LS_FULL = '目前去梁山的船已滿，請稍後再去吧';
export interface TigerAsk { t: 'qm-tiger'; p: number; secs: number; per: number }
export interface BoarAsk { t: 'qm-boar'; p: number; secs: number }
/** The answer { won, points }: points the damage done to 燕青 in percent (100 when won). */
export interface WrestleAsk { t: 'qm-wrestle'; p: number }

/** The 汴京 city wall's inside in map px (cells 7.2..39.8 × 7.2..43.8, the map moved 3 rows down; CELL 48). */
const WALL = { x0: 7.2 * 48, x1: 39.8 * 48, y0: 10.2 * 48, y1: 46.8 * 48 };

export class QingmingRules implements MapRules {
  readonly facilityNames = QM_FAC_NAMES;
  /** 瓦舍勾欄 is 長安's 博戲坊 here (the user 2026-11-24): anyone else stopping bets 大 / 小 with its owner; 漕運處 (caoyunOffice). */
  *landOnFacility(g: Game, p: Player, f: Facility): Flow<boolean> {
    if (f.type === 3 && f.level >= 1 && f.owner) { yield* this.caoyunOffice(g, p, f); return true; }
    return yield* diceHall(g, p, f);
  }

  /**
   * 漕運處 (the large plots' fourth kind here, one level, the user 2026-11-24): its owner stopping there may sail to 梁山
   * free; anyone else pays the old 加油費 to the owner as 漕運費 — 500 × the dice × the index, twice that by car; on foot as
   * on a motorbike (「走路的也付，和機車汽車一樣」) — and is shipped to 梁山 willy-nilly. Back from 金沙灘 one lands on this 漕運處. No boat before day 31 (the fee still).
   */
  *caoyunOffice(g: Game, p: Player, f: Facility): Flow {
    const open = this.day() >= DOCK_OPEN_DAY, from = p.node;
    if (f.owner === p.id + 1) {
      if (!open) { if (g.isHuman(p)) yield* g.say(p.id, `漕運處：船還沒開航，還剩${DOCK_OPEN_DAY - this.day()}天`); return; }
      if (this.boatFull(g, p)) { yield* g.say(p.id, LS_FULL); return; }
      const go = g.isHuman(p)
        ? Number(yield ask({ t: 'qm-dock', p: p.id, open: true, daysLeft: 0, fare: 0, free: true, can: true, office: true, ...(this.lsFull(g, p) ? { boss: true, full: true } : {}) } as never)) === 1
        : g.rng.below(100) < 60;
      if (!go) { if (!g.isHuman(p)) yield* g.say(p.id, '漕運處：這回不去梁山了'); return; }
      yield* this.sail(g, p, from, 0, `${g.name(p.id)}坐自家漕運處的船到了梁山泊金沙灘`);
      return;
    }
    const owner = g.players[f.owner - 1];
    if (!owner || owner.bankrupt || !owner.whoPlays) return;
    const vehicle = Math.min(2, Math.max(1, p.traffic & 3));   // (on foot pays as on a motorbike)
    const amount = g.debtToll(owner, 500 * (1 << (vehicle - 1)) * g.diceTotal * g.priceIndex);
    if (amount && (yield* g.ownerCollects(owner, f.tmpState, '漕運費'))) {
      yield* g.say(undefined, `漕運處東家${g.name(owner.id)} 請付${amount}元漕運費`);
      const paid = yield* g.collect(p, owner, amount, '漕運費', true);
      if (paid) f.lastFee = yield* g.transfer(paid.payer, owner.id, paid.amount, 0, '漕運費');
    }
    if (g.over || !p.whoPlays || !open) return;
    if (this.boatFull(g, p)) { yield* g.say(p.id, LS_FULL); return; }
    yield* g.say(undefined, `${g.name(p.id)}被${g.name(owner.id)}的漕運處押上船，送去梁山`);
    yield* this.sail(g, p, from, amount, `${g.name(p.id)}被送到了梁山泊金沙灘`);
  }

  /** The boat to 金沙灘 from `from` (a dock or a 漕運處), where the boat home lands again. */
  *sail(g: Game, p: Player, from: number, fare: number, line: string): Flow {
    const land = this.nodesOf('land')[0];
    if (!land) return;
    this.boarded[p.id] = from;
    this.arrived[p.id] = this.day();
    yield { t: 'fx', kind: 'qm-sail', p: p.id, data: { from, to: land, back: false, fare } };
    this.put(g, p, land, true);
    yield { t: 'teleport', p: p.id, node: land };
    yield* g.say(p.id, line);
  }

  /** A computer building on an empty large plot here: a 漕運處 when it has none (6 in 10) or one (1 in 4); else as anywhere. */
  aiFacilityType(g: Game, p: Player): number | undefined {
    const own = g.board.facilities.filter(x => x.owner === p.id + 1 && x.type === 3 && x.level > 0).length;
    if (own >= 2) return undefined;
    return g.rng.below(100) < (own ? 25 : 60) ? 3 : undefined;
  }
  constructor(readonly g: Game) {
    // (Objects.init placed the starting gods and boxes before the rules were made: put them where this map wants them.
    // A loaded game's objects come from the save afterwards.)
    for (const o of g.objects.slots) {
      if (!o.node || o.owner || this.dropAllowed(g.node(o.node), o.type)) continue;
      o.node = 0;
      // (g.rules is not set yet, so Game.randomFreeNode would not filter: the same draw over the allowed squares here)
      const taken = new Set(g.objects.slots.filter(x => x.node).map(x => x.node));
      const ok = g.board.nodes.filter(n => !n.noDrop && !taken.has(n.id) && n.adjacent.some(Boolean) && this.dropAllowed(n, o.type));
      if (ok.length) o.node = ok[g.rng.below(ok.length)].id;
    }
  }

  /** Per player: the run of right answers at 貢院 and a computer's stops as 狀元; the dock boarded at (0: in town). */
  examRun: number[] = [];
  examTop: number[] = [];
  boarded: number[] = [];
  /** The game day each player last landed on 金沙灘 (LS_STAY_DAYS). */
  arrived: number[] = [];
  /** Forced dice (戴宗 歐鵬 王定六 白勝 宣贊): the count and the turns left. */
  forced: { n: number; turns: number }[] = [];
  /** 張家兄弟: the boat is free for the rest of the game. */
  freeBoat: boolean[] = [];
  /** The 東家 said yes passing a dock: that dock's node, the stop there sails at once (within the turn, not saved). */
  charter: number[] = [];
  ling: LingState = newLingState();

  saveState(): unknown {
    return { examRun: this.examRun, examTop: this.examTop, boarded: this.boarded, arrived: this.arrived, forced: this.forced, freeBoat: this.freeBoat, ling: this.ling };
  }
  loadState(s: unknown): void {
    const v = (s ?? {}) as Partial<{ examRun: number[]; examTop: number[]; boarded: number[]; arrived: number[]; forced: { n: number; turns: number }[]; freeBoat: boolean[]; ling: LingState }>;
    this.examRun = [...(v.examRun ?? [])]; this.examTop = [...(v.examTop ?? [])]; this.boarded = [...(v.boarded ?? [])]; this.arrived = [...(v.arrived ?? [])];
    this.forced = (v.forced ?? []).map(f => (f ? { ...f } : f)); this.freeBoat = [...(v.freeBoat ?? [])];
    this.ling = v.ling ? structuredClone(v.ling) : newLingState();
  }

  // ---------------------------------------------------------------- where things are

  private lsSet?: Set<number>;
  /** 梁山泊's squares: the part of the road 金沙灘 is on (no road joins it to the city). */
  liangshan(): Set<number> {
    if (!this.lsSet) {
      const b = this.g.board, start = this.nodesOf('land')[0];
      const seen = new Set<number>();
      if (start) {
        const q = [start];
        seen.add(start);
        while (q.length) for (const a of b.nodes[q.shift()! - 1]?.adjacent ?? []) if (a && !seen.has(a)) { seen.add(a); q.push(a); }
      }
      this.lsSet = seen;
    }
    return this.lsSet;
  }
  onLiangshan(p: Player): boolean { return this.liangshan().has(p.node); }
  /** LS_MAX others are on 梁山 already. */
  lsFull(g: Game, p: Player): boolean { return g.players.filter(q => q.id !== p.id && q.placed && q.whoPlays !== 0 && !q.bankrupt && this.onLiangshan(q)).length >= LS_MAX; }
  /** The boat is full for p (never for 汴河漕運's 董事長). */
  boatFull(g: Game, p: Player): boolean { return this.lsFull(g, p) && this.caoyunBoss(g)?.id !== p.id; }
  /** Inside the 汴京 wall (the 出城 road and 梁山 are not). */
  inCity(n: BoardNode): boolean { return n.x > WALL.x0 && n.x < WALL.x1 && n.y > WALL.y0 && n.y < WALL.y1 && !this.liangshan().has(n.id); }
  /** In 汴京 (city or the 出城 road), i.e. not on 梁山: where 「城裡」 effects of 梁山令 look. */
  inTown(n: BoardNode): boolean { return !this.liangshan().has(n.id); }
  nodesOf(kind: string): number[] {
    return Object.entries(this.g.board.specials ?? {}).filter(([, k]) => k === kind).map(([id]) => Number(id)).sort((a, b) => a - b);
  }
  /** Day of the game, 1 on the first. */
  day(): number { return serial(this.g.date) - serial(this.g.settings.startDate) + 1; }

  /** Random drops (Game.randomFreeNode): players never on 梁山, gods only in the city, gift boxes outside it, the chest anywhere. */
  dropAllowed(n: BoardNode, what: number): boolean {
    if (what === 0) return !this.liangshan().has(n.id);
    if (GODS.has(what)) return this.inCity(n);
    if (what === 13) return !this.inCity(n);
    return true;
  }

  /** Each day: a god moved out of the city (a 傳送機) goes back to a random square inside the wall. */
  daily(g: Game): void {
    for (const o of g.objects.slots) {
      if (!o.node || o.owner || !GODS.has(o.type) || this.inCity(g.node(o.node))) continue;
      o.node = 0;
      const to = g.randomFreeNode(undefined, o.type);
      if (this.inCity(to)) o.node = to.id;
    }
    lingDaily(g, this);
  }

  // ---------------------------------------------------------------- 梁山令's timed effects (core/qingming-ling.ts)

  guardPlot(_g: Game, ref: number): boolean { return lingGuard(this, ref); }
  tollPayee(g: Game, land: Land): number | undefined { return lingPayee(g, this, land); }
  tollFactor(_g: Game, land: Land): number { return lingTollFactor(this, land); }
  cardShield(_g: Game, q: Player): boolean { return lingShield(this, q); }

  // ---------------------------------------------------------------- the squares

  *landSquare(g: Game, p: Player, n: BoardNode): Flow<boolean> {
    const kind = g.board.specials?.[n.id];
    if (!kind) return false;
    switch (kind) {
      case 'boat': yield* this.dock(g, p, n); return true;
      case 'land': yield* this.sailBack(g, p); return true;
      case 'exam': yield* this.exam(g, p); return true;
      case 'ling': yield* this.drawLing(g, p, 'any'); return true;
      case 'juyi': yield* exchangeJuyi(g, p, this); return true;
      case 'tiger': yield* this.tiger(g, p); return true;
      case 'pig': yield* this.boar(g, p); return true;
      case 'wrestle': yield* this.wrestle(g, p); return true;
      case 'inn': yield* this.inn(g, p); return true;
      case 'gang': yield* this.gang(g, p); return true;
      case 'move': if (!this.mover.moving) yield* this.mover.move(g, p); return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 小事件 (core/move-events.ts)

  /** The moves kept to the part p stands in: 梁山 stays 梁山 (no lots, so no 'lot'), the town stays the town. */
  readonly moveArea: MoveArea = {
    pool: (_g, p, list) => (this.onLiangshan(p) ? list.filter(e => e.t !== 'lot') : list),
    windTo: (g, p) => {
      const ls = this.liangshan(), on = ls.has(p.node), near = g.node(p.node);
      const taken = new Set([...g.players.filter(q => q.placed).map(q => q.node), ...g.objects.slots.filter(o => o.node).map(o => o.node)]);
      const free = g.board.nodes.filter(n => !n.noDrop && !taken.has(n.id) && n.adjacent.some(Boolean) && ls.has(n.id) === on
        && g.board.specials?.[n.id] !== 'land');
      if (!free.length) return near;
      for (let tries = 0; ; tries++) {
        const n = free[g.rng.below(free.length)];
        if (Math.abs(n.x - near.x) >= 300 || Math.abs(n.y - near.y) >= 300 || tries >= 200) return n;
      }
    },
    swapOk: (_g, p, q) => this.onLiangshan(p) === this.onLiangshan(q),
  };
  readonly mover = new MoveEngine(QM_MOVES, this.moveArea, 'qingming');

  // ---------------------------------------------------------------- 清明上河's own decks (core/qingming-events.ts)
  // (Northern Song news and fate, one for one with 長安's — the user 2026-11-23: 「清明上河…命運裡面還有行人闖馬路罰款…
  // 新聞什麼都沒做」: without these the original's modern decks were drawn)
  *news(g: Game, p: Player): Flow<boolean> { return yield* drawCnDeck(g, p, QINGMING_NEWS, 'news', '汴京小報'); }
  *fate(g: Game, p: Player): Flow<boolean> { return yield* drawCnDeck(g, p, QINGMING_FATE, 'fate', '汴京小報'); }

  /** Days until the boat home comes for p (LS_STAY_DAYS after landing; 0: it is there). */
  boatWait(p: Player): number {
    const at = this.arrived[p.id];
    return at ? Math.max(0, at + LS_STAY_DAYS + 1 - this.day()) : 0;
  }

  /** 金沙灘 on foot: the walk ends there (the boat home follows as the stop) — not in one's first days there (boatWait). */
  *step(g: Game, p: Player, left: number): Flow<number> {
    if (left > 0 && g.board.specials?.[p.node] === 'land' && !this.boatWait(p)) return 0;
    // 汴河漕運's 東家 walking by an open dock: the boatman offers the trip (a 小事件's walk passes by)
    if (left > 0 && g.board.specials?.[p.node] === 'boat' && !this.mover.moving && this.day() >= DOCK_OPEN_DAY && this.caoyunBoss(g)?.id === p.id) {
      let go: boolean;
      if (g.isHuman(p)) go = Number(yield ask({ t: 'qm-dock', p: p.id, open: true, daysLeft: 0, fare: 0, free: true, can: true, boss: true, passing: true, ...(this.lsFull(g, p) ? { full: true } : {}) } as never)) === 1;
      else go = g.rng.below(100) < 50;
      if (go) { this.charter[p.id] = p.node; return 0; }
    }
    return left;
  }

  /** 汴河漕運's 董事長, alive; null when nobody runs it. */
  caoyunBoss(g: Game): Player | null {
    const c = g.board.companies.find(x => x.name === CAOYUN);
    const q = c?.controller ? g.players[c.controller - 1] : undefined;
    return q && q.whoPlays !== 0 ? q : null;
  }

  /** 梁山旗 planted on a lot (郁保四 / 侯健 / 梁山元老): the board draws the banner on it while it lasts. */
  lotFlag(ref: number): boolean { return !!this.ling.flag?.[ref]; }

  /** 官窯 sells china as the computer companies sell computers: paid at once, the dearer the longer the game (the user 2026-11-25). */
  companyFeeName(c: { name: string }): string | undefined { return c.name === '官窯' ? '瓷器錢' : undefined; }

  /**
   * 汴河漕運's building (the user 2026-11-25: 「別人停下收運輸費，然後強制運到梁山去」): anyone but its 董事長 pays the 運輸費 — the
   * petrol fee, on foot as by motorbike — into the company and is shipped to 梁山; before the boats sail (day 31) the fee only.
   */
  companyShip(g: Game, p: Player, c: { name: string }): { fee: string; go: () => Flow; boss: () => Flow } | undefined {
    if (c.name !== CAOYUN) return undefined;
    const r = this;
    return { fee: '運輸費', go: function* (): Flow {
      if (r.day() < DOCK_OPEN_DAY) return;
      if (r.boatFull(g, p)) { yield* g.say(p.id, LS_FULL); return; }
      yield* g.say(undefined, `${g.name(p.id)}被汴河漕運押上船，送去梁山`);
      yield* r.sail(g, p, p.node, 0, `${g.name(p.id)}被送到了梁山泊金沙灘`);
    },
    // (its 董事長: nothing to pay, may go — the user 2026-11-25: 「董事長停下不收費，可以選擇去不去梁山」)
    boss: function* (): Flow {
      if (r.day() < DOCK_OPEN_DAY) { if (g.isHuman(p)) yield* g.say(p.id, `汴河漕運：船還沒開航，還剩${DOCK_OPEN_DAY - r.day()}天`); return; }
      const yes = g.isHuman(p)
        ? Number(yield ask({ t: 'qm-dock', p: p.id, open: true, daysLeft: 0, fare: 0, free: true, can: true, boss: true, ...(r.lsFull(g, p) ? { full: true } : {}) } as never)) === 1
        : g.rng.below(100) < 50;
      if (yes) yield* r.sail(g, p, p.node, 0, `${g.name(p.id)}坐自家漕船到了梁山泊金沙灘`);
    } };
  }

  /**
   * Forced dice: that many dice whatever the vehicle, for the turns given (a new card starts its own count). A 遙控骰子
   * wins over them (the user 2026-11-23: 「遙控骰子最大，改過所有的強制骰子」): that turn the remote die goes and the
   * forced turn is not used up.
   */
  *rollDice(g: Game, p: Player): Flow<number[] | undefined> {
    const f = this.forced[p.id];
    if (!f || f.turns <= 0) return undefined;
    f.turns -= 1;
    const values = Array.from({ length: f.n }, () => g.rng.rand() % 6 + 1);
    if (f.turns <= 0) delete this.forced[p.id];
    return values;
  }

  // ---------------------------------------------------------------- 汴河漕運

  *dock(g: Game, p: Player, n: BoardNode): Flow {
    const day = this.day(), open = day >= DOCK_OPEN_DAY, boss = this.caoyunBoss(g), isBoss = boss?.id === p.id;
    const free = !!this.freeBoat[p.id] || isBoss;
    const fare = free ? 0 : DOCK_FARE * g.priceIndex, can = p.cash >= fare;
    const chartered = this.charter[p.id] === n.id, full = open && this.lsFull(g, p);
    delete this.charter[p.id];
    let go = false;
    if (chartered && open) go = true;
    else if (full && !isBoss) {
      if (g.isHuman(p)) yield ask({ t: 'qm-dock', p: p.id, open, daysLeft: 0, fare, free, can: false, full: true } as never);
      else yield* g.say(p.id, LS_FULL);
    } else if (g.isHuman(p)) {
      const a = yield ask({ t: 'qm-dock', p: p.id, open, daysLeft: Math.max(0, DOCK_OPEN_DAY - day), fare, free, can, ...(isBoss ? { boss: true } : {}), ...(full ? { full: true } : {}) } as never);
      go = open && can && Number(a) === 1;
    } else if (open && can) {
      // a computer goes when it can spare the fare and still build in town (or when it has a set to cash in)
      const spare = p.cash >= fare + 8000 * g.priceIndex;
      go = (spare && g.rng.below(100) < 60) || (free && g.rng.below(100) < 70);
      if (!go) yield* g.say(p.id, '漕船：這回不去梁山了');
    }
    if (!go) return;
    if (fare) {
      // the fare to 汴河漕運's 東家 (the bank when nobody runs it)
      const to = boss && !isBoss ? boss.id : -1;
      yield* g.transfer(p.id, to, fare, to >= 0 ? 1 : 0, '漕船船錢', true);
      if (to >= 0) yield* g.say(undefined, `船錢${fare}元歸漕運東家${g.name(to)}`);
      if (g.over || !p.whoPlays) return;
    }
    yield* this.sail(g, p, n.id, fare, `${g.name(p.id)}坐漕船到了梁山泊金沙灘`);
  }

  /** Back from 金沙灘 to where one boarded (a dock or a 漕運處; the first dock when unknown), free. */
  *sailBack(g: Game, p: Player): Flow {
    const wait = this.boatWait(p);
    if (wait) { yield* g.say(p.id, `漕船剛走，${wait}天後再回金沙灘接人`); return; }
    const docks = this.nodesOf('boat'), was = this.boarded[p.id];
    const to = was && g.board.nodes.some(n => n.id === was) && !this.liangshan().has(was) ? was : docks[0];
    if (!to) return;
    delete this.boarded[p.id];
    yield { t: 'fx', kind: 'qm-sail', p: p.id, data: { from: p.node, to, back: true, fare: 0 } };
    this.put(g, p, to, false);
    yield { t: 'teleport', p: p.id, node: to };
    yield* g.say(p.id, `${g.name(p.id)}從金沙灘坐船回到汴京`);
  }

  /** Puts p on node `id`, facing on: on 金沙灘 the way round the ring (towards 梁山令 first), elsewhere either way. */
  put(g: Game, p: Player, id: number, ring: boolean) {
    const n = g.node(id), ways = n.adjacent.filter(Boolean);
    // on 金沙灘: come from the lower neighbour so the walk goes on up the west side (lay() put 梁山令 next)
    const from = ring ? ways.slice().sort((a, b) => g.node(b).y - g.node(a).y)[0] : ways[0];
    p.node = id; p.lastNode = from ?? id;
  }

  // ---------------------------------------------------------------- 貢院 (長安's hall, the Song banks)

  *exam(g: Game, p: Player): Flow {
    const run = this.examRun[p.id] ?? 0, tier = Math.min(run + 1, 5);
    const q = g.rng.below(QM_EXAM_COUNTS[tier - 1]);
    const order = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = g.rng.below(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const prize = Math.round(EXAM_PRIZE[tier - 1] * (1 + (g.priceIndex - 1) / 2));
    let right: boolean;
    const help = examHelp(g, p);
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'cn-exam', p: p.id, tier, q, order, secs: EXAM_SECS[tier - 1], run, prize, set: 'qingming', ...help } as never)) as unknown;
      right = a === 0;
    } else {
      right = g.rng.below(1000) < Math.round(examRate(tier, this.examTop[p.id] ?? 0, g.aiLevel(p), help.off.length) * 1000);
      if (tier === 5) this.examTop[p.id] = (this.examTop[p.id] ?? 0) + 1;
    }
    const was = examTitle(run), now = right ? run + 1 : 0, top = now - 5;
    const scene = right
      ? (tier < 5 ? ['rank-0-commoner', 'rank-1-jinshi', 'rank-2-tanhua', 'rank-3-bangyan'][tier - 1] : top === 5 ? 'rank-5-yanta' : top === 10 ? 'rank-7-feast' : 'rank-4-zhuangyuan')
      : run >= 2 ? ['demote-1-jinshi', 'demote-2-tanhua', 'demote-3-bangyan', 'demote-4-zhuangyuan'][Math.min(run, 5) - 2] : 'rank-6-fail';
    this.examRun[p.id] = now;
    if (!right) this.examTop[p.id] = 0;
    yield { t: 'fx', kind: 'cn-exam-result', p: p.id, data: { right, tier, q, order, run: now, prize: right ? prize : 0, was, title: examTitle(now), scene, human: g.isHuman(p), set: 'qingming' } };
    if (right) {
      yield* g.say(undefined, `${g.name(p.id)}在貢院答對了！\n${tier === 1 ? '' : `升為${EXAM_RANKS[tier - 1]}　`}獲得${prize}元`, `${g.name(p.id)}在貢院答對${EXAM_RANKS[tier - 1]}題，獲得${prize}元`);
      g.gain(p, prize, 1);
    } else yield* g.say(undefined, run >= 2 ? `${g.name(p.id)}落第了…\n${was}打回平民` : `${g.name(p.id)}答錯了…`, `${g.name(p.id)}在貢院答錯，${run >= 2 ? `${was}打回平民` : '沒有獎金'}`);
  }

  // ---------------------------------------------------------------- 梁山令

  *drawLing(g: Game, p: Player, pool: 'any' | 'tiangang' | 'legend'): Flow {
    const seat = drawSeat(g, pool, new Set(this.ling.got?.[p.id] ?? []));
    yield* applyLing(g, p, seat, this);
  }

  // ---------------------------------------------------------------- the 水滸 squares

  /** A computer's 點券 from a mini-game (AI_GAME_POINTS by its level). */
  private aiPoints(g: Game, p: Player): number {
    const [lo, hi] = AI_GAME_POINTS[g.aiLevel(p)];
    return lo + g.rng.below(hi - lo + 1);
  }

  /** The level's chance (a computer: its own; never a human's). */
  private fails(g: Game, p: Player, table: number[]): boolean {
    return g.rng.below(1000) < Math.round(table[g.aiLevel(p)] * 1000);
  }

  /** A computer's lost game held out (HOLD_SECS): so that the hospital comes AI_HOSPITAL of the time over all its games. */
  private aiHeld(g: Game, p: Player, fail: number[], hospital = AI_HOSPITAL): boolean {
    const lv = g.aiLevel(p), sent = Math.min(1, hospital[lv] / fail[lv]);
    return g.rng.below(1000) >= Math.round(sent * 1000);
  }
  /** The seconds a human's lost game lasted (the screen's answer; none: not held). */
  private lasted(a: { lasted?: number } | null): number { return Math.max(0, Math.min(15, Number(a?.lasted) || 0)); }

  /** 景陽岡: 5 點券 a red spot hit; a miss ends it (the points kept): after HOLD_SECS one stays on 梁山, sooner the hospital 3 days. */
  *tiger(g: Game, p: Player): Flow {
    let full: boolean, pts: number, held: boolean;
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'qm-tiger', p: p.id, secs: 15, per: TIGER_PER_HIT } as never)) as { hits?: number; full?: boolean; lasted?: number } | null;
      full = !!a?.full;
      held = full || this.lasted(a) >= HOLD_SECS;
      pts = Math.max(0, Math.min(TIGER_MAX_HITS, Math.floor(Number(a?.hits) || 0))) * TIGER_PER_HIT;
      yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'tiger', ok: full, held, points: pts, human: true } };   // (派對: the others see it)
    } else {
      full = !this.fails(g, p, TIGER_FAIL);
      held = full || this.aiHeld(g, p, TIGER_FAIL, TIGER_HOSPITAL);
      pts = this.aiPoints(g, p);
      yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'tiger', ok: full, held, points: pts } };
    }
    if (pts) { p.points += pts; yield { t: 'points', p: p.id, amount: pts }; }
    if (full) { yield* g.say(p.id, `${g.name(p.id)}打虎撐滿了！得${pts}點券`); return; }
    if (held) { yield* g.say(p.id, `被老虎撲倒了…撐得夠久，得${pts}點券，爬起來接著走`); return; }
    yield* g.say(p.id, `被老虎撲倒了…得${pts}點券`);
    yield* g.sendTo(p, 'hospital', 3);
  }

  /** 野豬林: 點券 for the boars shot; one through the line ends it — after HOLD_SECS one stays, sooner the hospital 3 days; 15 seconds stays and +30. */
  *boar(g: Game, p: Player): Flow {
    let full: boolean, pts: number, held: boolean;
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'qm-boar', p: p.id, secs: 15 } as never)) as { points?: number; full?: boolean; lasted?: number } | null;
      full = !!a?.full;
      held = full || this.lasted(a) >= HOLD_SECS;
      pts = Math.max(0, Math.min(BOAR_MAX_POINTS, Math.floor(Number(a?.points) || 0)));
      yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'boar', ok: full, held, points: pts + (full ? BOAR_FULL_BONUS : 0), human: true } };
    } else {
      full = !this.fails(g, p, BOAR_FAIL);
      held = full || this.aiHeld(g, p, BOAR_FAIL);
      pts = this.aiPoints(g, p);
      yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'boar', ok: full, held, points: pts } };
    }
    if (full && g.isHuman(p)) pts += BOAR_FULL_BONUS;   // (a computer's range is all it gets)
    if (pts) { p.points += pts; yield { t: 'points', p: p.id, amount: pts }; }
    if (full) { yield* g.say(p.id, `${g.name(p.id)}守住了野豬林！得${pts}點券`); return; }
    if (held) { yield* g.say(p.id, `被野豬頂翻了…撐得夠久，得${pts}點券，爬起來接著走`); return; }
    yield* g.say(p.id, `被野豬頂翻了…得${pts}點券`);
    yield* g.sendTo(p, 'hospital', 3);
  }

  /**
   * 相撲擂台: 點券 for the damage done to 燕青, 1 a percent (flooring him is 100; kept win or lose — the user 2026-11-23:
   * 「不管中途輸贏都有點券到賬」); won, any square of the ring (landed on as a stop); lost, the hospital 3 days.
   */
  *wrestle(g: Game, p: Player): Flow {
    let won: boolean, pts: number, held: boolean;
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'qm-wrestle', p: p.id } as never)) as { won?: boolean; points?: number } | null;
      won = !!a?.won;
      pts = won ? WRESTLE_WIN : Math.max(0, Math.min(WRESTLE_WIN - 1, Math.floor(Number(a?.points) || 0)));
      held = won || pts >= HOLD_WRESTLE;
      yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'wrestle', ok: won, held, points: pts, human: true } };
    } else {
      won = !this.fails(g, p, WRESTLE_FAIL);
      held = won || this.aiHeld(g, p, WRESTLE_FAIL);
      pts = this.aiPoints(g, p);
      yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'wrestle', ok: won, held, points: pts } };
    }
    if (pts) { p.points += pts; yield { t: 'points', p: p.id, amount: pts }; }
    if (!won && held) { yield* g.say(p.id, `被燕青摔下擂台…打得不錯，得${pts}點券，爬起來接著走`); return; }
    if (!won) { yield* g.say(p.id, `被燕青摔下擂台…得${pts}點券`); yield* g.sendTo(p, 'hospital', 3); return; }
    // (won: stays on the ring's square, as after a loss held out — the user 2026-11-25: 「不管輸贏…不要亂扔」)
    yield* g.say(p.id, `${g.name(p.id)}打贏了燕青！得${pts}點券`);
  }

  /** 十字坡: 孫二娘's 鬼手 bowls (SHELL_*): 20 點券 a round read; three read stays, fewer wakes in town — the hospital 2 days. */
  *inn(g: Game, p: Player): Flow {
    const rounds = SHELL_BOWLS.length;
    let cleared = 0;
    if (g.isHuman(p)) {
      const a = (yield ask({ t: 'qm-shell', p: p.id, bowls: SHELL_BOWLS, per: SHELL_PER, all: SHELL_ALL, hold: SHELL_HOLD } as never)) as { cleared?: number } | null;
      cleared = Math.max(0, Math.min(rounds, Math.floor(Number(a?.cleared) || 0)));
    } else {
      const base = SHELL_AI[g.aiLevel(p)] ?? SHELL_AI[1];
      while (cleared < rounds && g.rng.below(1000) < Math.round((base - (cleared >= 3 ? 0.25 : 0)) * 1000)) cleared += 1;
    }
    const pts = shellPoints(cleared), held = cleared >= SHELL_HOLD;
    yield { t: 'fx', kind: 'qm-game-result', p: p.id, data: { game: 'inn', ok: cleared >= rounds, held, points: pts, cleared, ...(g.isHuman(p) ? { human: true } : {}) } };
    if (pts) { p.points += pts; yield { t: 'points', p: p.id, amount: pts }; }
    if (cleared >= rounds) { yield* g.say(p.id, `${g.name(p.id)}識破了孫二娘的鬼手，五碗全中！得${pts}點券`); return; }
    if (held) { yield* g.say(p.id, `喝到第${cleared + 1}碗才中了蒙汗藥…撐過三局，得${pts}點券，人還在梁山`); return; }
    yield* g.say(p.id, `喝了孫二娘的蒙汗酒…${pts ? `得${pts}點券，` : ''}醒來已在汴京`);
    yield* g.sendTo(p, 'hospital', 2);
  }

  /** 黃泥岡: 智取生辰綱 — five reels 0..99,999 in cash (not × the index), then the 開封府 for 5 days (免罪卡 / 嫁禍卡 apply). */
  *gang(g: Game, p: Player): Flow {
    const value = g.rng.below(SLOT_MAX);
    yield { t: 'fx', kind: 'qm-slot', p: p.id, data: { value, human: g.isHuman(p) } };
    if (value) g.gain(p, value, 1);
    yield* g.say(undefined, `${g.name(p.id)}劫了生辰綱 ${value}元！\n官府來拿人了`, `${g.name(p.id)}在黃泥岡劫得生辰綱${value}元，官府來拿人`);
    // 免罪卡 lets one off, 嫁禍卡 sends someone else to the 開封府 — either way one stays on 梁山 (the user 2026-11-24)
    const target = yield* g.cards.pardonOrFrame(p, false, 'prison');
    if (target < 0) { yield* g.say(p.id, `${g.name(p.id)}用免罪卡躲過官府，留在梁山`); return; }
    if (g.over) return;
    if (target !== p.id) yield* g.say(p.id, `${g.name(p.id)}用嫁禍卡，${g.name(target)}替罪進了開封府`);
    yield* g.sendTo(g.players[target], 'prison', 5);
  }
}


MAP_RULES[QINGMING_MAP] = g => new QingmingRules(g);
RULE_SETS.qingming = g => new QingmingRules(g);
