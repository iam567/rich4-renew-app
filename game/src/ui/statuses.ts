/**
 * 狀態條's list (the user 2026-11-23: 「錢夫人坐牢還剩5天……股票休市還剩2天，銀行拒絕往來還剩幾天……外星人綁架消失還剩幾天，
 * 住宿還剩幾天」): every timed state running in a game, read from the rules' own counters — display only, nothing here
 * writes to the game (ui/status-strip.ts shows them).
 *
 * The days: the original's 0x80 counters (core/game.ts tick) say 「還剩(n & 0x7f) + 1天」 at the player's turn start
 * (playerTurn's 「坐牢中……還剩3天！」); before that turn start comes, a counter just set (坐牢3天 → 3) has one day fewer
 * in that sum. So each counter is remembered (StatusMemo): one seen falling has been counted down since it was set and
 * reads as the notice did (+1); one just set or raised reads as set. 住宿 always reads +1 (the day it starts is a day of
 * the stay: 「住宿3天」 stores 2). The rest count plain days left (gods, 工程車, a street's 漲價 / 查封, the maps' news).
 */
import type { Game } from '../core/game';
import { OBJECT_NAMES, OBJ } from '../core/modules/objects';
import { daysBetween } from '../core/date';
import { JiqingRules } from '../core/jiqing';
import { KabukichoRules } from '../core/kabukicho';
import { QingmingRules, DOCK_OPEN_DAY } from '../core/qingming';
import { shopNameFor } from '../core/modules/kb-data';

export interface TimedStatus {
  /** Stable id (the strip keeps its place in the rotation by it). */
  key: string;
  /** Player it is about (colour / portrait), none for a game-wide one. */
  p?: number;
  /** 「錢夫人 坐牢」, 「股市 休市」. */
  text: string;
  /** What is left, in `unit`s (≥ 1). */
  left: number;
  unit: '天' | '步' | '回合';
}

/** Which of the 0x80 counters have been counted down since they were set (see the header). */
export class StatusMemo {
  private seen = new Map<string, { v: number; m: number; down: boolean }>();
  /** Looked once already: a counter that turns up from now on was just set. */
  private primed = false;
  /** True when the counter `key` (raw value v, size m) has ticked since it was set; `guess` for one there at the first look. */
  down(key: string, v: number, m: number, guess: boolean): boolean {
    const o = this.seen.get(key);
    const down = !o ? !this.primed && guess : o.v === v ? o.down : m < o.m;
    this.seen.set(key, { v, m, down });
    return down;
  }
  /** Forgets the counters not seen this time (ended). */
  keep(keys: Set<string>): void {
    for (const k of this.seen.keys()) if (!keys.has(k)) this.seen.delete(k);
    this.primed = true;
  }
}
/** Size of a 0x80 counter: 0x80 (ends at the next count) is less than 1. */
const size = (c: number) => (c & 0x80 ? 0.5 : c & 0x7f);

const MOD_NAMES: Record<string, string> = {
  // 激情歲月 (core/jiqing.ts runNews)
  nixon: '尼克松訪華 招待所收費×2', opera: '樣板戲匯演 宣傳站罰款×2', dazibao: '大字報 過路費減半', chuanlian: '大串聯 招待所免費',
  supply: '供銷社到貨 消費×2',
  // 歌舞伎町 (core/kabukicho.ts runNews)
  matsuri: '夜祭 居酒屋收費×2', newmachine: '柏青哥新機 易中獎', setting6: '拉霸設定6 易中BIG', typhoon: '颱風 店收費減半',
  tourists: '觀光客 過路費×1.5', valentine: '情人節 情人酒店×2', taxistrike: '計程車罷工 只擲1顆骰子', blackout: '節電令 過路費減半',
  exchange: '景品七折', hostweek: '陪酒店週年慶 女客免費',
};

