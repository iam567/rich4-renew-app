/**
 * The top toolbar and the GO button (docs/rules/09 §2, §5), drawn with the redrawn icons.
 */
import type { SpriteBank } from './sprites';
import { audio } from './audio';

/** Toolbar cells in the original order; the icon is Panel#1 frame i+1, enlarged frame i+12. */
export const TOOLBAR = [
  { key: 'help', label: '說明' },
  { key: 'system', label: '系統' },
  { key: 'autopilot', label: '托管' },
  { key: 'load', label: '讀檔' },
  { key: 'save', label: '存檔' },
  { key: 'map', label: '地圖' },
  { key: 'info', label: '查詢' },
  { key: 'tool', label: '道具' },
  { key: 'card', label: '卡片' },
  { key: 'trade', label: '黑市' },
  { key: 'stock', label: '股市' },
] as const;
export type ToolbarKey = (typeof TOOLBAR)[number]['key'];

export class Toolbar {
  readonly el: HTMLElement;
  onAction: (key: ToolbarKey) => void = () => {};

  constructor(bank: SpriteBank) {
    this.el = document.createElement('nav');
    this.el.className = 'toolbar';
    TOOLBAR.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'tb';
      b.dataset.key = t.key;
      b.title = t.label;
      const normal = bank.art('Panel', 1, i + 1), hover = bank.art('Panel', 1, i + 12);
      b.innerHTML = `${normal ? `<img class="tb-n" src="${normal.src}" alt="">` : ''}${hover ? `<img class="tb-h" src="${hover.src}" alt="">` : ''}<span>${t.label}</span>`;
      // Hover (mouse) plays Effect#0, pressing a cell #1 (rich4.asm:11373-11407, 11008-11024).
      b.onpointerenter = e => { if (e.pointerType === 'mouse') audio.ui('hover'); };
      b.onpointerdown = () => audio.ui('click');
      b.onclick = () => this.onAction(t.key);
      this.el.append(b);
    });
  }

  /** Turn actions only work while a human decides to roll (the original's input gate, 09 §1.4). */
  setTurnOpen(open: boolean) { this.el.classList.toggle('turn-open', open); }
}

/** Dice-count slot positions in the 72×67 button by vehicle (09 §5.3): [x, y] of each slot. */
// The original slots are (7,26) / (7,16),(7,35) / (7,9),(7,25),(7,41) with 15 px dice. The redrawn Panel #7
// moved its dice tube: its inside is x 8.75..23.25, y 11.75..55 (centre x 16), so the 14 px dice sit in it.
const SLOTS: Record<number, [number, number][]> = {
  0: [[9, 26.4]], 3: [[9, 26.4]],
  1: [[9, 18.4], [9, 34.4]],
  2: [[9, 12.4], [9, 26.9], [9, 41.4]],
};

export class GoButton {
  readonly el: HTMLElement;
  private face: HTMLImageElement;
  private slots: HTMLElement;
  private blink = false;
  private state = 0;
  private timer = 0;
  private resolve: ((dice: number) => void) | null = null;
  private dice = 1;
  private vehicle = 0;
  private stopped = false;
  private slotsHtml = '';
  /** Position as fractions of the map area, kept for the session (the original does not save it either). */
  private pos = { x: 0.97, y: 0.97 };
  /**
   * The current player's spot in the map area, when known. The original draws GO at (180,120) of its 440×440
   * view, which is centred on the player at (220,260) (09 §5.4), so the button rides just above the character;
   * here it keeps that offset (in original pixels) from the character, and a drag changes the offset.
   */
  anchor: (() => { x: number; y: number; zoom: number } | null) | null = null;
  private offset = { x: 180 - 220, y: 120 - 260 };
  private raf = 0;

  constructor(readonly bank: SpriteBank, readonly area: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'go';
    this.face = document.createElement('img');
    this.face.className = 'go-face';
    this.face.draggable = false;
    this.slots = document.createElement('div');
    this.slots.className = 'go-slots';
    const hit = document.createElement('button');
    hit.className = 'go-hit';
    hit.setAttribute('aria-label', '出發');
    this.el.append(this.face, this.slots, hit);
    // The finger lifting is the press: iOS drops a tap's click when the page changes under it, and the face
    // swaps its picture every 500 ms while blinking, so a click handler alone often needed a second tap.
    let down = -1;
    hit.addEventListener('pointerdown', e => { down = e.pointerId; });
    hit.addEventListener('pointerup', e => { if (e.pointerId === down) { down = -1; this.go(); } });
    hit.addEventListener('pointercancel', () => { down = -1; });
    hit.onclick = () => this.go(); // keyboard and mouse; a second call does nothing once answered
    this.slots.onclick = e => {
      const s = (e.target as HTMLElement).closest<HTMLElement>('[data-n]');
      if (!s || this.stopped) return;
      audio.ui('click'); // dice count (rich4.asm:10669-10735)
      this.dice = Number(s.dataset.n);
      this.render();
    };
    this.bindDrag();
    area.append(this.el);
    this.hide();
  }

