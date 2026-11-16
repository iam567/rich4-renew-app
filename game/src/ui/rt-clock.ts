/**
 * 即時制's stopwatch (docs/rules/31, the user 2026-11-07: 「轉一圈兒是一天」): the face and the hand drawn by the image
 * server (tools/tycoon-art/rt_clock.py, maps/remake/rt/clock-*.webp); the hand turns once per game day, and the time
 * left of the game shows under it. Drawn without pictures (a plain dial) until they come, or when they are missing.
 */
import { ASSETS } from './assets';

const ART = `${ASSETS}/maps/remake/rt`;

export class RtClock {
  readonly el = document.createElement('div');
  private readonly hand: HTMLElement;
  private readonly left: HTMLElement;

  constructor(parent: HTMLElement, private readonly dayMs: number, private readonly length: number) {
    this.el.className = 'rt-clock';
    this.el.innerHTML = `<div class="rt-dial"><img class="rt-face" src="${ART}/clock-face.webp" alt=""><div class="rt-hand"><img src="${ART}/clock-hand.webp" alt=""></div></div><b class="rt-left"></b>`;
    this.hand = this.el.querySelector<HTMLElement>('.rt-hand')!;
    this.left = this.el.querySelector<HTMLElement>('.rt-left')!;
    for (const img of this.el.querySelectorAll('img')) img.onerror = () => this.el.classList.add('plain');
    parent.append(this.el);
  }

  /** The clock at `now` ms of the game: the hand's angle, the time left (無限制: the elapsed time). */
  show(now: number) {
    this.hand.style.transform = `rotate(${((now % this.dayMs) / this.dayMs) * 360}deg)`;
    const s = Math.max(0, Math.ceil((this.length ? this.length - now : now) / 1000));
    const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const text = this.length ? `剩 ${t}` : t;
    if (this.left.textContent !== text) this.left.textContent = text;
    this.el.classList.toggle('late', !!this.length && s <= 60);
  }

  remove() { this.el.remove(); }
}
