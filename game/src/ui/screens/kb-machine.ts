/**
 * 歌舞伎町's 柏青哥店 / 拉霸店 (docs/rules/21 §7): the page a human plays a machine on, and the computer's result notice.
 * The rules ask { t: 'kb-machine', kind, maxBuys, seed, boost, stored, points } (core/kabukicho.ts machine()); the page
 * drives the same machine objects as the computer (core/modules/kb-machines.ts) on `new Rng(seed)`, so the outcome does
 * not depend on the drawing. The answer is { buys, left, a, b, played } (see MachineAnswer).
 *
 * One page in both orientations like the casino (casino.ts): a fixed canvas (portrait 520×960, landscape 960×540)
 * scaled to fit, never scrolled — the machine art on one side, the counters and the big buttons on the other (below
 * it on a phone held upright). The games are kb-pachinko.ts (§7.2) and kb-pachislot.ts (§7.3); they register in
 * `games` below.
 */
import { CHARACTERS } from '../../core/characters';
import type { MachineKind } from '../../core/modules/kb-machines';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { esc, openScene, type Scene } from './place-scene';
import { RESULT_MIN_MS } from './event-result';
import { ASSETS } from '../assets';
import { audio, Sfx } from '../audio';
import './kb-machine.css';

/** The question of a human's visit (core/kabukicho.ts machine()). */
export interface KbMachineAsk { t: 'kb-machine'; p: number; kind: MachineKind; maxBuys: number; seed: number; boost: boolean; stored: number; points: number }
/**
 * The answer: `buys` used (10 點券 each), `left` balls / medals at the end (the stored ones included), `a` / `b` first
 * hits and all hits (pachinko) or BIG and REG (pachislot), `played` balls fired / games.
 */
export interface MachineAnswer { buys: number; left: number; a: number; b: number; played: number }

/** The machines' art (tools/tycoon-art, maps/remake/kabukicho/machines/). */
export const MACH = (name: string) => `${ASSETS}/maps/remake/kabukicho/machines/${name}.webp`;
/** The two pads' art on the board (Data-like map sprites 9019 柏青哥店, 9020 拉霸店). */
export const PAD = (kind: MachineKind) => `${ASSETS}/maps/remake/sprites/${kind === 'pachinko' ? 9019 : 9020}/frame-000.webp`;
export const fmt = (n: number) => Math.trunc(n).toLocaleString('zh-Hant');

/** The games by kind; each resolves with the answer when the player 收手 or the session is over. */
export const games: Partial<Record<MachineKind, (ctx: ScreenContext, ask: KbMachineAsk) => Promise<MachineAnswer>>> = {};

/** Loads the machine's pictures before the page shows (no blank reels on the first spin). */
const kept: HTMLImageElement[] = [];
export function preloadArt(names: string[]) {
  for (const n of names) { const i = new Image(); i.decoding = 'async'; i.src = MACH(n); void i.decode?.().catch(() => 0); kept.push(i); }
}

/**
 * The page frame shared by the two machines: the head (the shop's name and the counters), the machine (its art with the
 * game's overlays) and the panel (the game's message line and buttons). `build` fills it, again after a rotation.
 */
export function openMachine(ctx: ScreenContext, kind: MachineKind, build: (s: Scene, parts: { head: HTMLElement; mach: HTMLElement; panel: HTMLElement }) => void): Scene {
  return openScene(ctx, `kbm-scene kbm-${kind}`, portrait => (portrait ? [520, 960] : [960, 540]), s => {
    const root = s.box(`kbm-root ${s.portrait ? 'por' : 'land'}`, 0, 0, s.w, s.h,
      `<div class="kbm-bg"></div><div class="kbm-head"></div><div class="kbm-mach"><img class="kbm-art" src="${MACH(kind === 'pachinko' ? 'pachinko' : 'slot')}" alt="" draggable="false"></div><div class="kbm-panel"></div>`);
    build(s, { head: root.querySelector('.kbm-head')!, mach: root.querySelector('.kbm-mach')!, panel: root.querySelector('.kbm-panel')! });
  });
}

