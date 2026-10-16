/**
 * The lottery (docs/rules/06 §8, 09 §7.8): the ticket bar with the cheetah girl and the 36-number board
 * (Panel #12), and the day-15 draw on the lottery stage (Panel #15-17; the HD stage is redrawn without the
 * 「大富翁樂透開獎」 title).
 */
import type { Ask, GameEvent } from '../../core/types';
import { askScreens, fxScreens, type ScreenContext } from './registry';
import { day, month } from '../../core/date';
import { charColor, charName, el, esc, face, frameSrcs, money, openScene, preload, type Scene } from './place-scene';
import { audio, Sfx, Theme } from '../audio';
import './lottery.css';

type LotteryAsk = Extract<Ask, { t: 'lottery' }>;

/** Ticket cell n (1..36) in the original's 9×4 board: (31 + 64c, 272 + 48r), 62×46 (09 §7.8). */
const cellOf = (n: number) => ({ x: 31 + 64 * ((n - 1) % 9), y: 272 + 48 * Math.floor((n - 1) / 9), w: 62, h: 46 });
/** Portrait: the same numbers on a 6×6 board under the bar scene. */
const cellOfPortrait = (n: number) => ({ x: 17 + 68 * ((n - 1) % 6), y: 286 + 60 * Math.floor((n - 1) / 6), w: 66, h: 58 });

/** The prize bar (Panel #14 flashing lights at (8,8), #12.9 blue bar at (28,27), gold digits right-aligned to x 184). */
function prizeBar(s: Scene, x: number, y: number, pool: number, label = '累積獎金') {
  const lights = s.art('Panel', 14, 0, x, y, 'lt-lights');
  let f = 0;
  if (lights) s.every(160, () => s.swap(lights, 'Panel', 14, (f = (f + 1) % 5)));
  s.art('Panel', 12, 9, x + 20, y + 19);
  // The original writes the pool in its gold digit font (Panel #13); real text reads better at every size.
  const digits = s.box('lt-pool', x + 20, y + 19, 168, 28, `$${money(pool)}`);
  digits.title = `${label} ${money(pool)} 元`;
  s.box('lt-pool-label', x + 20, y + 62, 172, 18, label);
}

/** The cheetah girl (Panel #12.1 at (210,-5); 12.2 waving at (154,-8)) and her speech bubble (12.8). */
class Girl {
  img: HTMLImageElement | null;
  bubble: HTMLElement;
  text: HTMLElement;
  private eyes: HTMLImageElement | null = null;
  private mouth: HTMLImageElement | null = null;
  private talking = 0;
  constructor(readonly s: Scene, readonly dx: number, readonly dy: number, bubble: { x: number; y: number; k: number; flip: boolean }) {
    this.img = s.art('Panel', 12, 1, 210 + dx, -5 + dy, 'lt-girl pl-bob');
    // The redrawn girl does not line up with the original eye/mouth patches; they are only used on the original art.
    if (this.img && !s.ctx.bank.art('Panel', 12, 1)?.hd) {
      this.eyes = s.art('Panel', 12, 3, 273 + dx, 63 + dy, 'lt-patch');
      this.mouth = s.art('Panel', 12, 5, 273 + dx, 105 + dy, 'lt-patch');
      let blink = 0;
      s.every(100, () => {
        if (blink) { blink -= 1; s.swap(this.eyes, 'Panel', 12, blink === 1 ? 4 : 3); }
        else if (Math.random() < 1 / 32) { blink = 3; s.swap(this.eyes, 'Panel', 12, 4); }
        if (this.talking > 0) { this.talking -= 1; s.swap(this.mouth, 'Panel', 12, this.talking % 2 ? 6 : 5); }
      });
    }
    this.bubble = s.box(`lt-bubble${bubble.flip ? ' flip' : ''}`, bubble.x, bubble.y, 237 * bubble.k, 192 * bubble.k);
    const pic = s.ctx.bank.art('Panel', 12, 8);
    // Absolute URL: a url() inside a custom property resolves against the stylesheet.
    if (pic) this.bubble.style.setProperty('--bub', `url('${new URL(pic.src, location.href).href}')`);
    this.text = el('div', 'lt-bubble-text');
    this.bubble.append(this.text);
  }
  say(text: string) {
    void audio.say(text); // her lines are voiced (#0011-#0016)
    this.text.textContent = text;
    this.bubble.classList.remove('pl-pop');
    void this.bubble.offsetWidth;
    this.bubble.classList.add('pl-pop');
    this.talking = 10;
  }
  wave() {
    if (!this.img) return;
    this.img.dataset.x = String(154 + this.dx); this.img.dataset.y = String(-8 + this.dy);
    this.s.swap(this.img, 'Panel', 12, 2);
    this.eyes?.remove(); this.mouth?.remove();
  }
}

