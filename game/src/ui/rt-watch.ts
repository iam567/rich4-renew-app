/**
 * 即時制's little stopwatch (the user 2026-11-08: a cute one): the seconds left before the game answers for this player
 * — their turn's first move (RT.move: then it rolls) or a shop, the bank, the magic house, the lottery (RT.indoors:
 * then they come out). Its ring empties as the time goes; the last seconds it rocks from side to side with a 噔 each
 * second. Small, beside the map's buttons at the top left (the user 2026-11-08: anywhere else it covers something), the
 * seconds and what then in a little pill beside it. Hidden the rest of the time.
 * Dragged anywhere it stays there (the user 2026-11-08: wherever suits), kept per place — the map or a shop, landscape
 * or portrait — as a share of the screen; a double tap puts it back.
 */
import { audio } from './audio';

/** The last seconds: rocking and 噔. */
const URGENT = 5;
const R = 33, RING = 2 * Math.PI * R;
const KEY = 'rich4.rt.timerAt';

type Spots = Record<string, [number, number]>;
const loadSpots = (): Spots => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Spots; } catch { return {}; } };

export class RtWatch {
  readonly el = document.createElement('div');
  private readonly num: HTMLElement;
  private readonly ring: SVGCircleElement;
  private shownS = -1;
  /** Where it was dragged to, by place (moveTo's `place`): its top left as a share of the screen. */
  private readonly spots = loadSpots();
  private place = '';
  private dragging = false;

  constructor(parent: HTMLElement) {
    this.el.className = 'rt-timer';
    this.el.hidden = true;
    this.el.innerHTML = `<div class="rt-timer-body"><svg viewBox="0 0 100 112" aria-hidden="true">
      <rect x="42" y="2" width="16" height="12" rx="5" fill="#ff8fb1" stroke="#6b3a22" stroke-width="3.5"/>
      <rect x="46" y="12" width="8" height="10" fill="#6b3a22"/>
      <g transform="rotate(-40 50 64)"><rect x="43" y="10" width="14" height="10" rx="4" fill="#ffd25a" stroke="#6b3a22" stroke-width="3.5"/></g>
      <g transform="rotate(40 50 64)"><rect x="43" y="10" width="14" height="10" rx="4" fill="#ffd25a" stroke="#6b3a22" stroke-width="3.5"/></g>
      <circle cx="50" cy="64" r="44" fill="#fff8e6" stroke="#6b3a22" stroke-width="5"/>
      <circle cx="50" cy="64" r="${R}" fill="none" stroke="#f3e2c0" stroke-width="7"/>
      <circle class="rt-timer-ring" cx="50" cy="64" r="${R}" fill="none" stroke-width="7" stroke-linecap="round"
        stroke-dasharray="${RING}" transform="rotate(-90 50 64)"/>
      <circle cx="37" cy="50" r="3.2" fill="#3a2414"/><circle cx="63" cy="50" r="3.2" fill="#3a2414"/>
      <circle cx="38.2" cy="48.8" r="1.1" fill="#fff"/><circle cx="64.2" cy="48.8" r="1.1" fill="#fff"/>
      <ellipse cx="28" cy="72" rx="6" ry="3.6" fill="#ffadc4" opacity=".85"/><ellipse cx="72" cy="72" rx="6" ry="3.6" fill="#ffadc4" opacity=".85"/>
    </svg></div><span class="rt-timer-what"><b></b><i></i></span>`;
    this.num = this.el.querySelector('b')!;
    this.ring = this.el.querySelector('.rt-timer-ring')!;
    this.drag();
    parent.append(this.el);
  }

