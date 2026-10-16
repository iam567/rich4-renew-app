/**
 * The auction room (docs/rules/02 §10, rich4_ui_auction.asm): Panel #26 — the room, the auctioneer (#26.25,
 * gavel #26.21) and his assistant (#26.17), the lot's picture, the asking price, and the bidders on the right,
 * one per slot at feet line y = 80 + 120·s (Panel #27+3c standing / bidding, #28+3c out, #29+3c winning).
 * The room opens with the 'auction' announcement, follows 'auction-bid' / 'auction-pass' / 'auction-quit', asks a
 * human through the bid buttons (`choose:auction`, same values as the plain dialog: a step, 0 PASS, -1 放棄)
 * and closes with 'auction-end'. It sits in the map area under the message layer, so the game's own lines
 * (底價…請意者出價, …得標) show over it.
 */
import type { Ask, GameEvent } from '../../core/types';
import { AUCTION_STEPS } from '../../core/modules/places';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { charName, el, esc, money, openScene, type Scene } from './place-scene';
import { audio, Sfx, Theme } from '../audio';
import './auction.css';

type Choose = Extract<Ask, { t: 'choose' }>;
type Fx = Extract<GameEvent, { t: 'fx' }>;

/** Why a seat cannot bid (02 §10.3 flags 1-7). */
const STATUS = ['', '住宿中', '消失中', '坐牢中', '住院中', '冬眠中', '夢遊中', '賣方'];
/** Button centres (`ref_00475b84`): PASS, +100 … +10000, 放棄 at x 405. */
const BUTTON_Y = [133, 181, 229, 277, 325, 373, 421];

interface Seat { p: number; slot: number; flag: number; out: boolean; bid: number; said?: string }

class Room {
  scene: Scene;
  /** Same object as `scene`, set as soon as the first build runs (inside openScene). */
  private s!: Scene;
  seats: Seat[] = [];
  price: number;
  high = -1;
  turn = -1;
  private sprites = new Map<number, HTMLImageElement | null>();
  private bubbles = new Map<number, HTMLElement>();
  private say!: (t: string) => void;
  private priceEl!: HTMLElement;
  private buttons!: HTMLElement;
  private answer: ((v: number) => void) | null = null;
  private ask: Choose | null = null;
  private line = '';
  private auctioneer: HTMLImageElement | null = null;
  /** The last line voiced (the room is rebuilt on rotation without speaking again). */
  private spoken = '';
  /** Seat spacing: the original's 120 px for up to four bidders, closer for more (大富豪模式). */
  private step = 120;

  constructor(readonly ctx: ScreenContext, readonly ref: number, readonly start: number, readonly seller: number) {
    const g = ctx.game;
    this.price = start;
    // Seats as the rules set them (presentation copy of places.ts auction(): later marks win).
    let slot = 0;
    for (const p of g.players) {
      if (!p.whoPlays || !g.here(p)) continue; // 大富豪模式: only who is in this city bids (docs/rules/17 §9)
      let flag = 0;
      if (p.cash <= start) flag = 8;
      if (p.hotel) flag = 1;
      if (p.vanish) flag = 2;
      if (p.prison) flag = 3;
      if (p.hospital) flag = 4;
      if (p.sleep) flag = 5;
      if (p.sleepwalk) flag = 6;
      if (p.id === seller) flag = 7;
      this.seats.push({ p: p.id, slot: slot++, flag, out: flag >= 1 && flag <= 8, bid: 0 });
    }
    this.line = '公開拍賣土地一處。';
    // The auction room plays MIDI06 (rich4_ui_auction.asm:3139) and gives the background track back after.
    audio.theme(Theme.auction);
    this.scene = openScene(ctx, 'au-scene', p => (p ? [640, 800] : [640, 480]), s => this.build(s), { parent: ctx.area });
  }

  get lot() {
    const g = this.ctx.game;
    return this.ref > 4000 ? g.board.facilities[this.ref - 4001] : g.board.lands[this.ref - 2001];
  }

