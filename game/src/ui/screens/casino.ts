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
import './casino.css';

type Fx = { t: 'fx'; kind: string; p?: number; target?: number; node?: number; data?: Record<string, unknown> };
interface ChooseAsk { t: 'casino'; p: number; phase: 'choose'; game: C.CasinoGame; hall: string; banker: number; facility: number; name: string; level: number; cap: number; min: number; max?: number; mult?: number; cash: number; fee: number; godLine?: string }
interface BjAsk { t: 'casino'; p: number; phase: 'blackjack'; player: number[]; up: number; canDouble: boolean; double?: number; stake: number }
interface HeAsk { t: 'casino'; p: number; phase: 'holdem'; hole: number[]; board: number[]; stake: number; call?: number }
type CasinoAsk = ChooseAsk | BjAsk | HeAsk;

/** Table art (tools/tycoon-art/casino.py → maps/remake/casino/); the felt is drawn in CSS when it is missing. */
const ART: Record<string, string> = {
  lobby: `${ASSETS}/maps/remake/casino/lobby.webp`, roulette: `${ASSETS}/maps/remake/casino/roulette.webp`,
  blackjack: `${ASSETS}/maps/remake/casino/blackjack.webp`, baccarat: `${ASSETS}/maps/remake/casino/baccarat.webp`,
  holdem: `${ASSETS}/maps/remake/casino/holdem.webp`, sicbo: `${ASSETS}/maps/remake/casino/sicbo.webp`,
};
/** The halls' plates (the build picker's strip, tools/tycoon-art/casino.py): maps/remake/casino/plate-<type>.webp. */
export const PLATE = (type: number) => `${ASSETS}/maps/remake/casino/plate-${type}.webp`;
const TYPE_OF: Record<C.CasinoGame, number> = { roulette: 5, blackjack: 6, baccarat: 7, holdem: 8, sicbo: 9 };
export const GAME_ICON: Record<C.CasinoGame, string> = { roulette: '🎡', blackjack: '🂡', baccarat: '🀄', holdem: '♠', sicbo: '🎲' };
const GAME_RULE: Record<C.CasinoGame, string> = {
  roulette: '押顏色、單雙、大小 1 賠 1，押一打 1 賠 2，押單號 1 賠 35（0 號莊家通吃）',
  blackjack: '比莊家接近 21 點，超過就爆。21 點（黑傑克）1 賠 1.5，可加倍再拿一張',
  baccarat: '押閒或莊 1 賠 1（莊贏抽 5%），押和 1 賠 8；按標準補牌規則',
  holdem: '先下底注看翻牌，跟注再押一份看到底，五張最大牌型比大小，贏了兩份 1 賠 1',
  sicbo: '莊家搖三顆骰子：押大（11–17）或小（4–10），1 賠 1；豹子（三顆一樣）通殺',
};
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
export function cardHtml(c: number | null, cls = ''): string {
  if (c === null || c < 0) return `<div class="cs-card back ${cls}"><i></i></div>`;
  const r = RANK[C.rank(c)], s = SUIT[C.suit(c)];
  return `<div class="cs-card ${SUIT_RED(c) ? 'red' : ''} ${cls}"><b>${r}</b><s>${s}</s><em>${s}</em></div>`;
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
  /** Replay of a computer's visit (no controls). */
  constructor(readonly ctx: ScreenContext, a: ChooseAsk, readonly watch = false) {
    this.choose = a;
    this.game = a.game;
    this.stake = Math.min(this.max, Math.max(a.min, Math.round(Math.min(a.cash, a.cap) / 2 / 1000) * 1000));
  }

  /** The highest stake: the cap, or less when the visitor holds less (19 §5.1). */
  get max(): number { return Math.max(this.choose.min, Math.min(this.choose.cap, this.choose.max ?? this.choose.cap)); }

  open() {
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
    return `<div class="cs-plate"><span class="cs-sign">${esc(a.name)}${esc(a.hall)}</span><span class="cs-lv">Lv${a.level}</span>
      <span class="cs-cap">贏錢上限 <b>${money(a.cap)}</b>${a.fee ? `・門票 <b>${money(a.fee)}</b>` : ''}</span></div>
      <div class="cs-banker${this.youBank && this.watch ? ' you' : ''}">${face(ctx, bk?.character ?? 0, 'cs-face')}<span>${this.youBank && this.watch ? '你是莊家' : '莊家'}<br><b>${esc(name(ctx, a.banker))}</b></span></div>
      <div class="cs-guest">${face(ctx, ctx.game.players[a.p]?.character ?? 0, 'cs-face')}<span>${esc(name(ctx, a.p))}${a.godLine ? `<em class="cs-god">${esc(a.godLine)}</em>` : ''}<br><b>${money(a.cash)}</b></span></div>`;
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
    const main = root.querySelector<HTMLElement>('.cs-main')!;
    if (this.phase === 'choose') this.renderChoose(main);
    else this.renderTable(main);
  }

  // ---------------------------------------------------------------- choose: game and stake

  private renderChoose(main: HTMLElement) {
    const a = this.choose;
    main.innerHTML = `<div class="cs-hallcard">${hallPlate(TYPE_OF[this.game], this.game)}
        <b class="cs-hname">${esc(a.hall)}</b><span class="cs-hgame">${C.GAME_NAMES[this.game]}</span>
        <div class="cs-big"><i>莊家大牌（不設上限）</i>${esc(C.BANKER_TABLE[this.game].replace(/現金/g, chipMode() ? '籌碼' : '現金')).replace(/・/g, '<br>')}</div></div>
      <div class="cs-bet">
        <div class="cs-rule">${esc(GAME_RULE[this.game])}</div>
        <div class="cs-pick">${this.pickHtml()}</div>
        <div class="cs-stake"><span class="cs-stk-l">下注${chipMode() ? '（籌碼）' : ''}</span><b class="cs-stk">${money(this.stake)}</b>
          <span class="cs-range">${money(a.min)} – ${money(this.max)}</span></div>
        <div class="cs-chips">
          ${chipButtons(a.mult ?? 1)}
          <button class="cs-chip min" data-set="min">最低</button><button class="cs-chip max" data-set="max">${this.max < a.cap ? '全押' : '上限'}</button>
        </div>
        <button class="candy yes cs-go">開始！</button>
      </div>`;
    main.querySelectorAll<HTMLButtonElement>('.cs-chip').forEach(b => b.onclick = () => {
      const set = b.dataset.set;
      this.stake = set === 'min' ? a.min : set === 'max' ? this.max : Math.max(a.min, Math.min(this.max, this.stake + Number(b.dataset.d)));
      audio.sfx(Sfx.points);
      this.render();
    });
    main.querySelectorAll<HTMLButtonElement>('[data-bet]').forEach(b => b.onclick = () => { this.bet = b.dataset.bet!; audio.ui('click'); this.render(); });
    main.querySelectorAll<HTMLButtonElement>('[data-sic]').forEach(b => b.onclick = () => { this.sicBet = b.dataset.sic as C.SicboBet; audio.ui('click'); this.render(); });
    main.querySelectorAll<HTMLButtonElement>('[data-bac]').forEach(b => b.onclick = () => { this.bacBet = b.dataset.bac as C.BaccaratBet; audio.ui('click'); this.render(); });
    main.querySelectorAll<HTMLButtonElement>('[data-num]').forEach(b => b.onclick = () => { this.bet = 'num'; this.number = Number(b.dataset.num); audio.ui('click'); this.render(); });
    main.querySelector<HTMLButtonElement>('.cs-go')!.onclick = () => {
      audio.ui('yes');
      const bet = this.game === 'roulette' ? (this.bet === 'num' ? { kind: 'number', n: this.number } : ROULETTE_BETS.find(r => r.key === this.bet)!.bet)
        : this.game === 'baccarat' ? this.bacBet : this.game === 'sicbo' ? this.sicBet : undefined;
      this.answer({ game: this.game, stake: this.stake, bet });
    };
  }

  private pickHtml(): string {
    if (this.game === 'roulette') {
      const nums = Array.from({ length: 37 }, (_, n) => `<button class="cs-num ${n === 0 ? 'z' : C.RED.has(n) ? 'r' : 'b'}${this.bet === 'num' && this.number === n ? ' on' : ''}" data-num="${n}">${n}</button>`).join('');
      return `<div class="cs-rbets">${ROULETTE_BETS.map(r => `<button class="cs-opt${this.bet === r.key ? ' on' : ''} k-${r.key}" data-bet="${r.key}">${r.label}</button>`).join('')}</div>
        <div class="cs-nums">${nums}</div>`;
    }
    if (this.game === 'baccarat') {
      return `<div class="cs-bac">${(['player', 'banker', 'tie'] as C.BaccaratBet[]).map(b => `<button class="cs-opt big${this.bacBet === b ? ' on' : ''} k-${b}" data-bac="${b}">${C.BACCARAT_NAMES[b]}<small>${b === 'tie' ? '1 賠 8' : b === 'banker' ? '1 賠 0.95' : '1 賠 1'}</small></button>`).join('')}</div>`;
    }
    if (this.game === 'sicbo') {
      return `<div class="cs-bac sic">${(['small', 'big'] as C.SicboBet[]).map(b => `<button class="cs-opt big${this.sicBet === b ? ' on' : ''} k-${b}" data-sic="${b}">${C.SICBO_NAMES[b]}<small>${b === 'big' ? '11–17・1 賠 1' : '4–10・1 賠 1'}</small></button>`).join('')}</div>`;
    }
    if (this.game === 'blackjack') return `<div class="cs-hint">發兩張牌，再決定要牌、停牌或加倍。</div>`;
    return `<div class="cs-hint">跟莊家各拿兩張底牌，看完翻牌（三張公牌）再決定跟注或棄牌。</div>`;
  }

  // ---------------------------------------------------------------- the table

  private renderTable(main: HTMLElement) {
    const t = this.table;
    // Only the cards new since the last drawing fly in (a card turned over flips).
    const row = (cards: (number | null)[], cls: 'dealer' | 'player' | 'board') => {
      const was = this.seen[cls];
      const html = `<div class="cs-cards ${cls}">${cards.map((c, i) => cardHtml(c, i >= was.length ? 'deal' : was[i] !== c ? 'flip' : '')).join('')}</div>`;
      this.seen[cls] = [...cards];
      return html;
    };
    let center = '';
    if (this.game === 'roulette') center = `<div class="cs-wheel-box">${wheelSvg()}<div class="cs-ball"></div><div class="cs-wheel-num"></div></div>`;
    else if (this.game === 'sicbo') center = `<div class="cs-dice-box"><div class="cs-cup${this.dice.length ? ' up' : ''}"></div><div class="cs-dice">${this.dice.map(n => diceHtml(n)).join('')}</div></div>`;
    else if (this.game === 'holdem') center = row(t.board, 'board');
    const bk = this.choose.banker, p = this.choose.p;
    const dealerLabel = this.game === 'baccarat' ? '莊' : `莊家 ${esc(name(this.ctx, bk))}`;
    const playerLabel = this.game === 'baccarat' ? '閒' : esc(name(this.ctx, p));
    main.innerHTML = `<div class="cs-felt">
        ${this.game === 'roulette' || this.game === 'sicbo' ? '' : `<div class="cs-side dealer"><span class="cs-who">${dealerLabel}</span>${row(t.dealer, 'dealer')}<span class="cs-total">${esc(t.dealerNote)}</span></div>`}
        <div class="cs-center">${center}<div class="cs-note">${esc(t.note)}</div></div>
        ${this.game === 'roulette' || this.game === 'sicbo' ? '' : `<div class="cs-side player"><span class="cs-who">${playerLabel}</span>${row(t.player, 'player')}<span class="cs-total">${esc(t.playerNote)}</span></div>`}
      </div>
      ${this.caption ? `<div class="cs-caption">${esc(this.caption)}</div>` : ''}
      <div class="cs-bar"><span class="cs-on">${esc(this.betText())}</span><div class="cs-moves"></div></div>
      ${this.banner ? `<div class="cs-banner ${this.banner.cls}"><b>${esc(this.banner.text)}</b>${this.banner.math ? `<i class="cs-math">${esc(this.banner.math)}</i>` : ''}<span>${esc(this.banner.sub)}</span></div>` : ''}`;
    const moves = main.querySelector<HTMLElement>('.cs-moves')!;
    if (this.phase === 'blackjack' && this.ask?.phase === 'blackjack' && !this.watch) {
      const a = this.ask;
      moves.innerHTML = `<button class="candy yes" data-m="hit">要牌</button><button class="candy no" data-m="stand">停牌</button>${a.canDouble ? `<button class="candy" data-m="double">加倍 +${money(a.double ?? this.stake)}</button>` : ''}`;
    } else if (this.phase === 'holdem' && this.ask?.phase === 'holdem' && !this.watch) {
      const call = this.ask.call ?? this.stake;
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
      this.table = { ...this.table, dealer: [a.up, null], player: [...a.player], note: '', playerNote: `${C.bjValue(a.player).total} 點`, dealerNote: '' };
    } else if (a.phase === 'holdem') {
      this.phase = 'holdem'; this.game = 'holdem';
      this.table = { ...this.table, dealer: [null, null], player: [...a.hole], board: [...a.board, null, null], note: '翻牌', playerNote: C.bestHand([...a.hole, ...a.board]).name, dealerNote: '' };
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
      for (const [side, c] of order) {
        (side === 'player' ? this.table.player : this.table.dealer).push(c);
        this.table.playerNote = `${C.bacTotal(this.table.player as number[])} 點`;
        this.table.dealerNote = `${C.bacTotal(this.table.dealer as number[])} 點`;
        audio.sfx(Sfx.cardFlip); show(); await step(420);
      }
      this.table.note = r.winner === 'tie' ? '和局' : `${C.BACCARAT_NAMES[r.winner]}贏`;
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
        audio.sfx(Sfx.cardFlip); show();
      } else { this.table.note = '棄牌，輸掉底注'; show(); }
    }
    await step(500);
    const clipped = !!d.clipped, why = typeof d.why === 'string' ? d.why : '';
    const big = why ? `${why}${d.all ? `：全部${chipMode() ? '籌碼' : '現金'}` : ` ×${Number(d.mult)}`}・` : '';
    const bk = this.youBank ? '你（莊家）' : `莊家${name(this.ctx, this.choose.banker)}`;
    const math = typeof d.line === 'string' ? d.line : '';
    this.caption = '';
    this.banner = net > 0 ? { text: `${this.watch ? `${who} ` : ''}贏 +${money(net)}`, cls: 'win', math, sub: clipped && !math ? `超過上限，以 ${money(cap)} 計` : `${bk}付出` }
      : net < 0 ? { text: `${this.watch ? `${who} ` : ''}輸 −${money(-net)}`, cls: `lose${why ? ' big' : ''}`, math, sub: `${math ? '' : big}付給${bk}` }
        : { text: '平手', cls: 'push', math, sub: '退回賭注' };
    audio.sfx(net > 0 ? (net >= cap / 2 ? Sfx.fireworks : Sfx.points) : net < 0 ? Sfx.monthlyLow : Sfx.couponFlip);
    show();
    await this.scene.wait(this.watch ? 2000 : 2600);
    this.close();
  }

  // ---------------------------------------------------------------- the wheel

  private placeWheel(done: boolean, n?: number) {
    const box = this.scene.stage.querySelector<HTMLElement>('.cs-wheel-box');
    if (!box) return;
    const wheel = box.querySelector<SVGElement>('svg')!;
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
    const wheel = this.scene.stage.querySelector<SVGElement>('.cs-wheel-box svg');
    if (wheel) {
      wheel.style.transition = 'none';
      wheel.style.transform = 'rotate(0deg)';
      void wheel.getBoundingClientRect();
      wheel.style.transition = `transform ${Math.max(300, ms)}ms cubic-bezier(.12,.6,.18,1)`;
      wheel.style.transform = `rotate(${target}deg)`;
    }
    this.wheelAt = target;
    await sleep(Math.max(300, ms));
  }
}

