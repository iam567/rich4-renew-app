/**
 * 柏青哥 (docs/rules/21 §7.2), the human's session: the portrait machine (maps/remake/kabukicho/machines/pachinko.webp)
 * with its board, the start pocket (ヘソ) and the dark LCD where the three-digit reels are drawn here. The player sets
 * the launch strength on a slider and holds 「發射」 (or switches 自動 on): about 6.7 balls a second go up the rail and
 * down the nails. Each ball is `Pachinko.fire(strength)` on the visit's own stream; the silver balls only show it.
 * A ball into the start pocket spins the reels (リーチ when the rules say so — always before a 大當たり — up to four
 * spins held), a 大當たり plays its chain compressed to a few seconds: one fanfare per hit, +190 balls each, the
 * mode lamp 確變 / 時短 after it (an odd triple foretells 確變, just for the show). 「買珠」 buys 250 more balls for
 * 10 點券 (up to the visit's buys); 「收手」 ends it any time, and it ends by itself at 400 balls or with no balls and
 * no buys left. A hint 「今日推薦力度」 is near the nails' sweet spot (within ±4), never on it.
 */
import { Rng } from '../../core/rng';
import { BALLS_PER_BUY, BUY_POINTS, PACHI, Pachinko } from '../../core/modules/kb-machines';
import { banner, countUp, fmt, games, headHtml, MACH, openMachine, preloadArt, statsHtml, wait, type KbMachineAsk, type MachineAnswer } from './kb-machine';
import type { ScreenContext } from './registry';
import type { Scene } from './place-scene';
import { audio, Sfx } from '../audio';

/** Balls a second (§7.2: 6–7 on screen). */
const FIRE_MS = 150;
/** The LCD, the start pocket, the knob and the board as fractions of the machine art (1024×1536). */
const POCKET = { x: 0.5, y: 0.55 };

type Spin = { hit: false; reach: boolean } | { hit: true; chain: ('kakuhen' | 'jitan' | 'end')[] };

class PachinkoPage {
  readonly m: Pachinko;
  scene!: Scene;
  parts!: { head: HTMLElement; mach: HTMLElement; panel: HTMLElement };
  strength = 50;
  firing = false;
  auto = false;
  /** A 大當たり is being shown: no firing until its chain is over (the rounds are not counted as time, §7.1). */
  paused = false;
  /** 收手 asked or the session over: the held spins finish quickly, then the page closes. */
  ending = false;
  finished = false;
  queue: Spin[] = [];
  spinning = false;
  /** Payouts already in m.balls but still to pour into the tray on screen. */
  hidden = 0;
  digits = [7, 3, 5];
  rolling = [false, false, false];
  mode: 'normal' | 'kakuhen' | 'jitan' = 'normal';
  msg = '調好力度，按住「發射」';
  readonly hint: number;
  resolve!: (a: MachineAnswer) => void;

  constructor(readonly ctx: ScreenContext, readonly ask: KbMachineAsk) {
    this.m = new Pachinko(new Rng(ask.seed), ask.maxBuys, ask.boost ? 1 / 40 : PACHI.hit);
    this.m.buy();
    this.m.balls += ask.stored;
    // Near the sweet spot but never on it (§7.2: guessing it right is the player's part); from the seed, not the stream.
    const off = ((ask.seed >>> 4) % 4) + 1;
    this.hint = Math.max(0, Math.min(100, this.m.sweet + ((ask.seed >>> 2) & 1 ? off : -off)));
  }

  run(): Promise<MachineAnswer> {
    preloadArt(['pachinko', 'sym-ball']);
    return new Promise(resolve => {
      this.resolve = resolve;
      this.scene = openMachine(this.ctx, 'pachinko', (s, parts) => { this.scene = s; this.parts = parts; this.build(); });
      audio.ui('click');
    });
  }

  get shownBalls() { return Math.max(0, this.m.balls - this.hidden); }