function ticketScreen(ctx: ScreenContext, a: LotteryAsk): Promise<number> {
  const g = ctx.game, me = g.players[a.p];
  const taken = new Set(a.taken);
  let pick = 0;
  // The ticket bar plays MIDI07 (rich4_ui_letou.asm:2938).
  audio.theme(Theme.lottery);
  return new Promise(resolve => {
    let girl: Girl;
    let buyBtn: HTMLButtonElement;
    let busy = false;
    const cells = new Map<number, HTMLElement>();
    const ring: { img: HTMLImageElement | null } = { img: null };
    const scene = openScene(ctx, 'lt-scene', p => (p ? [440, 762] : [640, 480]), s => {
      const P = s.portrait;
      // Bar scene: the redrawn Panel #12.0; its board is replaced by the real 36-number board below.
      const top = P ? s.box('lt-crop', 0, 0, 440, 262) : s.stage;
      s.art('Panel', 12, 0, P ? -150 : 0, 0, 'lt-bg', top);
      if (P) s.box('lt-crop-fade', 0, 212, 440, 50, '', top);
      prizeBar(s, 8, 8, a.pool);
      girl = P ? new Girl(s, -10, 0, { x: 4, y: 96, k: 0.82, flip: true }) : new Girl(s, 0, 0, { x: 360, y: 20, k: 1, flip: false });
      // The board.
      const board = P ? s.box('lt-board', 8, 272, 424, 376) : s.box('lt-board', 22, 262, 596, 212);
      const at = P ? cellOfPortrait : cellOf;
      const ox = P ? 8 : 22, oy = P ? 272 : 262;
      cells.clear();
      for (let n = 1; n <= 36; n++) {
        const c = at(n), owner = g.places.lottery[n - 1] - 1;
        const sold = taken.has(n);
        const cell = s.box(`lt-cell${sold ? ' sold' : ''}${n === pick ? ' on' : ''}`, c.x - ox, c.y - oy, c.w, c.h,
          `<b>${String(n).padStart(2, '0')}</b>`, board);
        cell.dataset.n = String(n);
        if (sold && owner >= 0) {
          cell.insertAdjacentHTML('beforeend', `<span class="lt-owner" style="--c:${charColor(ctx, owner)}">${face(ctx, g.players[owner].character)}</span>`);
          cell.title = `${charName(ctx, owner)}買了 ${n} 號`;
          if (owner === a.p) s.art('Panel', 12, 7, c.x - ox + c.w / 2, c.y - oy + c.h / 2, 'lt-ring mine', board);
        }
        cells.set(n, cell);
      }
      board.onclick = e => {
        const c = (e.target as HTMLElement).closest<HTMLElement>('.lt-cell');
        if (!c || busy) return;
        const n = Number(c.dataset.n);
        if (taken.has(n)) { girl.say(`${String(n).padStart(2, '0')} 號已經賣出了，\n換一個號碼吧！`); return; }
        select(n);
      };
      // Price, cash and the two buttons.
      const info = P ? s.box('lt-info', 12, 660, 416, 34) : s.box('lt-info', 12, 96, 196, 62);
      info.innerHTML = `<span>每張 <b>${money(a.price)}</b> 元</span><span>${face(ctx, me.character, 'lt-me')}現金 <b>${money(me.cash)}</b> 元</span>`;
      buyBtn = el('button', 'candy yes lt-buy');
      buyBtn.disabled = !pick;
      buyBtn.innerHTML = pick ? `買 ${String(pick).padStart(2, '0')} 號` : '請選號碼';
      const leave = el('button', 'candy ghost lt-leave', '下次再來吧');
      Object.assign(buyBtn.style, P ? { left: '232px', top: '706px', width: '196px' } : { left: '14px', top: '168px', width: '192px' });
      Object.assign(leave.style, P ? { left: '12px', top: '706px', width: '196px' } : { left: '14px', top: '214px', width: '192px' });
      s.stage.append(buyBtn, leave);
      buyBtn.onclick = () => { if (pick && !busy) buy(); };
      leave.onclick = () => { if (!busy) bye(); };
      if (pick) {
        const c = at(pick);
        ring.img = s.art('Panel', 12, 7, c.x - ox + c.w / 2, c.y - oy + c.h / 2, 'lt-ring pl-pop', board);
        girl.say(`${String(pick).padStart(2, '0')} 號，\n要買這張嗎？`);
      } else girl.say('哈囉！\n一券在手，\n希望無窮！');
    });
    const select = (n: number) => {
      const s = scene;
      cells.get(pick)?.classList.remove('on');
      pick = n;
      const cell = cells.get(n)!;
      cell.classList.add('on');
      ring.img?.remove();
      const board = cell.parentElement!;
      ring.img = s.art('Panel', 12, 7, cell.offsetLeft + cell.offsetWidth / 2, cell.offsetTop + cell.offsetHeight / 2, 'lt-ring pl-pop', board);
      buyBtn.disabled = false;
      buyBtn.textContent = `買 ${String(n).padStart(2, '0')} 號`;
      girl.say(`${String(n).padStart(2, '0')} 號，\n要買這張嗎？`);
    };
    const finish = async (value: number, line: string, ms: number) => {
      busy = true;
      // Paying for a ticket rings Effect#31; leaving cancels (#4) (fcn_0042f7fc).
      audio.sfx(value > 0 ? Sfx.lotteryBuy : 4);
      if (value > 0) { girl.wave(); ring.img?.classList.add('lt-ring-buy'); }
      girl.say(line);
      await scene.wait(ms);
      scene.close();
      audio.restore();
      resolve(value);
    };
    const buy = () => finish(pick, '拜拜！\n祝您中獎！', 1500);
    const bye = () => finish(-1, '下次再來吧！', 900);
  });
}

