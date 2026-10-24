/**
 * The wealth / poverty gods' slot machine (拉霸) over the map — docs/rules/06 §5.7, rich4.asm fcn_00440706 /
 * fcn_0043f23e. The original draws, on the map view: the message box Data#517.5 at (220,140) with
 * "%s附身\n\n向所有對手收..." (送您... / 付給每個人... / 損失...), the machine Panel#67.0 (four reels) or #67.1 (three)
 * at (220,320), the lever #67.2 at (317|298, 240) (#67.3 while pulled), and the reel strips #67.4..23 (position
 * 0..19; 2k = digit k) at (ref_00475ce8, 320). One frame per 30 ms; Effect#51 loops while the reels turn,
 * the lever clicks UI[1].
 *
 * The rules (core/modules/slot-machine.ts) replay the loop and send every frame's reel positions in the
 * 'slot-machine' fx. A human first gets the 'slot-machine' question: the reels spin here (the look of the
 * original's spin: half-digit steps, a re-draw every 10th frame) until a tap or a key release anywhere, which
 * answers the frame of the pull; the same machine then plays the rest from the rules' frames. For a computer the
 * fx plays the whole run from frame 0 (the original shows it to everybody; a tap here jumps to the result).
 */
import type { Ask, GameEvent } from '../../core/types';
import { OBJECT_NAMES } from '../../core/modules/objects';
import { SLOT_FRAME_MS } from '../../core/modules/slot-machine';
import { askScreens, fxScreens, onStuck, type ScreenContext } from './registry';
import { esc, frameSrcs, money, openScene, preload, type Scene } from './place-scene';
import { audio, Sfx } from '../audio';
import './slot-machine.css';

type SlotAsk = Extract<Ask, { t: 'slot-machine' }>;
type Fx = Extract<GameEvent, { t: 'fx' }>;
interface Timeline { reels: number[][]; pull: number; leverUp: number; result: number; end: number; amount: number; mult: number; human: boolean }

/** Reel x by machine (0 = four reels, 1 = three): ref_00475ce8 words; reel 0 is not drawn on the small one. */
const REEL_X = [[145, 182, 219, 256], [0, 163, 200, 237]];
const REEL_Y = 320;
/** Lever x (ref_00475ce0), y 240. */
const LEVER_X = [317, 298];
/** Message box second line by god type (0x4652a9 / c1 / d1 / e7). */
const TEXT: Record<number, string> = { 1: '向所有對手收...', 2: '送您...', 5: '付給每個人...', 6: '損失...' };

/** Two layouts in original pixels: box over machine (as the original), or side by side for wide map areas. */
const BOX = { x: 97, y: 39, w: 249, h: 170 };
const MACHINE = { x: 124, y: 222, w: 224, h: 183 };
const STACK = { w: 272, h: 384, box: [-88, -30], machine: [-88, -30] };
const SIDE = { w: 505, h: 199, box: [8 - BOX.x, 14 - BOX.y], machine: [8 + BOX.w + 16 - MACHINE.x, 8 - MACHINE.y] };

/** The machine left open by the question for the fx that follows it. */
let live: SlotMachine | null = null;
/** Every machine on screen (the hang guard closes them all when it gives up on an event). */
const machines = new Set<SlotMachine>();
onStuck(() => { for (const m of [...machines]) m.close(); });

class SlotMachine {
  readonly small: 0 | 1;
  scene!: Scene;
  closed = false;
  /** Frames drawn so far (index of the next one). */
  private f = 0;
  private pos = [1, 1, 1, 1];
  private lever = false;
  private text: string;
  private title: string;
  private amount: number | null = null;
  private mult = 1;
  private side = false;
  /** The reels: drums of digits scrolled smoothly between the rules' positions (the original swaps 20 pictures). */
  private reels: ({ el: HTMLElement; strip: HTMLElement; at: number; moved: number; landed: boolean } | null)[] = [];
  private body: HTMLElement | null = null;
  private leverImg: HTMLImageElement | null = null;
  private textBox: HTMLElement | null = null;
  private textHtml = '';
  private hint: HTMLElement | null = null;
  private raf = 0;
  /** Set while the reels spin freely, waiting for the player (or for the rules' frames). */
  private onTap: (() => void) | null = null;
  private tapped = false;
  /** The human's own spin, before the tap: the hint shows and the lever glows. */
  private waiting = false;