  /** The lot's picture in Panel #26 (rich4_ui_auction.asm:2496-2676, map theme 0). */
  private picture(): number {
    const g = this.ctx.game, owner = this.lot.owner;
    const ch = owner ? g.players[owner - 1]?.character ?? -1 : -1;
    if (this.ref > 4000) {
      const f = g.board.facilities[this.ref - 4001];
      if (f.level === 0) return ch >= 0 ? 0x68 + ch : 0x67;
      return f.type === 0 ? 0x33 : 0x33 + 5 * (f.type - 1) + f.level;
    }
    const l = g.board.lands[this.ref - 2001];
    if (l.chain) return 0x32;
    if (l.level === 0) return ch >= 0 ? 0x5b + ch : 0x5a;
    return 0x1d + l.level;
  }

  private build(s: Scene) {
    this.s = s;
    const P = s.portrait, ctx = this.ctx, g = ctx.game;
    this.sprites.clear(); this.bubbles.clear();
    this.step = this.seats.length > 4 ? Math.floor(((P ? 800 : 480) - 100) / this.seats.length) : 120;
    s.stage.classList.toggle('au-many', this.seats.length > 4);
    s.art('Panel', 26, 0, 0, 0, 'au-bg');
    // Auctioneer (#26.25 at (123,24)) and the assistant in front of him (#26.17 at (67,63)).
    this.auctioneer = s.art('Panel', 26, 25, 123, 24, 'au-man');
    s.art('Panel', 26, 17, 67, 63, 'au-girl pl-bob');
    // Speech box #26.2 (the original's centred on (410,60)): moved left beside the auctioneer's face and made
    // shorter, so it never covers a bidder's starburst, the top bidder's figures or the buttons under it.
    const box = s.box('au-say', 200, 4, 248, 86);
    const pic = ctx.bank.art('Panel', 26, 2);
    if (pic) box.style.backgroundImage = `url('${pic.src}')`;
    const text = el('div', 'au-say-text');
    box.append(text);
    this.say = t => { if (t && t !== this.spoken) { this.spoken = t; void audio.say(t); } this.line = t; text.textContent = t; box.hidden = !t; box.classList.remove('pl-pop'); void box.offsetWidth; box.classList.add('pl-pop'); };
    // A compact card hugging the lot: its name just above the picture, 標價 and the price just under it.
    const lotImg = s.art('Panel', 26, this.picture(), 232, 186, 'au-lot');
    const pt = lotImg ? parseFloat(lotImg.style.top) : 160, pb = lotImg ? pt + parseFloat(lotImg.style.height) : 212;
    const card = s.box('au-lot-card', 180, pt - 30, 104, pb - pt + 58);
    card.style.zIndex = '0';
    s.box('au-lot-name', 180, pt - 26, 104, 20, esc(this.lot.name));
    s.box('au-tag', 186, pb + 4, 30, 20, '標價');
    this.priceEl = s.box('au-price', 212, pb + 2, 68, 24, `${money(this.price)}元`);
    // Bidders.
    for (const seat of this.seats) {
      const q = g.players[seat.p], y = 80 + this.step * seat.slot;
      const mark = s.art('Panel', 26, 78 + q.character, 590, y, 'au-mark');
      if (mark) mark.dataset.p = String(seat.p);
      const out = seat.flag >= 1 && seat.flag <= 8 && seat.flag !== 7;
      this.sprites.set(seat.p, s.art('Panel', out ? 28 + 3 * q.character : 27 + 3 * q.character, 0, 590, y, 'au-bidder'));
      const info = s.box('au-info', 520, y + 2, 116, 20, seat.flag >= 1 && seat.flag <= 7
        ? `<span class="au-status">${STATUS[seat.flag]}</span>` : `${money(q.cash)}元`);
      info.title = charName(ctx, seat.p);
      // The bid beside the figure's feet (the original's under the cash, y + 24, fell off the room for the last seat).
      const bid = s.box(`au-bid${q.human ? ' me' : ''}`, 446, y - 1, 120, 24, '');
      bid.dataset.p = String(seat.p);
    }
    this.showBids();
    // Starbursts of the bids so far stay through a rotation.
    for (const seat of this.seats) if (seat.said) this.bubble(seat, seat.said);
    // Buttons: PASS, +100 … +10000, 放棄 at (405, y) in the room; in portrait a big row under it.
    this.buttons = P ? s.box('au-buttons big', 0, 480, 640, 320) : s.box('au-buttons', 357, 110, 96, 336);
    this.renderButtons();
    this.mark();
    if (this.line) this.say(this.line);
  }

