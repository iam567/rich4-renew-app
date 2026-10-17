/**
 * 大富翁城's casino (docs/rules/19 §5, core/finale.ts, core/modules/casino.ts): one toy-style page over the game for a
 * visit, in landscape and portrait. The human visitor picks one of the four games and a stake with chips (up to the
 * casino level's cap), plays the moves (21點: 要牌 / 停牌 / 加倍; 德州撲克: 跟注 / 棄牌), then sees the result
 * animated (the wheel turns, the cards come) and the payout. A computer's visit in the city on screen is replayed
 * in short; the 'casino-auto' fx (the banker away) is the gods' slot machine with 「莊家不在！」.
 *
 * Questions: { t: 'casino', phase: 'choose' | 'blackjack' | 'holdem', … } (finale.ts), answered with the choice or
 * the move. Results: fx 'casino-result' (data.result is the game's record), 'casino-auto' (data.digits, amount).
 */
import { CHARACTERS } from '../../core/characters';
import * as C from '../../core/modules/casino';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { esc, face, openScene, type Scene } from './place-scene';
import { chipMode, fmtMoney } from '../finale';
/** Money as shown here: chips in the finale (19 §2), else 元 (no unit). */
const money = (n: number) => fmtMoney(n, false);
import { audio, Sfx } from '../audio';
import { ASSETS } from '../assets';
import { hallSeen } from '../casino-sprite';
import './casino.css';

type Fx = { t: 'fx'; kind: string; p?: number; target?: number; node?: number; data?: Record<string, unknown> };
interface ChooseAsk { t: 'casino'; p: number; phase: 'choose'; game: C.CasinoGame; hall: string; banker: number; facility: number; name: string; level: number; cap: number; min: number; max?: number; mult?: number; cash: number; fee: number; godLine?: string; free?: boolean }
interface BjAsk { t: 'casino'; p: number; phase: 'blackjack'; player: number[]; up: number; canDouble: boolean; double?: number; stake: number }
interface HeAsk { t: 'casino'; p: number; phase: 'holdem'; hole: number[]; board: number[]; stake: number; call?: number }
type CasinoAsk = ChooseAsk | BjAsk | HeAsk;

/** Table art (tools/tycoon-art/casino.py → maps/remake/casino/); the felt is drawn in CSS when it is missing. */
const ART: Record<string, string> = {
  lobby: `${ASSETS}/maps/remake/casino/lobby.webp`, roulette: `${ASSETS}/maps/remake/casino/roulette.webp`,
  blackjack: `${ASSETS}/maps/remake/casino/blackjack.webp`, baccarat: `${ASSETS}/maps/remake/casino/baccarat.webp`,
  holdem: `${ASSETS}/maps/remake/casino/holdem.webp`, sicbo: `${ASSETS}/maps/remake/casino/sicbo.webp`,
};
/** The tables' cartoon props (tools/tycoon-art/props.py → maps/remake/casino/props/), set as CSS variables on the page. */
const PROP_NAMES = ['roulette-bowl', 'roulette-turret', 'roulette-ball', 'dice-cup', 'dice-plate', 'card-back', 'card-shoe', 'squeeze-frame',
  'chip-blue', 'chip-red', 'chip-green', 'chip-purple', 'felt-roulette', 'felt-blackjack', 'felt-baccarat', 'felt-holdem', 'felt-sicbo', 'felt-lobby'];
const PROP = (n: string) => `${ASSETS}/maps/remake/casino/props/${n}.webp`;
const PROP_VARS = PROP_NAMES.map(n => `--p-${n}:url('${PROP(n)}')`).join(';');
/** The halls' plates (the build picker's strip, tools/tycoon-art/casino.py): maps/remake/casino/plate-<type>.webp. */
export const PLATE = (type: number) => `${ASSETS}/maps/remake/casino/plate-${type}.webp`;
const TYPE_OF: Record<C.CasinoGame, number> = { roulette: 5, blackjack: 6, baccarat: 7, holdem: 8, sicbo: 9 };
export const GAME_ICON: Record<C.CasinoGame, string> = { roulette: '🎡', blackjack: '🂡', baccarat: '🀄', holdem: '♠', sicbo: '🎲' };
/** Each hall's rules as deliberate short lines (shown as chips, never wrapped mid-phrase). */
const GAME_RULE: Record<C.CasinoGame, string[]> = {
  roulette: ['紅黑・單雙・大小 1 賠 1', '押一打 1 賠 2', '押單號 1 賠 35', '開出 0 號莊家通吃'],
  blackjack: ['比莊家接近 21 點', '超過 21 點就爆牌', '黑傑克 1 賠 1.5', '頭兩張可加倍'],
  baccarat: ['押閒或押莊 1 賠 1', '莊贏抽水 5%', '押和 1 賠 8', '照標準補牌規則'],
  holdem: ['先下底注看翻牌', '跟注再押一份', '七張取最好五張', '贏了兩份 1 賠 1'],
  sicbo: ['莊家搖三顆骰子', '押大 11–17', '押小 4–10', '1 賠 1・豹子通殺'],
};
/** Text cut at its natural breaks (，・→) into pieces that never wrap inside. */
const pieces = (text: string, cls = '') => text.split(/(?<=[，・])|(?= → )/).filter(Boolean).map(t => `<span class="cs-pc${cls ? ` ${cls}` : ''}">${esc(t.trim())}</span>`).join('');
/** The banker's big hands of a hall as rows: label and multiplier (BANKER_TABLE's 「…×5・…全部現金」). */
const bigRows = (game: C.CasinoGame) => C.BANKER_TABLE[game].replace(/現金/g, chipMode() ? '籌碼' : '現金').split('・').map(x => {
  const m = /^(.*?)\s*(×\d+(?:\.\d+)?|全部\S+)$/.exec(x.trim());
  return `<div class="cs-bigrow"><span>${esc(m ? m[1] : x)}</span><b>${esc(m ? m[2] : '')}</b></div>`;
}).join('');
/** Shrinks a one-line text until it fits its box (no wraps in names and titles). */
function fitText(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>('.fit')) {
    let size = parseFloat(getComputedStyle(el).fontSize);
    for (let k = 0; k < 24 && el.scrollWidth > el.clientWidth + 1 && size > 11; k++) el.style.fontSize = `${(size -= 1)}px`;
  }
}
/** The table art loaded before it is needed (no decode stall on the first table). */
let preloaded = false;
/** Kept alive so the decoded pictures stay in memory. */
const kept: HTMLImageElement[] = [];
export function preload() {
  if (preloaded) return;
  preloaded = true;
  for (const u of [...Object.values(ART), ...[5, 6, 7, 8, 9].map(PLATE), ...PROP_NAMES.map(PROP)]) { const i = new Image(); i.decoding = 'async'; i.src = u; void i.decode?.().catch(() => 0); kept.push(i); }
}
hallSeen.fn = preload;
const ROULETTE_BETS: { key: string; label: string; bet: C.RouletteBet }[] = [
  { key: 'red', label: '紅', bet: { kind: 'red' } }, { key: 'black', label: '黑', bet: { kind: 'black' } },
  { key: 'odd', label: '單', bet: { kind: 'odd' } }, { key: 'even', label: '雙', bet: { kind: 'even' } },
  { key: 'low', label: '小 1–18', bet: { kind: 'low' } }, { key: 'high', label: '大 19–36', bet: { kind: 'high' } },
  { key: 'd1', label: '第1打', bet: { kind: 'dozen', n: 1 } }, { key: 'd2', label: '第2打', bet: { kind: 'dozen', n: 2 } },
  { key: 'd3', label: '第3打', bet: { kind: 'dozen', n: 3 } },
];
const SUIT_RED = (c: number) => C.suit(c) === 1 || C.suit(c) === 2;
const RANK = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUIT = ['♠', '♥', '♦', '♣'];