  build() {
    const { head, mach, panel } = this.parts;
    head.innerHTML = headHtml('pachinko', '柏青哥');
    mach.insertAdjacentHTML('beforeend', `<div class="kbp-board"></div><i class="kbp-pocket"></i><i class="kbp-attacker"></i>
      <div class="kbp-lcd"><div class="kbp-mode"></div><div class="kbp-reels">${[0, 1, 2].map(i => `<b class="kbp-d" data-i="${i}"></b>`).join('')}</div>
        <div class="kbp-held">${[0, 1, 2, 3].map(() => '<i></i>').join('')}</div><div class="kbp-say"></div></div>
      <div class="kbp-knob"><i></i></div><div class="kbp-tray"><img src="${MACH('sym-ball')}" alt=""><b></b></div>`);
    panel.innerHTML = `<div class="kbm-info"><span class="kbm-msg"></span><span class="kbp-hint">今日推薦力度 約 ${this.hint}</span></div>
      <div class="kbp-power"><span class="kbp-pl">力度 <b></b></span><input class="kbp-range" type="range" min="0" max="100" step="1" value="${this.strength}" aria-label="發射力度"></div>
      <div class="kbm-btns">
        <button class="candy kbm-btn kbp-fire">發射<small>按住</small></button>
        <button class="candy kbm-btn kbp-auto">自動<small></small></button>
        <button class="candy kbm-btn kbm-buy">買珠 +${BALLS_PER_BUY}<small>${BUY_POINTS} 點券</small></button>
        <button class="candy kbm-btn kbm-stop">收手</button>
      </div>`;
    const range = panel.querySelector<HTMLInputElement>('.kbp-range')!;
    range.oninput = () => { this.strength = Number(range.value); this.update(); };
    range.onchange = () => audio.ui('click');
    const fire = panel.querySelector<HTMLButtonElement>('.kbp-fire')!;
    fire.onpointerdown = e => { e.preventDefault(); fire.setPointerCapture?.(e.pointerId); this.firing = true; this.update(); };
    fire.onpointerup = fire.onpointercancel = fire.onlostpointercapture = () => { this.firing = false; this.update(); };
    fire.oncontextmenu = e => e.preventDefault();
    panel.querySelector<HTMLButtonElement>('.kbp-auto')!.onclick = () => { this.auto = !this.auto; audio.ui('click'); this.update(); };
    panel.querySelector<HTMLButtonElement>('.kbm-buy')!.onclick = () => this.buy();
    panel.querySelector<HTMLButtonElement>('.kbm-stop')!.onclick = () => { audio.ui('no'); this.stop(); };
    this.scene.every(FIRE_MS, () => this.tick());
    this.update();
  }

  update() {
    if (this.finished) return;
    const { head, mach, panel } = this.parts, m = this.m;
    head.querySelector('.kbm-stats')!.innerHTML = statsHtml([
      ['鋼珠', fmt(this.shownBalls), 'main'], ['點券', `−${m.bought * BUY_POINTS}`], ['發射', `${m.fired}/${PACHI.cap}`],
    ]);
    mach.querySelectorAll<HTMLElement>('.kbp-d').forEach((d, i) => { d.textContent = String(this.digits[i]); d.classList.toggle('roll', this.rolling[i]); });
    mach.querySelectorAll<HTMLElement>('.kbp-held i').forEach((d, i) => d.classList.toggle('on', i < Math.min(4, this.queue.length)));
    const lamp = mach.querySelector<HTMLElement>('.kbp-mode')!;
    lamp.textContent = this.mode === 'kakuhen' ? '確變中' : this.mode === 'jitan' ? '時短中' : '';
    lamp.className = `kbp-mode ${this.mode}`;
    mach.querySelector<HTMLElement>('.kbp-knob i')!.style.transform = `rotate(${-135 + this.strength * 2.7}deg)`;
    mach.querySelector('.kbp-tray b')!.textContent = fmt(this.shownBalls);
    panel.querySelector('.kbm-msg')!.textContent = this.msg;
    panel.querySelector('.kbp-pl b')!.textContent = String(this.strength);
    const buy = panel.querySelector<HTMLButtonElement>('.kbm-buy')!;
    buy.disabled = m.bought >= this.ask.maxBuys || this.ending;
    buy.querySelector('small')!.textContent = m.bought >= this.ask.maxBuys ? '已達上限' : `${BUY_POINTS} 點券・剩 ${this.ask.maxBuys - m.bought} 次`;
    const auto = panel.querySelector<HTMLButtonElement>('.kbp-auto')!;
    auto.classList.toggle('on', this.auto);
    auto.querySelector('small')!.textContent = this.auto ? 'ON' : 'OFF';
    panel.querySelector('.kbp-fire')!.classList.toggle('on', this.firing || this.auto);
    for (const b of panel.querySelectorAll<HTMLButtonElement>('.kbp-fire, .kbp-auto')) b.disabled = this.ending;
  }