  private renderButtons() {
    const b = this.buttons, a = this.ask, P = this.s.portrait;
    b.replaceChildren();
    if (P) {
      const me = this.seats.find(x => x.p === (a?.p ?? -1)) ?? this.seats.find(x => this.ctx.game.players[x.p]?.human);
      const mine = me?.bid ? `　我的出價 <b class="me">${money(me.bid)}</b>` : '';
      b.insertAdjacentHTML('beforeend', `<div class="au-hint">${a ? `輪到${esc(charName(this.ctx, a.p))}出價　目前 <b>${money(this.price)}</b> 元${mine}` : `等待其他人出價…${mine}`}</div>`);
    }
    const row = el('div', 'au-row');
    b.append(row);
    const values = [0, ...AUCTION_STEPS, -1];
    values.forEach((v, i) => {
      const o = a?.options.find(x => x.value === v);
      const label = v === 0 ? 'PASS' : v < 0 ? '放棄' : `+${money(v)}`;
      const btn = el('button', `candy ${v === 0 ? 'ghost' : v < 0 ? 'no' : 'yes'} au-btn`, label);
      btn.disabled = !a || !o || !!o.disabled;
      if (!P) btn.style.top = `${BUTTON_Y[i] - 110 - 19}px`;
      btn.onclick = () => this.pick(v);
      row.append(btn);
    });
  }

  private mark() {
    for (const m of this.s.stage.querySelectorAll<HTMLElement>('.au-mark')) m.classList.toggle('on', Number(m.dataset.p) === this.turn);
  }

  private pick(v: number) {
    if (!this.answer) return;
    audio.ui(v < 0 ? 'no' : 'click');
    const done = this.answer;
    this.answer = null; this.ask = null;
    // 請出價 is answered: the box goes so the room shows every bid.
    this.say('');
    this.renderButtons();
    done(v);
  }

  /** A human's turn: enable the buttons the rules allow. */
  bid(a: Choose): Promise<number> {
    this.ask = a;
    this.turn = a.p;
    const m = /目前出價(\d+)元/.exec(a.text ?? '');
    if (m) this.setPrice(Number(m[1]));
    this.mark();
    this.renderButtons();
    this.say(`${charName(this.ctx, a.p)}，\n請出價！`);
    return new Promise(resolve => { this.answer = resolve; });
  }

  /**
   * Bidder's starburst #26.1 (the original's 142×113 at (480 − 74, y − 74)): a little smaller, between the buttons
   * and the figure and kept inside the room, so the top seat's is not cut off or under the speech box.
   */
  private bubble(seat: Seat, text: string, pop = false) {
    const s = this.s, y = 80 + this.step * seat.slot;
    this.bubbles.get(seat.p)?.remove();
    const bub = s.box(`au-bubble${pop ? ' pl-pop' : ''}`, 458, Math.max(0, y - 84), 118, 80, esc(text));
    const art = this.ctx.bank.art('Panel', 26, 1);
    if (art) bub.style.backgroundImage = `url('${art.src}')`;
    this.bubbles.set(seat.p, bub);
  }

  /** Everyone's last bid under their figure, the leading one marked (a raise no longer wipes the others'). */
  private showBids() {
    for (const b of this.s.stage.querySelectorAll<HTMLElement>('.au-bid')) {
      const seat = this.seats.find(x => String(x.p) === b.dataset.p);
      b.innerHTML = seat?.bid ? `<span>${money(seat.bid)}元</span>` : '';
      b.classList.toggle('top', !!seat?.bid && seat.p === this.high);
    }
  }

  setPrice(n: number) { this.price = n; this.priceEl.textContent = `${money(n)}元`; this.priceEl.classList.remove('pl-pop'); void this.priceEl.offsetWidth; this.priceEl.classList.add('pl-pop'); }