/** A playing card (CSS); `back` shows the back. */
export function cardHtml(c: number | null, cls = '', i = 0): string {
  const st = `style="--i:${i}"`;
  if (c === null || c < 0) return `<div class="cs-card back ${cls}" ${st}><i></i></div>`;
  const r = RANK[C.rank(c)], s = SUIT[C.suit(c)];
  return `<div class="cs-card ${SUIT_RED(c) ? 'red' : ''} ${cls}" ${st}><b>${r}</b><s>${s}</s><em>${s}</em></div>`;
}

const name = (ctx: ScreenContext, p: number) => CHARACTERS[ctx.game.players[p]?.character ?? 0]?.name ?? '';
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** The page of one visit (kept open from the first question to the result). */
class CasinoPage {
  scene!: Scene;
  closed = false;
  phase: 'choose' | 'blackjack' | 'holdem' | 'result' = 'choose';
  game: C.CasinoGame = 'blackjack';
  stake = 0;
  bet = 'red';
  number = 17;
  bacBet: C.BaccaratBet = 'banker';
  sicBet: C.SicboBet = 'big';
  dice: number[] = [];
  ask: CasinoAsk | null = null;
  choose: ChooseAsk;
  resolve: ((v: unknown) => void) | null = null;
  /** What the table shows now (rebuilt on rotation). */
  table: { dealer: (number | null)[]; player: (number | null)[]; board: (number | null)[]; note: string; dealerNote: string; playerNote: string } =
    { dealer: [], player: [], board: [], note: '', dealerNote: '', playerNote: '' };
  banner: { text: string; cls: string; sub: string; math?: string } | null = null;
  /** A computer's replay: what it does now (「沙隆巴斯 押紅 2,000」「沙隆巴斯：要牌」). */
  caption = '';
  /** A tap on a replay: the rest at once (the result stays readable). */
  skip = false;
  /** Cards on the table at the last drawing (new ones are dealt in, turned ones flip). */
  seen: Record<'dealer' | 'player' | 'board', (number | null)[]> = { dealer: [], player: [], board: [] };
  wheelAt = 0;
  /** The ball has dropped into its pocket (kept over a redraw). */
  settled = false;
  /** The stake on the table: 'in' slides in once, 'on' stays, then to the winner. */
  pot: '' | 'in' | 'on' | 'guest' | 'banker' = '';
  /** The five cards of the winning hand (德州), lit at the showdown. */
  best: number[] = [];
  /** 百家樂: a side with a natural (天生 8/9) glows. */
  natural: { player: boolean; dealer: boolean } = { player: false, dealer: false };
  /** The banker's face at the result: happy when the visitor loses, sad when it wins. */
  mood: '' | 'happy' | 'sad' = '';
  /** The result on the table: the roulette number (-1 before), the winning 百家樂 / 骰寶 zone ('' before). */
  hitNum = -1;
  won = '';
  /** The dice have tumbled in once (a redraw shows them still). */
  diceShown = false;
  /** Replay of a computer's visit (no controls). */
  constructor(readonly ctx: ScreenContext, a: ChooseAsk, readonly watch = false) {
    this.choose = a;
    this.game = a.game;
    this.stake = Math.min(this.max, Math.max(a.min, Math.round(Math.min(a.cash, a.cap) / 2 / 1000) * 1000));
  }

  /** The highest stake: the cap, or less when the visitor holds less (19 §5.1). */
  get max(): number { return Math.max(this.choose.min, Math.min(this.choose.cap, this.choose.max ?? this.choose.cap)); }

  open() {
    preload();
    this.scene = openScene(this.ctx, 'cs-scene', portrait => (portrait ? [500, 880] : [880, 500]), s => { this.scene = s; this.render(); });
    if (this.watch) this.scene.root.addEventListener('pointerdown', () => { this.skip = true; }, { capture: true });
    audio.ui('click');
  }

  /** The human is the banker of this table (a computer's visit to the human's hall). */
  private get youBank(): boolean { return !!this.ctx.game.players[this.choose.banker]?.human; }

  close() { if (this.closed) return; this.closed = true; this.scene.close(); }

  private head(): string {
    const a = this.choose, ctx = this.ctx;
    const bk = ctx.game.players[a.banker];
    const you = this.youBank && this.watch;
    // One line each, never wrapped: the name shrinks to fit; the cap and the 門票 two tidy lines.
    return `<div class="cs-plate"><span class="cs-sign fit">${esc(a.name)}${esc(a.hall)}</span><span class="cs-lv">Lv${a.level}</span>
      <span class="cs-caps"><span>贏錢上限 <b>${money(a.cap)}</b></span>${a.fee ? `<span>門票 <b>${money(a.fee)}</b></span>` : ''}</span></div>
      <div class="cs-people">
        <div class="cs-banker${you ? ' you' : ''}${this.mood ? ` mood-${this.mood}` : ''}">${this.mood ? `<em class="cs-bubble">${this.mood === 'happy' ? '哈哈！' : '嗚…'}</em>` : ''}${face(ctx, bk?.character ?? 0, 'cs-face')}<span class="cs-np"><i>${you ? '你是莊家' : '莊家'}</i><b class="nm">${esc(name(ctx, a.banker))}</b></span></div>
        <div class="cs-guest">${face(ctx, ctx.game.players[a.p]?.character ?? 0, 'cs-face')}<span class="cs-np"><i>${esc(name(ctx, a.p))}</i><b>${money(a.cash)}</b></span>${a.godLine ? `<em class="cs-god">${esc(a.godLine)}</em>` : ''}</div>
      </div>`;
  }

  render() {
    const s = this.scene;
    if (!s || this.closed) return;
    s.stage.replaceChildren();
    s.layer = s.stage;
    s.root.classList.toggle('cs-watch', this.watch);
    const bg = this.phase === 'choose' ? ART.lobby : ART[this.game];
    const root = s.box(`cs-root ${s.portrait ? 'por' : 'land'} ph-${this.phase} g-${this.game}`, 0, 0, s.w, s.h,
      `<div class="cs-bg" style="background-image:url('${bg}')"></div><div class="cs-head">${this.head()}</div><div class="cs-main"></div>`);
    root.setAttribute('style', `${root.getAttribute('style') ?? ''};${PROP_VARS}`);
    const main = root.querySelector<HTMLElement>('.cs-main')!;
    if (this.phase === 'choose') this.renderChoose(main);
    else this.renderTable(main);
    fitText(root);
  }

  // ---------------------------------------------------------------- choose: game and stake

