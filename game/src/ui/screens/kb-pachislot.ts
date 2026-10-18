/**
 * 拉霸 (パチスロ, docs/rules/21 §7.3), the human's session: the machine (maps/remake/kabukicho/machines/slot.webp) with
 * three empty reel windows where the reels are drawn here from the symbol art (sym-*.webp). 「開始」 (or the lever)
 * bets 3 medals and draws the game's role at once — `Pachislot.start()` on the visit's own stream; the stops only line
 * it up. The three stop buttons (under the reels, or the machine's own) stop the reels in any order; a reel slides up to
 * 4 symbols to show the drawn small role on the line (4 コマ滑り) and never shows a role that was not drawn.
 * BIG / REG light the 「GOGO」 lamp: the player stops each reel with its 7 (red for BIG, blue for REG) within ±4
 * symbols of the line (a light 目押し); a miss keeps the bonus for the next game (`settle(role, false)`, 持ち越し) and
 * turns on the 目押し補助 arrows that light when a press would line the 7 up. A lined-up bonus plays a few seconds of
 * celebration while its medals pour in. A 西瓜 / 櫻桃 lights 「チャンス！」 (the next game wins a bonus 1/3 / 1/2); after a
 * bonus the 「高確率」 lamp counts its 10 games down (a bonus 1 in 4 each). 「買幣」 buys 50 medals for 10 點券; 「收手」
 * ends it any time; it ends by itself after 100 games or with no medals and no buys left.
 */
import { Rng } from '../../core/rng';
import { BUY_POINTS, HIGH_GAMES, MEDALS_PER_BUY, Pachislot, SLOT_BET, SLOT_BIG, SLOT_BIG_BOOST, SLOT_CAP, type Role } from '../../core/modules/kb-machines';
import { banner, countUp, fmt, games, headHtml, MACH, openMachine, preloadArt, statsHtml, wait, type KbMachineAsk, type MachineAnswer } from './kb-machine';
import type { ScreenContext } from './registry';
import type { Scene } from './place-scene';
import { audio, Sfx } from '../audio';

type Sym = 'r7' | 'b7' | 'bell' | 'cherry' | 'melon' | 'replay';
const SYM_ART: Record<Sym, string> = { r7: 'sym-seven-red', b7: 'sym-seven-blue', bell: 'sym-bell', cherry: 'sym-cherry', melon: 'sym-watermelon', replay: 'sym-replay' };
/** One reel's 21 symbols: a replay and a bell within every 5 (so the slide always reaches them), two of each 7. */
const BASE: Sym[] = ['r7', 'replay', 'bell', 'cherry', 'melon', 'replay', 'bell', 'b7', 'replay', 'bell', 'melon', 'cherry', 'replay', 'bell', 'r7', 'melon', 'replay', 'bell', 'b7', 'replay', 'bell'];
const N = BASE.length;
const STRIPS: Sym[][] = [0, 7, 14].map(r => BASE.map((_, i) => BASE[(i + r) % N]));
/** Drawn items of a reel: the strip from index −2, enough for three rows wherever it stands. */
const ITEMS = N + 5;
/** What a small role shows on the line (the cherry: on the left reel only). */
const ROLE_SYM: Partial<Record<Role, Sym>> = { replay: 'replay', bell: 'bell', suika: 'melon', cherry: 'cherry', BIG: 'r7', REG: 'b7' };
const ROLE_NAME: Partial<Record<Role, string>> = { replay: 'Replay', bell: '鈴鐺', cherry: '櫻桃', suika: '西瓜' };
const SLIDE = 4;
const mod = (i: number) => ((i % N) + N) % N;
const isBonus = (r: Role | null) => r === 'BIG' || r === 'REG';

class PachislotPage {
  readonly m: Pachislot;
  scene!: Scene;
  parts!: { head: HTMLElement; mach: HTMLElement; panel: HTMLElement };
  /** The symbol index on the line of each reel (fractional while it turns; the strip runs downwards). */
  pos = [3, 9, 16];
  turning = [false, false, false];
  /** A reel stopping: sliding to its target. */
  target: (number | null)[] = [null, null, null];
  lined = [false, false, false];
  role: Role | null = null;
  /** A bonus is being paid (no new game). */
  busy = false;
  ending = false;
  finished = false;
  /** 目押し補助: on after a missed bonus (§7.3). */
  assist = false;
  /** Medals already in m.medals but still pouring in on screen. */
  hidden = 0;
  msg = 'チャンス：西瓜・櫻桃／BONUS後高確率10回';
  resolve!: (a: MachineAnswer) => void;
  private last = 0;
  private looping = false;