askScreens.lottery = (ctx, a) => ticketScreen(ctx, a as LotteryAsk);

// ---------------------------------------------------------------- the draw (day 15)

type Fx = Extract<GameEvent, { t: 'fx' }>;

/** The presenter's lines (ui_letou.asm, voice #0017-#0036). */
const DRAW_LINES = {
  hello: '嗨！\n又到了每月\n十五號樂透\n開獎時間∼',
  now: '現在馬上為您\n開出這一期的\n號碼……',
  who: '本月份的得主\n是……',
  sorry: 'SORRY！\n本月份沒有人\n得獎∼',
  carry: '獎金將累積\n到下個月……',
};

/**
 * The draw stage `_rich4_ui_letou_kaijiang_entry` (09 §7.8): Panel #15.0 stage, the board girl (#15.3 at (7,66),
 * the pool written on her board) and the presenter (#15.1 at (472,66)); the ball machine FLC #16 at (183,75);
 * the two number balls #15.(37 + digit) at (286,405) / (358,405) in the pedestal window and the big digits
 * Data #517.(8 + digit) on the globe; a winner gets the confetti ball FLC #17 at (205,0), the explosion #15.24
 * at (320,200) with the name in red, the girl jumping (#15.6) and the presenter clapping (#15.5); no winner
 * turns the speech box into the burst #15.23 and the presenter cries (#15.4 at (489,116)).
 * The four player boxes (16,340) / (16,410) / (328,340) / (328,410) list everyone's tickets.
 */