/** The head: the pad's sign and the shop's name, then the counters (`stats`: label, value, css class). */
export function headHtml(kind: MachineKind, title: string): string {
  return `<div class="kbm-title"><img src="${PAD(kind)}" alt=""><b>${esc(title)}</b></div><div class="kbm-stats"></div>`;
}
export function statsHtml(stats: [string, string, string?][]): string {
  return stats.map(([label, value, cls]) => `<span class="kbm-stat ${cls ?? ''}"><i>${esc(label)}</i><b>${value}</b></span>`).join('');
}

/** A big banner over the machine (大當たり！, BIG BONUS!, 收手): shown for `ms`, then gone. */
export function banner(mach: HTMLElement, html: string, cls: string, ms: number): Promise<void> {
  const b = document.createElement('div');
  b.className = `kbm-banner ${cls}`;
  b.innerHTML = html;
  mach.append(b);
  return new Promise(r => setTimeout(() => { b.classList.add('out'); setTimeout(() => { b.remove(); r(); }, 220); }, ms));
}

/** Calls `step(k)` with k going 0 → 1 over `ms`, once a frame (a payout pouring into the tray). */
export function countUp(ms: number, step: (k: number) => void): Promise<void> {
  return new Promise(r => {
    const t0 = performance.now();
    const f = () => {
      const k = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
      step(k);
      if (k < 1) requestAnimationFrame(f); else r();
    };
    requestAnimationFrame(f);
  });
}

export const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

askScreens['kb-machine'] = async (ctx, ask) => {
  const a = ask as unknown as KbMachineAsk;
  const play = games[a.kind];
  // Without its screen the session is not played: nothing bought, nothing left.
  return play ? play(ctx, a) : { buys: 0, left: a.stored, a: 0, b: 0, played: 0 };
};

// ------------------------------------------------------------------ the result notice (§7.6)

/**
 * A session's result (core/kabukicho.ts machine()): a computer's instant session, the human's after the counter, or
 * 「路過看看」 (`skipped`). One line in a small cartoon box with the pad's sign; ~2.5 s (× game speed), a tap closes it.
 */
fxScreens['kb-machine-result'] = async (ctx, fx) => {
  const d = fx.data ?? {};
  const kind: MachineKind = d.kind === 'pachislot' ? 'pachislot' : 'pachinko';
  const text = String(d.text ?? '');
  const p = fx.p !== undefined ? ctx.game.players[fx.p] : undefined;
  const ch = p ? CHARACTERS[p.character] : undefined;
  const face = ch ? ctx.bank.art('Data', 2, ch.id) : null;
  // 「忍太郎　柏青哥　花 30 點券（750 顆）→ 大當たり 2 次 → 剩 1,420 顆 → 換：…」: the name, then one step a line.
  const [who, ...rest] = text.split('　');
  const steps = rest.join('　').split(/\s*→\s*/).filter(Boolean);
  const node = document.createElement('div');
  node.className = `msg kbm-result ${kind}${d.skipped ? ' skipped' : ''}`;
  node.innerHTML = `<div class="ribbon">${kind === 'pachinko' ? '柏青哥店' : '拉霸店'}</div>
    <div class="kbm-r-body"><img class="kbm-r-pad" src="${PAD(kind)}" alt="">
      <div class="kbm-r-text"><b class="kbm-r-who">${face ? `<img src="${face.src}" alt="">` : ''}${esc(who)}</b>
        ${steps.map((t, i) => `<span class="kbm-r-step${i === steps.length - 1 && !d.skipped ? ' last' : ''}">${i ? '→ ' : ''}${esc(t)}</span>`).join('')}</div></div>`;
  ctx.open(node);
  if (!d.skipped) audio.sfx(Number(d.left) > Number(d.cost ?? 0) * (kind === 'pachinko' ? 25 : 5) ? Sfx.points : Sfx.couponFlip);
  const layer = node.parentElement;
  if (layer) layer.style.pointerEvents = 'auto';
  await new Promise<void>(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      layer?.removeEventListener('pointerup', end);
      if (layer) layer.style.pointerEvents = '';
      ctx.close();
      resolve();
    };
    // The human's own summary stays readable at the fast speed too (as the result boxes, RESULT_MIN_MS).
    const timer = setTimeout(end, d.human ? Math.max(RESULT_MIN_MS, 3200 * ctx.scale()) : (d.skipped ? 1500 : 2500) * ctx.scale());
    setTimeout(() => { if (!done) layer?.addEventListener('pointerup', end); }, 250);
  });
};