/** The stake chips: ±1,000 / ±5,000 元, shown as ±10 / ±50 in the finale's chips; × the finale's blinds (19 §5.5). */
function chipButtons(mult = 1): string {
  const t = (n: number) => (chipMode() ? (n / 100).toLocaleString('en-US') : `${n / 1000}千`);
  const a = 1000 * mult, b = 5000 * mult;
  return `<button class="cs-chip c5" data-d="${-b}">−${t(b)}</button><button class="cs-chip c1" data-d="${-a}">−${t(a)}</button>
    <button class="cs-chip c50" data-d="${a}">+${t(a)}</button><button class="cs-chip c10" data-d="${b}">+${t(b)}</button>`;
}

/** A die face (CSS pips). */
function diceHtml(n: number): string {
  const pips: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return `<div class="cs-die${n === 1 || n === 4 ? ' red' : ''}">${Array.from({ length: 9 }, (_, i) => `<i${pips[n]?.includes(i) ? ' class="on"' : ''}></i>`).join('')}</div>`;
}

/** A hall's plate (the picker's art), or its emoji on a coloured tile while the art is missing. */
export function hallPlate(type: number, game: C.CasinoGame): string {
  return `<span class="cs-hplate t${type}"><img src="${PLATE(type)}" alt="" onerror="this.remove()"><em>${GAME_ICON[game]}</em></span>`;
}