  buy() {
    if (this.ending || !this.m.buy()) return;
    audio.sfx(Sfx.points);
    this.msg = `買了 ${BALLS_PER_BUY} 顆鋼珠`;
    this.update();
  }

  tick() {
    if (this.ending || this.paused || !(this.firing || this.auto)) return;
    const m = this.m;
    if (m.done) { this.stop(); return; }
    // Out of balls: the player buys or stops (never a silent buy of 點券).
    if (m.balls === 0) { this.auto = false; this.firing = false; this.msg = '鋼珠用完了：買珠，或收手'; audio.ui('error'); this.update(); return; }
    const r = m.fire(this.strength);
    if (r.kind === 'none') return;
    this.launch(r.kind !== 'out');
    if (r.kind === 'start') this.queue.push({ hit: false, reach: r.reach });
    if (r.kind === 'hit') { this.hidden += r.chain.length * PACHI.payout; this.queue.push({ hit: true, chain: r.chain }); this.paused = true; }
    if (r.kind !== 'out') void this.pump();
    if (m.done) {
      this.msg = m.fired >= PACHI.cap ? `已發射 ${PACHI.cap} 顆，本局結束` : '鋼珠和點券都用完了';
      this.stop();
    }
    this.update();
  }

  /** One silver ball: up the rail, released by the strength, down the nails into the pocket or out at the bottom. */
  launch(pocket: boolean) {
    const board = this.parts.mach.querySelector<HTMLElement>('.kbp-board');
    if (!board) return;
    const ball = document.createElement('img');
    ball.className = 'kbp-ball';
    ball.src = MACH('sym-ball');
    ball.alt = '';
    board.append(ball);
    const pts: [number, number][] = [[0.11, 0.74], [0.075, 0.5], [0.09, 0.22], [0.2, 0.07]];
    let x = 0.22 + (this.strength / 100) * 0.56, y = 0.08;
    pts.push([x, y]);
    const end = pocket ? POCKET.y : 0.75;
    while (y < end - 0.07) {
      y += 0.06;
      x = Math.max(0.12, Math.min(0.88, x + (Math.random() - 0.5) * 0.1));
      // Round the LCD in the middle (0.30–0.70 × 0.27–0.50).
      if (y > 0.25 && y < 0.52 && x > 0.27 && x < 0.73) x = x < 0.5 ? 0.24 + Math.random() * 0.03 : 0.73 + Math.random() * 0.03;
      pts.push([x, y]);
    }
    pts.push(pocket ? [POCKET.x, POCKET.y] : [x + (Math.random() - 0.5) * 0.08, 0.76]);
    const anim = ball.animate(pts.map(([px, py]) => ({ left: `${px * 100}%`, top: `${py * 100}%` })), { duration: 1500 + Math.random() * 300, easing: 'ease-in' });
    anim.onfinish = () => {
      ball.remove();
      if (pocket) { const p = this.parts.mach.querySelector('.kbp-pocket'); p?.classList.remove('lit'); void (p as HTMLElement | null)?.offsetWidth; p?.classList.add('lit'); }
    };
  }

  /** Plays the held spins one after another. */
  async pump() {
    if (this.spinning) return;
    this.spinning = true;
    while (this.queue.length && !this.finished) {
      const sp = this.queue[0];
      await this.spin(sp);
      this.queue.shift();
      if (sp.hit) { await this.fanfare(sp.chain); this.paused = false; }
      this.update();
    }
    this.spinning = false;
    if (this.ending) this.finish();
  }

