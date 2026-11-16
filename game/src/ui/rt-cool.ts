/**
 * 即時制's cooldown (the user 2026-11-08: show that this is the wait between two moves): the player's own character
 * waiting with an hourglass (two frames in turn, tools/tycoon-art/rt_wait.py) and a countdown 3 – 2 – 1 over the
 * cooldown, written each character's own way (the user: 孫小美 叁貳壹, 沙隆巴斯 Arabic numerals, the Japanese ones
 * kanji …) on a badge of their own, where GO stands (the user: GO hidden, this shown, and back). Hidden the rest of
 * the time; without the pictures, only the countdown.
 */
import { ASSETS } from './assets';

const ART = `${ASSETS}/maps/remake/rt`;

/** Each character's 3, 2, 1 (by character id) and its badge's look (rt-cool.c<id> in style.css). */
const COUNT: Record<number, [string, string, string]> = {
  0: ['3', '2', '1'],          // 約翰喬: a sheriff's star
  1: ['٣', '٢', '١'],          // 沙隆巴斯: Arabic numerals, a golden crescent
  2: ['三', '二', '一'],        // 忍太郎: brush kanji on a shuriken
  3: ['參', '貳', '壹'],        // 錢夫人: on a gold ingot
  4: ['三', '二', '一'],        // 阿土伯: brush on red couplet paper
  5: ['Ⅲ', 'Ⅱ', 'Ⅰ'],          // 莎拉公主: Roman numerals, a jewelled crown
  6: ['三', '二', '一'],        // 宮本寶藏: on a wooden tablet
  7: ['3', '2', '1'],          // 糖糖: a candy
  8: ['|||', '||', '|'],       // 烏咪: tally marks on a carved totem
  9: ['叁', '贰', '壹'],        // 孫小美: a red lantern
  10: ['3', '2', '1'],         // 小丹尼: a basketball
  11: ['셋', '둘', '하나'],      // 金貝貝: Korean, a baby bottle
};

export class RtCool {
  readonly el = document.createElement('div');
  private readonly img: HTMLImageElement;
  private readonly num: HTMLElement;
  private frames: [string, string];
  private shownN = -1;

  private readonly nums: [string, string, string];

  /** `total`: the cooldown's length (ms): 3, 2, 1 each a third of it. */
  constructor(parent: HTMLElement, character: number, private readonly total: number) {
    this.nums = COUNT[character] ?? ['3', '2', '1'];
    this.el.className = `rt-cool c${character}`;
    this.el.hidden = true;
    this.el.innerHTML = `<img alt=""><b></b>`;
    this.img = this.el.querySelector('img')!;
    this.num = this.el.querySelector('b')!;
    this.frames = [`${ART}/wait-${character}-a.webp`, `${ART}/wait-${character}-b.webp`];
    this.img.onerror = () => {
      // no picture for this character: the hourglass, else only the number
      if (this.frames[0].includes('/wait-')) { this.frames = [`${ART}/cool-a.webp`, `${ART}/cool-b.webp`]; this.img.src = this.frames[0]; }
      else this.img.hidden = true;
    };
    this.img.src = this.frames[0];
    parent.append(this.el);
  }

  /** `left`: ms of the cooldown left (0 or less: hidden). */
  show(left: number) {
    const on = left > 0;
    if (this.el.hidden === on) this.el.hidden = !on;
    if (!on) { this.shownN = -1; return; }
    // 3 – 2 – 1 over the cooldown (the user: 2 s, read quickly)
    const n = Math.max(1, Math.min(3, Math.ceil((left / this.total) * 3)));
    if (n !== this.shownN) { this.shownN = n; this.num.textContent = this.nums[3 - n]; this.num.classList.remove('pop'); void this.num.offsetWidth; this.num.classList.add('pop'); }
    const f = this.frames[Math.floor(performance.now() / 350) % 2];
    if (!this.img.hidden && !this.img.src.endsWith(f.slice(f.lastIndexOf('/')))) this.img.src = f;
  }

  /** Stands centred on (x, y) of its parent: where GO is, GO being hidden while it waits. */
  moveTo(x: number, y: number) {
    const l = `${Math.round(x)}px`, t = `${Math.round(y)}px`;
    if (this.el.style.left !== l) this.el.style.left = l;
    if (this.el.style.top !== t) this.el.style.top = t;
  }

  remove() { this.el.remove(); }
}