  constructor(readonly ctx: ScreenContext, readonly p: number, readonly god: number, big: boolean, readonly human: boolean) {
    this.small = big ? 0 : 1;
    this.title = `${OBJECT_NAMES[god - 1] ?? ''}附身`;
    this.text = TEXT[god] ?? '';
  }

  /** Opens the scene once its art is loaded (or after a short wait). */
  async open() {
    machines.add(this);
    await preload(frameSrcs(this.ctx, 'Panel', 67, 0, 23), 1500);
    if (this.closed) return;
    const area = this.ctx.area;
    this.scene = openScene(this.ctx, 'sm-scene', () => {
      // The layout that shows the machine larger wins.
      const W = area.clientWidth || 440, H = area.clientHeight || 440;
      this.side = Math.min(W / SIDE.w, H / SIDE.h) > Math.min(W / STACK.w, H / STACK.h) * 1.08;
      return this.side ? [SIDE.w, SIDE.h] : [STACK.w, STACK.h];
    }, s => this.build(s), { parent: area });
    const tap = (e: Event) => { e.preventDefault(); this.tap(); };
    this.scene.root.addEventListener('pointerup', tap);
    window.addEventListener('keyup', this.key); // WM_KEYUP stops the reels too
    audio.loop(Sfx.slot);
  }

  private build(s: Scene) {
    this.scene = s;
    s.root.classList.toggle('side', this.side);
    const L = this.side ? SIDE : STACK;
    const boxG = s.box('sm-group', L.box[0], L.box[1], 0, 0);
    const machG = s.box('sm-group', L.machine[0], L.machine[1], 0, 0);
    // The remake's message box (style.css .msg: blue, orange border, dashed frame, ribbon title) where the original
    // drew its board Data#517.5: the god on the ribbon, the line and then the amount inside, the tap hint under them.
    const box = s.box('msg scene-msg sm-msg', BOX.x + 4, BOX.y + 24, BOX.w - 8, BOX.h - 28,
      `<div class="ribbon">${esc(this.title)}</div><div class="scene-msg-text sm-text"></div><div class="sm-hint"></div>`, boxG);
    this.textBox = box.querySelector<HTMLElement>('.sm-text');
    this.textHtml = '';
    this.hint = box.querySelector<HTMLElement>('.sm-hint');
    this.body = s.art('Panel', 67, this.small, 220, REEL_Y, 'sm-body', machG);
    const digits = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(d => `<b${d === 7 ? ' class="seven"' : ''}>${d}</b>`).join('');
    this.reels = [0, 1, 2, 3].map(r => {
      if (r < this.small) return null;
      const el = s.box('sm-reel', REEL_X[this.small][r], REEL_Y, 36, 36, `<div class="sm-strip">${digits}</div>`, machG);
      return { el, strip: el.firstElementChild as HTMLElement, at: -1, moved: -99, landed: true };
    });
    this.leverImg = s.art('Panel', 67, this.lever ? 3 : 2, LEVER_X[this.small], 240, 'sm-lever', machG);
    this.render();
  }

  private render() {
    const s = this.scene;
    if (!s || this.closed) return;
    for (let r = this.small; r < 4; r++) this.drum(r);
    this.body?.classList.toggle('spin', this.amount === null);
    s.swap(this.leverImg, 'Panel', 67, this.lever ? 3 : 2);
    if (this.textBox) {
      const html = this.amount === null
        ? esc(this.text)
        : `${this.mult > 1 ? `<span class="sm-bonus${this.mult > 2 ? ' seven' : ''}">${this.mult > 2 ? '777 大獎' : '豹子號'}！×${this.mult}</span>` : ''}<span class="sm-amount">${money(this.amount)}元</span>`;
      // Compared with the last markup written, not innerHTML: 简体 (lang.ts) rewrites the text after it is set.
      if (this.textHtml !== html) { this.textHtml = html; this.textBox.innerHTML = html; }
    }
    if (this.hint) {
      const waiting = this.waiting;
      this.hint.classList.toggle('on', waiting);
      this.hint.textContent = waiting ? '點一下畫面，拉下拉桿！' : '';
      this.leverImg?.classList.toggle('glow', waiting);
    }
  }