  constructor(readonly ctx: ScreenContext, readonly ask: KbMachineAsk) {
    this.m = new Pachislot(new Rng(ask.seed), ask.maxBuys, ask.boost ? SLOT_BIG_BOOST : SLOT_BIG);
    this.m.buy();
    this.m.medals += ask.stored;
  }

  run(): Promise<MachineAnswer> {
    preloadArt(['slot', 'sym-medal', ...Object.values(SYM_ART)]);
    return new Promise(resolve => {
      this.resolve = resolve;
      this.scene = openMachine(this.ctx, 'pachislot', (s, parts) => { this.scene = s; this.parts = parts; this.build(); });
      audio.ui('click');
    });
  }

  get spinning() { return this.turning.some(Boolean); }
  get gogo() { return isBonus(this.role) && this.m.pending !== null; }

  build() {
    const { head, mach, panel } = this.parts;
    head.innerHTML = headHtml('pachislot', '拉霸');
    const strip = (r: number) => Array.from({ length: ITEMS }, (_, k) => `<img src="${MACH(SYM_ART[STRIPS[r][mod(k - 2)]])}" alt="" draggable="false">`).join('');
    mach.insertAdjacentHTML('beforeend', `<div class="kbs-lamps"></div><div class="kbs-gogo">GOGO!</div><div class="kbs-mode"></div>
      ${[0, 1, 2].map(r => `<div class="kbs-win" data-r="${r}"><div class="kbs-strip" style="height:${(ITEMS / 3) * 100}%">${strip(r)}</div><i class="kbs-aid">▶</i></div>`).join('')}
      <i class="kbs-line"></i>
      ${[0, 1, 2].map(r => `<button class="kbs-hit kbs-stop-art" data-r="${r}" aria-label="停 ${r + 1}"></button>`).join('')}
      <button class="kbs-hit kbs-lever" aria-label="開始"></button>
      <div class="kbs-tray"><img src="${MACH('sym-medal')}" alt=""><b></b></div><div class="kbs-pay"></div>`);
    panel.innerHTML = `<div class="kbm-info"><span class="kbs-lamp">GOGO</span><span class="kbm-msg"></span></div>
      <div class="kbs-stops">${[0, 1, 2].map(r => `<button class="candy kbm-btn kbs-stop" data-r="${r}">停</button>`).join('')}</div>
      <div class="kbm-btns">
        <button class="candy kbm-btn kbs-start">開始<small>押 ${SLOT_BET} 枚</small></button>
        <button class="candy kbm-btn kbm-buy">買幣 +${MEDALS_PER_BUY}<small>${BUY_POINTS} 點券</small></button>
        <button class="candy kbm-btn kbm-stop">收手</button>
      </div>`;
    const root = this.parts.mach.parentElement!;
    root.querySelectorAll<HTMLButtonElement>('.kbs-stop, .kbs-stop-art').forEach(b => { b.onpointerdown = e => { e.preventDefault(); this.stopReel(Number(b.dataset.r)); }; });
    root.querySelectorAll<HTMLButtonElement>('.kbs-start, .kbs-lever').forEach(b => { b.onclick = () => this.start(); });
    panel.querySelector<HTMLButtonElement>('.kbm-buy')!.onclick = () => this.buy();
    panel.querySelector<HTMLButtonElement>('.kbm-stop')!.onclick = () => { audio.ui('no'); this.stop(); };
    if (!this.looping) { this.looping = true; this.last = performance.now(); requestAnimationFrame(t => this.frame(t)); }
    this.update();
    this.draw();
  }

  /** The reels: turning ones run down the strip, a stopping one slides to its target. */
  frame(t: number) {
    if (this.finished) { this.looping = false; return; }
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const speed = this.gogo ? 8 : 12;
    for (let r = 0; r < 3; r++) {
      const tg = this.target[r];
      if (tg !== null) {
        // the shortest way round to the target, quickly (a slide back within ±4 is the 目押し's pull)
        let d = tg - this.pos[r];
        if (d > N / 2) d -= N;
        if (d < -N / 2) d += N;
        const step = Math.sign(d) * Math.min(Math.abs(d), 16 * dt);
        this.pos[r] = mod(this.pos[r] + step);
        if (Math.abs(d) < 0.01) { this.pos[r] = tg; this.target[r] = null; this.turning[r] = false; this.stopped(); }
      } else if (this.turning[r]) this.pos[r] = mod(this.pos[r] - speed * dt);
    }
    this.draw();
    requestAnimationFrame(x => this.frame(x));
  }