  private renderChoose(main: HTMLElement) {
    const a = this.choose, mult = a.mult ?? 1, por = !!this.scene?.portrait, g = this.game;
    const maxLabel = this.max < a.cap ? '全押' : '上限';
    // Left: the hall's own velvet panel (its colours, its room behind, gold trim, a slow shimmer; the wheel for 輪盤).
    // Right: the hall's table layout with the chips on the chosen zone, the chip tray and the gold plaque.
    main.innerHTML = `<div class="cs-hallcard t-${g}"><div class="cs-hc-art" style="background-image:url('${ART[g]}')"></div><div class="cs-hc-shine"></div>
        <div class="cs-hc-top">${hallPlate(TYPE_OF[g], g)}<div class="cs-hc-name"><b class="cs-hname fit">${esc(a.hall)}</b><span class="cs-hgame">${C.GAME_NAMES[g]}</span></div></div>
        ${g === 'roulette' ? `<div class="cs-hc-wheel">${wheelHtml()}<div class="cs-pointer">▼</div></div>` : ''}
        <div class="cs-big"><i>莊家大牌・不設上限</i>${bigRows(g)}</div>
        <div class="cs-rule">${GAME_RULE[g].map(l => `<span>${esc(l)}</span>`).join('')}</div>
      </div>
      <div class="cs-play t-${g}">
        <div class="cs-hint1">${this.stake < a.min ? `點下面的<b>籌碼</b>加注（最低 ${money(a.min)}）` : g === 'roulette' ? `點<b>桌上的格子</b>換押注・好了按<b>開始！</b>` : g === 'baccarat' ? `點<b>閒／莊／和</b>換押注・好了按<b>開始！</b>` : g === 'sicbo' ? `點<b>小／大</b>換押注・好了按<b>開始！</b>` : `點<b>籌碼</b>加注・好了按<b>開始！</b>`}</div>
        <div class="cs-layout">${g === 'roulette' ? this.rouletteLayout(por) : this.tableLayout(g)}</div>
        <div class="cs-tray${a.free ? ' off' : ''}">${trayChips(mult)}
          <button class="cs-tbtn" data-set="clear">清除</button><button class="cs-tbtn" data-set="min">最低</button><button class="cs-tbtn max" data-set="max">${maxLabel}</button></div>
        <div class="cs-betbar"><div class="cs-plaque"><i>${a.free ? '免費注' : '下注'}${chipMode() ? '・籌碼' : ''}</i><b>${money(this.stake)}</b><small>${money(a.min)} – ${money(this.max)}</small></div>
          <button class="candy yes cs-go"${this.stake < a.min ? ' disabled' : ''}>開始！</button></div>
      </div>`;
    main.querySelectorAll<HTMLButtonElement>('[data-set], [data-d]').forEach(b => b.onclick = () => {
      if (a.free) return;
      const set = b.dataset.set;
      this.stake = set === 'clear' ? 0 : set === 'min' ? a.min : set === 'max' ? this.max : Math.min(this.max, this.stake + Number(b.dataset.d));
      audio.sfx(Sfx.points);
      this.render();
    });
    main.querySelectorAll<HTMLButtonElement>('[data-bet]').forEach(b => b.onclick = () => { this.bet = b.dataset.bet!; audio.ui('click'); this.render(); });
    main.querySelectorAll<HTMLButtonElement>('[data-sic]').forEach(b => b.onclick = () => { this.sicBet = b.dataset.sic as C.SicboBet; audio.ui('click'); this.render(); });
    main.querySelectorAll<HTMLButtonElement>('[data-bac]').forEach(b => b.onclick = () => { this.bacBet = b.dataset.bac as C.BaccaratBet; audio.ui('click'); this.render(); });
    main.querySelectorAll<HTMLButtonElement>('[data-num]').forEach(b => b.onclick = () => { this.bet = 'num'; this.number = Number(b.dataset.num); audio.ui('click'); this.render(); });
    main.querySelector<HTMLButtonElement>('.cs-go')!.onclick = () => {
      if (this.stake < a.min) return;
      audio.ui('yes');
      const bet = g === 'roulette' ? (this.bet === 'num' ? { kind: 'number', n: this.number } : ROULETTE_BETS.find(r => r.key === this.bet)!.bet)
        : g === 'baccarat' ? this.bacBet : g === 'sicbo' ? this.sicBet : undefined;
      this.answer({ game: g, stake: this.stake, bet });
    };
  }

  /**
   * The other halls' tables as printed felts (cartoon): 百家樂 the 和 / 閒 / 莊 arcs and the two card boxes; 骰寶 the big
   * 小 / 大 zones with the house's 豹子 band and the cup on its plate; 21點 / 德州 the dealer's arc, the shoe and the betting
   * circle(s). Each zone says what it pays; the stake sits on the chosen zone as a chip stack.
   */
  private tableLayout(g: C.CasinoGame): string {
    const stack = this.stake > 0 ? chipStack(this.stake) : '';
    if (g === 'baccarat') {
      const arc = (b: C.BaccaratBet, label: string, pay: string) =>
        `<button class="cs-arc k-${b}${this.bacBet === b ? ' on' : ''}" data-bac="${b}"><span>押${label}</span><small>${pay}</small>${this.bacBet === b ? stack : ''}</button>`;
      return `<div class="cs-felt-l cs-tbl t-baccarat"><div class="cs-boxes"><div class="cs-cbox p"><b>閒</b><i></i><i></i><i></i></div><div class="cs-cbox b"><b>莊</b><i></i><i></i><i></i></div></div>
        ${arc('tie', '和', '贏 8 倍')}${arc('player', '閒', '贏 1 倍')}${arc('banker', '莊', '贏 0.95 倍')}</div>`;
    }
    if (g === 'sicbo') {
      const zone = (b: C.SicboBet, label: string, range: string) =>
        `<button class="cs-sz k-${b}${this.sicBet === b ? ' on' : ''}" data-sic="${b}"><span>押${label}</span><em>${range}</em><small>贏 1 倍</small>${this.sicBet === b ? stack : ''}</button>`;
      return `<div class="cs-felt-l cs-tbl t-sicbo"><div class="cs-sic-top"><span class="cs-mini-plate"></span><span class="cs-mini-cup"></span></div>
        <div class="cs-sic-zones">${zone('small', '小', '4 – 10 點')}${zone('big', '大', '11 – 17 點')}</div>
        <div class="cs-leopard">豹子（三顆一樣）莊家通殺</div></div>`;
    }
    const bj = g === 'blackjack';
    return `<div class="cs-felt-l cs-tbl t-${g}"><span class="cs-tshoe"></span>
      <div class="cs-darc"><span>${bj ? '莊家拿到 17 點以上就停牌' : '莊家　與你比最好的五張牌'}</span></div>
      <div class="cs-circles"><div class="cs-circle on"><span>${bj ? '下注' : '底注'}</span>${stack}</div>${bj ? '' : '<div class="cs-circle later"><span>跟注</span><small>看翻牌後決定</small></div>'}</div>
      <div class="cs-pays">${bj ? '<span>黑傑克 贏 1.5 倍</span><span>其他贏 1 倍</span><span>頭兩張可加倍</span>' : '<span>贏了兩份 1 賠 1</span><span>棄牌只輸底注</span>'}</div></div>`;
  }

