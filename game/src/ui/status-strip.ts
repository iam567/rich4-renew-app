/**
 * 狀態條 (the user 2026-11-23: 「在遊戲主畫面的右上角加一個當前的狀態……一個很小的小條滾動顯示……如果沒有這種事件的話就不用顯示……
 * 有一個小箭頭可以折疊回去」): a small strip at the map's top right that shows the timed states running (ui/statuses.ts)
 * one line at a time, the next every 2.5 s; a tap opens the whole list, the arrow folds it to a small tab (kept per
 * device). Nothing running: nothing shown. Display only.
 */
import type { Game } from '../core/game';
import { CHARACTERS } from '../core/characters';
import type { SpriteBank } from './sprites';
import { StatusMemo, timedStatuses, type TimedStatus } from './statuses';
import './status-strip.css';

const FOLD_KEY = 'rich4.statusFold';
const ROTATE_MS = 2500;
/** What else sits at the map's top right (party, spectators, 試玩, 挑戰 / 大富豪 bars, 即時制's standings): the strip goes under them. */
const ABOVE = '.net-hud, .net-tags, .sp-count, .sp-bar, .trial-end, .chb, .wb, .pc-btn, .rt-rank, .rt-timer';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class StatusStrip {
  readonly el: HTMLElement;
  private readonly line: HTMLElement;
  private readonly count: HTMLElement;
  private readonly list: HTMLElement;
  private readonly memo = new StatusMemo();
  private items: TimedStatus[] = [];
  private at = 0;
  private shownKey = '';
  private lastHtml = '';
  private timer: ReturnType<typeof setInterval> | undefined;
  private folded = false;

  constructor(readonly stage: HTMLElement, readonly game: Game, readonly bank: SpriteBank) {
    try { this.folded = localStorage.getItem(FOLD_KEY) === '1'; } catch { /* not kept */ }
    this.el = document.createElement('div');
    this.el.className = 'ss';
    this.el.hidden = true;
    this.el.innerHTML = '<button class="ss-tog" type="button" aria-label="收起狀態"></button><button class="ss-main" type="button" aria-label="全部狀態"><span class="ss-line"></span><span class="ss-n"></span></button><div class="ss-list" hidden></div>';
    this.line = this.el.querySelector('.ss-line')!;
    this.count = this.el.querySelector('.ss-n')!;
    this.list = this.el.querySelector('.ss-list')!;
    const tog = this.el.querySelector<HTMLButtonElement>('.ss-tog')!;
    tog.onclick = e => { e.stopPropagation(); this.setFolded(!this.folded); };
    this.el.querySelector<HTMLButtonElement>('.ss-main')!.onclick = e => {
      e.stopPropagation();
      if (this.folded) { this.setFolded(false); return; }
      this.list.hidden = !this.list.hidden;
      this.render();
    };
    this.list.onclick = e => { e.stopPropagation(); this.list.hidden = true; };
    // a tap anywhere else closes the list
    stage.addEventListener('pointerdown', e => { if (!this.list.hidden && !this.el.contains(e.target as Node)) this.list.hidden = true; }, true);
    stage.append(this.el);
    this.applyFold();
    this.update();
  }

  private setFolded(v: boolean) {
    this.folded = v;
    try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* not kept */ }
    this.applyFold();
  }

  private applyFold() {
    this.el.classList.toggle('folded', this.folded);
    const tog = this.el.querySelector<HTMLButtonElement>('.ss-tog')!;
    tog.textContent = this.folded ? '◀' : '▶';
    tog.setAttribute('aria-label', this.folded ? '展開狀態' : '收起狀態');
    if (this.folded) this.list.hidden = true;
    this.render();
  }

  /** Reads the game again (the HUD's refresh: each step of the game). */
  update() {
    let items: TimedStatus[] = [];
    try { items = timedStatuses(this.game, this.memo); } catch { items = []; } // (a display: never in the game's way)
    this.items = items;
    if (!items.length) {
      this.el.hidden = true;
      this.list.hidden = true;
      this.stop();
      return;
    }
    const was = this.el.hidden;
    this.el.hidden = false;
    const i = items.findIndex(s => s.key === this.shownKey);
    this.at = i >= 0 ? i : Math.min(this.at, items.length - 1);
    this.render();
    if (was) this.place();
    this.start();
  }

  private start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.el.isConnected) { this.stop(); return; }
      this.place(); // (the party's bars come and go)
      if (this.items.length < 2 || this.folded || !this.list.hidden || document.hidden) return;
      this.at = (this.at + 1) % this.items.length;
      this.render(true);
    }, ROTATE_MS);
  }

  private stop() { if (this.timer) { clearInterval(this.timer); this.timer = undefined; } }

  private face(p: number | undefined): string {
    const pl = p === undefined ? undefined : this.game.players[p];
    if (!pl) return '<i class="ss-dot"></i>';
    const f = this.bank.art('Data', 2, pl.character), c = hex(CHARACTERS[pl.character]?.color ?? 0xffe14a);
    return f ? `<img class="ss-face" style="--c:${c}" src="${f.src}" alt="">` : `<i class="ss-dot" style="--c:${c}"></i>`;
  }

  private row(s: TimedStatus): string {
    return `${this.face(s.p)}<span class="ss-t">${esc(s.text)}</span><b class="ss-d">還剩${s.left}${s.unit}</b>`;
  }

  private render(roll = false) {
    const n = this.items.length;
    if (!n) return;
    const s = this.items[this.at];
    this.shownKey = s.key;
    const html = this.row(s);
    if (html !== this.lastHtml) {
      this.lastHtml = html;
      this.line.innerHTML = html;
      if (roll) { this.line.classList.remove('roll'); void this.line.offsetWidth; this.line.classList.add('roll'); }
    }
    const c = n > 1 ? `${this.at + 1}/${n}` : '';
    if (this.count.textContent !== c) this.count.textContent = c;
    this.el.dataset.n = String(n);
    if (!this.list.hidden) {
      const all = this.items.map(x => `<div class="ss-row">${this.row(x)}</div>`).join('');
      if (this.list.innerHTML !== all) this.list.innerHTML = all;
    }
  }

  /** Under whatever else is at the top right just now. */
  private place() {
    const shell = this.stage.parentElement ?? this.stage;
    const a = this.stage.getBoundingClientRect();
    const w = this.el.offsetWidth || 160;
    let top = 6;
    for (const o of shell.querySelectorAll<HTMLElement>(ABOVE)) {
      if (o === this.el || o.hidden) continue;
      const r = o.getBoundingClientRect();
      if (!r.width || !r.height || r.top > a.top + 200 || r.bottom < a.top) continue;
      if (r.right < a.right - w - 6 || r.left > a.right) continue;
      top = Math.max(top, Math.round(r.bottom - a.top + 4));
    }
    const v = `${top}px`;
    if (this.el.style.top !== v) this.el.style.top = v;
  }

  dispose() { this.stop(); this.el.remove(); }
}