  draw() {
    const mach = this.parts?.mach;
    if (!mach) return;
    mach.querySelectorAll<HTMLElement>('.kbs-win').forEach(w => {
      const r = Number(w.dataset.r);
      (w.firstElementChild as HTMLElement).style.transform = `translateY(${(-(this.pos[r] + 1) / ITEMS) * 100}%)`;
      w.classList.toggle('blur', this.turning[r] && this.target[r] === null);
      w.querySelector('.kbs-aid')!.classList.toggle('now', this.assist && this.gogo && this.turning[r] && this.target[r] === null && this.find(r, ROLE_SYM[this.role!]!, true) !== null);
    });
  }

  update() {
    if (this.finished) return;
    const { head, mach, panel } = this.parts, m = this.m;
    const shown = Math.max(0, m.medals - this.hidden);
    head.querySelector('.kbm-stats')!.innerHTML = statsHtml([['代幣', fmt(shown), 'main'], ['點券', `−${m.bought * BUY_POINTS}`], ['遊戲', `${m.games}/${SLOT_CAP}`]]);
    mach.querySelector('.kbs-tray b')!.textContent = fmt(shown);
    mach.classList.toggle('gogo', this.gogo);
    mach.classList.toggle('assist', this.assist && this.gogo);
    panel.querySelector('.kbs-lamp')!.classList.toggle('on', this.gogo);
    // チャンス (the next game may win a bonus) / 高確率 N 回 (the games left), on the machine.
    const mode = mach.querySelector<HTMLElement>('.kbs-mode')!, chance = !!m.chance && !m.pending && !this.spinning, high = m.high > 0 && !this.busy;
    mode.className = `kbs-mode${chance ? ' chance' : high ? ' high' : ''}`;
    mode.textContent = chance ? 'チャンス！' : high ? `高確率 ${m.high} 回` : '';
    panel.querySelector('.kbm-msg')!.textContent = this.msg;
    const idle = !this.spinning && !this.busy && !this.ending;
    panel.querySelector<HTMLButtonElement>('.kbs-start')!.disabled = !idle || m.done || m.medals < SLOT_BET;
    panel.querySelectorAll<HTMLButtonElement>('.kbs-stop').forEach(b => { const r = Number(b.dataset.r); b.disabled = !this.turning[r] || this.target[r] !== null; });
    const buy = panel.querySelector<HTMLButtonElement>('.kbm-buy')!;
    buy.disabled = m.bought >= this.ask.maxBuys || this.ending;
    buy.querySelector('small')!.textContent = m.bought >= this.ask.maxBuys ? '已達上限' : `${BUY_POINTS} 點券・剩 ${this.ask.maxBuys - m.bought} 次`;
  }

  buy() {
    if (this.ending || !this.m.buy()) return;
    audio.sfx(Sfx.points);
    this.msg = `買了 ${MEDALS_PER_BUY} 枚代幣`;
    this.update();
  }

  start() {
    const m = this.m;
    if (this.spinning || this.busy || this.ending) return;
    if (m.done) { this.stop(); return; }
    // Not enough for a bet: the player buys or stops (never a silent buy of 點券).
    if (m.medals < SLOT_BET) { this.msg = '代幣不夠：買幣，或收手'; audio.ui('error'); this.update(); return; }
    const role = m.start();
    if (!role) { this.stop(); return; }
    this.role = role;
    this.turning = [true, true, true];
    this.target = [null, null, null];
    this.lined = [false, false, false];
    this.parts.mach.querySelector('.kbs-pay')!.textContent = '';
    audio.sfx(Sfx.slot);
    this.msg = this.gogo ? (role === 'BIG' ? 'GOGO！對準紅 7 按停' : 'GOGO！對準藍 7 按停') : '按「停」';
    this.update();
  }

  /** The symbol index where reel `r` would stop showing `sym`: forward up to 4 (both ways with `both`), or null. */
  find(r: number, sym: Sym, both = false): number | null {
    const b = Math.floor(this.pos[r]);
    for (let d = 0; d <= SLIDE; d++) {
      if (STRIPS[r][mod(b - d)] === sym) return mod(b - d);
      if (both && d && STRIPS[r][mod(b + d)] === sym) return mod(b + d);
    }
    return null;
  }