  /**
   * 輪盤's betting layout as printed on a real table: the 0, the 3 × 12 numbers (red / black), the dozens, then
   * 1–18 / 雙 / 紅◆ / 黑◆ / 單 / 19–36; landscape as seen from the side, portrait from the end (12 rows of 3).
   * The stake sits as a chip stack on the chosen zone.
   */
  private rouletteLayout(por: boolean, mini = false): string {
    const stack = this.stake > 0 ? chipStack(this.stake, !mini) : '';
    // Selected (glowing) and, at the result, every zone the number wins lit up.
    const cls = (sel: boolean, b: C.RouletteBet) => `${sel ? ' on' : ''}${this.hitNum >= 0 && C.rouletteWins(b, this.hitNum) ? ' hit' : ''}`;
    const tag = mini ? 'div' : 'button';
    const cell = (n: number) => {
      const r = Math.floor((n - 1) / 3), c = (n - 1) % 3;
      const pos = por ? `grid-row:${r + 2};grid-column:${c + 3}` : `grid-row:${3 - c};grid-column:${r + 2}`;
      const sel = this.bet === 'num' && this.number === n;
      return `<${tag} class="cs-z n ${C.RED.has(n) ? 'r' : 'b'}${cls(sel, { kind: 'number', n })}" data-num="${n}" style="${pos}"><span>${n}</span>${sel ? stack : ''}</${tag}>`;
    };
    const z0 = this.bet === 'num' && this.number === 0;
    const zero = `<${tag} class="cs-z n z${cls(z0, { kind: 'number', n: 0 })}" data-num="0" style="${por ? 'grid-row:1;grid-column:3 / 6' : 'grid-row:1 / 4;grid-column:1'}"><span>0</span><small>單號 贏 35 倍</small>${z0 ? stack : ''}</${tag}>`;
    const dozens = [1, 2, 3].map(k => `<${tag} class="cs-z o${cls(this.bet === `d${k}`, { kind: 'dozen', n: k })}" data-bet="d${k}" style="${por ? `grid-row:${(k - 1) * 4 + 2} / ${k * 4 + 2};grid-column:2` : `grid-row:4;grid-column:${(k - 1) * 4 + 2} / ${k * 4 + 2}`}"><span>第${['一', '二', '三'][k - 1]}打</span><small>贏 2 倍</small>${this.bet === `d${k}` ? stack : ''}</${tag}>`).join('');
    const outs: [C.RouletteBet['kind'], string][] = [['low', '1–18'], ['even', '雙'], ['red', ''], ['black', ''], ['odd', '單'], ['high', '19–36']];
    const outside = outs.map(([k, label], i) => `<${tag} class="cs-z o${cls(this.bet === k, { kind: k } as C.RouletteBet)}" data-bet="${k}" style="${por ? `grid-row:${i * 2 + 2} / ${i * 2 + 4};grid-column:1` : `grid-row:5;grid-column:${i * 2 + 2} / ${i * 2 + 4}`}">${k === 'red' || k === 'black' ? `<i class="cs-dia ${k}"></i>` : `<span>${label}</span>`}<small>贏 1 倍</small>${this.bet === k ? stack : ''}</${tag}>`).join('');
    return `<div class="cs-rl ${por ? 'por' : 'land'}${mini ? ' mini' : ''}">${zero}${Array.from({ length: 36 }, (_, i) => cell(i + 1)).join('')}${dozens}${outside}</div>`;
  }

  /** 百家樂 / 骰寶 in play: the betting zones printed on the felt, the stake on the chosen one, the winner lit. */
  private playZones(): string {
    const stack = this.stake > 0 ? chipStack(this.stake, false) : '';
    const zone = (k: string, label: string, pay: string, sel: boolean) =>
      `<div class="cs-zn k-${k}${sel ? ' on' : ''}${this.won === k ? ' win' : ''}"><span>${label}</span><small>${pay}</small>${sel ? stack : ''}</div>`;
    if (this.game === 'baccarat') return `<div class="cs-zones bac">${zone('player', '閒', '贏 1 倍', this.bacBet === 'player')}${zone('tie', '和', '贏 8 倍', this.bacBet === 'tie')}${zone('banker', '莊', '贏 0.95 倍', this.bacBet === 'banker')}</div>`;
    if (this.game === 'sicbo') return `<div class="cs-zones sic">${zone('small', '小', '4–10 點', this.sicBet === 'small')}${zone('big', '大', '11–17 點', this.sicBet === 'big')}<div class="cs-zn k-triple${this.won === 'triple' ? ' win' : ''}"><span>豹子</span><small>莊家通殺</small></div></div>`;
    return '';
  }

  // ---------------------------------------------------------------- the table