async function drawScreen(ctx: ScreenContext, fx: Fx): Promise<void> {
  const g = ctx.game;
  const d = fx.data ?? {};
  const number = Number(d.number), winner = Number(d.winner ?? -1), prize = Number(d.prize ?? 0);
  const pool = Number(d.pool ?? g.lotteryPool);
  const tickets = Array.isArray(d.tickets) ? (d.tickets as number[]) : [...g.places.lottery];
  const two = String(number).padStart(2, '0');
  // The animations are a few megabytes in HD: load them while the presenter talks.
  const loading = preload([...frameSrcs(ctx, 'Panel', 16, 0, 41), ...(winner >= 0 ? frameSrcs(ctx, 'Panel', 17, 0, 36) : [])], 4000);
  await preload([ctx.bank.art('Panel', 15, 0)?.src, ctx.bank.art('Panel', 15, 1)?.src, ctx.bank.art('Panel', 15, 3)?.src], 800);
  let state: 'hello' | 'spin' | 'balls' | 'result' = 'hello';
  // The draw plays MIDI09 (rich4_ui_letou.asm:3063); the machine and the result have their sounds (table
  // 0x47567b: Effect#57, #58); the presenter's lines are voiced (#0017-#0035).
  audio.theme(Theme.draw);
  return new Promise<void>(resolve => {
    let token = 0;
    openScene(ctx, 'ld-scene', p => (p ? [440, 690] : [640, 480]), async s => {
      const run = ++token;
      const P = s.portrait;
      const alive = () => run === token && !s.closed;
      // Portrait: the stage scaled into the top, the player boxes as a list under it.
      const view = P ? s.box('ld-view', 0, 0, 640, 480) : s.stage;
      if (P) view.style.transform = `scale(${440 / 640})`;
      s.art('Panel', 15, 0, 0, 0, 'ld-bg', view);
      const machine = s.art('Panel', 16, 0, 183, 75, 'ld-machine', view);
      let girl = s.art('Panel', 15, 3, 7, 66, 'ld-girl', view);
      let host = s.art('Panel', 15, 1, 472, 66, 'ld-host pl-bob', view);
      // `累積獎金` 20 px 0x4f35b1 at (77,193) and the pool in red at (77,228), on the girl's board.
      const poolBox = s.box('ld-pool', 23, 176, 116, 70, `<span>累積獎金</span><b>$${money(pool)}</b>`, view);
      // It is the monthly draw: say so, with the date, on the pedestal above the result window.
      s.box('ld-date pl-pop', 226, 342, 188, 24, `${month(g.date)}月${day(g.date)}日・每月15日開獎`, view);
      // Speech box #15.22 at (300,47), text centred at (383,117).
      const bubble = s.box('ld-bubble', 300, 47, 187, 140, '', view);
      const bub = ctx.bank.art('Panel', 15, 22);
      if (bub) bubble.style.backgroundImage = `url('${bub.src}')`;
      const say = (t: string) => { if (t) void audio.say(t); bubble.textContent = t; bubble.hidden = !t; bubble.classList.remove('pl-pop'); void bubble.offsetWidth; bubble.classList.add('pl-pop'); };
      // Player boxes: head #15.(25 + character) and the numbers each one holds (plain text balls: the original's digit font reads 3 as 8).
      const list = P ? s.box('ld-list', 10, 340, 420, 340) : view;
      // With more than four players (大富豪模式, docs/rules/17 §12) only the ticket holders get a box, in a tighter grid.
      const many = g.players.length > 4;
      const shown = g.players.map((q, i) => ({ q, i, mine: tickets.map((b, k) => (b === i + 1 ? k + 1 : 0)).filter(Boolean) }))
        .filter(x => (many ? x.mine.length > 0 : x.q.whoPlays || x.mine.length));
      const tight = many && shown.length > 4;
      shown.forEach(({ q, i, mine }, k) => {
        // Narrower than the original's 296 so the pedestal window with the balls stays clear.
        const rowsL = Math.ceil(shown.length / 2), hL = tight ? Math.floor(134 / rowsL) - 4 : 60, hP = many ? Math.min(76, Math.floor(336 / shown.length) - 6) : 76;
        const [bx, by, bw] = P ? [0, k * (hP + 8), 420]
          : tight ? [k % 2 ? 410 : 16, 340 + Math.floor(k / 2) * (hL + 4), 214]
          : [[16, 340, 214], [16, 410, 214], [410, 340, 214], [410, 410, 214]][many ? k : i] ?? [0, 0, 0];
        const box = s.box(`ld-player${i === winner ? ' win' : ''}${tight || (P && many && hP < 60) ? ' tight' : ''}`, bx, by, bw, P ? hP : hL, '', list);
        box.style.setProperty('--c', charColor(ctx, i));
        const head = ctx.bank.art('Panel', 15, 25 + q.character);
        box.innerHTML = `<span class="ld-head">${head ? `<img src="${head.src}" alt="">` : face(ctx, q.character)}</span>
          ${P ? `<span class="ld-name">${esc(charName(ctx, i))}</span>` : ''}
          <span class="ld-nums${mine.length > 6 && !P ? ' two' : ''}">${mine.length
            ? mine.map(n => `<i class="ld-num" data-n="${n}">${String(n).padStart(2, '0')}</i>`).join('')
            : '<em>沒有買</em>'}</span>`;
        box.title = charName(ctx, i);
      });
      const showBalls = () => {
        s.art('Panel', 15, 37 + Number(two[0]), 286, 405, 'ld-ball', view);
        s.art('Panel', 15, 37 + Number(two[1]), 358, 405, 'ld-ball b2', view);
        s.art('Data', 517, 8 + Number(two[0]), 300, 220, 'ld-glass', view);
        s.art('Data', 517, 8 + Number(two[1]), 340, 220, 'ld-glass b2', view);
        for (const i of s.stage.querySelectorAll<HTMLElement>(`[data-n="${number}"]`)) i.classList.add('hit');
      };
      const winScene = () => {
        girl?.remove(); host?.remove();
        girl = s.art('Panel', 15, 6, 0, 0, 'ld-girl pl-pop', view);
        host = s.art('Panel', 15, 5, 505, 66, 'ld-host pl-bob', view);
        // The pool goes up with the raised board: (91,19) / (91,56).
        Object.assign(poolBox.style, { left: '33px', top: '3px' });
        // The explosion (#15.24) with the winner's name: the original centres it on the globe at (320,200);
        // here it sits at the top of the stage (the redrawn one has no title), smaller, so the machine and the
        // drawn balls stay in view.
        say('');
        audio.sfx(Sfx.drawEnd);
        void audio.voice(20 + g.players[winner].character); // the winner's name (#0020-#0031)
        const card = result(24, 0.74, 0);
        card.innerHTML = `<span class="ld-wface">${face(ctx, g.players[winner].character)}</span><b>${esc(charName(ctx, winner))}</b><span class="ld-sub">獨得 ${money(prize)} 元</span>`;
      };
      /** Result burst at the top of the stage (#15.24 explosion / #15.23 yellow burst), returned for its text. */
      const result = (frame: number, k: number, dy: number): HTMLElement => {
        const a = ctx.bank.art('Panel', 15, frame);
        const w = (a?.w ?? 233) * k, h = (a?.h ?? 192) * k;
        stage.querySelector('.ld-result')?.remove();
        const card = s.box(`ld-result f${frame} pl-pop`, 320 - w / 2, 4 + dy, w, h, '', view);
        if (a) card.style.backgroundImage = `url('${a.src}')`;
        return card;
      };
      const stage = s.stage;
      const missScene = () => {
        host?.remove();
        host = s.art('Panel', 15, 4, 489, 116, 'ld-host pl-pop', view);
        // The speech box becomes the burst #15.23 (the original's at (320,200) on the globe; here at the top).
        say('');
        audio.sfx(Sfx.drawEnd);
        missCard = result(23, 0.86, 2);
      };
      let missCard: HTMLElement | null = null;
      const sayMiss = (t: string) => { void audio.say(t); if (missCard) missCard.textContent = t; };
      // Re-entering after a rotation jumps to where the show was.
      if (state === 'balls' || state === 'result') showBalls();
      if (state === 'result') { if (winner >= 0) winScene(); else { missScene(); sayMiss(DRAW_LINES.carry); } }
      if (state === 'hello') {
        say(DRAW_LINES.hello);
        await s.wait(1400);
        if (!alive()) return;
        say(DRAW_LINES.now);
        await s.wait(1200);
        if (!alive()) return;
        state = 'spin';
      }
      if (state === 'spin') {
        // The presenter points at the machine (#15.2 at (418,66)) and it spins: 42 frames, one per 50 ms tick.
        say('');
        host?.remove();
        host = s.art('Panel', 15, 2, 418, 66, 'ld-host', view);
        await loading;
        if (!alive()) return;
        audio.sfx(Sfx.drawStart);
        for (let f = 1; f < 42 && alive(); f++) { s.swap(machine, 'Panel', 16, f); await s.sleep(50); }
        if (!alive()) return;
        s.swap(machine, 'Panel', 16, 0);
        host?.remove();
        host = s.art('Panel', 15, 1, 472, 66, 'ld-host pl-bob', view);
        state = 'balls';
        showBalls();
        await s.wait(900);
        if (!alive()) return;
      }
      if (state === 'balls') {
        if (winner >= 0) {
          say(DRAW_LINES.who);
          await s.wait(1400);
          if (!alive()) return;
          state = 'result';
          say('');
          winScene();
          await s.wait(900);
          if (!alive()) return;
          const confetti = s.art('Panel', 17, 0, 205, 0, 'ld-confetti', view);
          for (let f = 1; f < 37 && confetti && alive(); f++) { s.swap(confetti, 'Panel', 17, f); await s.sleep(50); }
          if (!alive()) return;
          const sub = stage.querySelector('.ld-sub');
          if (sub) sub.textContent = `恭喜獨得 ${money(prize)} 元！`;
          void audio.voice(32); // 恭喜您獨得所有獎金！
          await s.wait(1800);
        } else {
          await s.sleep(500);
          if (!alive()) return;
          state = 'result';
          missScene();
          sayMiss(DRAW_LINES.sorry);
          await s.wait(1600);
          if (!alive()) return;
          sayMiss(DRAW_LINES.carry);
          await s.wait(1600);
        }
      } else await s.wait(1800);
      if (!alive()) return;
      s.close();
      audio.restore();
      resolve();
    });
  });
}