  stopReel(r: number) {
    if (!this.turning[r] || this.target[r] !== null || this.role === null) return;
    audio.ui('click');
    const role = this.role, strip = STRIPS[r], b = Math.floor(this.pos[r]);
    const want = role === 'cherry' ? (r === 0 ? 'cherry' : null) : ROLE_SYM[role] ?? null;
    let tg: number | null = null;
    if (isBonus(role)) {
      // the light 目押し: the 7 within ±4 of where the button was pressed
      tg = this.find(r, want!, true);
      this.lined[r] = tg !== null;
    } else if (want) {
      tg = this.find(r, want);
      // a role always shows: past the 4-symbol slide only where the strip has none near (西瓜, 櫻桃)
      for (let d = SLIDE + 1; tg === null && d < N; d++) if (strip[mod(b - d)] === want) tg = mod(b - d);
    }
    if (tg === null) {
      // No role on the line: no left cherry, no missed 7, no third of a pair the other reels show.
      const shown = [0, 1, 2].filter(i => i !== r && !this.turning[i]).map(i => STRIPS[i][this.pos[i]]);
      const bad = new Set<Sym>();
      if (r === 0) bad.add('cherry');
      if (isBonus(role)) { bad.add('r7'); bad.add('b7'); }
      if (shown.length === 2 && shown[0] === shown[1]) bad.add(shown[0]);
      for (let d = 0; d < N && tg === null; d++) if (!bad.has(strip[mod(b - d)])) tg = mod(b - d);
    }
    this.target[r] = tg ?? b;
    this.update();
  }

  /** A reel has stopped; after the third, the game is settled. */
  stopped() {
    this.update();
    if (this.spinning || this.role === null) return;
    void this.settle(this.role);
  }

  async settle(role: Role) {
    const m = this.m, bonus = isBonus(role);
    const lined = !bonus || this.lined.every(Boolean);
    this.busy = true;
    const before = m.medals;
    const pay = m.settle(role, lined);
    this.hidden += m.medals - before;
    this.role = bonus && !lined ? role : null;
    if (bonus && lined) {
      this.assist = false;
      const big = role === 'BIG';
      this.parts.mach.classList.add('kbs-win-bonus');
      audio.sfx(Sfx.fireworks);
      this.msg = big ? 'BIG BONUS！' : 'REG BONUS！';
      this.update();
      const ms = (big ? 2600 : 1600) * (this.ending ? 0.4 : 1);
      void banner(this.parts.mach, `<b>${big ? 'BIG BONUS' : 'REG BONUS'}</b><small>+${pay} 枚</small>`, `kbs-bn ${big ? 'big' : 'reg'}`, ms);
      const start = this.hidden;
      await countUp(ms, t => { this.hidden = start - Math.round(pay * t); this.update(); });
      this.parts.mach.classList.remove('kbs-win-bonus');
      if (m.high === HIGH_GAMES) this.msg = `高確率 ${HIGH_GAMES} 回！每局 1/4 中 BONUS`;
    } else if (bonus) {
      this.assist = true;
      audio.ui('error');
      this.msg = '沒對齊！獎勵保留到下一局（看箭頭亮時按）';
    } else if (pay) {
      audio.sfx(role === 'replay' ? Sfx.couponFlip : Sfx.points);
      this.parts.mach.querySelector('.kbs-pay')!.textContent = `+${pay}`;
      this.msg = role === 'replay' ? 'Replay：免費再一局' : `${ROLE_NAME[role]} +${pay} 枚`;
      if (m.chance) {
        // 西瓜 / 櫻桃: a chance for the next game (1/3, 1/2).
        this.msg = `${ROLE_NAME[role]}！チャンス：下一局${role === 'cherry' ? '1/2' : '1/3'}中BONUS`;
        audio.sfx(Sfx.fireworks);
        void banner(this.parts.mach, '<b>チャンス！</b>', 'kbs-bn chance', 900);
      }
      this.update();
      await wait(m.chance ? 600 : 250);
    } else this.msg = '沒中';
    this.hidden = 0;
    this.busy = false;
    if (m.done) {
      this.msg = m.games >= SLOT_CAP ? `已玩 ${SLOT_CAP} 局，本局結束` : '代幣和點券都用完了';
      this.stop();
    } else if (m.medals < SLOT_BET) this.msg = '代幣不夠：買幣，或收手';
    this.update();
  }

  stop() {
    if (this.ending) return;
    this.ending = true;
    this.update();
    void this.whenIdle().then(() => this.finish());
  }

  /** 收手 during a game: the reels stop by themselves (a bonus flag stays with the machine, as a real one). */
  async whenIdle() {
    for (let r = 0; r < 3; r++) if (this.turning[r] && this.target[r] === null) { this.stopReel(r); await wait(120); }
    while (this.spinning || this.busy) await wait(80);
  }

  async finish() {
    if (this.finished) return;
    const m = this.m;
    this.hidden = 0;
    this.update();
    this.finished = true;
    await banner(this.parts.mach, `<b>收手</b><small>剩 ${fmt(m.medals)} 枚</small>`, 'kbm-end', 1100);
    this.scene.close();
    this.resolve({ buys: m.bought, left: m.medals, a: m.big, b: m.reg, played: m.games });
  }
}

games.pachislot = (ctx, ask) => new PachislotPage(ctx, ask).run();
