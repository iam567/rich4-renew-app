/**
 * 派對模式's 圍觀 (the user 2026-11-03): spectators watch a party game and send gifts, like a live stream's (but free):
 * an animation on everyone's screen. The rarer the gift, the flashier (the user: 「越稀有的禮物效果越炫」) — always on a
 * transparent background over the game, about half the screen, never covering it all; clicks pass through; 1.8–4.2 s;
 * one at a time in the room (party-net.ts drops the rest); a player can turn them off (設定 → 觀眾特效, or the 「N 人圍觀」
 * chip): then only a line in the log. The pictures: tools/tycoon-art/cheer_art.py (maps/remake/party/cheer-*.webp).
 *
 * Three are free (撒花, 鼓掌, 比心). The small gifts come with a monthly supply (the real calendar month) and as gifts
 * when something happens to a player — a good thing (樂透, a big income, a good fate or news, a 獎勵卡) may give a
 * 墨鏡 / 玫瑰 / 禮花 / 鞭炮 / 紅包, a bad one (prison, hospital, a bad fate or news, bankruptcy) a 雞蛋 / 番茄. The big
 * gifts (超跑 … 嘉年華) only by a small chance at good things (a bigger one at very good things). Cosmetic only:
 * Math.random, never the game's random stream.
 */
import { playerName } from '../core/characters';
import type { Game } from '../core/game';
import { eventTone, TOLL_REASONS } from '../core/stats';
import type { GameEvent } from '../core/types';
import { ASSETS } from './assets';
import { audio, Sfx } from './audio';
import type { Room } from './party-net';
import './spectate.css';

/** free: always; small: a monthly supply and gifts; big: only by chance; top: 嘉年華, the rarest. */
type Tier = 'free' | 'small' | 'big' | 'top';
interface Gift { id: string; name: string; tier: Tier; icon: string; month?: number; tone?: 'good' | 'bad'; weight?: number }
export const GIFTS: readonly Gift[] = [
  { id: 'flower', name: '撒花', tier: 'free', icon: 'blossom' },
  { id: 'clap', name: '鼓掌', tier: 'free', icon: 'clap' },
  { id: 'heart', name: '比心', tier: 'free', icon: 'heart' },
  { id: 'shades', name: '墨鏡', tier: 'small', icon: 'shades', month: 5, tone: 'good' },
  { id: 'rose', name: '玫瑰', tier: 'small', icon: 'rose', month: 5, tone: 'good' },
  { id: 'firework', name: '禮花', tier: 'small', icon: 'firework', month: 3, tone: 'good' },
  { id: 'cracker', name: '鞭炮', tier: 'small', icon: 'crackers', month: 3, tone: 'good' },
  { id: 'redpack', name: '紅包', tier: 'small', icon: 'redpack', month: 3, tone: 'good' },
  { id: 'egg', name: '雞蛋', tier: 'small', icon: 'egg', month: 10, tone: 'bad' },
  { id: 'tomato', name: '番茄', tier: 'small', icon: 'tomato', month: 10, tone: 'bad' },
  { id: 'car', name: '超跑', tier: 'big', icon: 'car', weight: 5 },
  { id: 'yacht', name: '遊艇', tier: 'big', icon: 'yacht', weight: 4 },
  { id: 'jet', name: '私人飛機', tier: 'big', icon: 'jet', weight: 4 },
  { id: 'carriage', name: '南瓜馬車', tier: 'big', icon: 'carriage', weight: 3 },
  { id: 'ferris', name: '摩天輪', tier: 'big', icon: 'ferris', weight: 3 },
  { id: 'dragon', name: '舞龍', tier: 'big', icon: 'dragon', weight: 3 },
  { id: 'rocket', name: '火箭', tier: 'big', icon: 'rocket', weight: 2 },
  { id: 'castle', name: '城堡', tier: 'big', icon: 'castle', weight: 2 },
  { id: 'carnival', name: '嘉年華', tier: 'top', icon: 'crown', weight: 1 },
];
const byId = new Map(GIFTS.map(g => [g.id, g]));
const art = (k: string) => `${ASSETS}/maps/remake/party/cheer-${k}.webp`;