/** The roulette wheel as SVG: 37 pockets in the European order, 0 at the top. */
function wheelSvg(): string {
  const R = 100, r2 = 64, per = (2 * Math.PI) / 37;
  const parts: string[] = [];
  C.WHEEL.forEach((n, i) => {
    const a0 = i * per - per / 2 - Math.PI / 2, a1 = a0 + per;
    const p = (a: number, rr: number) => `${(110 + rr * Math.cos(a)).toFixed(2)},${(110 + rr * Math.sin(a)).toFixed(2)}`;
    const col = n === 0 ? '#1c9a4a' : C.RED.has(n) ? '#d8242f' : '#1d1d26';
    parts.push(`<path d="M${p(a0, r2)} L${p(a0, R)} A${R},${R} 0 0 1 ${p(a1, R)} L${p(a1, r2)} A${r2},${r2} 0 0 0 ${p(a0, r2)}Z" fill="${col}" stroke="#f4d27a" stroke-width="0.8"/>`);
    const am = a0 + per / 2, tx = 110 + 88 * Math.cos(am), ty = 110 + 88 * Math.sin(am);
    parts.push(`<text x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" transform="rotate(${(am * 180) / Math.PI + 90} ${tx.toFixed(1)} ${ty.toFixed(1)})" text-anchor="middle" dominant-baseline="central">${n}</text>`);
  });
  return `<svg viewBox="0 0 220 220" class="cs-wheel"><circle cx="110" cy="110" r="108" fill="#7a4a12" stroke="#ffd860" stroke-width="4"/>${parts.join('')}
    <circle cx="110" cy="110" r="62" fill="url(#csg)"/><defs><radialGradient id="csg"><stop offset="0" stop-color="#fff2b0"/><stop offset=".6" stop-color="#e2a92a"/><stop offset="1" stop-color="#8a5a10"/></radialGradient></defs>
    ${[0, 1, 2, 3].map(k => `<rect x="106" y="58" width="8" height="104" rx="4" fill="#ffe9a0" transform="rotate(${k * 45} 110 110)"/>`).join('')}
    <circle cx="110" cy="110" r="14" fill="#ffd860" stroke="#8a5a10" stroke-width="3"/></svg>`;
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
        ? `<span class="cs-auto-h">莊家不在！</span><span class="sm-amount">自動獲勝 ${fmtMoney(amount)}</span>`
        : `<span class="cs-auto-h">莊家不在！</span><span>莊家${esc(String(d.away ?? ''))}<br>拉霸決定彩金（最高 ${money(Number(d.cap))}）</span>`;
    };
    const s = openScene(ctx, 'cs-auto sm-scene', portrait => (portrait ? [272, 384] : [505, 199]), sc => {
      const side = !sc.portrait;
      const g1 = sc.box('sm-group', side ? 8 - 97 : -88, side ? 14 - 39 : -30, 0, 0);
      const g2 = sc.box('sm-group', side ? 8 + 249 + 16 - 124 : -88, side ? 8 - 222 : -30, 0, 0);
      sc.art('Data', 517, 5, 220, 140, 'sm-box', g1);
      text = sc.box('sm-text cs-auto-text', 109, 66, 224, 136, '', g1);
      sc.art('Panel', 67, 0, 220, 320, 'sm-body spin', g2);
      const strip = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(x => `<b>${x}</b>`).join('');
      reels = [145, 182, 219, 256].map(x => sc.box('sm-reel fast', x, 320, 36, 36, `<div class="sm-strip">${strip}</div>`, g2));
      sc.art('Panel', 67, 3, 317, 240, 'sm-lever', g2);
      sc.box('cs-auto-zero', 296, 320, 30, 36, '0', g2);
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
  audio.sfx(Sfx.rent);
  await ctx.flash(`${name(ctx, fx.p ?? 0)}進入${String(d.name ?? '')}${String(d.hall ?? '賭場')}\n\n門票 ${fmtMoney(Number(d.fee))}\n（付給莊家${name(ctx, fx.target ?? 0)}）`, (ctx.game.players[fx.p ?? 0]?.human ? 1100 : 750) * Math.max(0.5, ctx.scale()));
};