  private renderTable(main: HTMLElement) {
    const t = this.table;
    // Only the cards new since the last drawing fly in (a card turned over flips).
    const row = (cards: (number | null)[], cls: 'dealer' | 'player' | 'board') => {
      const was = this.seen[cls];
      let k = 0;
      const html = `<div class="cs-cards ${cls}${this.best.length ? ' show' : ''}">${cards.map((c, i) => cardHtml(c, `${i >= was.length ? 'deal' : was[i] !== c ? 'flip' : ''}${c !== null && this.best.includes(c) ? ' best' : ''}`, i >= was.length ? k++ : 0)).join('')}</div>`;
      this.seen[cls] = [...cards];
      return html;
    };
    let center = '';
    // 輪盤: the wheel beside (portrait: above) the betting layout with the stake on its zone, the winners lit.
    if (this.game === 'roulette') center = `<div class="cs-wheel-box">${wheelHtml()}<div class="cs-orbit${this.settled ? ' settle' : ''}"><div class="cs-ball"></div></div><div class="cs-pointer">▼</div><div class="cs-wheel-num"></div></div><div class="cs-mini">${this.rouletteLayout(false, true)}</div>`;
    else if (this.game === 'sicbo') {
      center = `<div class="cs-dice-box"><div class="cs-cup${this.dice.length ? ' up' : ''}"></div><div class="cs-dice${this.diceShown ? ' still' : ''}">${this.dice.map((n, i) => diceHtml(n, i)).join('')}</div></div>`;
      if (this.dice.length) this.diceShown = true;
    } else if (this.game === 'holdem') center = row(t.board, 'board');
    const bk = this.choose.banker, p = this.choose.p;
    const dealerLabel = this.game === 'baccarat' ? '莊' : `莊家 ${esc(name(this.ctx, bk))}`;
    const playerLabel = this.game === 'baccarat' ? '閒' : esc(name(this.ctx, p));
    const cards = this.game !== 'roulette' && this.game !== 'sicbo';
    // 21點 / 德州: the stake in the betting circle; the other halls have it on their zone (it slides to the winner).
    const zoned = this.game === 'roulette' || this.game === 'baccarat' || this.game === 'sicbo';
    const pot = this.pot && !zoned ? `<div class="cs-pot ${this.pot}"><i></i><i></i><i></i><span>${money(this.stake)}</span></div>` : '';
    if (this.pot === 'in') this.pot = 'on';
    main.innerHTML = `<div class="cs-felt t-${this.game}${this.pot === 'guest' || this.pot === 'banker' ? ` pay-${this.pot}` : ''}">
        ${cards ? '<div class="cs-shoe"></div>' : ''}
        ${cards ? `<div class="cs-side dealer${this.natural.dealer ? ' natural' : ''}"><span class="cs-who">${dealerLabel}</span>${row(t.dealer, 'dealer')}<span class="cs-total">${esc(t.dealerNote)}</span></div>` : ''}
        <div class="cs-center">${center}<div class="cs-note">${esc(t.note)}</div>${this.playZones()}</div>
        ${cards ? `<div class="cs-side player${this.natural.player ? ' natural' : ''}"><span class="cs-who">${playerLabel}</span>${row(t.player, 'player')}<span class="cs-total">${esc(t.playerNote)}</span></div>` : ''}
        ${pot}
      </div>
      <div class="cs-bar">${this.caption ? `<span class="cs-on cs-cap2">${pieces(this.caption)}</span>` : `<span class="cs-on">${esc(this.betText())}</span>`}<div class="cs-moves"></div></div>
      ${this.banner ? `<div class="cs-bwrap"><div class="cs-banner ${this.banner.cls}">${this.banner.cls === 'win' ? `<div class="cs-burst">${Array.from({ length: 18 }, (_, i) => `<i style="--a:${i * (360 / 18)}deg;--d:${(i % 3) * 60}ms"></i>`).join('')}</div>` : ''}<b class="fit">${esc(this.banner.text)}</b>${this.banner.math ? `<div class="cs-math">${pieces(this.banner.math)}</div>` : ''}<span>${esc(this.banner.sub)}</span></div></div>` : ''}`;
    const moves = main.querySelector<HTMLElement>('.cs-moves')!;
    if (this.phase === 'blackjack' && this.ask?.phase === 'blackjack' && !this.watch) {
      const a = this.ask;
      main.querySelector('.cs-bar')!.classList.add('asking');
      moves.innerHTML = `<button class="candy yes" data-m="hit">要牌</button><button class="candy no" data-m="stand">停牌</button>${a.canDouble ? `<button class="candy" data-m="double">加倍 +${money(a.double ?? this.stake)}</button>` : ''}`;
    } else if (this.phase === 'holdem' && this.ask?.phase === 'holdem' && !this.watch) {
      const call = this.ask.call ?? this.stake;
      main.querySelector('.cs-bar')!.classList.add('asking');
      moves.innerHTML = `<button class="candy yes" data-m="call">${call < this.stake ? '全押' : '跟注'} +${money(call)}</button><button class="candy no" data-m="fold">棄牌</button>`;
    }
    moves.querySelectorAll<HTMLButtonElement>('[data-m]').forEach(b => b.onclick = () => { audio.ui(b.dataset.m === 'stand' || b.dataset.m === 'fold' ? 'no' : 'yes'); moves.innerHTML = ''; this.answer(b.dataset.m); });
    if (this.game === 'roulette') this.placeWheel(false);
  }

  private betText(): string {
    const g = C.GAME_NAMES[this.game];
    if (this.game === 'roulette') return `${g}・押${this.bet === 'num' ? `${this.number}號` : ROULETTE_BETS.find(r => r.key === this.bet)?.label ?? ''}・${money(this.stake)}`;
    if (this.game === 'baccarat') return `${g}・押${C.BACCARAT_NAMES[this.bacBet]}・${money(this.stake)}`;
    if (this.game === 'sicbo') return `${g}・押${C.SICBO_NAMES[this.sicBet]}・${money(this.stake)}`;
    return `${g}・下注 ${money(this.stake)}`;
  }

  private answer(v: unknown) { const r = this.resolve; this.resolve = null; r?.(v); }

  /** Waits for the player's answer to `a`. */
  wait(a: CasinoAsk): Promise<unknown> {
    this.ask = a;
    if (a.phase === 'blackjack') {
      this.phase = 'blackjack'; this.game = 'blackjack';
      this.table = { ...this.table, dealer: [a.up, null], player: [...a.player], note: a.canDouble ? '要牌・停牌・還是加倍？' : '再要一張，還是停牌？', playerNote: `${C.bjValue(a.player).total} 點`, dealerNote: '' };
    } else if (a.phase === 'holdem') {
      this.phase = 'holdem'; this.game = 'holdem';
      this.table = { ...this.table, dealer: [null, null], player: [...a.hole], board: [...a.board, null, null], note: '牌不錯就跟注，不好就棄牌', playerNote: C.bestHand([...a.hole, ...a.board]).name, dealerNote: '' };
    }
    this.render();
    return new Promise(resolve => { this.resolve = resolve; });
  }

  // ---------------------------------------------------------------- the result