/** Every timed state running in `g` now (players in seat order, then the game-wide ones). */
export function timedStatuses(g: Game, memo: StatusMemo = new StatusMemo()): TimedStatus[] {
  const out: TimedStatus[] = [];
  const keys = new Set<string>();
  const add = (s: TimedStatus) => { if (s.left > 0) out.push(s); };
  /** A 0x80 counter's days (see the header); `guess`: whether it has been counted down, for one not seen before. */
  const counter = (key: string, c: number, guess: boolean, plusOne = false, m = size(c)): number => {
    if (!c) return 0;
    keys.add(key);
    const down = memo.down(key, c, m, guess);
    // (0x80: its last day, whichever way — 停留卡 on oneself sets it for the turn it is played in)
    return Math.max(1, (c & 0x80 ? 0 : c & 0x7f) + (down || plusOne ? 1 : 0));
  };
  const qm = g.rules instanceof QingmingRules ? g.rules : undefined;
  const jq = g.rules instanceof JiqingRules ? g.rules : undefined;
  const kb = g.rules instanceof KabukichoRules ? g.rules : undefined;

  for (const p of g.players) {
    if (!p.whoPlays || p.bankrupt) continue;
    const name = g.name(p.id), id = p.id;
    // has this player's turn started this round (their counters counted down today)? only a first look's guess
    const started = id <= g.current;
    const k = (what: string) => `p${id}:${what}`;
    const one = (what: string, label: string, left: number, unit: TimedStatus['unit'] = '天') => add({ key: k(what), p: id, text: `${name} ${label}`, left, unit });
    if (p.prison && p.leaving !== 'prison') one('prison', '坐牢', counter(k('prison'), p.prison, started));
    if (p.hospital && p.leaving !== 'hospital') one('hospital', '住院', counter(k('hospital'), p.hospital, started));
    if (p.hotel) one('hotel', (g.rules?.stayLabel?.(g, p) ?? '住宿').replace(/中$/, ''), counter(k('hotel'), p.hotel, started, true));
    if (p.vanish) {
      const alien = (p.vanish & 0x40) !== 0;
      const label = (g.rules?.vanishLabel?.(g, p) ?? (alien ? '被外星人帶走' : '出國觀光')).replace(/中$/, '');
      // low 6 bits the days, bit 7 back at the next turn (core/game.ts turnStart)
      const v = p.vanish & 0x80 ? 0x80 : p.vanish & 0x3f;
      one('vanish', label, counter(k('vanish'), v, started));
    }
    if (p.sleep) one('sleep', qm ? '昏睡' : '冬眠', counter(k('sleep'), p.sleep, started));
    if (p.sleepwalk) one('sleepwalk', '夢遊', counter(k('sleepwalk'), p.sleepwalk, started));
    if (p.stay) one('stay', '停留', counter(k('stay'), p.stay, started));
    if (p.turtle) one('turtle', '烏龜（每次一步）', counter(k('turtle'), p.turtle, started));
    if (p.bankRefused) one('bank', '銀行拒絕往來', counter(k('bank'), p.bankRefused, started));
    if (p.noLoan) one('noloan', '不能貸款', counter(k('noloan'), p.noLoan, started));
    if (p.allyDays && p.ally && p.id < p.ally - 1) one('ally', `和${g.name(p.ally - 1)}同盟`, counter(k('ally'), p.allyDays, started));
    if (p.insurance) one('insurance', '保險', counter(k('insurance'), p.insurance, started));
    // 工程車: traffic 3, the days in the bits above (core/modules/tools.ts turnStart)
    if ((p.traffic & 3) === 3 && p.traffic >> 2) one('construction', '工程車', p.traffic >> 2);
    // the god with them (core/modules/objects.ts turnStart: `life` days, gone at 0); 大富豪模式: its city's slot
    const objs = g.world && !g.here(p) ? g.world.hooks.cityOf(p)?.objects : g.objects;
    const god = p.god ? objs?.slots[p.god - 1] : undefined;
    if (god && god.life > 0 && god.type !== OBJ.TimeBomb) one('god', `${OBJECT_NAMES[god.type - 1]}附身`, god.life);
    const bomb = p.bomb ? g.objects.slots[p.bomb - 1] : undefined;
    if (bomb && bomb.life > 0) one('bomb', '身上的定時炸彈', bomb.life, '步');
    if (p.loanDue && p.loan && !g.rules?.chipsOnly) {
      const d = daysBetween(g.date, p.loanDue);
      if (d >= 1 && d <= 7) one('loan', '貸款到期', d);
    }
    // the maps' own
    if (jq && (jq.s.study[id] ?? 0) > 0) one('jq-study', '學習班', jq.s.study[id]);
    if (kb && (kb.s.busy[id] ?? 0) > 0) one('kb-busy', '處理事務', kb.s.busy[id], '回合');
    if (kb && kb.s.gang.holder === id && kb.s.gang.days > 0) one('kb-gang', '被黑幫附身', kb.s.gang.days);
    if (qm) {
      const f = qm.forced[id];
      if (f && f.turns > 0) one('qm-dice', `只擲${f.n}顆骰子`, f.turns, '回合');
      const sh = qm.ling.shield?.[id] ?? 0;
      if (sh > 0) one('qm-shield', '守寨（不受卡片）', sh);
    }
  }

  // ---- the game-wide ones
  const st = g.stocks;
  if (st.restDays && !g.rules?.chipsOnly && !g.settings.mapRules?.noStocks) {
    add({ key: 'stock-rest', text: '股市休市', left: counter('stock-rest', st.restDays, true), unit: '天' });
  }
  if (!g.rules?.chipsOnly) {
    const forced = st.stocks.map(s => s.forced);
    const all = forced.length > 1 && forced.every(f => f && f === forced[0]);
    st.stocks.forEach((s, i) => {
      if (s.suspendDays) add({ key: `stock-susp${i}`, text: `${s.name} 暫停交易`, left: s.suspendDays, unit: '天' });
      if (!s.forced || (all && i > 0)) return;
      const up = s.forced >> 4, down = s.forced & 0xf;
      add({ key: `stock-forced${all ? '' : i}`, text: `${all ? '全部股票' : s.name} ${up ? '連漲' : '連跌'}`, left: up || down, unit: '天' });
    });
  }
  // 漲價卡 / 查封卡 (tmpState: days in the high nibble, 0 漲價 / 1 查封 in the low one), one line a street
  const streets = new Map<string, { text: string; left: number }>();
  for (const l of g.board.lands) {
    if (!(l.tmpState >> 4)) continue;
    const kind = l.tmpState & 0xf ? '查封' : '漲價';
    streets.set(`land:${l.name}:${kind}`, { text: `${l.name} ${kind}`, left: l.tmpState >> 4 });
  }
  const facNames = g.rules?.facilityNames ?? ['公園', '旅館', '購物中心', '加油站', '研究所'];
  for (const f of g.board.facilities) {
    if (!(f.tmpState >> 4)) continue;
    const kind = f.tmpState & 0xf ? '查封' : '漲價';
    streets.set(`fac:${f.id}:${kind}`, { text: `${f.name || facNames[f.type] || '大地'} ${kind}`, left: f.tmpState >> 4 });
  }
  for (const [key, s] of streets) add({ key, ...s, unit: '天' });

  // 激情歲月 / 歌舞伎町's news in force (name → days)
  const mods = jq?.s.mods ?? kb?.s.mods;
  if (mods) for (const [m, d] of Object.entries(mods)) if (d > 0) add({ key: `mod:${m}`, text: MOD_NAMES[m] ?? m, left: d, unit: '天' });
  if (kb) {
    for (const [fid, d] of Object.entries(kb.s.closed)) {
      const f = g.board.facilities.find(x => x.id === Number(fid));
      if (f && d > 0) add({ key: `kb-closed:${fid}`, text: `${f.name}${shopNameFor(f.type, false)} 停業`, left: d, unit: '天' });
    }
    if (kb.s.tout.gone > 0) add({ key: 'kb-tout', text: '拉客仔 不在', left: kb.s.tout.gone, unit: '天' });
    if (kb.s.gang.holder < 0 && !kb.s.gang.node && kb.s.gang.back > 0) add({ key: 'kb-gang-back', text: '黑幫 不在', left: kb.s.gang.back, unit: '天' });
  }
  // 清明上河: the boats (none the first 30 days) and 梁山令's timed effects
  if (qm) {
    const left = DOCK_OPEN_DAY - qm.day();
    if (left > 0) add({ key: 'qm-dock', text: '汴河漕船 停航', left, unit: '天' });
    const s = qm.ling;
    const group = (what: string, rec: Record<number, { p: number; days: number }> | undefined, label: string) => {
      const by = new Map<string, TimedStatus>();
      for (const v of Object.values(rec ?? {})) {
        if (!(v.days > 0) || !g.players[v.p]) continue;
        const key = `qm-${what}:${v.p}:${v.days}`;
        if (!by.has(key)) by.set(key, { key, p: v.p, text: `${g.name(v.p)} ${label}`, left: v.days, unit: '天' });
      }
      for (const x of by.values()) add(x);
    };
    group('flag', s.flag, '梁山旗 過路費+50%');
    group('payee', s.payee, '代收過路費');
    const guards = new Map<number, number>();
    for (const [, d] of Object.entries(s.guard ?? {})) if (d > 0) guards.set(d, (guards.get(d) ?? 0) + 1);
    for (const [d, n] of guards) add({ key: `qm-guard:${d}`, text: `${n}處房子 拆不掉炸不掉`, left: d, unit: '天' });
  }
  memo.keep(keys);
  return out;
}

/** 「錢夫人 坐牢 還剩5天」. */
export const statusLine = (s: TimedStatus) => `${s.text} 還剩${s.left}${s.unit}`;