// ---------------------------------------------------------------- the animations (every phone)

/** 設定 → 觀眾特效: 0 開 (default), 1 關. */
export const WATCH_FX_KEY = 'rich4.watchFx';
export const WATCH_FX_MODES = ['開', '關'];
export const watchFxOn = () => { try { return localStorage.getItem(WATCH_FX_KEY) !== '1'; } catch { return true; } };
export const setWatchFx = (on: boolean) => { try { localStorage.setItem(WATCH_FX_KEY, on ? '0' : '1'); } catch { /* not kept */ } };

/** How long each tier plays (ms): the rarer, the longer. */
const LENGTH: Record<Tier, number> = { free: 1800, small: 2300, big: 3300, top: 4200 };

/**
 * Plays gifts over the whole window (a layer clicks pass through): the gift banner at the top like a live stream's,
 * and the gift's animation around the middle — about half the screen — or, for the ones aimed at a player (墨鏡, 雞蛋,
 * 番茄), at the player whose turn it is (`target`, window coordinates; null: the middle).
 */
export class CheerFx {
  busyUntil = 0;
  constructor(private target: () => { x: number; y: number; name: string } | null, private note: (text: string) => void) {}

  play(kind: string, from: string, force = false, player = false) {
    const g = byId.get(kind);
    if (!g) return;
    const t = this.target();
    const aimed = g.id === 'egg' || g.id === 'tomato' || g.id === 'shades';
    this.note(`${player ? '' : '觀眾 '}${from} 送出${g.name}${t && aimed ? `給 ${t.name}` : ''}`);
    if (!force && !watchFxOn()) return;
    const now = Date.now();
    if (now < this.busyUntil) return; // one at a time on this screen too
    this.busyUntil = now + LENGTH[g.tier];
    const W = window.innerWidth, H = window.innerHeight, u = Math.min(W, H) / 100; // 1 vmin
    const box = document.createElement('div');
    box.className = `sp-fx sp-t-${g.tier}`;
    const at = aimed && t ? t : { x: W / 2, y: H / 2 };
    const set = (e: HTMLElement, vars: Record<string, string | number>) => { for (const [k, v] of Object.entries(vars)) e.style.setProperty(`--${k}`, String(v)); };
    set(box, { x: `${at.x}px`, y: `${at.y}px`, u: `${u}px`, w: `${W}px` });
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    /** One piece: a picture (or an empty element styled by its class), its own variables. */
    const put = (pic: string | null, cls: string, vars: Record<string, string | number> = {}) => {
      const e = document.createElement(pic ? 'img' : 'i');
      if (pic) { (e as HTMLImageElement).src = art(pic); (e as HTMLImageElement).alt = ''; }
      e.className = cls;
      set(e, vars);
      box.append(e);
      return e;
    };
    // the banner: who sends what, the gift's picture (gold for the big ones)
    const banner = document.createElement('div');
    banner.className = `sp-banner ${g.tier}`;
    banner.innerHTML = `<img src="${art(g.icon)}" alt=""><span><b></b><small></small></span>`;
    banner.querySelector('b')!.textContent = from;
    banner.querySelector('small')!.textContent = `送出 ${g.name}${g.tier === 'top' ? '！！！' : g.tier === 'big' ? '！' : ''}`;
    box.append(banner);
    const ring = (n: number, pic: string | null, cls: string, r: number, extra: () => Record<string, string | number> = () => ({})) => {
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2 + rnd(-.2, .2); put(pic, cls, { tx: `${Math.cos(a) * r * rnd(.75, 1.15)}px`, ty: `${Math.sin(a) * r * rnd(.75, 1.15)}px`, d: `${rnd(0, .25)}s`, ...extra() }); }
    };
    const half = Math.min(W * .9, 126 * u); // the width the effects keep to (about half the screen's area)
    const rain = (n: number, pic: string, cls: string, size: [number, number], span = 1) => {
      for (let k = 0; k < n; k++) put(pic, cls, { sx: `${rnd(-half / 2, half / 2)}px`, s: `${rnd(size[0], size[1]) * u}px`, d: `${rnd(0, span)}s`, r: `${rnd(-360, 360)}deg`, dx: `${rnd(-8, 8) * u}px` });
    };
    switch (g.id) {
      // ---- free: small, around the middle
      case 'flower': rain(26, 'blossom', 'sp-fall', [4, 8], .8); audio.sfx(Sfx.couponFlip); break;
      case 'clap':
        put('clap', 'sp-pop sp-clapping', { s: `${26 * u}px` });
        put(null, 'sp-word', { s: `${13 * u}px` }).textContent = '好！';
        ring(10, 'star', 'sp-burst', 22 * u, () => ({ s: `${rnd(3, 5) * u}px` }));
        audio.sfx(Sfx.points); window.setTimeout(() => audio.sfx(Sfx.points), 260); break;
      case 'heart':
        put('heart', 'sp-pop sp-beat', { s: `${28 * u}px` });
        for (let k = 0; k < 14; k++) put('heart', 'sp-rise', { sx: `${rnd(-25, 25) * u}px`, s: `${rnd(3, 7) * u}px`, d: `${rnd(.1, .9)}s`, dx: `${rnd(-10, 10) * u}px` });
        audio.sfx(Sfx.gift); break;
      // ---- small: about half the screen
      case 'shades':
        // the glasses drop onto the player, a shine sweeps across, 「酷！」
        put('shades', 'sp-drop', { s: `${30 * u}px` });
        put(null, 'sp-word sp-late', { s: `${10 * u}px` }).textContent = '酷！';
        ring(8, 'star', 'sp-burst sp-late', 20 * u, () => ({ s: `${rnd(3, 5) * u}px` }));
        audio.sfx(Sfx.cardFlip); break;
      case 'rose':
        put('rose', 'sp-spin-in', { s: `${30 * u}px` });
        rain(22, 'rose', 'sp-fall', [5, 9], 1);
        audio.sfx(Sfx.gift); break;
      case 'firework':
        for (let b = 0; b < 4; b++) put('firework', 'sp-firework', { fx: `${rnd(-.35, .35) * half}px`, fy: `${rnd(-25, 10) * u}px`, s: `${rnd(22, 34) * u}px`, d: `${b * .35}s` });
        audio.sfx(Sfx.fireworks); window.setTimeout(() => audio.sfx(Sfx.fireworks), 700); break;
      case 'cracker':
        put('crackers', 'sp-swing', { fx: `${-half * .32}px`, s: `${26 * u}px` });
        put('crackers', 'sp-swing', { fx: `${half * .32}px`, s: `${26 * u}px`, d: '.15s' });
        for (let k = 0; k < 10; k++) put('bang', 'sp-bang', { fx: `${rnd(-.4, .4) * half}px`, fy: `${rnd(-15, 22) * u}px`, s: `${rnd(9, 16) * u}px`, d: `${.2 + k * .16}s` });
        audio.sfx(Sfx.smallBlast); for (const ms of [300, 600, 900, 1200, 1500]) window.setTimeout(() => audio.sfx(Sfx.smallBlast), ms);
        box.classList.add('sp-shake'); break;
      case 'redpack':
        put('redpack', 'sp-throw-in', { s: `${26 * u}px` });
        ring(26, 'coin', 'sp-fountain', 34 * u, () => ({ s: `${rnd(4, 7) * u}px`, d: `${.75 + rnd(0, .25)}s`, r: `${rnd(-540, 540)}deg` }));
        audio.sfx(Sfx.gift); window.setTimeout(() => audio.sfx(Sfx.points), 750); break;
      case 'egg': case 'tomato': {
        // thrown at the player: it grows toward the screen, splats over about half of it, slides down and fades
        const [missile, splat] = g.id === 'egg' ? ['egg', 'yolk'] : ['tomato', 'tomatosplat'];
        put(missile, 'sp-hurl', { s: `${16 * u}px`, sx: `${rnd(-.3, .3) * W}px` });
        put(splat, 'sp-splat', { s: `${55 * u}px`, r: `${rnd(-25, 25)}deg` });
        put(splat, 'sp-splat sp-small', { s: `${18 * u}px`, fx: `${rnd(-30, 30) * u}px`, fy: `${rnd(-20, 20) * u}px`, r: `${rnd(0, 360)}deg` });
        window.setTimeout(() => audio.sfx(Sfx.demolishCard), 560);
        window.setTimeout(() => box.classList.add('sp-shake'), 560); break;
      }
      // ---- big: rarer, longer, flashier; they may cross the screen but cover only a band of it
      case 'car':
        put('car', 'sp-drive', { s: `${46 * u}px` });
        for (let k = 0; k < 9; k++) put('smoke', 'sp-puff', { s: `${rnd(9, 15) * u}px`, d: `${.3 + k * .18}s` });
        for (let k = 0; k < 8; k++) put(null, 'sp-speed', { fy: `${rnd(-8, 12) * u}px`, d: `${rnd(0, .5)}s` });
        ring(12, 'star', 'sp-burst sp-mid', 30 * u, () => ({ s: `${rnd(3, 6) * u}px` }));
        audio.sfx(Sfx.car); window.setTimeout(() => audio.sfx(Sfx.car), 900); break;
      case 'yacht':
        // the waves low and behind, the yacht riding over them
        for (let k = 0; k < 3; k++) put('wave', 'sp-wave', { fx: `${(k - 1) * 30 * u}px`, s: `${18 * u}px`, d: `${k * .15}s` });
        put('yacht', 'sp-sail', { s: `${44 * u}px` });
        rain(12, 'coin', 'sp-fall', [3, 5], 1.6);
        audio.sfx(Sfx.boat); break;
      case 'jet':
        put(null, 'sp-trail', { fy: `${-2 * u}px` });
        put(null, 'sp-trail', { fy: `${3 * u}px`, d: '.05s' });
        put('jet', 'sp-fly', { s: `${42 * u}px` });
        rain(14, 'star', 'sp-fall', [2, 4], 1.8);
        audio.sfx(Sfx.airplane); break;
      case 'carriage':
        put('carriage', 'sp-ride', { s: `${42 * u}px` });
        for (let k = 0; k < 18; k++) put('star', 'sp-dust', { s: `${rnd(2, 4) * u}px`, d: `${.2 + k * .12}s`, fy: `${rnd(4, 16) * u}px` });
        ring(10, 'diamond', 'sp-burst sp-mid', 34 * u, () => ({ s: `${rnd(3, 5) * u}px` }));
        audio.sfx(Sfx.santa); break;
      case 'ferris':
        put('ferris', 'sp-rise-up sp-turn', { s: `${50 * u}px` });
        for (let b = 0; b < 3; b++) put('firework', 'sp-firework', { fx: `${(b - 1) * 30 * u}px`, fy: `${-26 * u}px`, s: `${20 * u}px`, d: `${.9 + b * .35}s` });
        put('balloons', 'sp-float', { fx: `${-30 * u}px`, s: `${16 * u}px`, d: '.4s' });
        put('balloons', 'sp-float', { fx: `${30 * u}px`, s: `${16 * u}px`, d: '.7s' });
        audio.sfx(Sfx.fireworks); break;
      case 'dragon':
        put('dragon', 'sp-dragon', { s: `${56 * u}px` });
        rain(20, 'ingot', 'sp-fall', [4, 7], 2);
        for (let k = 0; k < 6; k++) put('bang', 'sp-bang', { fx: `${rnd(-.4, .4) * half}px`, fy: `${rnd(10, 25) * u}px`, s: `${rnd(8, 12) * u}px`, d: `${.5 + k * .3}s` });
        audio.sfx(Sfx.smallBlast); window.setTimeout(() => audio.sfx(Sfx.fireworks), 900); break;
      case 'rocket': {
        // lift-off: smoke billowing at the foot, the rocket climbing on its flame, shaking, a burst at the top
        for (let k = 0; k < 10; k++) put('smoke', 'sp-billow', { fx: `${rnd(-18, 18) * u}px`, s: `${rnd(14, 22) * u}px`, d: `${k * .08}s` });
        const r = put(null, 'sp-launch', { s: `${30 * u}px` });
        r.innerHTML = `<img src="${art('flame')}" alt="" class="sp-flame"><img src="${art('rocket')}" alt="" class="sp-rocket">`;
        put('firework', 'sp-firework', { fx: '0px', fy: `${-34 * u}px`, s: `${34 * u}px`, d: '2.2s' });
        box.classList.add('sp-rumble');
        audio.sfx(Sfx.missile); window.setTimeout(() => audio.sfx(Sfx.fireworks), 2200); break;
      }
      case 'castle':
        put('rainbow', 'sp-arc', { s: `${70 * u}px`, d: '.5s' });
        put('castle', 'sp-rise-up', { s: `${52 * u}px` });
        for (let b = 0; b < 5; b++) put('firework', 'sp-firework', { fx: `${(b - 2) * 18 * u}px`, fy: `${rnd(-34, -20) * u}px`, s: `${rnd(16, 24) * u}px`, d: `${.8 + b * .3}s` });
        audio.sfx(Sfx.fireworks); window.setTimeout(() => audio.sfx(Sfx.fireworks), 1100); break;
      case 'carnival':
        // the rarest: everything at once — the crown, balloons rising, fireworks, confetti, 「嘉年華」 in gold
        for (let b = 0; b < 7; b++) put('firework', 'sp-firework', { fx: `${rnd(-.45, .45) * half}px`, fy: `${rnd(-30, 5) * u}px`, s: `${rnd(20, 30) * u}px`, d: `${.3 + b * .4}s` });
        for (let k = 0; k < 10; k++) put('balloons', 'sp-rise', { sx: `${rnd(-.5, .5) * half}px`, s: `${rnd(10, 16) * u}px`, d: `${rnd(0, 1.2)}s`, dx: `${rnd(-6, 6) * u}px` });
        put('crown', 'sp-crown', { s: `${34 * u}px` });
        put(null, 'sp-title', { s: `${15 * u}px` }).textContent = '嘉年華';
        for (let k = 0; k < 60; k++) put(null, 'sp-confetti', { sx: `${rnd(-.5, .5) * half}px`, c: ['#ffd84a', '#ff5c8a', '#5cd6ff', '#9dff7a', '#c38cff', '#ff9f43'][k % 6], d: `${rnd(0, 2)}s`, r: `${rnd(-720, 720)}deg`, dx: `${rnd(-10, 10) * u}px` });
        rain(16, 'coin', 'sp-fall', [3, 6], 2.5);
        audio.sfx(Sfx.fireworks); for (const ms of [500, 1100, 1800, 2600]) window.setTimeout(() => audio.sfx(Sfx.fireworks), ms);
        window.setTimeout(() => audio.sfx(Sfx.gift), 300); break;
    }
    document.body.append(box);
    window.setTimeout(() => box.remove(), LENGTH[g.tier] + 400);
  }
}