  /** Plays the result of the visit (fast for a computer), then the payout banner; closes after it. */
  async result(fx: Fx) {
    const d = fx.data ?? {}, r = d.result as unknown as C.CasinoResult, net = Number(d.net), cap = Number(d.cap);
    this.phase = 'result';
    this.ask = null;
    this.game = r.game;
    this.stake = Number(d.stake);
    if (typeof d.godLine === 'string' && d.godLine) this.choose = { ...this.choose, godLine: d.godLine };
    if (r.game === 'roulette') { this.bet = r.bet.kind === 'number' ? 'num' : r.bet.kind === 'dozen' ? `d${r.bet.n}` : r.bet.kind; if (r.bet.kind === 'number') this.number = r.bet.n; }
    if (r.game === 'baccarat') this.bacBet = r.bet;
    if (r.game === 'sicbo') this.sicBet = r.bet;
    this.best = []; this.natural = { player: false, dealer: false }; this.mood = ''; this.settled = false;
    this.hitNum = -1; this.won = ''; this.diceShown = false;
    this.pot = 'in';
    // A computer's visit is played at a readable pace (19 §7): its bet first, its moves one by one; a tap skips ahead.
    const step = (ms: number) => (this.skip ? Promise.resolve() : sleep(ms * this.ctx.scale()));
    const show = () => this.render();
    const who = name(this.ctx, this.choose.p), extra = Number(d.extra ?? this.stake);
    if (this.watch) {
      this.caption = `${who} ${r.game === 'blackjack' || r.game === 'holdem' ? '下注' : C.betLabel(r)} ${money(this.stake)}${Number(d.fee) ? `・門票 ${money(Number(d.fee))}` : ''}`;
      this.table = { dealer: [], player: [], board: [], note: '', dealerNote: '', playerNote: '' };
      show();
      await step(1100);
    }
    if (r.game === 'roulette') {
      this.table = { dealer: [], player: [], board: [], note: '', dealerNote: '', playerNote: '' };
      show();
      audio.sfx(Sfx.wheel, true);
      await this.spinWheel(r.number, this.skip ? 300 : (this.watch ? 2200 : 2600) * this.ctx.scale());
      audio.stop(Sfx.wheel);
      this.table.note = `${r.number} 號${r.number === 0 ? '' : C.RED.has(r.number) ? '・紅' : '・黑'}`;
      this.hitNum = r.number;
      show();
      this.placeWheel(true, r.number);
    } else if (r.game === 'blackjack') {
      const dealer: (number | null)[] = [r.dealer[0], null];
      this.table = { dealer, player: [...r.player], board: [], note: '', dealerNote: '', playerNote: `${C.bjValue(r.player).total} 點${r.doubled ? '（加倍）' : ''}` };
      if (this.watch) {
        // The computer's moves one by one (要牌 / 停牌 / 加倍), each with a short pause.
        let dealt = 2;
        this.table.player = r.player.slice(0, 2);
        this.table.playerNote = `${C.bjValue(this.table.player as number[]).total} 點`;
        audio.sfx(Sfx.cardFlip); show(); await step(700);
        for (const m of r.moves) {
          this.caption = `${who}：${m === 'hit' ? '要牌' : m === 'stand' ? '停牌' : `加倍 +${money(extra)}`}`;
          show(); await step(750);
          if (m === 'stand') continue;
          dealt += 1;
          this.table.player = r.player.slice(0, dealt);
          this.table.playerNote = `${C.bjValue(this.table.player as number[]).total} 點${m === 'double' ? '（加倍）' : ''}`;
          audio.sfx(Sfx.cardFlip); show(); await step(500);
        }
        this.caption = '';
      }
      show();
      await step(420);
      for (let i = 1; i < r.dealer.length; i++) {
        this.table.dealer = r.dealer.slice(0, i + 1);
        this.table.dealerNote = `${C.bjValue(r.dealer.slice(0, i + 1)).total} 點`;
        audio.sfx(Sfx.cardFlip); show(); await step(480);
      }
      this.table.note = ({ blackjack: '黑傑克！', win: '贏了', push: '平手', lose: '輸了', bust: '爆牌', 'dealer-blackjack': '莊家黑傑克' } as const)[r.outcome];
      show();
    } else if (r.game === 'baccarat') {
      this.table = { dealer: [], player: [], board: [], note: '', dealerNote: '', playerNote: '' };
      const order: ['player' | 'dealer', number][] = [['player', r.player[0]], ['dealer', r.banker[0]], ['player', r.player[1]], ['dealer', r.banker[1]]];
      if (r.player[2] !== undefined) order.push(['player', r.player[2]]);
      if (r.banker[2] !== undefined) order.push(['dealer', r.banker[2]]);
      // Each card is dealt face down, then squeezed open (a slow peel).
      for (const [k, [side, c]] of order.entries()) {
        const hand = side === 'player' ? this.table.player : this.table.dealer;
        hand.push(null); show(); await step(260);
        hand[hand.length - 1] = c;
        this.table.playerNote = `${C.bacTotal(this.table.player.filter((x): x is number => x !== null))} 點`;
        this.table.dealerNote = `${C.bacTotal(this.table.dealer.filter((x): x is number => x !== null))} 點`;
        audio.sfx(Sfx.cardFlip); show(); await step(560);
        if (k === 3) {
          // 天生 8 / 9 on the first two cards glow.
          const nat = (h: (number | null)[]) => C.bacTotal(h.slice(0, 2) as number[]) >= 8;
          this.natural = { player: nat(this.table.player), dealer: nat(this.table.dealer) };
          if (this.natural.player || this.natural.dealer) { this.table.note = '天生贏家！'; show(); await step(500); }
        }
      }
      this.table.note = r.winner === 'tie' ? '和局' : `${C.BACCARAT_NAMES[r.winner]}贏`;
      this.won = r.winner;
      show();
    } else if (r.game === 'sicbo') {
      this.table = { dealer: [], player: [], board: [], note: '搖骰中…', dealerNote: '', playerNote: '' };
      this.dice = [];
      show();
      const cup = this.scene.stage.querySelector<HTMLElement>('.cs-cup');
      cup?.classList.add('shake');
      audio.sfx(Sfx.dice);
      await step(1400);
      this.dice = [...r.dice];
      this.table.note = r.triple ? `豹子 ${r.dice[0]}${r.dice[0]}${r.dice[0]}！` : `${r.total} 點・${r.total >= 11 ? '大' : '小'}`;
      this.won = r.triple ? 'triple' : r.total >= 11 ? 'big' : 'small';
      show();
    } else {
      this.table = { dealer: [null, null], player: [...r.hole], board: [...r.board.slice(0, 3), null, null], note: this.watch ? '翻牌' : r.called ? '跟注' : '棄牌', dealerNote: '', playerNote: C.bestHand([...r.hole, ...r.board.slice(0, 3)]).name };
      show();
      if (this.watch) {
        await step(800);
        this.caption = `${who}：${r.called ? `${extra < this.stake ? '全押' : '跟注'} +${money(extra)}` : '棄牌'}`;
        this.table.note = r.called ? '跟注' : '棄牌';
        show(); await step(850);
        this.caption = '';
      }
      if (r.called) {
        for (let i = 3; i < 5; i++) { await step(450); this.table.board[i] = r.board[i]; audio.sfx(Sfx.cardFlip); show(); }
        await step(400);
        this.table.dealer = [...r.dealer];
        this.table.playerNote = r.playerHand; this.table.dealerNote = r.dealerHand;
        this.table.note = r.outcome === 'win' ? '贏了' : r.outcome === 'lose' ? '輸了' : '平手';
        // The winning five light up (the others dim).
        this.best = C.bestHand(r.outcome === 'lose' ? [...r.dealer, ...r.board] : [...r.hole, ...r.board]).five;
        audio.sfx(Sfx.cardFlip); show();
      } else { this.table.note = '棄牌，輸掉底注'; show(); }
    }
    await step(500);
    const clipped = !!d.clipped, why = typeof d.why === 'string' ? d.why : '';
    const big = why ? `${why}${d.all ? `：全部${chipMode() ? '籌碼' : '現金'}` : ` ×${Number(d.mult)}`}・` : '';
    const bk = this.youBank ? '你（莊家）' : `莊家${name(this.ctx, this.choose.banker)}`;
    const math = typeof d.line === 'string' ? d.line : '';
    this.caption = '';
    this.pot = net > 0 || net === 0 ? 'guest' : 'banker';
    this.mood = net < 0 ? 'happy' : net > 0 ? 'sad' : '';
    this.banner = net > 0 ? { text: `${this.watch ? `${who} ` : ''}贏 +${money(net)}`, cls: 'win', math, sub: clipped && !math ? `超過上限，以 ${money(cap)} 計` : `${bk}付出` }
      : net < 0 ? { text: `${this.watch ? `${who} ` : ''}輸 −${money(-net)}`, cls: `lose${why ? ' big' : ''}`, math, sub: `${math ? '' : big}付給${bk}` }
        : { text: '平手', cls: 'push', math, sub: '退回賭注' };
    audio.sfx(net > 0 ? (net >= cap / 2 ? Sfx.fireworks : Sfx.points) : net < 0 ? Sfx.monthlyLow : Sfx.couponFlip);
    show();
    // The banner pops in the middle, then slides down to the bottom so the table's result stays in view.
    void this.scene.sleep(this.watch ? 700 : 1000).then(() => this.dockBanner());
    await this.scene.wait(this.watch ? 2400 : 3000);
    this.close();
  }