  /**
   * Scrolls reel r to the rules' position (0..19, 2k = digit k, odd = half-way): one step forward slides over
   * the frame's 30 ms, so the drum turns smoothly; a jump (the original re-rolls every 10th frame) or the wrap
   * from 9 to 0 is drawn at once. A drum blurs while it turns fast and bounces when it lands on a digit.
   */
  private drum(r: number) {
    const d = this.reels[r];
    if (!d) return;
    const p = this.pos[r];
    if (p === d.at) {
      if (!d.landed && this.f - d.moved > 2 && p % 2 === 0) { d.landed = true; d.el.classList.remove('fast'); d.el.classList.remove('land'); void d.el.offsetWidth; d.el.classList.add('land'); }
      if (this.f - d.moved > 2) d.el.classList.remove('fast');
      return;
    }
    const step = d.at >= 0 && (p - d.at + 20) % 20 === 1;
    const from = d.at;
    d.at = p; d.moved = this.f; d.landed = false;
    d.el.classList.add('fast');
    const H = d.el.clientHeight || 36;
    const set = (v: number, ms: number) => { d.strip.style.transition = ms ? `transform ${ms}ms linear` : 'none'; d.strip.style.transform = `translateY(${-v / 2 * H}px)`; };
    if (step && from === 19) { set(20, SLOT_FRAME_MS); setTimeout(() => { if (d.at === 0) set(0, 0); }, SLOT_FRAME_MS + 5); }
    else set(p, step ? SLOT_FRAME_MS : 0);
  }

  /** One spinning frame of the original's state 1 (re-draw every 10th frame, half a digit per frame). */
  private freeFrame() {
    if (this.f % 10 === 0) for (let r = 0; r < 4; r++) this.pos[r] = Math.floor(Math.random() * 10) * 2 + 1;
    for (let r = this.small; r < 4; r++) this.pos[r] = (this.pos[r] + 1) % 20;
    this.f++;
  }