  /** Shows the button for a human's turn; resolves with the dice count when GO is pressed. */
  show(vehicle: number, dice: number, maxDice: number, stopped: boolean, turtle: boolean): Promise<number> {
    this.vehicle = vehicle;
    this.dice = Math.max(1, Math.min(maxDice, dice));
    this.stopped = stopped;
    this.state = turtle ? 4 : stopped ? 2 : 0;
    this.el.hidden = false;
    this.place();
    this.render();
    clearInterval(this.timer);
    this.timer = window.setInterval(() => { this.blink = !this.blink; this.render(); }, 500);
    cancelAnimationFrame(this.raf);
    const ride = () => { if (this.el.hidden) return; if (!this.dragging) this.place(); this.raf = requestAnimationFrame(ride); };
    this.raf = requestAnimationFrame(ride);
    return new Promise(r => { this.resolve = r; });
  }

  hide() {
    this.el.hidden = true;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
  }

  /** The number of dice currently picked on the button (kept across a card / tool used before rolling). */
  picked(): number { return this.dice; }

  /** Cancels a pending GO (another action answered the turn). */
  cancel() { this.resolve = null; this.hide(); }

  private go() {
    const r = this.resolve;
    if (!r) return;
    audio.ui('click'); // GO (rich4.asm:10750)
    this.resolve = null;
    this.hide();
    r(this.dice);
  }

  private render() {
    const f = this.bank.art('Panel', 7, this.state + (this.blink ? 1 : 0));
    if (f) this.face.src = f.src;
    const slots = SLOTS[this.vehicle] ?? SLOTS[0];
    const html = slots.map(([x, y], i) => {
      const lit = i <= this.dice - 1 && !this.stopped;
      const a = this.bank.art('Panel', 7, (lit ? 7 : 6) + 2 * i);
      return `<button data-n="${i + 1}" style="left:${(x + (lit ? 0 : 1)) / 72 * 100}%;top:${y / 67 * 100}%">${a ? `<img src="${a.src}" alt="">` : ''}</button>`;
    }).join('');
    // Rebuilt only when it changes (not on every blink), so a tap on a dice count is never lost under the finger.
    if (html !== this.slotsHtml) { this.slotsHtml = html; this.slots.innerHTML = html; }
  }

  private dragging = false;

  private place() {
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const aw = this.area.clientWidth, ah = this.area.clientHeight;
    const at = this.anchor?.();
    if (at) {
      const l = at.x + this.offset.x * at.zoom, t = at.y + this.offset.y * at.zoom;
      this.el.style.left = `${Math.max(0, Math.min(aw - w, l))}px`;
      this.el.style.top = `${Math.max(0, Math.min(ah - h, t))}px`;
      return;
    }
    this.el.style.left = `${Math.max(0, Math.min(aw - w, this.pos.x * (aw - w)))}px`;
    this.el.style.top = `${Math.max(0, Math.min(ah - h, this.pos.y * (ah - h)))}px`;
  }

  /** The purple frame drags the button (09 §5.4). */
  private bindDrag() {
    let start: { x: number; y: number; l: number; t: number; moved: boolean } | null = null;
    this.face.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.face.setPointerCapture(e.pointerId);
      start = { x: e.clientX, y: e.clientY, l: this.el.offsetLeft, t: this.el.offsetTop, moved: false };
      this.dragging = true;
    });
    this.face.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
      const aw = this.area.clientWidth - this.el.offsetWidth, ah = this.area.clientHeight - this.el.offsetHeight;
      const l = Math.max(0, Math.min(aw, start.l + dx)), t = Math.max(0, Math.min(ah, start.t + dy));
      this.el.style.left = `${l}px`; this.el.style.top = `${t}px`;
      this.pos = { x: aw > 0 ? l / aw : 0, y: ah > 0 ? t / ah : 0 };
      const at = this.anchor?.();
      if (at && at.zoom > 0) this.offset = { x: (l - at.x) / at.zoom, y: (t - at.y) / at.zoom };
    });
    this.face.addEventListener('pointerup', () => { start = null; this.dragging = false; });
    this.face.addEventListener('pointercancel', () => { start = null; this.dragging = false; });
    new ResizeObserver(() => { if (!this.el.hidden) this.place(); }).observe(this.area);
  }
}