  /** Slides the result banner from the middle down onto the bar (no redraw: the table keeps its state). */
  private dockBanner() {
    if (this.closed) return;
    const wrap = this.scene.stage.querySelector<HTMLElement>('.cs-bwrap'), ban = wrap?.querySelector<HTMLElement>('.cs-banner');
    if (!wrap || !ban) return;
    // Scaled about the middle, then moved so its bottom sits just above the page's bottom edge (scene units).
    // Landscape: to the bottom right, beside the bet line (the felt's zones stay in view).
    const por = this.scene.portrait, s = por ? 0.86 : 0.68, rh = wrap.offsetHeight, rw = wrap.offsetWidth, bh = ban.offsetHeight, bw = ban.offsetWidth;
    const dx = por ? 0 : Math.max(0, rw / 2 - 14 - (bw * s) / 2);
    wrap.style.transform = `translate(${dx}px, ${Math.max(0, rh / 2 - (por ? 10 : 6) - (bh * s) / 2)}px) scale(${s})`;
    wrap.classList.add('docked');
  }

  // ---------------------------------------------------------------- the wheel

  private placeWheel(done: boolean, n?: number) {
    const box = this.scene.stage.querySelector<HTMLElement>('.cs-wheel-box');
    if (!box) return;
    const wheel = box.querySelector<HTMLElement>('.w-rotor')!;
    wheel.style.transform = `rotate(${this.wheelAt}deg)`;
    if (done && n !== undefined) {
      const num = box.querySelector<HTMLElement>('.cs-wheel-num')!;
      num.textContent = String(n);
      num.className = `cs-wheel-num on ${n === 0 ? 'z' : C.RED.has(n) ? 'r' : 'b'}`;
    }
  }

  /** Turns the wheel so that pocket `n` stops under the ball at the top. */
  private async spinWheel(n: number, ms: number) {
    const i = C.WHEEL.indexOf(n), per = 360 / 37;
    const target = -(i * per) - 360 * 5;
    this.wheelAt = 0;
    this.placeWheel(false);
    const wheel = this.scene.stage.querySelector<HTMLElement>('.cs-wheel-box .w-rotor');
    if (wheel) {
      wheel.style.transition = 'none';
      wheel.style.transform = 'rotate(0deg)';
      void wheel.getBoundingClientRect();
      wheel.style.transition = `transform ${Math.max(300, ms)}ms cubic-bezier(.12,.6,.18,1)`;
      wheel.style.transform = `rotate(${target}deg)`;
    }
    // The ball runs the other way round the rim, slows down later than the wheel, then drops in at the top.
    const orbit = this.scene.stage.querySelector<HTMLElement>('.cs-orbit');
    if (orbit) {
      orbit.classList.remove('settle');
      orbit.style.transition = 'none';
      orbit.style.transform = 'rotate(0deg)';
      void orbit.getBoundingClientRect();
      orbit.style.transition = `transform ${Math.max(300, ms)}ms cubic-bezier(.2,.7,.25,1)`;
      orbit.style.transform = `rotate(${360 * 7}deg)`;
    }
    this.wheelAt = target;
    await sleep(Math.max(300, ms));
    this.settled = true;
    orbit?.classList.add('settle');
  }
}

/** A chip's face value as printed: chips in the finale, 千 / 萬 elsewhere. */
const chipLabel = (v: number) => (chipMode() ? (v / 100).toLocaleString('en-US') : v >= 10000 ? `${v / 10000}萬` : `${v / 1000}千`);
/** The chip tray (19 §5.1): four denominations, × the finale's blinds (19 §5.5); a tap adds one to the bet. */
function trayChips(mult = 1): string {
  return [1000, 5000, 10000, 50000].map((v, k) => `<button class="cs-chip v${k}" data-d="${v * mult}"><span>${chipLabel(v * mult)}</span></button>`).join('');
}
/** The bet as a little stack of chips with its amount, set on the chosen zone. */
function chipStack(amount: number, drop = true): string {
  const n = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount / 1000)) * 1.5));
  return `<span class="cs-stack${drop ? '' : ' still'}">${Array.from({ length: n }, (_, i) => `<i style="--k:${i}"></i>`).join('')}<b>${esc(money(amount))}</b></span>`;
}

/** A die face (CSS pips). */
function diceHtml(n: number, i = 0): string {
  const pips: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return `<div class="cs-die${n === 1 || n === 4 ? ' red' : ''}" style="--i:${i}">${Array.from({ length: 9 }, (_, i) => `<i${pips[n]?.includes(i) ? ' class="on"' : ''}></i>`).join('')}</div>`;
}

/** A hall's plate (the picker's art), or its emoji on a coloured tile while the art is missing. */
export function hallPlate(type: number, game: C.CasinoGame): string {
  return `<span class="cs-hplate t${type}"><img src="${PLATE(type)}" alt="" onerror="this.remove()"><em>${GAME_ICON[game]}</em></span>`;
}

/**
 * The roulette wheel in layers: the rotor (SVG: the 37 pockets in the exact European order, crisp numbers, under the
 * art turret) turns inside the static bowl art (its middle cut out), the ball (art) runs on the bowl's track.
 */