  /** Runs `step` once per 30 ms frame until it returns false (frames missed while hidden are skipped over). */
  private ticker(step: () => boolean): Promise<void> {
    cancelAnimationFrame(this.raf);
    this.endTicker?.();
    return new Promise(resolve => {
      // Ends when the machine closes too (its frame callback is cancelled then: the wait must not be left open).
      this.endTicker = () => { this.endTicker = null; resolve(); };
      let last = performance.now();
      const loop = (now: number) => {
        if (this.closed) { this.endTicker?.(); return; }
        let n = Math.floor((now - last) / SLOT_FRAME_MS);
        if (n > 0) {
          last += n * SLOT_FRAME_MS;
          if (n > 8) n = 8;
          let go = true;
          while (n-- > 0 && (go = step()));
          this.render();
          if (!go) { this.endTicker?.(); return; }
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    });
  }

  /** Settles the running ticker's promise (a new ticker, or the machine closed). */
  private endTicker: (() => void) | null = null;
  /** Answers the human's spin without a pull (the machine closed before the tap). */
  private unspin: (() => void) | null = null;

  private key = () => this.tap();

  private tap() {
    if (this.closed) return;
    const t = this.onTap;
    if (t) t();
  }

  /** The human's spin: resolves with the pull frame on the first tap; the reels go on turning until play(). */
  spin(): Promise<number> {
    this.waiting = true;
    return new Promise(resolve => {
      // Closed before the tap (the hang guard, a new game): no pull of the player's — the rules pull at frame 39.
      if (this.closed) { resolve(0); return; }
      this.unspin = () => resolve(0);
      this.onTap = () => {
        if (this.tapped) return;
        this.tapped = true;
        this.waiting = false;
        // The click is seen during the wait after frame f − 1: the pull is frame f (at least 1).
        const pull = Math.max(1, this.f);
        this.lever = true;
        audio.ui('click');
        this.render();
        this.unspin = null;
        resolve(pull);
      };
      void this.ticker(() => { this.freeFrame(); return true; });
      this.render();
    });
  }

  /** Plays the rules' frames from `from` to the end, then closes. */
  async play(t: Timeline, from: number) {
    this.onTap = null;
    this.f = from;
    let clicked = from > t.pull;
    const show = (f: number) => {
      this.pos = [...t.reels[Math.min(f, t.reels.length - 1)]];
      this.lever = f >= t.pull && f < t.leverUp;
      if (f === t.pull && !clicked) { clicked = true; audio.ui('click'); }
      if (f >= t.result && this.amount === null) { this.amount = t.amount; this.mult = t.mult; audio.stop(Sfx.slot); if (t.mult > 1) this.jackpot(); }
    };
    // A computer's run: a tap jumps to the result (the human's own reels stop by themselves, as in the original);
    // once the result shows, a tap closes the machine.
    let skip = false;
    this.onTap = () => { if (this.f >= t.result || !t.human) skip = true; };
    show(this.f);
    this.render();
    await this.ticker(() => {
      if (skip) {
        skip = false;
        this.f = this.f < t.result ? t.result : t.end;
      }
      show(this.f);
      if (this.f >= t.end) return false;
      this.f++;
      return true;
    });
    // A jackpot (house rule) stays up a little longer to be enjoyed.
    if (this.mult > 1 && !this.closed) await new Promise(r => setTimeout(r, 1500));
    this.close();
  }

  /**
   * 豹子號 / 777: the reels flash, gold rays burst behind the machine, coins shower down and a big banner pops
   * in (the house rule's celebration; the original has no such result).
   */
  private jackpot() {
    const s = this.scene;
    if (!s) return;
    audio.sfx(Sfx.fireworks);
    s.root.classList.add('sm-jackpot');
    if (this.mult > 2) s.root.classList.add('sm-777');
    const g = this.body?.parentElement ?? s.stage;
    const fx = s.box('sm-fx', 220 - 170, 320 - 170, 340, 340, '', g);
    fx.innerHTML = `<div class="sm-rays"></div>${Array.from({ length: 26 }, () => {
      const x = Math.round(Math.random() * 300 + 20), d = (Math.random() * 0.9).toFixed(2), r = Math.round(Math.random() * 720 - 360), t = (1.1 + Math.random() * 0.8).toFixed(2);
      return `<i class="sm-coin" style="left:${x}px;--r:${r}deg;animation-delay:${d}s;animation-duration:${t}s"></i>`;
    }).join('')}`;
    g.insertBefore(fx, g.firstChild);
    s.box('sm-banner', 220 - 150, 232, 300, 52, this.mult > 2 ? '777 大獎！' : '豹子號！', g);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.raf);
    this.endTicker?.();
    this.unspin?.();
    this.unspin = null;
    window.removeEventListener('keyup', this.key);
    audio.stop(Sfx.slot);
    this.scene?.close();
    if (live === this) live = null;
    machines.delete(this);
  }
}

askScreens['slot-machine'] = async (ctx, a) => {
  const q = a as SlotAsk;
  live?.close();
  const m = new SlotMachine(ctx, q.p, q.god, q.big, true);
  live = m;
  await m.open();
  const pull = await m.spin();
  // Should the rules' frames never come (a new game was loaded meanwhile), the machine does not stay up.
  setTimeout(() => { if (live === m) m.close(); }, 5000);
  return pull;
};

fxScreens['slot-machine'] = async (ctx, fx: Fx) => {
  const d = fx.data ?? {};
  const t: Timeline = {
    reels: (d.reels as number[][]) ?? [], pull: Number(d.pull), leverUp: Number(d.leverUp), result: Number(d.result),
    end: Number(d.end), amount: Number(d.amount), mult: Number(d.mult) || 1, human: !!d.human,
  };
  if (!t.reels.length) return;
  const god = Number(d.god), p = fx.p ?? 0;
  let m = live && !live.closed && live.god === god ? live : null;
  live = null;
  let from = 0;
  if (m) from = t.pull + 1;
  else {
    m = new SlotMachine(ctx, p, god, !!d.big, t.human);
    await m.open();
  }
  await m.play(t, from);
};

export {};
