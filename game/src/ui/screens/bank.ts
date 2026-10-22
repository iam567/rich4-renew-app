/**
 * The bank (docs/rules/09 §7.7, rules 02 §8): the counter hall with the clerk (Panel#23) for loans, and the
 * ATM (Panel#24) for deposits and withdrawals. Both are laid out on a fixed canvas in original pixels and
 * scaled to fit the screen; amounts are typed on the original number pads (Panel#21 at the counter, the ATM's
 * own keypad), dragged on the green bar, or picked from quick amounts.
 *
 * Engine contract (game.ts atm / bankCounter): one transaction per visit. The ATM answers { deposit } or
 * { withdraw }, the counter { borrow } or { repay }, or from the chairman's room (special financing, only for
 * the controller of the bank's company, 02 §8.7) { finance } or { financeRepay }; undefined leaves.
 */
import { eraLine } from '../era-line';
import { CHARACTERS, playerName } from '../../core/characters';
import { daysBetween, format } from '../../core/date';
import type { Ask, Player } from '../../core/types';
import { askScreens, type ScreenContext } from './registry';
import { audio, Sfx, Theme, voiceOf } from '../audio';
import { centreWords } from '../bubble-text';
import './bank.css';

type BankAsk = Extract<Ask, { t: 'bank' }>;
type Archive = 'Data' | 'Panel' | 'map';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const money = (n: number) => `$${Math.trunc(n).toLocaleString('en-US')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const lines = (s: string) => esc(s).replace(/\n/g, '<br>');
/** 1萬 / 50萬 / 1,234 for the quick-amount chips. */
const short = (n: number) => (n >= 10000 && n % 10000 === 0 ? `${n / 10000}萬` : n.toLocaleString('en-US'));

/**
 * A full-screen (or map-sized) overlay holding a fixed design canvas scaled to fit. `size` gives the canvas
 * for the current orientation; `onFlip` rebuilds the layout when the orientation changes.
 */
export function fitOverlay(host: HTMLElement, cls: string, size: (tall: boolean) => [number, number], onFlip?: (tall: boolean) => void, margin = 8) {
  const root = el('div', `fx-overlay ${cls}`);
  const scene = el('div', 'fx-scene');
  root.append(scene);
  host.append(root);
  let tall: boolean | null = null;
  const fit = () => {
    const w = root.clientWidth, h = root.clientHeight;
    if (!w || !h) return;
    const t = h > w * 1.05;
    if (t !== tall) { tall = t; scene.classList.toggle('tall', t); onFlip?.(t); }
    const [dw, dh] = size(t);
    scene.style.width = `${dw}px`; scene.style.height = `${dh}px`;
    const s = Math.min((w - margin) / dw, (h - margin) / dh);
    scene.style.transform = `translate(-50%, -50%) scale(${s})`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(root);
  fit();
  return { root, scene, isTall: () => !!tall, refit: fit, close: () => { ro.disconnect(); root.remove(); } };
}

/** An art frame as an <img> with its anchor at (x, y) in the parent's original-pixel coordinates. */
function art(ctx: ScreenContext, archive: Archive, id: number, frame: number, x: number, y: number, cls = '', parent?: HTMLElement): HTMLImageElement | null {
  const a = ctx.bank.art(archive, id, frame);
  if (!a) return null;
  const img = el('img', cls);
  img.src = a.src; img.alt = ''; img.draggable = false;
  Object.assign(img.style, { left: `${x - a.ax}px`, top: `${y - a.ay}px`, width: `${a.w}px`, height: `${a.h}px` });
  parent?.append(img);
  return img;
}

/** Waits ms (× game speed); a tap on `root` or a key ends it early. */
function hold(ctx: ScreenContext, root: HTMLElement, ms: number): Promise<void> {
  return new Promise(resolve => {
    let done = false;
    const end = () => {
      if (done) return;
      done = true; clearTimeout(t);
      root.removeEventListener('pointerup', end); window.removeEventListener('keydown', end);
      resolve();
    };
    const t = setTimeout(end, ms * ctx.scale());
    setTimeout(() => { if (!done) { root.addEventListener('pointerup', end); window.addEventListener('keydown', end); } }, 120);
  });
}

// ------------------------------------------------------------------ account card (Panel#23.15, 09 §7.7)

interface Shown { cash: number; bank: number; loan: number }

/** The account card: face, name, 現金 / 存款 / 貸款 written on Panel#23.15 the way fcn_00433d6e does. */
function accountCard(ctx: ScreenContext, p: Player) {
  const card = el('div', 'bk-card');
  art(ctx, 'Panel', 23, 15, 0, 0, 'bk-card-bg', card);
  const ch = CHARACTERS[p.character];
  const face = ctx.bank.art('Data', 2, p.character);
  card.insertAdjacentHTML('beforeend', `<div class="bk-card-face" style="--c:#${ch.color.toString(16).padStart(6, '0')}">${face ? `<img src="${face.src}" alt="">` : ''}</div>
    <div class="bk-card-name">${esc(playerName(p))}</div>
    <div class="bk-card-label" style="top:78px">現　金</div><div class="bk-card-label" style="top:142px">存　款</div><div class="bk-card-label" style="top:205px">貸　款</div>
    <div class="bk-card-val" data-k="cash" style="top:100px"></div><div class="bk-card-val" data-k="bank" style="top:164px"></div><div class="bk-card-val" data-k="loan" style="top:228px"></div>`);
  const shown: Shown = { cash: p.cash, bank: p.bank, loan: p.loan };
  const put = (v: Shown) => {
    for (const k of ['cash', 'bank', 'loan'] as const) {
      const n = card.querySelector<HTMLElement>(`[data-k=${k}]`)!;
      n.textContent = money(v[k]);
      n.classList.toggle('long', money(v[k]).length > 11);
    }
  };
  put(shown);
  /** Rolls the numbers to new values (after a transaction). */
  const roll = (to: Shown, ms: number) => new Promise<void>(resolve => {
    const from = { ...shown };
    const t0 = performance.now();
    for (const k of ['cash', 'bank', 'loan'] as const) {
      if (from[k] !== to[k]) card.querySelector(`[data-k=${k}]`)!.classList.add('bump');
    }
    const step = (t: number) => {
      const f = Math.min(1, (t - t0) / ms), e = 1 - (1 - f) ** 3;
      put({ cash: from.cash + (to.cash - from.cash) * e, bank: from.bank + (to.bank - from.bank) * e, loan: from.loan + (to.loan - from.loan) * e });
      if (f < 1) requestAnimationFrame(step); else { Object.assign(shown, to); resolve(); }
    };
    requestAnimationFrame(step);
  });
  return { card, roll };
}

/** Tags under the card: due date (日历 "距還款日%d天"), credit line, suspended lending. */
function infoTags(ctx: ScreenContext, p: Player, a: BankAsk): string {
  const tags: string[] = [];
  if (p.loan && p.loanDue) {
    const d = daysBetween(ctx.game.date, p.loanDue);
    tags.push(`<div class="bk-tag${d <= 3 ? ' warn' : ''}"><b>還款日</b>${format(p.loanDue)}<em>距還款日${Math.max(0, d)}天</em></div>`);
  } else if (p.loan) {
    tags.push(`<div class="bk-tag"><b>貸款中</b>無期限</div>`);
  } else {
    tags.push(`<div class="bk-tag ok"><b>無貸款</b>每月1日存款加息10％</div>`);
  }
  if (a.counter) tags.push(`<div class="bk-tag"><b>可貸額度</b>${money(a.maxLoan)}</div>`);
  if (p.noLoan) tags.push(`<div class="bk-tag warn"><b>銀行暫停放款</b>還剩${(p.noLoan & 0x7f) + 1}天</div>`);
  return tags.join('');
}

/** Quick amounts that fit under `max`: a few round sums plus half. */
function quickAmounts(max: number): { label: string; v: number }[] {
  const round = [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000].filter(v => v <= max);
  const out = round.slice(-3).map(v => ({ label: short(v), v }));
  if (max >= 2000) out.push({ label: '一半', v: Math.floor(max / 2 / 100) * 100 });
  return out;
}

// ------------------------------------------------------------------ number entry state

/** Amount being typed: at most 10 digits, never above the limit (09 §7.7). */
class Entry {
  digits = '';
  constructor(public max: number, readonly onChange: () => void) {}
  get value() { return Number(this.digits || 0); }
  set(v: number) { this.digits = String(Math.max(0, Math.min(this.max, Math.trunc(v)))); if (this.digits === '0') this.digits = ''; this.onChange(); }
  key(k: string) {
    if (/^[0-9]$/.test(k)) {
      if (this.digits.length >= 10) return;
      const next = (this.digits + k).replace(/^0+/, '');
      this.digits = Number(next) > this.max ? String(this.max) : next;
    } else if (k === 'C') this.digits = '';
    else if (k === '←') this.digits = this.digits.slice(0, -1);
    else if (k === 'MAX') this.digits = this.max > 0 ? String(this.max) : '';
    this.onChange();
  }
  /** 0..1 of the limit. */
  get frac() { return this.max > 0 ? Math.min(1, this.value / this.max) : 0; }
}

/** Keyboard shortcuts of the ATM and the number pad: 0-9, C, Backspace, Enter, M (MAX), Esc. */
function keyName(e: KeyboardEvent): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (e.key === 'c' || e.key === 'C' || e.key === 'Delete') return 'C';
  if (e.key === 'Backspace') return '←';
  if (e.key === 'Enter') return 'ENTER';
  if (e.key === 'm' || e.key === 'M') return 'MAX';
  if (e.key === 'Escape') return 'ESC';
  return null;
}

/** A row of digit frames (big ATM digits Panel#24.19..28 or the small pad digits Panel#21.16..25), right-aligned. */
function digitRow(ctx: ScreenContext, archive: Archive, id: number, base: number, text: string): string {
  return [...text].map(d => {
    const a = ctx.bank.art(archive, id, base + Number(d));
    return a ? `<img src="${a.src}" alt="${d}">` : `<span>${d}</span>`;
  }).join('');
}

/** Lets a drag on the bar set the amount (the ATM bar and the pad's slider). */
function dragBar(bar: HTMLElement, entry: Entry) {
  const at = (e: PointerEvent) => {
    const r = bar.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    entry.set(f >= 0.995 ? entry.max : Math.round((entry.max * f) / 100) * 100);
  };
  // The bars click (Effect#9, ATM fcn_00436ef8 / pad fcn_00452c02).
  bar.addEventListener('pointerdown', e => { audio.sfx(Sfx.slider); bar.setPointerCapture(e.pointerId); at(e); });
  bar.addEventListener('pointermove', e => { if (bar.hasPointerCapture(e.pointerId)) at(e); });
}

// ------------------------------------------------------------------ ATM (Panel#24)

/** Keypad keys of the ATM: label, frame, top-left relative to the machine (template-matched on Panel#24.0). */
const ATM_KEYS: [string, number, number, number][] = [
  ['7', 5, 58, 211], ['8', 6, 97, 211], ['9', 7, 136, 211],
  ['4', 8, 58, 230], ['5', 9, 97, 230], ['6', 10, 136, 230],
  ['1', 11, 58, 249], ['2', 12, 97, 249], ['3', 13, 136, 249],
  ['C', 14, 58, 268], ['0', 15, 97, 268], ['←', 16, 136, 268],
];

function atmScreen(ctx: ScreenContext, a: BankAsk): Promise<unknown> {
  const p = ctx.game.players[a.p];
  return new Promise(resolve => {
    let mode: 'withdraw' | 'deposit' = !a.canWithdraw || p.bank <= 0 ? 'deposit' : p.cash > 0 && p.cash >= p.bank ? 'deposit' : 'withdraw';
    if (p.cash <= 0 && p.bank > 0 && a.canWithdraw) mode = 'withdraw';
    const limit = () => (mode === 'withdraw' ? p.bank : p.cash);
    let busy = false;

    // The bank screens play MIDI05 (rich4_ui_bank.asm:3557 / 3743) and give the background track back after.
    audio.theme(Theme.bank);
    const ov = fitOverlay(ctx.shell, 'bk-atm-ov', tall => (tall ? [340, 700] : [600, 392]));
    const { scene, root } = ov;
    scene.classList.add('bk-atm-scene');

    // The machine: the redrawn body, the original keypad layout over it (the redraw lost the keys' order).
    const atm = el('div', 'bk-atm');
    art(ctx, 'Panel', 24, 0, 0, 0, 'bk-atm-body', atm);
    atm.insertAdjacentHTML('beforeend', `<div class="bk-pad-black" style="left:51px;top:204px;width:125px;height:88px"></div>
      <div class="bk-pad-black" style="left:166px;top:226px;width:73px;height:66px"></div>
      ${[[56, 209], [170, 209], [56, 287], [233, 231], [233, 287]].map(([x, y]) => `<i class="bk-rivet" style="left:${x}px;top:${y}px"></i>`).join('')}`);
    const btn = (cls: string, x: number, y: number, w: number, h: number, key: string, frame?: number) => {
      const b = el('button', `bk-key ${cls}`);
      Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      b.dataset.k = key;
      if (frame !== undefined) { const f = art(ctx, 'Panel', 24, frame, 0, 0, '', b); if (f) Object.assign(f.style, { left: '0', top: '0', width: '100%', height: '100%' }); }
      atm.append(b);
      return b;
    };
    for (const [k, f, x, y] of ATM_KEYS) btn('num', x, y, 33, 17, k, f);
    btn('max', 183, 233, 49, 25, 'MAX', 17);
    btn('enter', 175, 260, 57, 25, 'ENTER', 18);
    // Mode buttons on the screen: the selected one shows its lit frame (1 / 2); EXIT frame 3.
    // The redrawn body has the screen buttons a little lower and wider than the original's (57,49) / (139,49) /
    // (221,49); the frames go where the picture has them.
    const hdBody = !!ctx.bank.art('Panel', 24, 0)?.hd;
    const R = hdBody ? [[49, 56, 83, 46], [136, 56, 85, 46], [226, 56, 46, 46]] : [[57, 49, 80, 41], [139, 49, 80, 41], [221, 49, 43, 41]];
    const wBtn = btn('mode', R[0][0], R[0][1], R[0][2], R[0][3], 'withdraw', 1), dBtn = btn('mode', R[1][0], R[1][1], R[1][2], R[1][3], 'deposit', 2);
    for (const b of [wBtn, dBtn]) b.insertAdjacentHTML('beforeend', `<span class="bk-mode-name">${b === wBtn ? '提款' : '存款'}</span>`);
    btn('exit', R[2][0], R[2][1], R[2][2], R[2][3], 'EXIT', 3);
    wBtn.setAttribute('aria-label', '提款'); dBtn.setAttribute('aria-label', '存款');
    if (!a.canWithdraw) art(ctx, 'Panel', 24, 29, R[0][0] + R[0][2] / 2, R[0][1] + R[0][3] / 2, 'bk-forbid', atm);
    const lcd = el('div', `bk-lcd${hdBody ? ' hd' : ''}`);
    lcd.innerHTML = `<div class="bk-lcd-mode"></div><div class="bk-lcd-digits"></div><div class="bk-lcd-msg"></div>`;
    atm.append(lcd);
    // The bar: frame 4 dimmed as the track, frame 4 cut to the amount as the fill (placed where the redrawn
    // body has its scale, (51,146)–(270,164); the original draws it at (58,139), 204×26).
    const bar = el('div', `bk-bar${hdBody ? ' hd' : ''}`);
    const track = el('div', 'bk-bar-track'), fill = el('div', 'bk-bar-fill');
    const barArt = ctx.bank.art('Panel', 24, 4);
    if (barArt) track.style.backgroundImage = fill.style.backgroundImage = `url("${barArt.src}")`;
    bar.append(track, fill);
    atm.append(bar);

    // Right column: title, account card, the limit and quick amounts.
    const side = el('div', 'bk-side');
    side.innerHTML = `<div class="bk-title">自動提款機</div>`;
    const acct = accountCard(ctx, p);
    side.append(acct.card);
    const help = el('div', 'bk-help');
    const quick = el('div', 'bk-quick');
    side.append(help, quick);
    scene.append(atm, side);

    const entry = new Entry(limit(), () => draw());
    const draw = () => {
      entry.max = limit();
      if (entry.value > entry.max) entry.digits = entry.max ? String(entry.max) : '';
      wBtn.classList.toggle('on', mode === 'withdraw');
      dBtn.classList.toggle('on', mode === 'deposit');
      lcd.querySelector('.bk-lcd-mode')!.textContent = mode === 'withdraw' ? '提款' : '存款';
      lcd.querySelector('.bk-lcd-digits')!.innerHTML = digitRow(ctx, 'Panel', 24, 19, String(entry.value));
      // Bar width = ⌊amount / limit · 34⌋ · 6 of 204 (09 §7.7).
      fill.style.width = `${(Math.floor(entry.frac * 34) / 34) * 100}%`;
      help.innerHTML = mode === 'withdraw'
        ? `<b>提款</b>最多可提 <em>${money(p.bank)}</em>`
        : `<b>存款</b>最多可存 <em>${money(p.cash)}</em>`;
      quick.innerHTML = quickAmounts(entry.max).slice(-3).map(q => `<button class="chip" data-v="${q.v}">${q.label}</button>`).join('')
        + `<button class="chip" data-v="${entry.max}">全部</button>`;
    };
    dragBar(bar, entry);

    const finish = (v: unknown) => {
      window.removeEventListener('keydown', onKey);
      audio.restore();
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(v); }, 160);
    };
    const confirm = async () => {
      const x = entry.value;
      if (x <= 0 || busy) { lcd.classList.remove('shake'); void lcd.offsetWidth; lcd.classList.add('shake'); return; }
      busy = true;
      const msg = lcd.querySelector('.bk-lcd-msg')!;
      msg.textContent = mode === 'withdraw' ? `提領 ${money(x)}` : `存入 ${money(x)}`;
      lcd.classList.add('done');
      const to = mode === 'withdraw' ? { cash: p.cash + x, bank: p.bank - x, loan: p.loan } : { cash: p.cash - x, bank: p.bank + x, loan: p.loan };
      atm.classList.add(mode === 'withdraw' ? 'cash-out' : 'cash-in');
      await Promise.all([acct.roll(to, 650 * ctx.scale()), hold(ctx, root, 1100)]);
      finish(mode === 'withdraw' ? { withdraw: x } : { deposit: x });
    };
    const press = (k: string) => {
      if (busy) return;
      // The mode buttons click (#1); every other key of the machine beeps (#7).
      audio.sfx(k === 'withdraw' || k === 'deposit' ? 1 : Sfx.key);
      if (k === 'ENTER') { confirm(); return; }
      if (k === 'EXIT' || k === 'ESC') { finish(undefined); return; }
      if (k === 'withdraw' || k === 'deposit') {
        if (k === 'withdraw' && !a.canWithdraw) { ctx.flash('銀行暫停放款中\n只能存款', 1200); return; }
        if (mode !== k) { mode = k; entry.digits = ''; draw(); }
        return;
      }
      entry.key(k);
    };
    atm.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k]');
      if (b) press(b.dataset.k!);
    });
    quick.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
      if (b && !busy) entry.set(Number(b.dataset.v));
    });
    // Right click = leave without a transaction (09 §7.7).
    root.addEventListener('contextmenu', e => { e.preventDefault(); if (!busy) finish(undefined); });
    const onKey = (e: KeyboardEvent) => {
      const k = keyName(e);
      if (!k) return;
      e.preventDefault();
      const b = atm.querySelector<HTMLElement>(`[data-k="${k}"]`);
      if (b) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120); }
      press(k);
    };
    window.addEventListener('keydown', onKey);
    draw();
  });
}

// ------------------------------------------------------------------ counter (Panel#23)

/** Number pad Panel#21 (128×192): keys top-left in pad pixels, template-matched against frame 0. */
const PAD_KEYS: [string, number, number, number][] = [
  ['C', 4, 8, 95], ['0', 5, 48, 95], ['←', 6, 88, 95],
  ['7', 7, 8, 119], ['8', 8, 48, 119], ['9', 9, 88, 119],
  ['4', 10, 8, 143], ['5', 11, 48, 143], ['6', 12, 88, 143],
  ['1', 13, 8, 167], ['2', 14, 48, 167], ['3', 15, 88, 167],
];

/** The shared amount pad (fcn_00453544): LCD with small digits, slider, MAX, Enter and the keys. */
function numberPad(ctx: ScreenContext, entry: Entry) {
  const pad = el('div', 'bk-np');
  art(ctx, 'Panel', 21, 0, 0, 0, 'bk-np-body', pad);
  const key = (k: string, frame: number, x: number, y: number, w: number, h: number) => {
    const b = el('button', 'bk-npk');
    b.dataset.k = k;
    Object.assign(b.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const f = art(ctx, 'Panel', 21, frame, 0, 0, 'press', b);
    if (f) Object.assign(f.style, { left: '0', top: '0', width: '100%', height: '100%' });
    pad.append(b);
  };
  for (const [k, f, x, y] of PAD_KEYS) key(k, f, x, y, 33, 17);
  key('MAX', 2, 8, 63, 49, 25);
  key('ENTER', 3, 64, 63, 57, 25);
  // LCD and slider are drawn over the picture (the redraw's small LCD digits are hard to read): the LCD
  // window is (12,11)–(115,33) and the slider (12,43)–(115,58) in the redrawn pad.
  const lcd = el('div', 'bk-np-lcd', '<i>8888888888</i><b></b>');
  const slider = el('div', 'bk-np-slider');
  const track = el('div', 'bk-np-track'), fill = el('div', 'bk-np-fill');
  const s = ctx.bank.art('Panel', 21, 1);
  if (s) track.style.backgroundImage = fill.style.backgroundImage = `url("${s.src}")`;
  slider.append(track, fill);
  pad.append(lcd, slider);
  const close = el('button', 'bk-np-x', '×');
  close.dataset.k = 'ESC';
  close.setAttribute('aria-label', '取消');
  pad.append(close);
  dragBar(slider, entry);
  const draw = () => {
    lcd.querySelector('b')!.textContent = String(entry.value);
    fill.style.width = `${entry.frac * 103}px`;
  };
  return { pad, draw };
}

const CLERK = {
  hello: '歡迎光臨\n大富翁銀行！',
  serve: '需要我為您\n服務嗎？',
  askLoan: '請輸入您要貸款\n的金額！',
  loanDone: '您的貸款手續\n已經完成。',
  loanTerm: '請於三個月內\n還清貸款。',
  overLimit: '很抱歉！\n金額已超過\n許可額度。',
  askRepay: '請輸入您預備\n還款的金額！',
  noCash: '很抱歉！\n您的現金不足。',
  repayDone: '您的還款手續\n已完成。',
  bye: '謝謝您的惠顧！',
  noLoan: (d: number) => `銀行暫停放款\n還剩${d}天！`,
  hi: (name: string) => `${name}您好`,
};

/** The chairman's lines #0086-#0091 (ref_00464985..ref_00464a1b). */
const CHAIRMAN = {
  hello: '董事長親自蒞臨\n不知有何指教？',
  askLend: '請輸入您要\n週轉的金額∼',
  // #0088 is never shown by the original (週轉現金 just does nothing when nothing is left); the remake says it.
  empty: '行裡現在沒有\n這麼多現金。',
  askRepay: '請輸入您要\n還款的金額∼',
  joke: '董事長您別開玩笑了∼',
  bye: '董事長慢走！',
};

type PadKind = 'borrow' | 'repay' | 'finance' | 'financeRepay';

function counterScreen(ctx: ScreenContext, a: BankAsk): Promise<unknown> {
  const p = ctx.game.players[a.p];
  const fin = a.finance;
  return new Promise(resolve => {
    let busy = false;
    let padFor: PadKind | null = null;
    let inRoom = false;
    audio.theme(Theme.bank);
    const ov = fitOverlay(ctx.shell, 'bk-counter-ov', tall => (tall ? [640, 1100] : [868, 480]));
    const { scene, root } = ov;
    scene.classList.add('bk-counter-scene');

    // The hall: Panel#23.0. Unless the player controls this bank's company, the blinds (frame 1) close the
    // chairman's window (fcn_00434186, rich4_ui_bank.asm:740); for the controller the window is the way into
    // the chairman's room, with 特別融資 on the paper of his desk (14 px 0x808080 at (492,245)).
    const hall = el('div', 'bk-hall');
    art(ctx, 'Panel', 23, 0, 0, 0, 'bk-hall-bg', hall);
    const hd = ctx.bank.art('Panel', 23, 0)?.hd ?? false;
    if (!fin) art(ctx, 'Panel', 23, 1, 320, 240, 'bk-blinds', hall);
    else {
      // Hot area (268,51)-(591,273) in the original; the redrawn hall has a larger frame, (266,30)-(601,295).
      const win = el('button', 'bk-window');
      win.dataset.k = 'room';
      win.setAttribute('aria-label', '特別融資');
      const [x1, y1, x2, y2] = hd ? [266, 30, 601, 295] : [268, 51, 591, 273];
      Object.assign(win.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1 + 1}px`, height: `${y2 - y1 + 1}px` });
      const plate = el('div', 'bk-plate', '特別融資');
      Object.assign(plate.style, hd ? { left: '487px', top: '261px' } : { left: '492px', top: '245px' });
      hall.append(plate, win);
    }
    const slip = (key: 'borrow' | 'repay', x1: number, y1: number, x2: number, y2: number, label: string, ok: boolean) => {
      const b = el('button', `bk-slip${ok ? '' : ' off'}`, `<span>${label}</span>`);
      b.dataset.k = key;
      Object.assign(b.style, { left: `${x1}px`, top: `${y1}px`, width: `${x2 - x1 + 1}px`, height: `${y2 - y1 + 1}px` });
      hall.append(b);
      return b;
    };
    const canLoan = a.canBorrow && a.maxLoan > 0;
    // The two slips on the counter (hot areas (282,324)–(408,366) and (470,326)–(590,366) in the original; here
    // the slips of the redrawn hall, which sit a few pixels to the right).
    if (hd) {
      slip('borrow', 297, 324, 421, 365, '申請貸款', canLoan);
      slip('repay', 476, 326, 597, 367, '償還貸款', p.loan > 0);
    } else {
      slip('borrow', 282, 324, 408, 366, '申請貸款', canLoan);
      slip('repay', 470, 326, 590, 366, '償還貸款', p.loan > 0);
    }
    // Refused / suspended lending: the 禁止 sign over 申請貸款 (09 §7.7).
    if (!a.canBorrow) art(ctx, 'Panel', 23, 23, hd ? 359 : 345, 345, 'bk-forbid big', hall);
    // EXIT is part of the hall picture; the redraw paints it larger at (481,406)–(622,467).
    const exit = el('button', 'bk-exit');
    exit.dataset.k = 'EXIT';
    exit.setAttribute('aria-label', 'EXIT');
    Object.assign(exit.style, hd ? { left: '481px', top: '406px', width: '142px', height: '62px' } : { left: '548px', top: '431px', width: '81px', height: '41px' });
    const ex1 = art(ctx, 'Panel', 23, 19, 0, 0, 'h', exit);
    if (ex1) Object.assign(ex1.style, { left: '0', top: '0', width: '100%', height: '100%' });
    hall.append(exit);
    // The clerk's heart-shaped speech box (frame 21 at (240,80); the original centres the text on (357,151), here
    // on the heart's body, left of its tail: bubble-text.ts).
    const bubble = el('div', 'bk-bubble');
    art(ctx, 'Panel', 23, 21, 0, 0, 'bk-bubble-bg', bubble);
    const words = el('div', 'bk-words');
    centreWords(words, 'Panel/23/21');
    bubble.append(words);
    hall.append(bubble);

    const side = el('div', 'bk-side');
    side.innerHTML = `<div class="bk-title">銀行櫃台</div>`;
    const acct = accountCard(ctx, p);
    side.append(acct.card);
    const tags = el('div', 'bk-tags', infoTags(ctx, p, a));
    side.append(tags);
    scene.append(hall, side);

    // The chairman's room (fcn_00434492), built on first entry.
    let room: ReturnType<typeof chairmanRoom> | null = null;

    // The number pad (hidden until 申請貸款 / 償還貸款 / 週轉現金 / 歸還款項).
    const entry = new Entry(0, () => np.draw());
    const np = numberPad(ctx, entry);
    const dock = el('div', 'bk-dock');
    const padHead = el('div', 'bk-dock-head');
    const quick = el('div', 'bk-quick');
    const padWrap = el('div', 'bk-np-wrap');
    padWrap.append(np.pad);
    dock.append(padHead, padWrap);
    quick.classList.add('bk-dock-quick');
    scene.append(dock, quick);

    let talkId = 0;
    /** The clerk (or the chairman in his room) says a line (skippable); resolves after it has been shown for `ms`. */
    const say = async (text: string, ms = 0) => {
      const id = ++talkId;
      // The bank's lines are voiced (#0075-#0091); the greeting's voice is its second line.
      void audio.voice(voiceOf(text) ?? voiceOf(text.split('\n').slice(1).join('\n')));
      const [box, w] = inRoom && room ? [room.box, room.words] : [bubble, words];
      w.innerHTML = lines(eraLine(text));
      box.classList.remove('talk'); void box.offsetWidth; box.classList.add('talk');
      if (ms) await hold(ctx, root, ms);
      return id === talkId;
    };

    const finance = () => (fin ? { total: fin.total, used: p.specialFinance, left: Math.max(0, fin.total - p.specialFinance) } : null);
    const roomTags = () => {
      const t = [`<div class="bk-tag"><b>特別融資</b>無利息<em>無期限</em></div>`];
      if (p.noLoan) t.push(`<div class="bk-tag warn"><b>銀行暫停放款</b>不能週轉現金</div>`);
      return t.join('');
    };

    const openPad = (kind: PadKind) => {
      padFor = kind;
      const f = finance();
      entry.max = kind === 'borrow' ? a.maxLoan : kind === 'repay' ? p.loan : kind === 'finance' ? f!.left : p.specialFinance;
      entry.digits = '';
      padHead.innerHTML = {
        borrow: `<b>申請貸款</b><span>上限 ${money(a.maxLoan)}</span>`,
        repay: `<b>償還貸款</b><span>貸款 ${money(p.loan)}</span>`,
        finance: `<b>週轉現金</b><span>尚可 ${money(entry.max)}</span>`,
        financeRepay: `<b>歸還款項</b><span>融資 ${money(p.specialFinance)}</span>`,
      }[kind];
      quick.innerHTML = quickAmounts(entry.max).map(q => `<button class="chip" data-v="${q.v}">${q.label}</button>`).join('');
      np.draw();
      scene.classList.add('padding');
      say({ borrow: CLERK.askLoan, repay: CLERK.askRepay, finance: CHAIRMAN.askLend, financeRepay: CHAIRMAN.askRepay }[kind]);
    };
    const closePad = () => {
      padFor = null; scene.classList.remove('padding');
      // Cancelling the pad in the room goes back to waiting without a word (state 2, :1100).
      if (!inRoom) say(CLERK.serve);
    };

    const enterRoom = () => {
      room ??= chairmanRoom(ctx, hd, hall);
      inRoom = true;
      room.draw(finance()!, !p.noLoan);
      scene.classList.add('in-room');
      side.querySelector('.bk-title')!.textContent = '董事長室';
      tags.innerHTML = roomTags();
      say(CHAIRMAN.hello);
    };
    const leaveRoom = async () => {
      busy = true;
      await say(CHAIRMAN.bye, 900);
      inRoom = false;
      scene.classList.remove('in-room');
      side.querySelector('.bk-title')!.textContent = '銀行櫃台';
      tags.innerHTML = infoTags(ctx, p, a);
      busy = false;
      say(CLERK.serve);
    };

    const finish = async (v: unknown, line: string) => {
      busy = true;
      window.removeEventListener('keydown', onKey);
      await say(line, 1100);
      audio.restore();
      root.classList.add('out');
      setTimeout(() => { ov.close(); resolve(v); }, 160);
    };
    const confirm = async () => {
      const x = entry.value;
      if (!padFor || busy) return;
      if (x <= 0) { np.pad.classList.remove('shake'); void np.pad.offsetWidth; np.pad.classList.add('shake'); return; }
      if (padFor === 'borrow') {
        if (x > a.maxLoan) { say(CLERK.overLimit); return; }
        busy = true;
        scene.classList.remove('padding');
        acct.roll({ cash: p.cash, bank: p.bank + x, loan: p.loan + x }, 700 * ctx.scale());
        await say(CLERK.loanDone, 1300);
        await finish({ borrow: x }, CLERK.loanTerm);
      } else if (padFor === 'repay') {
        if (x > p.cash + p.bank) { say(CLERK.noCash); return; }
        busy = true;
        scene.classList.remove('padding');
        const fromBank = Math.min(x, p.bank);
        acct.roll({ cash: p.cash - (x - fromBank), bank: p.bank - fromBank, loan: p.loan - x }, 700 * ctx.scale());
        await say(CLERK.repayDone, 1300);
        await finish({ repay: x }, CLERK.bye);
      } else if (padFor === 'finance') {
        // A transaction in the room ends the whole bank visit (hall state 0xb, :2863).
        busy = true;
        scene.classList.remove('padding');
        const f = finance()!;
        room!.draw({ total: f.total, used: f.used + x, left: f.left - x }, !p.noLoan);
        acct.roll({ cash: p.cash, bank: p.bank + x, loan: p.loan }, 700 * ctx.scale());
        await finish({ finance: x }, CHAIRMAN.bye);
      } else {
        // More than cash + deposit: the joke line, and the pad comes back (state 5 → 6, :1124).
        if (x > p.cash + p.bank) { say(CHAIRMAN.joke); return; }
        busy = true;
        scene.classList.remove('padding');
        const f = finance()!;
        room!.draw({ total: f.total, used: f.used - x, left: f.left + x }, !p.noLoan);
        const fromBank = Math.min(x, p.bank);
        acct.roll({ cash: p.cash - (x - fromBank), bank: p.bank - fromBank, loan: p.loan }, 700 * ctx.scale());
        await finish({ financeRepay: x }, CHAIRMAN.bye);
      }
    };
    const press = (k: string) => {
      if (busy) return;
      // Slips and the room's buttons click (#1), leaving cancels (#4), the pad's keys beep (#7)
      // (fcn_00434492 / fcn_00435062 / fcn_00452c02).
      audio.sfx(['borrow', 'repay', 'room', 'finance', 'financeRepay'].includes(k) ? 1 : (k === 'EXIT' || k === 'ESC') ? 4 : Sfx.key);
      if (padFor) {
        if (k === 'ENTER') { confirm(); return; }
        if (k === 'ESC') { closePad(); return; }
        if (k === 'EXIT') { closePad(); }
        else { entry.key(k); return; }
      }
      if (inRoom) {
        if (k === 'EXIT' || k === 'ESC') { void leaveRoom(); return; }
        const f = finance()!;
        if (k === 'finance') {
          // Suspended lending: the 禁止 sign is on the button and it does nothing (:1546).
          if (p.noLoan) { room!.shake('finance'); return; }
          if (f.left <= 0) { say(CHAIRMAN.empty); return; }
          openPad('finance');
        }
        if (k === 'financeRepay') {
          if (p.specialFinance <= 0) { room!.shake('financeRepay'); return; }
          openPad('financeRepay');
        }
        return;
      }
      if (k === 'EXIT' || k === 'ESC') { finish(undefined, CLERK.bye); return; }
      if (k === 'room' && fin) { enterRoom(); return; }
      if (k === 'borrow') {
        if (!a.canBorrow) { say(CLERK.noLoan((p.noLoan & 0x7f) + 1)); return; }
        if (a.maxLoan <= 0) { say(CLERK.overLimit); return; }
        openPad('borrow');
      }
      if (k === 'repay') {
        if (p.loan <= 0) { say('您目前沒有\n任何貸款喔！'); return; }
        openPad('repay');
      }
    };
    scene.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-k],[data-v]');
      if (!b) return;
      if (b.dataset.v !== undefined) { if (padFor && !busy) entry.set(Number(b.dataset.v)); return; }
      press(b.dataset.k!);
    });
    root.addEventListener('contextmenu', e => { e.preventDefault(); press('ESC'); });
    const onKey = (e: KeyboardEvent) => {
      const k = keyName(e);
      if (!k) return;
      e.preventDefault();
      const b = np.pad.querySelector<HTMLElement>(`[data-k="${k}"]`);
      if (b && padFor) { b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 120); }
      press(k);
    };
    window.addEventListener('keydown', onKey);

    // Greeting: 歡迎光臨大富翁銀行！ → 需要我為您服務嗎？ (or the suspended-lending notice).
    (async () => {
      if (await say(`${CLERK.hi(playerName(p))}\n${CLERK.hello}`, 1500)) {
        if (!padFor && !busy && !inRoom) say(p.noLoan ? CLERK.noLoan((p.noLoan & 0x7f) + 1) : CLERK.serve);
      }
    })();
  });
}