  /** Bidder's starburst with "%d元" / ＰＡＳＳ / 放棄, and the bidding animation (#27+3c frames 1..4). */
  async act(p: number, kind: 'bid' | 'pass' | 'quit', price = 0) {
    const s = this.s, seat = this.seats.find(x => x.p === p);
    if (!seat || s.closed) return;
    const q = this.ctx.game.players[p];
    this.turn = p; this.mark();
    seat.said = kind === 'bid' ? `${money(price)}元` : kind === 'pass' ? 'ＰＡＳＳ' : '放棄';
    this.bubble(seat, seat.said, true);
    const img = this.sprites.get(p) ?? null;
    if (kind === 'bid') {
      audio.sfx(Sfx.auctionBid); // a raise (AUCTION table 0x475bba: Effect#63)
      this.high = p; seat.bid = price;
      // A raise clears everyone's PASS (02 §10.4).
      for (const [k, b] of this.bubbles) if (k !== p && b.textContent === 'ＰＡＳＳ') { b.remove(); this.bubbles.delete(k); const o = this.seats.find(x => x.p === k); if (o) o.said = undefined; }
      this.showBids();
      this.setPrice(price);
      if (this.buttons && this.s.portrait) this.renderButtons();
      for (let f = 1; f <= 4 && !s.closed; f++) { s.swap(img, 'Panel', 27 + 3 * q.character, f); await s.sleep(70); }
      s.swap(img, 'Panel', 27 + 3 * q.character, 0);
    } else if (kind === 'quit') {
      seat.out = true;
      s.swap(img, 'Panel', 28 + 3 * q.character, 0);
    }
    await s.wait(kind === 'bid' ? 450 : 600);
  }

  /** 成交: the gavel (#26.21 at (124,27)), the winner celebrating (#29+3c), then the room closes. */
  async end(buyer: number, price: number) {
    const s = this.s;
    this.ask = null; this.renderButtons();
    if (buyer >= 0) {
      const seat = this.seats.find(x => x.p === buyer), q = this.ctx.game.players[buyer];
      if (this.auctioneer) { this.auctioneer.dataset.x = '124'; this.auctioneer.dataset.y = '27'; s.swap(this.auctioneer, 'Panel', 26, 21); }
      audio.sfx(Sfx.auctionHammer); // the gavel #26.21 comes down with Effect#29 (ui_auction.asm:1777)
      this.say(`${money(price)}元成交！`);
      void audio.voice(135); // '%d元成交'
      s.box('au-sold pl-pop', 170, 296, 124, 46, '成交');
      const img = seat ? this.sprites.get(buyer) ?? null : null;
      for (let k = 0; k < 10 && !s.closed; k++) { s.swap(img, 'Panel', 29 + 3 * q.character, k % 5); await s.sleep(90); }
      await s.wait(700);
      if (this.auctioneer) { this.auctioneer.dataset.x = '123'; this.auctioneer.dataset.y = '24'; s.swap(this.auctioneer, 'Panel', 26, 25); }
      this.say(`恭喜${charName(this.ctx, buyer)}\n購得此地！`); // voiced by its text (#0136-#0147 by character)
      await s.wait(1300);
    } else {
      this.say('無人出價，\n宣佈流標。');
      s.box('au-sold none pl-pop', 170, 296, 124, 46, '流標');
      await s.wait(1300);
    }
    s.close();
    audio.restore();
  }
}

let room: Room | null = null;

/** The room for the auction in progress (opened late if its announcement was missed). */
function ensure(ctx: ScreenContext, a?: Choose): Room {
  if (room && !room.scene.closed) return room;
  const name = a?.title.replace(/^拍賣\s*/, '') ?? '';
  const g = ctx.game;
  const land = g.board.lands.find(l => l.name === name), fac = g.board.facilities.find(f => f.name === name);
  const ref = land ? land.id + 2000 : fac ? fac.id + 4000 : 2001;
  const price = Number(/目前出價(\d+)元/.exec(a?.text ?? '')?.[1] ?? 0);
  room = new Room(ctx, ref, price || g.places.reservePrice(ref), -1);
  return room;
}

fxScreens.auction = async (ctx, fx: Fx) => {
  if (room && !room.scene.closed) { room.scene.close(); audio.restore(); }
  room = new Room(ctx, Number(fx.data?.ref), Number(fx.data?.start), fx.p ?? -1);
  await room.scene.wait(700);
};
fxScreens['auction-bid'] = (ctx, fx) => ensure(ctx).act(fx.p ?? -1, 'bid', Number(fx.data?.price));
fxScreens['auction-pass'] = (ctx, fx) => ensure(ctx).act(fx.p ?? -1, 'pass');
fxScreens['auction-quit'] = (ctx, fx) => ensure(ctx).act(fx.p ?? -1, 'quit');
fxScreens['auction-end'] = async (_ctx, fx) => {
  if (!room || room.scene.closed) return;
  const r = room;
  room = null;
  await r.end(Number(fx.data?.buyer ?? -1), Number(fx.data?.price ?? 0));
};
askScreens['choose:auction'] = (ctx, a) => ensure(ctx, a as Choose).bid(a as Choose);
