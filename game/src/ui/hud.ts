/**
 * Messages and questions over the map (docs/rules/09 §6): the message box, YES/NO, the character speech
 * cloud, news/fate boards and the choice dialogs. Drawn as crisp vector UI in the game's toy style, with the
 * redrawn portraits and art; text is real text.
 */
import { CHARACTERS } from '../core/characters';
import type { Game } from '../core/game';
import type { Ask } from '../core/types';
import type { PlayerPanel, Calendar } from './side';
import type { SpriteBank } from './sprites';
import { StockScreen } from './stock-screen';
import { tycoon } from './tycoon';
import { askKey, askScreens, type ScreenContext } from './screens/registry';
import './screens';
import { audio, boardVoice, characterVoice, voiceOf } from './audio';

const money = (n: number) => n.toLocaleString('zh-Hant');
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const lines = (s: string) => esc(s).replace(/\n{2,}/g, '<br><span class="gap"></span>').replace(/\n/g, '<br>');
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
  context(shell: HTMLElement): ScreenContext {
    return {
      game: this.game, bank: this.bank, area: this.area, shell,
      open: node => this.show(node), close: () => this.hide(), scale: this.scale,
      flash: (text, ms) => this.flash(text, ms),
    };
  }
  /** Set by the controller: the game screen element, for full-screen scenes. */
  shell: HTMLElement | null = null;

  private show(node: HTMLElement) {
    this.layer.replaceChildren(node);
    this.layer.classList.add('show');
    requestAnimationFrame(() => {
      const box = node.getBoundingClientRect(), area = this.area.getBoundingClientRect();
      this.onModal(area.height ? (box.top - area.top) / area.height : null);
    });
  }
  private hide() { this.layer.classList.remove('show'); this.layer.replaceChildren(); this.onModal(null); }

  /**
   * The card grid on one page whatever the hand (up to 15) and the screen: picks the column count that gives the
   * biggest card in the dialog layer's free box, sizes the pictures to it (CSS vars on the row), and does it again
   * when the layer changes size (rotation). Where height is short (landscape) 取消 moves up beside the ribbon.
   */
  private fitCards(box: HTMLElement, row: HTMLElement) {
    const n = row.childElementCount;
    if (!n) return;
    const CARD = 960 / 624, GAP = 8, MAX_H = 112;
    const fit = () => {
      if (!box.isConnected) { ro.disconnect(); return; }
      const ls = getComputedStyle(this.layer);
      const W = this.layer.clientWidth - parseFloat(ls.paddingLeft) - parseFloat(ls.paddingRight);
      const H = this.layer.clientHeight - parseFloat(ls.paddingTop) - parseFloat(ls.paddingBottom) - parseFloat(getComputedStyle(box).marginTop);
      if (W <= 0 || H <= 0) return;
      box.classList.add('card-grid');
      box.classList.toggle('short', H < W * 0.75);
      // Measure one tile around its picture at a known size (name at its default size)…
      const set = (h: number, cols: number) => {
        row.style.setProperty('--ph', `${h}px`); row.style.setProperty('--pw', `${Math.floor(h / CARD)}px`); row.style.setProperty('--cols', String(cols));
      };
      row.style.removeProperty('--fs');
      set(90, Math.min(n, 8));
      const tile = row.firstElementChild as HTMLElement, pic = tile.querySelector<HTMLElement>('.tile-pic')!;
      const tw = tile.offsetWidth - pic.offsetWidth, th = tile.offsetHeight - pic.offsetHeight;
      // …and the dialog around a tiny grid, so it is not capped by max-height (grid margins count in the chrome,
      // offsetHeight leaves them out; the dialog is at most 760 wide).
      set(4, n);
      const chromeW = box.offsetWidth - row.clientWidth, chromeH = box.offsetHeight - row.offsetHeight;
      const rowW = Math.min(W, 760) - chromeW, rowH = H - chromeH - 4;
      let best = { cols: 1, h: 0 };
      for (let cols = 1; cols <= n; cols++) {
        const rows = Math.ceil(n / cols);
        const byW = ((rowW - GAP * (cols - 1)) / cols - tw) * CARD;
        const byH = (rowH - (GAP + 5) * (rows - 1) - 5) / rows - th;
        const h = Math.min(byW, byH, MAX_H);
        if (h > best.h + 0.5) best = { cols, h };
      }
      const h = Math.max(28, Math.floor(best.h));
      set(h, best.cols);
      row.style.setProperty('--fs', `${Math.max(10, Math.min(13, h / 6.4)).toFixed(1)}px`);
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
        this.hide();
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
      <div class="cloud-body"><b>${ch.name}</b><div>${lines(text)}</div></div>`), ms, characterVoice(ch.id, text) ?? voiceOf(text));
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
    if (screen) return screen(this.context(this.shell ?? this.area), a);
    const who = this.game.players[a.p], ch = CHARACTERS[who?.character ?? 0];
    return new Promise(resolve => {
      const box = el('div', 'msg ask');
      const done = (v: unknown) => { this.hide(); resolve(v); };
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
        box.innerHTML = `${head(ch.name)}<div class="msg-text">${lines(a.text)}</div>`;
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
          return;
        }
      } else if (a.t === 'choose' && a.layout) {
        // Tool and card grids (09 §7.2-7.3): every item on one page, with its picture.
        box.classList.add('tiles');
        box.innerHTML = `${head(a.title)}${a.text ? `<div class="msg-text small">${lines(a.text)}</div>` : ''}`;
        row.className = `choices tiles ${a.layout}`;
        for (const o of a.options) {
          const pic = o.icon ? this.bank.art(o.icon.archive, o.icon.id, o.icon.frame ?? 0) : null;
          const b = button(`<span class="tile-pic">${pic ? `<img src="${pic.src}" alt="">` : ''}</span><span class="tile-name">${esc(o.label)}</span>${o.detail && a.layout === 'tiles' ? `<span class="tile-count">${esc(o.detail)}</span>` : ''}${o.detail && a.layout === 'lab' ? `<span class="tile-need">${esc(o.detail)}</span>` : ''}`, o.value, 'tile', o.disabled);
          if (o.detail) b.title = o.detail;
        }
        if (a.cancellable) {
          const c = el('div', 'choices tiles-cancel'); const b = el('button', 'candy ghost', '取消'); b.onclick = () => { audio.ui('no'); done(-1); }; c.append(b); box.append(row, c);
          this.show(box);
          if (a.layout === 'cards') this.fitCards(box, row);
          return;
        }
      } else if (a.t === 'choose') {
        box.innerHTML = `${head(a.title)}${a.text ? `<div class="msg-text small">${lines(a.text)}</div>` : ''}`;
        row.className = `choices grid${a.options.length > 8 ? ' scroll' : ''}`;
        for (const o of a.options) { const b = button(esc(o.label), o.value, 'opt', o.disabled); if (o.detail) b.title = o.detail; }
        if (a.cancellable) button('取消', -1, 'ghost');
      } else if (a.t === 'pick-player') {
        box.innerHTML = head(a.title);
        row.className = 'choices players';
        for (const q of a.players) {
          const c = CHARACTERS[this.game.players[q].character];
          button(`${this.portrait(c.id)}<span>${c.name}</span>`, q, 'cell');
        }
        if (a.cancellable) button('取消', -1, 'ghost');
      } else if (a.t === 'pick-node') {
        box.innerHTML = head(a.title);
        row.className = 'choices grid scroll';
        for (const id of a.nodes) button(esc(this.describeNode(id)), id);
        if (a.cancellable) button('取消', 0, 'ghost');
      } else if (a.t === 'pick-map') {
        box.innerHTML = head(a.title);
        row.className = 'choices grid scroll';
        a.spots.forEach((sp, i) => button(esc(sp.label || (sp.at === 'node' ? this.describeNode(sp.id) : String(sp.id))), i));
        if (a.cancellable) button('取消', -1, 'ghost');
      } else if (a.t === 'stock-market') {
        const screen = new StockScreen(this.game, a.p, tycoon.world);
        screen.done = v => done(v);
        const sheet = el('div', 'msg sheet wide stocks', `<div class="ribbon"><span class="ribbon-face">${this.portrait(ch.id)}</span>股市</div>`);
        const exit = el('div', 'choices');
        const b = el('button', 'candy ghost', '離開股市');
        b.onclick = () => { audio.ui('no'); done(-1); };
        exit.append(b);
        sheet.append(screen.el, exit);
        this.show(sheet);
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
    });
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
    const owner = (o: number) => (o ? `（${CHARACTERS[g.players[o - 1].character].name}）` : '（無主）');
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
        btn.onclick = () => { audio.ui(b.value ? 'click' : 'no'); this.hide(); resolve(b.value); };
        row.append(btn);
      }
      box.append(row);
      this.show(box);
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
        btn.onclick = () => { audio.ui(b.value ? 'click' : 'no'); this.hide(); resolve(b.value); };
        row.append(btn);
      }
      box.append(node, row);
      this.show(box);
    });
  }

  /** A sheet holding a live element (查詢); resolves when closed. */
  sheetNode(title: string, node: HTMLElement): Promise<void> {
    return new Promise(resolve => {
      const box = el('div', 'msg sheet wide', `<div class="ribbon">${esc(title)}</div>`);
      const row = el('div', 'choices');
      const btn = el('button', 'candy ghost', '關閉');
      btn.onclick = () => { audio.ui('no'); this.hide(); resolve(); };
      row.append(btn);
      box.append(node, row);
      this.show(box);
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