fxScreens['lottery-draw'] = drawScreen;

// ---------------------------------------------------------------- a ticket bought

/**
 * Anyone buying a ticket (the computer players buy without a screen, 06 §8): a small ticket slides in over the
 * map with the buyer, the number stamped with the red circle (#12.7) and the draw day.
 */
fxScreens['lottery-ticket'] = (ctx, fx) => new Promise<void>(resolve => {
  const g = ctx.game, p = fx.p ?? 0, n = Number(fx.data?.number ?? 0);
  const two = String(n).padStart(2, '0');
  const ring = ctx.bank.art('Panel', 12, 7);
  const box = el('div', 'lt-ticket-fx');
  box.innerHTML = `<div class="lt-ticket" style="--c:${charColor(ctx, p)}">
      <div class="lt-t-head"><span>大富翁樂透</span><em>每張 1,000 元</em></div>
      <div class="lt-t-body"><span class="lt-t-face">${face(ctx, g.players[p]?.character ?? 0)}</span>
        <span class="lt-t-num"><b>${two}</b>${ring ? `<img src="${ring.src}" alt="">` : ''}</span></div>
      <div class="lt-t-foot">${esc(charName(ctx, p))}買了 ${two} 號樂透彩券<br><small>每月15日開獎</small></div></div>`;
  ctx.area.append(box);
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    box.classList.add('out');
    setTimeout(() => { box.remove(); resolve(); }, 180);
  };
  box.addEventListener('pointerup', end);
  setTimeout(end, 1500 * ctx.scale());
});
