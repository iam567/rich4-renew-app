/**
 * Messages and questions over the map (docs/rules/09 §6): the message box, YES/NO, the character speech
 * cloud, news/fate boards and the choice dialogs. Drawn as crisp vector UI in the game's toy style, with the
 * redrawn portraits and art; text is real text.
 */
import { CHARACTERS, playerName } from '../core/characters';
import type { Game } from '../core/game';
import type { Ask } from '../core/types';
import type { PlayerPanel, Calendar } from './side';
import type { SpriteBank } from './sprites';
import { StockScreen } from './stock-screen';
import { tycoon } from './tycoon';
import { askKey, askScreens, type ScreenContext } from './screens/registry';
import './screens';
import { itemText, shortHtml } from './screens/item-text';
import { audio, boardVoice, characterVoice, voiceOf } from './audio';
import { fitPhrases, phrases, shrinkText } from './text';

const money = (n: number) => n.toLocaleString('zh-Hant');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** Message text, broken only between clauses (text.ts). */
const lines = (s: string) => phrases(s);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Hud {
  /** Everything shown, newest first (for the 查詢 screen). */
  readonly log: { text: string; color?: number }[] = [];
  private layer: HTMLElement;
  /** Told when a dialog opens or closes, with the dialog's top edge relative to the map's height. */
  onModal: (top: number | null) => void = () => {};
  /** Time scale of notices (game speed). */
  scale = () => 1;

  constructor(readonly area: HTMLElement, readonly game: Game, readonly bank: SpriteBank,
              readonly panel: PlayerPanel, readonly calendar: Calendar) {
    this.layer = el('div', 'ui-layer');
    area.append(this.layer);
    this.refresh();
  }

  refresh() { this.panel.update(); this.calendar.update(); }

  note(text: string, color?: number) {
    if (!text) return;
    this.log.unshift({ text: text.replace(/\n+/g, ' '), color });
    if (this.log.length > 200) this.log.pop();
  }

  private portrait(character: number): string {
    const f = this.bank.art('Data', 2, character);
    return f ? `<img src="${f.src}" alt="">` : '';
  }

  /** What the full screens (screens/registry.ts) get to work with. */
  context(shell: HTMLElement, question = false): ScreenContext {
    // Each screen closes only what it opened (hide(node)); a question's boxes wait under a box that covers them.
    let mine: HTMLElement | undefined;
    return {
      game: this.game, bank: this.bank, area: this.area, shell,
      open: (node, full) => { mine = node; if (question) node.dataset.keep = '1'; this.show(node, full); },
      close: () => { if (mine) this.hide(mine); }, scale: this.scale,
      flash: (text, ms) => this.flash(text, ms),
    };
  }
  /** Set by the controller: the game screen element, for full-screen scenes. */
  shell: HTMLElement | null = null;

  /**
   * The layer over the whole game screen (toolbar, map and side panels) for the big sheets — 查詢, 股市, 地圖, 說明,
   * 各地動態 — which need more room than the map area leaves on a phone; made on first use.
   */
  private fullLayer: HTMLElement | null = null;

  /**
   * Questions still waiting for their answer that another box covered (a tap on the toolbar's 「請在自己的回合使用」,
   * 查詢 …): shown again when that box closes. Only questions (`data-keep`) wait here; a notice is gone once covered.
   */
  private under: { node: HTMLElement; full: boolean }[] = [];
  private shown(): { node: HTMLElement; full: boolean } | null {
    const a = this.layer.firstElementChild as HTMLElement | null;
    if (a) return { node: a, full: false };
    const b = this.fullLayer?.firstElementChild as HTMLElement | null;
    return b ? { node: b, full: true } : null;
  }

  /** While a question builds its boxes (ask): every box shown, so its answer closes whichever is up. */
  private collect: HTMLElement[] | null = null;
  /** Closes the first of `nodes` on screen; those covered are forgotten (answered: they do not come back). */
  private hideAny(nodes: HTMLElement[]) {
    const up = nodes.find(n => n.parentElement === this.layer || (!!this.fullLayer && n.parentElement === this.fullLayer));
    if (up) this.hide(up);
    for (const n of nodes) if (n !== up) this.under = this.under.filter(u => u.node !== n);
  }

  private show(node: HTMLElement, full = false, restoring = false) {
    if (this.collect && !restoring) { this.collect.push(node); node.dataset.keep = '1'; }
    if (full && this.shell && !this.fullLayer) { this.fullLayer = el('div', 'ui-layer full'); this.shell.append(this.fullLayer); }
    const now = this.shown();
    if (!restoring && now && now.node !== node && now.node.dataset.keep) this.under.push(now);
    this.under = this.under.filter(u => u.node !== node);
    const target = full && this.fullLayer ? this.fullLayer : this.layer;
    const other = target === this.layer ? this.fullLayer : this.layer;
    if (other) { other.classList.remove('show'); other.replaceChildren(); }
    target.replaceChildren(node);
    target.classList.add('show');
    // A clause longer than the line: the text a little smaller rather than broken inside the clause.
    for (const t of node.querySelectorAll<HTMLElement>('.msg-text')) fitPhrases(t, 0.8);
    // A long title stays on its ribbon's one line, smaller rather than wider than the dialog.
    shrinkText(node, ':scope > .ribbon', 12);
    requestAnimationFrame(() => {
      if (target !== this.layer) { this.onModal(null); return; }
      const box = node.getBoundingClientRect(), area = this.area.getBoundingClientRect();
      this.onModal(area.height ? (box.top - area.top) / area.height : null);
    });
  }
  /**
   * Clears the dialog layers. With `node`: only while that node is what they show — a screen closing late (its own
   * timer, a tap that came in as the next one opened) must not take the next screen away with it: the game then
   * waited on a question nobody could see (the user, fast taps after a card, 2026-10-19).
   */
  /** Closes whatever dialog is up (派對模式: a turn's 60 s ran out with a menu open). */
  dismiss() { this.under = []; this.hide(); }

  private hide(node?: HTMLElement) {
    if (node && node.parentElement !== this.layer && (!this.fullLayer || node.parentElement !== this.fullLayer)) {
      this.under = this.under.filter(u => u.node !== node); // answered while covered: it does not come back
      return;
    }
    for (const l of [this.layer, this.fullLayer]) { l?.classList.remove('show'); l?.replaceChildren(); }
    this.onModal(null);
    // A question the closed box covered comes back.
    const back = node ? this.under.pop() : undefined;
    if (!node) this.under = [];
    if (back) this.show(back.node, back.full, true);
  }

  /**
   * A grid of pictures (cards, tools, faces) on one page whatever their number and the screen: picks the column count
   * that gives the biggest picture in the dialog layer's free box (no column narrower than the longest name), sizes the
   * pictures to it (CSS vars on the row), and does it again when the layer changes size (rotation). Where height is
   * short (landscape) 取消 becomes the grid's last cell instead of a row of its own.
   */
  /** A touch long-press on a grid button shows `text` in a bubble at the top of the box, and the tap is not taken. */
  private longInfo(b: HTMLButtonElement, box: HTMLElement, text: string) {
    let timer = 0, long = false;
    b.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      long = false;
      timer = window.setTimeout(() => {
        long = true;
        box.querySelector('.tile-info')?.remove();
        const tip = el('div', 'tile-info', esc(text));
        box.append(tip);
        setTimeout(() => tip.remove(), 2600);
      }, 420);
    });
    const up = () => clearTimeout(timer);
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    b.addEventListener('click', e => { if (long) { long = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  }

  private fitTiles(box: HTMLElement, row: HTMLElement, cancel: HTMLElement | null, ratio: number, MAX_H: number) {
    const cancelRow = cancel?.parentElement ?? null;
    if (!row.childElementCount) return;
    const GAP = 8;
    const fit = () => {
      if (!box.isConnected) { ro.disconnect(); return; }
      box.style.zoom = '';
      box.style.maxHeight = '';
      const { W, H } = this.room(box);
      if (W <= 0 || H <= 0) return;
      box.classList.add('card-grid');
      const short = H < W * 0.75;
      box.classList.toggle('short', short);
      if (cancel && cancelRow) {
        if (short && cancel.parentElement !== row) { row.append(cancel); cancelRow.hidden = true; }
        if (!short && cancel.parentElement === row) { cancelRow.append(cancel); cancelRow.hidden = false; }
      }
      const n = row.childElementCount;
      // Measure one tile around its picture at a known size (name at its default size)…
      const set = (h: number, cols: number) => {
        row.style.setProperty('--ph', `${h}px`); row.style.setProperty('--pw', `${Math.floor(h / ratio)}px`); row.style.setProperty('--cols', String(cols));
      };
      row.style.removeProperty('--fs');
      set(90, Math.min(n, 8));
      const tile = row.firstElementChild as HTMLElement, pic = tile.querySelector<HTMLElement>('.tile-pic')!;
      const tw = tile.offsetWidth - pic.offsetWidth, th = tile.offsetHeight - pic.offsetHeight;
      // the narrowest a cell may be: the longest name (at the smallest font) with the tile's padding
      const pad = parseFloat(getComputedStyle(tile).paddingLeft) + parseFloat(getComputedStyle(tile).paddingRight) + 6;
      const names = [...row.querySelectorAll<HTMLElement>('.tile-name')];
      const name10 = names.length ? Math.max(...names.map(e => e.scrollWidth)) * 10 / parseFloat(getComputedStyle(names[0]).fontSize) : 0;
      // the names' size for a picture height, at most what lets the longest one fit its cell
      const fsFor = (h: number, cellW: number) => Math.min(Math.max(10.5, Math.min(14, 9 + h / ratio / 14)), name10 ? (cellW - pad) * 10 / name10 : 14);
      // …and the dialog around a tiny grid, so it is not capped by max-height (grid margins count in the chrome,
      // offsetHeight leaves them out; the dialog is at most 760 wide).
      set(4, n);
      const chromeW = box.offsetWidth - row.clientWidth, chromeH = box.offsetHeight - row.offsetHeight;
      const rowW = Math.min(W, 760) - chromeW - 6, rowH = H - chromeH - 4; // (a few px spare for rounding)
      let best = { cols: 1, h: 0, fs: 12 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols), cellW = (rowW - GAP * (cols - 1)) / cols;
        const byW = (cellW - tw) * ratio;
        const byH = (rowH - (GAP + 5) * (rows - 1) - 5) / rows - th;
        const h = Math.min(byW, byH, MAX_H), fs = fsFor(h, cellW);
        if (cols > 1 && fs < 10) break; // no column narrower than the longest name at 10 px
        // Bigger pictures first; at the same size (capped at MAX_H on a wide screen) fewer rows, then the fewest
        // columns for those rows (balanced rows) — it used to stop at two columns, a tall narrow strip in a wide
        // dialog (the user 2026-10-23: 「道具排列…這麼醜」).
        const bestRows = Math.ceil(n / best.cols);
        if (h > best.h + 0.5 || (h > best.h - 0.5 && rows < bestRows)) best = { cols, h, fs };
      }
      // Pictures too small for the map area (a small phone): the dialog moves over the whole game screen.
      if (best.h < MAX_H * 0.5 && this.promote(box, ro)) return;
      const h = Math.max(24, Math.floor(best.h));
      set(h, best.cols);
      row.style.setProperty('--fs', `${Math.max(10, best.fs).toFixed(1)}px`);
      this.shrink(box, H);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(this.layer);
    fit();
  }

  /**
   * Any other dialog: when it is taller than the map area (a small phone), it moves over the whole game screen, and
   * only an extreme screen shrinks it as a whole. Again on rotation.
   */
  private fitBox(box: HTMLElement) {
    const fit = () => {
      if (!box.isConnected) { ro.disconnect(); return; }
      box.style.zoom = '';
      box.style.maxHeight = '';
      const { H } = this.room(box);
      if (H <= 0 || box.scrollHeight <= H + 0.5) return;
      if (this.promote(box, ro)) return;
      this.shrink(box, H);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(this.layer);
    fit();
  }

  /** Moves a dialog from the map area to the whole game screen (once); true when it moved. */
  private promote(box: HTMLElement, ro: ResizeObserver): boolean {
    if (box.parentElement !== this.layer || !this.shell) return false;
    this.show(box, true);
    if (this.fullLayer) ro.observe(this.fullLayer);
    return true;
  }

  /** The last resort for an extreme screen: the dialog shrinks as a whole to the room `H`. */
  private shrink(box: HTMLElement, H: number) {
    box.style.zoom = '';
    box.style.maxHeight = '';
    if (box.scrollHeight <= H + 0.5) return;
    box.style.maxHeight = 'none';
    box.style.zoom = String(Math.max(0.6, H / box.scrollHeight));
  }

  /** The free box of the dialog layer for `box` (CSS px): its width and height, less the box's top margin. */
  private room(box: HTMLElement) {
    const layer = box.parentElement ?? this.layer, ls = getComputedStyle(layer);
    const W = layer.clientWidth - parseFloat(ls.paddingLeft) - parseFloat(ls.paddingRight);
    const H = layer.clientHeight - parseFloat(ls.paddingTop) - parseFloat(ls.paddingBottom) - parseFloat(getComputedStyle(box).marginTop);
    return { W, H };
  }

  /**
   * A list of choices on one page whatever their number (up to ~16) and the screen: the labels stay on one line, the
   * grid takes as many columns as the widest label allows, and the font steps down (18 → 13 px) until the whole
   * dialog fits the layer; only an extreme screen shrinks the dialog as a whole. Again on rotation.
   */
  private fitChoices(box: HTMLElement, row: HTMLElement) {
    const items = [...row.children] as HTMLElement[];
    const n = items.length;
    if (!n) return;
    box.classList.add('fit-list');
    row.classList.remove('scroll');
    row.classList.add('fit');
    const fit = () => {
      if (!box.isConnected) { ro.disconnect(); return; }
      box.style.zoom = '';
      box.style.maxHeight = '';
      const { H } = this.room(box);
      if (H <= 0) return;
      for (const fs of [18, 17, 16, 15, 14, 13]) {
        // Still too tall at 15 px in the map area (a small phone): the list moves over the whole game screen.
        if (fs === 14 && this.promote(box, ro)) return;
        row.style.setProperty('--fs', `${fs}px`);
        row.classList.add('measure');
        const widest = Math.max(...items.map(b => b.offsetWidth));
        row.classList.remove('measure');
        const gap = parseFloat(getComputedStyle(row).columnGap) || 8;
        const most = Math.max(1, Math.min(n, Math.floor((row.clientWidth + gap) / (widest + gap))));
        const cols = Math.ceil(n / Math.ceil(n / most)); // the same rows, balanced
        row.style.setProperty('--cols', String(cols));
        if (box.scrollHeight <= H + 0.5) return;
      }
      this.shrink(box, H);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(this.layer);
    fit();
  }

  /** Faces to pick (pick-player): the faces get smaller until every one shows on the page. */
  private fitFaces(box: HTMLElement, row: HTMLElement) {
    const fit = () => {
      if (!box.isConnected) { ro.disconnect(); return; }
      box.style.zoom = '';
      box.style.maxHeight = '';
      const { H } = this.room(box);
      if (H <= 0) return;
      for (const f of [64, 56, 48, 40, 34]) {
        if (f === 40 && this.promote(box, ro)) return;
        row.style.setProperty('--face', `${f}px`);
        if (box.scrollHeight <= H + 0.5) return;
      }
      this.shrink(box, H);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(this.layer);
    fit();
  }

  /**
   * Waits `ms` (scaled by game speed) or until a tap, as the original's notices do (09 §6.1). With a voice,
   * `fcn_004544f6(ms)`: the notice stays while the line is spoken and at least `ms`; a tap ends both.
   */
  private hold(node: HTMLElement, ms: number, voice?: number): Promise<void> {
    this.show(node);
    const spoken = voice !== undefined ? audio.voice(voice) : Promise.resolve();
    return new Promise(resolve => {
      let done = false, timeUp = false, said = voice === undefined;
      const end = () => {
        if (done) return;
        done = true;
        this.layer.removeEventListener('pointerup', tap);
        if (voice !== undefined) audio.stopVoice();
        this.hide(node);
        resolve();
      };
      const tap = () => end();
      this.layer.addEventListener('pointerup', tap);
      setTimeout(() => { timeUp = true; if (said) end(); }, ms * this.scale());
      void spoken.then(() => { said = true; if (timeUp) end(); });
    });
  }

  /** The message box: a notice that closes by itself (default 1500 ms); the original's voiced lines speak. */
  flash(text: string, ms = 1500): Promise<void> {
    return this.hold(el('div', 'msg', `<div class="msg-text">${lines(text)}</div>`), ms, voiceOf(text));
  }

  /** The speech cloud with the speaker's face (09 §6.3), with the character's voice for the line. */
  say(p: number, text: string, ms = 1300): Promise<void> {
    const ch = CHARACTERS[this.game.players[p]?.character ?? 0];
    return this.hold(el('div', 'cloud', `<div class="cloud-face">${this.portrait(ch.id)}</div>
      <div class="cloud-body"><b>${playerName(this.game.players[p])}</b><div>${lines(text)}</div></div>`), ms, characterVoice(ch.id, text) ?? voiceOf(text));
  }

  /** News and fate boards (09 §6.6) over the map. */
  board(kind: 'news' | 'fate', text: string, id?: number, ms = 2400): Promise<void> {
    const bg = this.bank.art('Panel', 66, kind === 'news' ? 0 : 1);
    const pic = kind === 'news' && id !== undefined ? this.bank.art('Data', 441 + id) : null;
    const node = el('div', `board-card ${kind}`, `${bg ? `<img class="board-bg" src="${bg.src}" alt="">` : ''}
      ${pic ? `<img class="board-pic" src="${pic.src}" alt="">` : ''}
      <div class="board-title">${kind === 'news' ? '新聞快報' : '命運'}</div>
      <div class="board-text">${lines(text)}</div>`);
    return this.hold(node, ms, id !== undefined ? boardVoice(kind, id, this.game.mapSlot) : undefined);
  }

  /** Ask a human player (not the turn itself: that is the GO button). */
  ask(a: Exclude<Ask, { t: 'turn' }>): Promise<unknown> {
    const screen = askScreens[askKey(a)];
    if (screen) return screen(this.context(this.shell ?? this.area, true), a);
    const who = this.game.players[a.p], ch = CHARACTERS[who?.character ?? 0];
    // Every box this question shows (its own, or a sheet such as 股市's): its answer closes whichever is up.
    const mine: HTMLElement[] = [], prev = this.collect;
    this.collect = mine;
    const asked = new Promise(resolve => {
      const box = el('div', 'msg ask');
      box.dataset.keep = '1'; // a question: it waits under a box that covers it (show / hide)
      const done = (v: unknown) => { this.hideAny(mine.length ? mine : [box]); resolve(v); };
      const head = (title: string) => `<div class="ribbon"><span class="ribbon-face">${this.portrait(ch.id)}</span>${esc(title)}</div>`;
      const row = el('div', 'choices');
      // YES / confirm Effect#2, NO / cancel #4, other choices click #1, mouse hover #0 (rich4_ui_yesno.asm).
      const button = (label: string, value: unknown, kind = 'opt', disabled = false) => {
        const b = el('button', `candy ${kind}`, label) as HTMLButtonElement;
        b.disabled = disabled;
        b.onclick = () => { audio.ui(kind === 'yes' ? 'yes' : kind === 'no' || kind === 'ghost' ? 'no' : 'click'); done(value); };
        b.onpointerenter = e => { if (e.pointerType === 'mouse' && !b.disabled) audio.ui('hover'); };
        row.append(b);
        return b;
      };
      if (a.t === 'yesno') {
        box.innerHTML = `${head(playerName(who))}<div class="msg-text">${lines(a.text)}</div>`;
        row.className = 'choices yesno';
        button('YES 是', true, 'yes'); button('NO 否', false, 'no');
      } else if (a.t === 'facility-type') {
        // One row of the five facilities, each shown by its icon from the original's strip Data#517.4 (355×83,
        // the icons' boxes below; the HD strip is a full redesign of the five icons at the same places).
        box.classList.add('fac');
        box.innerHTML = `${head(a.title ?? '請選擇設施類別')}<div class="msg-text">${a.text ? esc(a.text) : a.price ? `建設費用 ${money(a.price)} 元` : '免費建設'}</div>`;
        row.className = 'choices facilities';
        const strip = this.bank.art('Data', 517, 4), ICON_X = [9, 78, 147, 215, 283];
        ['公園', '旅館', '購物中心', '加油站', '研究所'].forEach((t, i) => {
          const pic = strip ? `<span class="fac-pic"><i style="background-image:url('${strip.src}');--x:${ICON_X[i]}"></i></span>` : '';
          button(`${pic}<span class="fac-name">${t}</span>`, i, 'cell fac-cell');
        });
        if (a.cancellable) {
          const c = el('div', 'choices tiles-cancel'); const b = el('button', 'candy ghost', '取消'); b.onclick = () => { audio.ui('no'); done(-1); }; c.append(b); box.append(row, c);
          this.show(box);
          this.fitBox(box);
          return;
        }
      } else if (a.t === 'choose' && a.layout) {
        // Tool and card grids (09 §7.2-7.3): every item on one page, with its picture.
        box.classList.add('tiles');
        box.innerHTML = `${head(a.title)}${a.text ? `<div class="msg-text small">${lines(a.text)}</div>` : ''}`;
        row.className = `choices tiles ${a.layout}`;
        for (const o of a.options) {
          const pic = o.icon ? this.bank.art(o.icon.archive, o.icon.id, o.icon.frame ?? 0) : null;
          const b = button(`<span class="tile-pic">${pic ? `<img src="${pic.src}" alt="">` : ''}</span><span class="tile-name">${esc(o.label)}</span>${o.hint ? `<span class="tile-hint">${shortHtml(o.hint)}</span>` : ''}${o.detail && a.layout === 'tiles' ? `<span class="tile-count">${esc(o.detail)}</span>` : ''}${o.detail && a.layout === 'lab' ? `<span class="tile-need">${esc(o.detail.replace(/^需(?:要研究所)?\s*(\d+)\s*級$/, '需$1級'))}</span>` : ''}${o.detail && a.layout === 'faces' ? `<span class="tile-where">${esc(o.detail)}</span>` : ''}${o.badge ? `<span class="tile-badge">${esc(o.badge)}</span>` : ''}`, o.value, 'tile', o.disabled);
          if (o.detail) b.title = o.detail;
          // A tool: what it does on hover (title) and on a touch long-press (a bubble over the grid, the tap not taken).
          if (a.layout === 'tiles' && itemText(o.value)) { b.title = `${o.label}：${itemText(o.value)}`; this.longInfo(b, box, `${o.label}：${itemText(o.value)}`); }
        }
        if (a.cancellable) {
          const c = el('div', 'choices tiles-cancel'); const b = el('button', 'candy ghost', '取消'); b.onclick = () => { audio.ui('no'); done(-1); }; c.append(b); box.append(row, c);
          this.show(box);
          if (a.layout === 'cards') this.fitTiles(box, row, b, 960 / 624, 112);
          if (a.layout === 'tiles') this.fitTiles(box, row, b, 44 / 52, 72);
          if (a.layout === 'faces') this.fitTiles(box, row, b, 1, 60);
          if (a.layout === 'lab') { shrinkText(box, '.tile-name, .tile-need', 8); this.fitBox(box); }
          return;
        }
      } else if (a.t === 'choose') {
        box.innerHTML = `${head(a.title)}${a.text ? `<div class="msg-text small">${lines(a.text)}</div>` : ''}`;
        row.className = 'choices grid';
        for (const o of a.options) { const b = button(esc(o.label), o.value, 'opt', o.disabled); if (o.detail) b.title = o.detail; }
        if (a.cancellable) button('取消', -1, 'ghost');
        box.append(row);
        this.show(box);
        this.fitChoices(box, row);
        return;
      } else if (a.t === 'pick-player') {
        box.innerHTML = head(a.title);
        row.className = 'choices players';
        for (const q of a.players) {
          const c = CHARACTERS[this.game.players[q].character];
          button(`${this.portrait(c.id)}<span>${playerName(this.game.players[q])}</span>`, q, 'cell');
        }
        if (a.cancellable) button('取消', -1, 'ghost');
        box.append(row);
        this.show(box);
        this.fitFaces(box, row);
        return;
      } else if (a.t === 'pick-node') {
        box.innerHTML = head(a.title);
        row.className = 'choices grid';
        for (const id of a.nodes) button(esc(this.describeNode(id)), id);
        if (a.cancellable) button('取消', 0, 'ghost');
        box.append(row);
        this.show(box);
        this.fitChoices(box, row);
        return;
      } else if (a.t === 'pick-map') {
        box.innerHTML = head(a.title);
        row.className = 'choices grid';
        a.spots.forEach((sp, i) => button(esc(sp.label || (sp.at === 'node' ? this.describeNode(sp.id) : String(sp.id))), i));
        if (a.cancellable) button('取消', -1, 'ghost');
        box.append(row);
        this.show(box);
        this.fitChoices(box, row);
        return;
      } else if (a.t === 'stock-market') {
        const screen = new StockScreen(this.game, a.p, tycoon.world);
        screen.done = v => done(v);
        const sheet = el('div', 'msg sheet wide stocks', `<div class="ribbon"><span class="ribbon-face">${this.portrait(ch.id)}</span>股市</div>`);
        const exit = el('div', 'choices sheet-close');
        const b = el('button', 'candy ghost', '離開股市');
        b.onclick = () => { audio.ui('no'); done(-1); };
        exit.append(b);
        sheet.append(screen.el, exit);
        this.show(sheet, true);
        return;
      } else if (a.t === 'amount') {
        box.innerHTML = `${head(a.title)}${a.text ? `<div class="msg-text small">${lines(a.text)}</div>` : ''}`;
        const input = this.amountInput(a.min, a.max, a.step, a.min);
        box.append(input.wrap);
        row.className = 'choices yesno';
        button('確定', undefined, 'yes').onclick = () => done(Math.max(a.min, Math.min(a.max, input.value())));
        button('取消', -1, 'no');
      } else if (a.t === 'bank') {
        const p = this.game.players[a.p];
        box.innerHTML = `${head(a.counter ? '銀行櫃台' : '自動提款機')}
          <div class="msg-text small">現金 ${money(p.cash)}　存款 ${money(p.bank)}${p.loan ? `　貸款 ${money(p.loan)}` : ''}</div>`;
        const input = this.amountInput(0, 1e9, 1000, 0);
        box.append(input.wrap);
        row.className = 'choices grid';
        const add = (label: string, key: string, enabled = true) => { button(label, undefined, 'opt', !enabled).onclick = () => done({ [key]: input.value() }); };
        if (a.counter) {
          add(`貸款（上限 ${money(a.maxLoan)}）`, 'borrow', a.canBorrow && a.maxLoan > 0);
          add('還款', 'repay', p.loan > 0);
          if (a.finance) {
            add(`週轉現金（尚可 ${money(Math.max(0, a.finance.total - p.specialFinance))}）`, 'finance', a.canBorrow && a.finance.total > p.specialFinance);
            add('歸還融資', 'financeRepay', p.specialFinance > 0);
          }
        } else {
          add('存款', 'deposit');
          add('提款', 'withdraw', a.canWithdraw);
        }
        button('離開', undefined, 'ghost');
      } else {
        // A question whose screen is not registered (screens/): leave it.
        resolve(-1);
        return;
      }
      box.append(row);
      this.show(box);
      if (a.t === 'choose' && a.layout && a.layout !== 'lab') this.fitTiles(box, row, null, a.layout === 'cards' ? 960 / 624 : a.layout === 'faces' ? 1 : 44 / 52, a.layout === 'cards' ? 112 : 64);
      else this.fitBox(box);
    });
    this.collect = prev;
    return asked;
  }

  private amountInput(min: number, max: number, step: number, value: number) {
    const wrap = el('div', 'amount');
    const input = el('input') as HTMLInputElement;
    Object.assign(input, { type: 'number', inputMode: 'numeric', min: String(min), max: String(max), step: String(step), value: String(value) });
    // The original's amount pad beeps on every key (fcn_00452c02: Effect#7).
    const nudge = (k: number) => { audio.sfx(7); input.value = String(Math.max(min, Math.min(max, (Number(input.value) || 0) + k))); };
    const minus = el('button', 'candy ghost', `−${step.toLocaleString()}`), plus = el('button', 'candy ghost', `+${step.toLocaleString()}`);
    minus.onclick = () => nudge(-step); plus.onclick = () => nudge(step);
    wrap.append(minus, input, plus);
    return { wrap, value: () => Math.max(0, Math.trunc(Number(input.value) || 0)) };
  }

  /** A readable label for a node: its lot, plot or event. */
  private describeNode(id: number): string {
    const g = this.game, n = g.node(id);
    const owner = (o: number) => (o ? `（${playerName(g.players[o - 1])}）` : '（無主）');
    if (n.ref > 2000 && n.ref < 4000) { const l = g.board.lands[n.ref - 2001]; return `${l.name} ${l.level}級${owner(l.owner)}`; }
    if (n.ref > 4000 && n.ref < 6000) { const f = g.board.facilities[n.ref - 4001]; return `${f.name}${owner(f.owner)}`; }
    if (n.ref > 6000 && n.ref < 8000) return g.board.companies[n.ref - 6001].name;
    return `路格 #${id}`;
  }

  /** A sheet over the map for the toolbar screens (查詢, 系統, 說明); resolves with the chosen value. */
  panelScreen(title: string, html: string, buttons: { label: string; kind?: string; value: string }[] = [], extra?: HTMLElement): Promise<string> {
    return new Promise(resolve => {
      const box = el('div', 'msg sheet', `<div class="ribbon">${esc(title)}</div><div class="sheet-body">${html}</div>`);
      if (extra) box.querySelector('.sheet-body')!.append(extra);
      const row = el('div', 'choices');
      for (const b of [...buttons, { label: '關閉', kind: 'ghost', value: '' }]) {
        const btn = el('button', `candy ${b.kind ?? 'opt'}`, b.label);
        btn.onclick = () => { audio.ui(b.value ? 'click' : 'no'); this.hide(box); resolve(b.value); };
        row.append(btn);
      }
      box.append(row);
      this.show(box, true);
    });
  }

  /**
   * A compact settings window (系統): the live rows in `node` change things at once; the buttons close it.
   * Everything fits on one page — no scrolling area.
   */
  settingsSheet(title: string, node: HTMLElement, buttons: { label: string; kind?: string; value: string }[]): Promise<string> {
    return new Promise(resolve => {
      const box = el('div', 'msg sheet sys-sheet', `<div class="ribbon">${esc(title)}</div>`);
      const row = el('div', 'choices sys-buttons');
      for (const b of [...buttons, { label: '關閉', kind: 'ghost', value: '' }]) {
        const btn = el('button', `candy ${b.kind ?? 'opt'}`, b.label);
        btn.onclick = () => { audio.ui(b.value ? 'click' : 'no'); this.hide(box); resolve(b.value); };
        row.append(btn);
      }
      box.append(node, row);
      this.show(box, true);
      // Over the whole game screen (the map area of a small phone is too low for it); an extreme screen still shrinks
      // the whole window rather than cut off its buttons, again on rotation.
      const fit = () => {
        if (!box.isConnected) { ro.disconnect(); return; }
        box.style.zoom = '';
        const layer = box.parentElement ?? this.layer, ls = getComputedStyle(layer);
        const room = layer.clientHeight - parseFloat(ls.paddingTop) - parseFloat(ls.paddingBottom);
        const need = box.scrollHeight + parseFloat(getComputedStyle(box).marginTop) + 12;   // scrollHeight: max-height caps the box itself
        if (need > room && room > 0) box.style.zoom = String(Math.max(0.6, room / need));
      };
      const ro = new ResizeObserver(fit);
      ro.observe(box.parentElement ?? this.layer);
    });
  }

  /** A sheet holding a live element (查詢); resolves when closed. */
  sheetNode(title: string, node: HTMLElement): Promise<void> {
    return new Promise(resolve => {
      const box = el('div', 'msg sheet wide', `<div class="ribbon">${esc(title)}</div>`);
      const row = el('div', 'choices sheet-close');
      const btn = el('button', 'candy ghost', '關閉');
      btn.onclick = () => { audio.ui('no'); this.hide(box); resolve(); };
      row.append(btn);
      box.append(node, row);
      this.show(box, true);
    });
  }

  gameOver(text: string) {
    const box = el('div', 'msg', `<div class="ribbon">遊戲結束</div><div class="msg-text">${lines(text)}</div>`);
    const row = el('div', 'choices');
    const b = el('button', 'candy yes', '回到主畫面');
    b.onclick = () => location.reload();
    row.append(b);
    box.append(row);
    this.show(box);
  }
}