  /** Dragging it (a finger or the mouse): it stays where let go; a double tap puts it back where it was at first. */
  private drag() {
    let dx = 0, dy = 0, id = -1, x0 = 0, y0 = 0, lastTap = 0;
    const at = (x: number, y: number) => {
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      x = Math.max(0, Math.min(window.innerWidth - w, x)); y = Math.max(0, Math.min(window.innerHeight - h, y));
      this.el.classList.add('free');
      this.el.style.left = `${Math.round(x)}px`; this.el.style.top = `${Math.round(y)}px`;
      return [x / window.innerWidth, y / window.innerHeight] as [number, number];
    };
    for (const ev of ['pointerdown', 'touchstart', 'wheel'] as const) this.el.addEventListener(ev, e => e.stopPropagation(), { passive: true });
    this.el.addEventListener('pointerdown', e => {
      const r = this.el.getBoundingClientRect();
      dx = e.clientX - r.left; dy = e.clientY - r.top; id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
      this.dragging = true;
      this.el.setPointerCapture(id);
    });
    // (a few pixels first: a tap is not a drag)
    this.el.addEventListener('pointermove', e => { if (this.dragging && e.pointerId === id && Math.hypot(e.clientX - x0, e.clientY - y0) > 4) at(e.clientX - dx, e.clientY - dy); });
    const end = (e: PointerEvent) => {
      if (!this.dragging || e.pointerId !== id) return;
      this.dragging = false;
      if (Math.hypot(e.clientX - x0, e.clientY - y0) <= 4) {
        // a double tap: back where it was at first
        if (e.timeStamp - lastTap < 400) { delete this.spots[this.place]; this.save(); this.el.classList.remove('free'); lastTap = 0; } else lastTap = e.timeStamp;
        return;
      }
      const r = this.el.getBoundingClientRect();
      this.spots[this.place] = at(r.left, r.top); this.save();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
  }

  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.spots)); } catch { /* not kept */ } }

  /** `left` ms of `total` left (null: hidden); `what`: a word under it (擲骰, 離店). */
  show(left: number | null, total = 1, what = '') {
    const on = left !== null && left > 0;
    if (this.el.hidden === on) this.el.hidden = !on;
    if (!on) { this.shownS = -1; this.el.classList.remove('urgent'); return; }
    const f = Math.max(0, Math.min(1, left / total));
    this.ring.style.strokeDashoffset = `${RING * (1 - f)}`;
    this.ring.style.stroke = f > 0.5 ? '#5cc96b' : f > 0.25 ? '#ffb02e' : '#ff5a5a';
    const s = Math.ceil(left / 1000);
    if (s === this.shownS) return;
    this.shownS = s;
    this.num.textContent = String(s);
    this.el.querySelector('.rt-timer-what i')!.textContent = what;
    const urgent = s <= URGENT;
    this.el.classList.toggle('urgent', urgent);
    if (urgent) this.dun(s === 1);
  }

  /**
   * Places it (its left edge, its middle) at x, y on the page — unless dragged somewhere for this `place` (map / shop,
   * landscape / portrait); `stack`: the pill under the stopwatch (a narrow margin).
   */
  moveTo(x: number, y: number, stack = false, place = 'map') {
    if (this.dragging) return;
    this.place = `${place}-${window.innerWidth > window.innerHeight ? 'l' : 'p'}`;
    this.el.classList.toggle('stack', stack);
    const s = this.spots[this.place];
    if (s) {
      const w = this.el.offsetWidth, h = this.el.offsetHeight;
      this.el.classList.add('free');
      this.el.style.left = `${Math.round(Math.max(0, Math.min(window.innerWidth - w, s[0] * window.innerWidth)))}px`;
      this.el.style.top = `${Math.round(Math.max(0, Math.min(window.innerHeight - h, s[1] * window.innerHeight)))}px`;
      return;
    }
    this.el.classList.remove('free');
    this.el.style.left = `${Math.round(x)}px`; this.el.style.top = `${Math.round(y)}px`;
  }

  /** 噔: a short bright note (higher on the last second), on the effect volume. */
  private dun(last: boolean) {
    const a = audio.ambience();
    if (!a) return;
    const t = a.ctx.currentTime, o = a.ctx.createOscillator(), g = a.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(last ? 1320 : 880, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(a.out);
    o.start(t);
    o.stop(t + 0.18);
  }

  remove() { this.el.remove(); }
}