/**
 * The chairman's room fcn_00434492 (09 §7.7): Panel#23.2 full size, 特別融資 on the desk paper, the statistics
 * board (frame 20 at (10,125)) with 客戶存款總額 / 目前融資金額 / 尚可融資金額, the blue buttons 週轉現金 and
 * 歸還款項 (frames 16/17 at (11,305) and (11,362)), EXIT (frames 18/19 at (11,419)) and his speech box
 * (frame 22 at (214,50); text centred on (339,95) in the original, here on the box above its tail). Laid over the
 * hall in the same place.
 */
function chairmanRoom(ctx: ScreenContext, hallHd: boolean, hall: HTMLElement) {
  const room = el('div', 'bk-hall bk-room');
  art(ctx, 'Panel', 23, 2, 0, 0, 'bk-hall-bg', room);
  const hd = ctx.bank.art('Panel', 23, 2)?.hd ?? hallHd;
  // 26 px at (443,427) on the paper; the redrawn paper lies a little lower and to the left, slightly turned.
  const title = el('div', `bk-room-title${hd ? ' hd' : ''}`, '特別融資');
  Object.assign(title.style, hd ? { left: '433px', top: '436px' } : { left: '443px', top: '427px' });
  room.append(title);
  // The board: labels 16 px 0x202020 centred on x = 78, y = 147 / 195 / 243; values 16 px 0xf0f0f0 right-aligned
  // on x = 128 from y = 163 / 211 / 259 (fcn_00433c20, :254). Positions here are relative to the board.
  const board = el('div', 'bk-board');
  art(ctx, 'Panel', 23, 20, 0, 0, 'bk-board-bg', board);
  board.insertAdjacentHTML('beforeend', ['客戶存款總額', '目前融資金額', '尚可融資金額'].map((t, i) =>
    `<div class="bk-board-label" style="top:${22 + 48 * i}px">${t}</div><div class="bk-board-val" data-v="${i}" style="top:${38 + 48 * i}px"></div>`).join(''));
  room.append(board);
  const button = (k: string, y: number, label: string) => {
    const b = el('button', 'bk-rbtn');
    b.dataset.k = k;
    b.style.top = `${y}px`;
    art(ctx, 'Panel', 23, 16, 0, 0, 'n', b);
    art(ctx, 'Panel', 23, 17, 0, 0, 'h', b);
    b.insertAdjacentHTML('beforeend', `<span>${label}</span>`);
    room.append(b);
    return b;
  };
  const lend = button('finance', 305, '週轉現金'), back = button('financeRepay', 362, '歸還款項');
  // The 禁止 sign over 週轉現金 while lending is suspended (frame 23 at (67,324), fcn_00434186).
  const forbid = art(ctx, 'Panel', 23, 23, 67, 324, 'bk-forbid big', room);
  const exit = el('button', 'bk-rexit');
  exit.dataset.k = 'EXIT';
  exit.setAttribute('aria-label', 'EXIT');
  art(ctx, 'Panel', 23, 18, 0, 0, 'n', exit);
  art(ctx, 'Panel', 23, 19, 0, 0, 'h', exit);
  room.append(exit);
  const box = el('div', 'bk-cbox');
  art(ctx, 'Panel', 23, 22, 0, 0, 'bk-cbox-bg', box);
  const words = el('div', 'bk-cwords');
  centreWords(words, 'Panel/23/22');
  box.append(words);
  room.append(box);
  // Right over the hall, under the number pad.
  hall.after(room);
  return {
    box, words,
    draw(f: { total: number; used: number; left: number }, canLend: boolean) {
      [f.total, f.used, f.left].forEach((v, i) => {
        const n = board.querySelector<HTMLElement>(`[data-v="${i}"]`)!;
        n.textContent = money(v);
        n.classList.toggle('long', money(v).length > 11);
      });
      lend.classList.toggle('off', !canLend || f.left <= 0);
      back.classList.toggle('off', f.used <= 0);
      forbid?.classList.toggle('gone', canLend);
    },
    shake(k: string) {
      const b = k === 'finance' ? lend : back;
      b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
    },
  };
}

askScreens['bank'] = (ctx, ask) => {
  const a = ask as BankAsk;
  return a.counter ? counterScreen(ctx, a) : atmScreen(ctx, a);
};