function wheelHtml(): string {
  const R = 108, r2 = 70, per = (2 * Math.PI) / 37;
  const parts: string[] = [];
  C.WHEEL.forEach((n, i) => {
    const a0 = i * per - per / 2 - Math.PI / 2, a1 = a0 + per;
    const p = (a: number, rr: number) => `${(110 + rr * Math.cos(a)).toFixed(2)},${(110 + rr * Math.sin(a)).toFixed(2)}`;
    const col = n === 0 ? 'url(#cs-pz)' : C.RED.has(n) ? 'url(#cs-pr)' : 'url(#cs-pb)';
    parts.push(`<path d="M${p(a0, r2)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, r2)} A${r2},${r2} 0 0 0 ${p(a0, r2)}Z" fill="${col}" stroke="#ffd23f" stroke-width="1.6"/>`);
    const am = a0 + per / 2, tx = 110 + 92 * Math.cos(am), ty = 110 + 92 * Math.sin(am);
    parts.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${(am * 180) / Math.PI + 90} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="central">${n}</text>`);
  });
  const grad = (id: string, a: string, b: string) => `<radialGradient id="${id}" cx="110" cy="110" r="108" gradientUnits="userSpaceOnUse"><stop offset=".62" stop-color="${b}"/><stop offset=".86" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
  return `<div class="cs-wheel3"><div class="w-rotor"><svg viewBox="0 0 220 220" class="cs-wheel"><defs>${grad('cs-pr', '#ff6b7a', '#d0102f')}${grad('cs-pb', '#5a5a80', '#22223a')}${grad('cs-pz', '#5cf08a', '#139a40')}
    <radialGradient id="cs-cone"><stop offset="0" stop-color="#fff2b0"/><stop offset=".7" stop-color="#e2a92a"/><stop offset="1" stop-color="#9a5a10"/></radialGradient></defs>
    <circle cx="110" cy="110" r="109" fill="#2a1250"/>${parts.join('')}<circle cx="110" cy="110" r="${r2}" fill="url(#cs-cone)" stroke="#2a1250" stroke-width="3"/></svg>
    <span class="w-turret"></span></div><span class="w-bowl"></span></div>`;
}

/** The page of the human's visit, from the first question to the result fx. */
let live: CasinoPage | null = null;

askScreens.casino = async (ctx, ask) => {
  const a = ask as unknown as CasinoAsk;
  if (a.phase === 'choose') {
    live?.close();
    live = new CasinoPage(ctx, a);
    live.open();
    return live.wait(a);
  }
  if (!live || live.closed) return a.phase === 'blackjack' ? C.bjBasic(a.player, a.up) : 'call';
  return live.wait(a);
};

fxScreens['casino-result'] = async (ctx, fx) => {
  const d = fx.data ?? {};
  let page = live && !live.closed && live.choose.p === fx.p ? live : null;
  live = null;
  if (!page) {
    // A computer's visit (or the human's on autopilot): the same table, replayed fast without controls.
    const p = ctx.game.players[fx.p ?? 0];
    page = new CasinoPage(ctx, {
      t: 'casino', p: fx.p ?? 0, phase: 'choose', game: ((d.result as { game?: C.CasinoGame })?.game ?? 'roulette'), hall: String(d.hall ?? ''),
      banker: fx.target ?? 0, facility: Number(d.facility), name: String(d.name ?? ''),
      level: Number(d.level), cap: Number(d.cap), min: 0, cash: (p?.cash ?? 0) + (p?.bank ?? 0), fee: Number(d.fee ?? 0),
    }, true);
    page.open();
  }
  await page.result(fx as Fx);
};

// ------------------------------------------------------------------ 莊家不在！ the gods' slot machine (19 §5.4)

fxScreens['casino-auto'] = async (ctx, fx) => {
  const d = fx.data ?? {};
  const digits = (d.digits as number[]) ?? [0, 1, 0, 0], amount = Number(d.amount), level = Number(d.level);
  await new Promise<void>(done => {
    let reels: HTMLElement[] = [], text: HTMLElement | null = null;
    const stopped = [false, false, false, false];
    const top = [0, 1, 2, 3, 5, 8][Math.max(1, Math.min(5, level))];
    const shown = [0, 0, 0, 0];
    const paint = () => {
      reels.forEach((r, i) => {
        const st = r.firstElementChild as HTMLElement, H = r.clientHeight || 36;
        st.style.transform = `translateY(${-shown[i] * H}px)`;
        r.classList.toggle('fast', !stopped[i]);
      });
      if (text) text.innerHTML = stopped[3]
        ? `<span>自動獲勝</span><b class="cs-auto-win">${esc(fmtMoney(amount))}</b>`
        : `<span>莊家${esc(String(d.away ?? ''))}</span><span>拉霸決定彩金</span><small>最高 ${esc(fmtMoney(Number(d.cap)))}</small>`;
    };
    const s = openScene(ctx, 'cs-auto sm-scene', portrait => (portrait ? [272, 384] : [505, 199]), sc => {
      const side = !sc.portrait;
      const g1 = sc.box('sm-group', side ? 8 - 97 : -88, side ? 14 - 39 : -30, 0, 0);
      const g2 = sc.box('sm-group', side ? 8 + 249 + 16 - 124 : -88, side ? 8 - 222 : -30, 0, 0);
      // The remake's message box (style.css .msg: blue, orange border, dashed frame, ribbon title), not the original's board.
      void g1;
      const box = sc.box('msg cs-auto-msg', side ? 20 : 26, side ? 52 : 34, side ? 222 : 220, side ? 128 : 128, '<div class="ribbon">莊家不在！</div><div class="msg-text cs-auto-text"></div>');
      text = box.querySelector<HTMLElement>('.cs-auto-text');
      sc.art('Panel', 67, 0, 220, 320, 'sm-body spin', g2);
      const strip = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(x => `<b>${x}</b>`).join('');
      // Four reels and the fixed last 0 as a fifth, static reel of the same look (amount = the four digits × 10).
      // The original's four reel windows (145…292) hold five narrower reels.
      reels = [146, 175.5, 205, 234.5].map(x => sc.box('sm-reel fast cs-auto-reel', x, 320, 27, 36, `<div class="sm-strip">${strip}</div>`, g2));
      sc.box('sm-reel cs-auto-reel cs-auto-zero', 264, 320, 27, 36, '<div class="sm-strip"><b>0</b></div>', g2);
      sc.art('Panel', 67, 3, 317, 240, 'sm-lever', g2);
      paint();
    });
    audio.sfx(Sfx.slot, true);
    const t0 = performance.now(), scale = ctx.scale();
    const timer = window.setInterval(() => {
      const t = performance.now() - t0;
      for (let i = 0; i < 4; i++) {
        if (stopped[i]) continue;
        if (t > (700 + i * 380) * scale) { stopped[i] = true; shown[i] = digits[i]; audio.ui('click'); }
        else shown[i] = i === 0 ? Math.floor(Math.random() * (top + 1)) : Math.floor(Math.random() * 10);
      }
      paint();
      if (stopped[3]) {
        clearInterval(timer);
        audio.stop(Sfx.slot);
        audio.sfx(amount >= Number(d.cap) / 2 ? Sfx.fireworks : Sfx.points);
        void s.wait(1800).then(() => { s.close(); done(); });
      }
    }, 60);
  });
};

// ------------------------------------------------------------------ 過路稅 / 籌碼券 (19 §4.4)

fxScreens['finale-square'] = async (ctx, fx) => {
  const d = fx.data ?? {}, amount = Number(d.amount), tax = d.kind === 'tax';
  const el = document.createElement('div');
  el.className = `cs-toast ${tax ? 'tax' : 'coupon'}`;
  el.innerHTML = `<b>${tax ? '過路稅' : '籌碼券'}</b><span>${tax ? '−' : '+'}${esc(fmtMoney(amount))}</span><small>${esc(name(ctx, fx.p ?? 0))}${Number(d.mult) > 1 ? `・盲注 ×${Number(d.mult)}` : ''}</small>`;
  document.body.append(el);
  audio.sfx(tax ? Sfx.rent : Sfx.points);
  await sleep(900 * Math.max(0.5, ctx.scale()));
  el.classList.add('out');
  setTimeout(() => el.remove(), 400);
};

// ------------------------------------------------------------------ 盲注遞增 (19 §5.5)

fxScreens['finale-blinds'] = async (ctx, fx) => {
  const d = fx.data ?? {};
  const caps = (d.caps as number[]) ?? [], mins = (d.mins as number[]) ?? [];
  audio.sfx(Sfx.fireworks);
  await ctx.flash(`加注時間！\n賭注上限翻倍 ×${Number(d.mult)}\n\n贏錢上限 ${fmtMoney(caps[0] ?? 0, false)}–${fmtMoney(caps[4] ?? 0)}\n最低下注 ${fmtMoney(mins[0] ?? 0, false)}–${fmtMoney(mins[4] ?? 0)}\n門票也翻倍・下次加注：第 ${Number(d.next) + 1} 天`, 2200 * Math.max(0.5, ctx.scale()));
};

// ------------------------------------------------------------------ 門票 (19 §5.0)

fxScreens['casino-fee'] = async (ctx, fx) => {
  const d = fx.data ?? {};
  preload();
  audio.sfx(Sfx.rent);
  await ctx.flash(`${name(ctx, fx.p ?? 0)}進入${String(d.name ?? '')}${String(d.hall ?? '賭場')}\n\n門票 ${fmtMoney(Number(d.fee))}\n（付給莊家${name(ctx, fx.target ?? 0)}）`, (ctx.game.players[fx.p ?? 0]?.human ? 1100 : 750) * Math.max(0.5, ctx.scale()));
};