// ---------------------------------------------------------------- the spectator's gifts and bar

const STORE = 'rich4.watch.items';
/** `n`: what is left of each gift; `won`: how many times this phone won each big one (for BOOST). */
type Supply = { month: string; n: Record<string, number>; won?: Record<string, number> };
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}`; };
function supply(): Supply {
  let s: Supply = { month: '', n: {} };
  try { s = JSON.parse(localStorage.getItem(STORE) ?? 'null') ?? s; } catch { /* fresh */ }
  s.n ??= {};
  // a new month: at least the month's supply of each small gift (what was given on top stays)
  if (s.month !== thisMonth()) { s.month = thisMonth(); for (const g of GIFTS) if (g.month) s.n[g.id] = Math.max(s.n[g.id] ?? 0, g.month); save(s); }
  return s;
}
const save = (s: Supply) => { try { localStorage.setItem(STORE, JSON.stringify(s)); } catch { /* not kept */ } };
/**
 * Gifts sent to this install (they come with the notice, notice.ts): added to what is left, never counted as won (the
 * boost stays). Returns what was added, as 「嘉年華 ×1」 lines; unknown or free kinds are skipped.
 */
export function receiveGifts(list: readonly { g: string; n: number }[]): string[] {
  const s = supply(), out: string[] = [];
  for (const { g, n } of list) {
    const gift = byId.get(g), k = Math.min(Math.max(Math.floor(n) || 0, 0), 99);
    if (!gift || gift.tier === 'free' || !k) continue;
    s.n[g] = (s.n[g] ?? 0) + k;
    out.push(`${gift.name} ×${k}`);
  }
  if (out.length) save(s);
  return out;
}
const FOLD = 'rich4.party.watchFold';
/** The chance of a big gift at a good thing (a very good thing: `great`), shared by the big gifts by their weights. */
const BIG_CHANCE = { good: .05, great: .3 };
/**
 * The user 2026-11-08 (so everyone gets to use the big ones): each big gift's own chance is ten times as high until this
 * phone first won it, then five times, then twice, from the fourth time on as before — each gift on its own (won a 超跑
 * twice: 超跑 at twice, a 私人飛機 never won still at ten times).
 */
const BOOST = [10, 5, 2];
const boost = (s: Supply, id: string) => BOOST[s.won?.[id] ?? 0] ?? 1;
/**
 * The big gift a good thing gives this phone, or null: each big one by its weight's share of `chance`, times its boost
 * (all of them together at most 1: then one always, shared in the same proportions). `chance` 1: one always.
 */
function bigGift(s: Supply, chance: number): Gift | null {
  const big = GIFTS.filter(x => x.tier === 'big' || x.tier === 'top');
  const total = big.reduce((a, g) => a + (g.weight ?? 1), 0);
  const p = big.map(g => chance * ((g.weight ?? 1) / total) * boost(s, g.id));
  const sum = p.reduce((a, b) => a + b, 0);
  let r = Math.random() * Math.max(1, sum);
  for (let k = 0; k < big.length; k++) { r -= p[k]; if (r < 0) return big[k]; }
  return sum >= 1 ? big[big.length - 1] : null;
}
const HOW_TO_WIN = '有人碰到好事時有機會得到大禮物：收到 3 萬以上的過路費、好的命運或新聞、抽到獎勵卡；有人中樂透或抽到 SR 獎勵卡時一定有。';
const pickWeighted = (list: Gift[]) => { let w = Math.random() * list.reduce((a, g) => a + (g.weight ?? 1), 0); for (const g of list) { w -= g.weight ?? 1; if (w < 0) return g; } return list[0]; };

/**
 * A phone's gifts: what is left of each (the big ones only once won), sending them (one every 5 s), and the gifts given
 * when a player meets something good or bad (`see` every game event).
 */
class GiftShelf {
  private readyAt = 0;
  private giftAt = 0;
  constructor(private room: Room, private game: Game, private note: (text: string) => void, private changed: () => void) {}

  /** Seconds until the next gift. */
  get wait() { return Math.max(0, Math.ceil((this.readyAt - Date.now()) / 1000)); }

  send(id: string) {
    const g = byId.get(id);
    if (!g) return;
    const s = supply();
    // a big one not won yet (the user 2026-11-08: everyone should know they exist): how to get one
    if ((g.tier === 'big' || g.tier === 'top') && !(s.n[id] ?? 0)) { audio.ui('click'); this.note(`「${g.name}」還沒有。${HOW_TO_WIN}`); return; }
    if (Date.now() < this.readyAt) { audio.ui('error'); return; }
    if (g.tier !== 'free') { if (!(s.n[id] ?? 0)) { audio.ui('error'); return; } s.n[id] -= 1; save(s); }
    this.readyAt = Date.now() + 5000;
    audio.ui('click');
    this.room.cheer(id);
    this.changed();
  }

  /**
   * The buttons: the free and small gifts, and below them a row of every big one (the user 2026-11-08: shown before
   * they are won, so everyone knows they exist) — locked and grey until this phone has one; tapping a locked one says
   * how to get it. `shut`: sending is not possible now.
   */
  buttons(shut = false) {
    const s = supply(), wait = this.wait;
    const button = (g: Gift) => {
      const n = g.tier === 'free' ? -1 : s.n[g.id] ?? 0;
      const big = g.tier === 'big' || g.tier === 'top', locked = big && n === 0;
      return `<button data-c="${g.id}" class="${g.tier}${locked ? ' locked' : n === 0 || wait || shut ? ' off' : ''}" title="${g.name}"><img src="${art(g.icon)}" alt=""><small>${g.name}</small>${locked ? '<em>🔒</em>' : n >= 0 ? `<em>${n}</em>` : ''}</button>`;
    };
    const big = GIFTS.filter(g => g.tier === 'big' || g.tier === 'top');
    return `<div class="sp-btns">${GIFTS.filter(g => g.tier === 'free' || g.tier === 'small').map(button).join('')}</div><div class="sp-big"><b>大禮物</b>${big.map(button).join('')}</div>`;
  }

  /**
   * A game event as everyone sees it: a good thing for a player may give this phone a small good gift (and by a small
   * chance a big one; a bigger chance at a very good thing), a bad one a 雞蛋 / 番茄. At most one every 8 s. The best
   * news (樂透, an SR 獎勵卡; the user 2026-11-07) gives every phone a big one, always.
   */
  see(e: GameEvent) {
    const g = this.game, name = (p?: number) => (p !== undefined && g.players[p] ? playerName(g.players[p]) : '');
    let tone: 'good' | 'bad' | null = null, who = '', what = '', great = false, sure = false;
    if (e.t === 'bankrupt') { tone = 'bad'; who = name(e.p); what = '破產了'; }
    else if (e.t === 'pay' && TOLL_REASONS.has(e.reason) && e.amount >= 30000) {
      if (e.to >= 0 && e.to < 100) { tone = 'good'; who = name(e.to); what = `收到 ${e.amount.toLocaleString()} 元`; great = e.amount >= 100000; }
    } else if (e.t === 'fx') {
      const d = (e.data ?? {}) as Record<string, unknown>;
      if (e.kind === 'lottery-draw' && typeof d.winner === 'number' && d.winner >= 0) { tone = 'good'; who = name(d.winner); what = '中了樂透'; sure = true; }
      else if (e.kind === 'reward') { tone = 'good'; who = name(e.p); what = '抽到獎勵卡'; sure = d.grade === 2; }
      else if (e.kind === 'to-prison' || e.kind === 'to-hospital') { tone = 'bad'; who = name(e.p); what = e.kind === 'to-prison' ? '坐牢了' : '住院了'; }
      else if (e.kind === 'event-result' && (d.src === 'fate' || d.src === 'news') && typeof d.id === 'number') {
        const t = eventTone(d.src as 'fate' | 'news', d.id);
        if (t !== 'neutral') { tone = t; who = name(e.p); what = t === 'good' ? '碰上好事' : '碰上倒楣事'; }
      }
    }
    if (!tone || !who || (!sure && Date.now() < this.giftAt)) return;
    const s = supply();
    let gift = tone === 'good' ? bigGift(s, sure ? 1 : great ? BIG_CHANCE.great : BIG_CHANCE.good) : null;
    if (!gift && Math.random() < .5) gift = pickWeighted(GIFTS.filter(x => x.tier === 'small' && x.tone === tone));
    if (!gift) return;
    this.giftAt = Date.now() + 8000;
    const big = gift.tier === 'big' || gift.tier === 'top';
    s.n[gift.id] = (s.n[gift.id] ?? 0) + 1;
    if (big) (s.won ??= {})[gift.id] = (s.won[gift.id] ?? 0) + 1;
    save(s);
    this.note(`${who}${what}，${big ? '大禮物！' : ''}送你一個「${gift.name}」`);
    audio.sfx(big ? Sfx.fireworks : Sfx.gift);
    this.changed();
  }
}

/** The spectator's bar: who watches, the gifts, 接手, 離開圍觀. */
export class SpectatorBar {
  readonly el = document.createElement('div');
  private shelf: GiftShelf;
  /** 折疊 (the user 2026-11-04: the bar covers the game under it): only its top line, 接手 still there. Kept on the phone. */
  private folded = (() => { try { return localStorage.getItem(FOLD) === '1'; } catch { return false; } })();
  constructor(private room: Room, game: Game, note: (text: string) => void, leave: () => void) {
    this.shelf = new GiftShelf(room, game, note, () => this.draw());
    this.el.className = 'sp-bar';
    this.el.addEventListener('click', e => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c], [data-leave], [data-take], [data-fold], [data-cam]');
      if (!b) return;
      if (b.dataset.cam !== undefined) { audio.ui('click'); this.cam?.step(Number(b.dataset.cam) as 1 | -1); return; }
      if (b.dataset.fold !== undefined) {
        audio.ui('click'); this.folded = !this.folded;
        try { localStorage.setItem(FOLD, this.folded ? '1' : '0'); } catch { /* not kept */ }
        this.draw(); return;
      }
      if (b.dataset.leave !== undefined) { audio.ui('no'); leave(); return; }
      if (b.dataset.take !== undefined) { audio.ui('yes'); this.room.take(Number(b.dataset.take)); b.textContent = '接手中…'; return; }
      this.shelf.send(b.dataset.c!);
    });
    this.draw();
    this.timer = window.setInterval(() => this.draw(), 1000);
  }
  private timer = 0;
  /** 即時制's 視角 (main.ts): whom the camera follows, ◀ ▶ to change; none in 回合制 (the camera follows the turn). */
  cam: { name: () => string; step: (d: 1 | -1) => void } | null = null;
  destroy() { clearInterval(this.timer); this.el.remove(); }
  see(e: GameEvent) { this.shelf.see(e); }

  draw() {
    const wait = this.shelf.wait, btns = this.shelf.buttons();
    const esc = (t: string) => t.replace(/[<>&"]/g, '');
    const cam = this.cam ? `<div class="sp-cam"><button data-cam="-1" aria-label="上一位">◀</button><span>視角：${esc(this.cam.name())}</span><button data-cam="1" aria-label="下一位">▶</button></div>` : '';
    // 接手 (the user 2026-11-03): a seat its player left (gone 30 s and not 暫離, or voted out) — the first to tap takes it
    const take = this.room.vacant.map(v => `<button data-take="${v.seat}">接手 ${v.name.replace(/[<>&"]/g, '')}</button>`).join('');
    this.el.innerHTML = `<div class="sp-head"><b>圍觀中</b><span>${this.room.watchCount || 1} 人在看${wait ? `・${wait} 秒後可再送` : ''}</span><button data-leave class="sp-leave">離開圍觀</button><button data-fold class="sp-fold" aria-label="${this.folded ? '展開' : '收起'}">${this.folded ? '▲' : '▼'}</button></div>${cam}${take ? `<div class="sp-take">${take}</div>` : ''}${this.folded ? '' : btns}`;
    this.el.classList.toggle('folded', this.folded);
  }
}

/**
 * 等待時送禮物 (the user 2026-11-07: 「這樣大家等的時候就不無聊了」): the gifts for a player of the game, opened from the
 * party bar. It collects gifts all game long; sending is for the turns of the others (`canSend`).
 */
export class PlayerGifts {
  readonly el = document.createElement('div');
  private shelf: GiftShelf;
  private timer = 0;
  constructor(room: Room, game: Game, note: (text: string) => void, private canSend: () => boolean) {
    this.shelf = new GiftShelf(room, game, note, () => this.draw());
    this.el.className = 'sp-bar sp-player';
    this.el.hidden = true;
    for (const k of ['pointerdown', 'click'] as const) this.el.addEventListener(k, e => e.stopPropagation());
    this.el.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c], [data-close]');
      if (!b) return;
      if (b.dataset.close !== undefined) { audio.ui('no'); this.toggle(false); return; }
      if (this.canSend() || b.classList.contains('locked')) this.shelf.send(b.dataset.c!); else audio.ui('error');
    });
  }
  get open() { return !this.el.hidden; }
  toggle(on = this.el.hidden) {
    this.el.hidden = !on;
    clearInterval(this.timer);
    if (on) { this.draw(); this.timer = window.setInterval(() => this.draw(), 1000); }
  }
  destroy() { clearInterval(this.timer); this.el.remove(); }
  see(e: GameEvent) { this.shelf.see(e); }

  draw() {
    if (this.el.hidden) return;
    const wait = this.shelf.wait, can = this.canSend();
    this.el.innerHTML = `<div class="sp-head"><b>送禮物</b><span>${!can ? '等別人操作時才能送' : wait ? `${wait} 秒後可再送` : '大家都看得到'}</span><button data-close class="sp-leave">收起</button></div>${this.shelf.buttons(!can)}`;
  }
}