  /** One turn of the three reels: left, right, then the middle (slowly on a リーチ). */
  async spin(sp: Spin) {
    const fast = this.ending || this.queue.length > 2;
    const reach = sp.hit || sp.reach;
    const r9 = () => 1 + Math.floor(Math.random() * 9);
    let fin: number[];
    if (sp.hit) { const d = this.triple(sp.chain[0]); fin = [d, d, d]; }
    else if (reach) { const a = r9(); let c = r9(); while (c === a) c = r9(); fin = [a, c, a]; }
    else { const a = r9(); let b = r9(); while (b === a) b = r9(); fin = [a, r9(), b]; }
    this.rolling = [true, true, true];
    const roll = window.setInterval(() => { this.digits = this.digits.map((d, i) => (this.rolling[i] ? r9() : d)); this.update(); }, 70);
    const base = fast ? 260 : 900;
    await wait(base * 0.5);
    this.rolling[0] = false; this.digits[0] = fin[0]; audio.ui('click');
    await wait(base * 0.35);
    this.rolling[2] = false; this.digits[2] = fin[2]; audio.ui('click');
    if (reach) {
      this.say('リーチ！', 'reach');
      await wait(fast ? 350 : 1500);
    } else await wait(base * 0.25);
    this.rolling[1] = false; this.digits[1] = fin[1]; audio.ui('click');
    clearInterval(roll);
    this.say('', '');
    this.update();
    await wait(fast ? 80 : 220);
  }

  /** A 大當たり's triple: odd for one that goes into 確變 (§7.2's preview, only for the show). */
  triple(next: 'kakuhen' | 'jitan' | 'end'): number {
    const odd = [1, 3, 5, 7, 9], even = [2, 4, 6, 8];
    const set = next === 'kakuhen' ? odd : even;
    return set[Math.floor(Math.random() * set.length)];
  }

  /** The chain of one first hit, compressed: each hit's fanfare and +190 balls, then the mode it leaves. */
  async fanfare(chain: ('kakuhen' | 'jitan' | 'end')[]) {
    const k = this.ending ? 0.4 : 1;
    for (let i = 0; i < chain.length && !this.finished; i++) {
      if (i > 0) { const d = this.triple(chain[i]); await this.quickTriple(d, k); }
      audio.sfx(Sfx.fireworks);
      this.parts.mach.classList.add('kbp-win');
      void banner(this.parts.mach, `<b>大當たり！</b>${i ? `<small>${i + 1} 連</small>` : ''}`, 'kbp-bn', 950 * k);
      const start = this.hidden;
      await countUp(900 * k, t => { this.hidden = start - Math.round(PACHI.payout * t); this.update(); });
      this.hidden = start - PACHI.payout;
      const next = chain[i];
      this.mode = next === 'end' ? 'normal' : next;
      this.msg = next === 'kakuhen' ? '確變！下次必定大當たり' : next === 'jitan' ? `時短 ${PACHI.jitan} 回…又中了！` : '大當たり結束';
      this.update();
      await wait(450 * k);
      this.parts.mach.classList.remove('kbp-win');
    }
    this.mode = 'normal';
    this.msg = `大當たり ${chain.length} 次，+${fmt(chain.length * PACHI.payout)} 顆`;
    this.update();
  }

  async quickTriple(d: number, k: number) {
    this.rolling = [true, true, true];
    const roll = window.setInterval(() => { this.digits = this.digits.map(() => 1 + Math.floor(Math.random() * 9)); this.update(); }, 60);
    await wait(420 * k);
    clearInterval(roll);
    this.rolling = [false, false, false];
    this.digits = [d, d, d];
    this.update();
  }

  say(text: string, cls: string) {
    const el = this.parts.mach.querySelector<HTMLElement>('.kbp-say');
    if (el) { el.textContent = text; el.className = `kbp-say ${cls}`; }
  }

  /** 收手 (or the end of the session): the held spins finish quickly, then the result. */
  stop() {
    if (this.ending) return;
    this.ending = true;
    this.firing = false; this.auto = false;
    this.update();
    if (!this.spinning) this.finish();
  }

  async finish() {
    if (this.finished) return;
    const m = this.m;
    this.hidden = 0;
    this.update();
    this.finished = true;
    await banner(this.parts.mach, `<b>收手</b><small>剩 ${fmt(m.balls)} 顆</small>`, 'kbm-end', 1100);
    this.scene.close();
    this.resolve({ buys: m.bought, left: m.balls, a: m.firstHits, b: m.hits, played: m.fired });
  }
}

games.pachinko = (ctx, ask) => new PachinkoPage(ctx, ask).run();
