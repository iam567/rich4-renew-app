/**
 * 景品兌換所 (docs/rules/21 §7.4): after a human's session the balls / medals left go to the prize counter
 * (maps/remake/kabukicho/machines/counter.webp, the clerk and the shelves behind a big pale board). The board lists the
 * prizes — the four exclusive tools (§7.5) and the original tools 1–8 — at their value in 點券 (25 balls or 5 medals
 * each), with − / + steppers kept within the value left, the shop's supply (tools 1–8, 05 §2.1) and the 9 a player may
 * hold. What is not taken is paid in cash (value × 200 元 × the price index, news #21 ×1.5) or, with 「存玉／存幣」,
 * kept at the shop for the next visit; the odd balls (端玉) are candy. The question is { t: 'kb-exchange', kind, left,
 * per, value, cashRate, options } (core/kabukicho.ts exchange()); the answer { tools: ids (repeated), store }.
 * One page like the casino: portrait 500×960 / landscape 1120×540 (two rows of six, for a phone held sideways) scaled to
 * fit, never scrolled.
 */
import type { MachineKind } from '../../core/modules/kb-machines';
import { toolIcon } from '../../core/modules/tools';
import { askScreens, type ScreenContext } from './registry';
import { esc, openScene, type Scene } from './place-scene';
import { fmt, MACH } from './kb-machine';
import { ASSETS } from '../assets';
import { audio, Sfx } from '../audio';
import './kb-exchange.css';

interface Prize { id: number; name: string; price: number; text: string; have: number; stock: number }
interface ExchangeAsk { t: 'kb-exchange'; p: number; kind: MachineKind; left: number; per: number; value: number; cashRate: number; options: Prize[] }
const MAX_HELD = 9;

/** A tool's icon: the original's Panel#11 frames, the remake's tools as maps/remake/tools/0<600 + id>.webp. */
export function toolIconSrc(ctx: ScreenContext, id: number): string {
  const ic = toolIcon(id);
  return ctx.bank.art(ic.archive, ic.id, ic.frame)?.src ?? (ic.archive === 'Data' ? `${ASSETS}/maps/remake/tools/0${ic.id}.webp` : '');
}

class Counter {
  scene!: Scene;
  count: Record<number, number> = {};
  store = false;
  info = '';
  resolve!: (v: { tools: number[]; store: boolean }) => void;
  readonly unit: string;

  constructor(readonly ctx: ScreenContext, readonly a: ExchangeAsk) {
    this.unit = a.kind === 'pachinko' ? '顆' : '枚';
    for (const o of a.options) this.count[o.id] = 0;
  }

  get spent() { return this.a.options.reduce((s, o) => s + o.price * this.count[o.id], 0); }
  get rest() { return this.a.value - this.spent; }
  /** How many more of a prize can be taken. */
  room(o: Prize) {
    const n = this.count[o.id];
    return n < MAX_HELD - o.have && (o.id > 8 || n < o.stock) && o.price <= this.rest;
  }

  run(): Promise<{ tools: number[]; store: boolean }> {
    return new Promise(resolve => {
      this.resolve = resolve;
      this.scene = openScene(this.ctx, 'kbx-scene', portrait => (portrait ? [500, 960] : [1120, 540]), s => { this.scene = s; this.build(); });
      audio.ui('click');
    });
  }

  build() {
    const s = this.scene, a = this.a;
    const root = s.box(`kbx-root ${s.portrait ? 'por' : 'land'}`, 0, 0, s.w, s.h, `<div class="kbx-bg" style="background-image:url('${MACH('counter')}')"></div>
      <div class="kbx-board">
        <div class="kbx-head"><b class="kbx-title">景品兌換所</b><span class="kbx-have"><img src="${MACH(a.kind === 'pachinko' ? 'sym-ball' : 'sym-medal')}" alt="">${fmt(a.left)}${this.unit} = <b>${a.value}</b> 點券價值</span></div>
        <div class="kbx-info"></div>
        <div class="kbx-grid">${a.options.map(o => `<div class="kbx-cell" data-id="${o.id}">
          <div class="kbx-top"><span class="kbx-icon"><img src="${toolIconSrc(this.ctx, o.id)}" alt="" draggable="false"><b class="kbx-n"></b></span>
            <div class="kbx-name"><b>${esc(o.name)}</b><span class="kbx-price">${o.price} 點券</span><span class="kbx-lim"></span></div></div>
          <div class="kbx-step"><button class="candy kbx-minus" aria-label="少一個">−</button><button class="candy kbx-plus" aria-label="多一個">＋</button></div>
        </div>`).join('')}</div>
        <div class="kbx-foot"><div class="kbx-rest"></div>
          <button class="candy kbx-store" aria-pressed="false">${a.kind === 'pachinko' ? '存玉' : '存幣'}<small></small></button>
          <button class="candy yes kbx-ok">兌換</button></div>
      </div>`);
    root.querySelectorAll<HTMLElement>('.kbx-cell').forEach(c => {
      const o = a.options.find(x => x.id === Number(c.dataset.id))!;
      const tell = () => { this.info = `${o.name}：${o.text || '道具店的道具'}`; this.update(); };
      c.onpointerenter = e => { if (e.pointerType === 'mouse') tell(); };
      c.querySelector<HTMLButtonElement>('.kbx-plus')!.onclick = () => { if (this.room(o)) { this.count[o.id] += 1; audio.ui('click'); } else audio.ui('error'); tell(); };
      c.querySelector<HTMLButtonElement>('.kbx-minus')!.onclick = () => { if (this.count[o.id] > 0) { this.count[o.id] -= 1; audio.ui('click'); } tell(); };
    });
    root.querySelector<HTMLButtonElement>('.kbx-store')!.onclick = () => { this.store = !this.store; audio.ui('click'); this.update(); };
    root.querySelector<HTMLButtonElement>('.kbx-ok')!.onclick = () => this.done();
    this.update();
  }

  update() {
    const root = this.scene.stage, a = this.a, rest = this.rest, odd = a.left % a.per;
    for (const c of root.querySelectorAll<HTMLElement>('.kbx-cell')) {
      const o = a.options.find(x => x.id === Number(c.dataset.id))!, n = this.count[o.id];
      c.querySelector('.kbx-n')!.textContent = n ? `×${n}` : '';
      c.querySelector<HTMLButtonElement>('.kbx-minus')!.disabled = n === 0;
      c.querySelector<HTMLButtonElement>('.kbx-plus')!.disabled = !this.room(o);
      c.querySelector('.kbx-lim')!.textContent = `持有 ${o.have}${o.id <= 8 ? `・庫存 ${o.stock}` : ''}`;
      c.classList.toggle('picked', n > 0);
      c.classList.toggle('dim', n === 0 && !this.room(o));
    }
    root.querySelector('.kbx-info')!.textContent = this.info || `剩下的換成現金：每 1 點券價值 ${fmt(a.cashRate)} 元`;
    const restLine = this.store
      ? `存在店裡 <b>${fmt(rest * a.per + odd)}</b>${this.unit}<small>下次來接著玩</small>`
      : `剩 <b>${rest}</b> 點券價值 → 現金 <b>${fmt(Math.round(rest * a.cashRate))}</b> 元${odd ? `<small>零頭 ${odd}${this.unit} 換糖果</small>` : ''}`;
    root.querySelector('.kbx-rest')!.innerHTML = restLine;
    const st = root.querySelector<HTMLButtonElement>('.kbx-store')!;
    st.classList.toggle('on', this.store);
    st.setAttribute('aria-pressed', String(this.store));
    st.querySelector('small')!.textContent = this.store ? 'ON' : 'OFF';
  }

  done() {
    const tools = this.a.options.flatMap(o => Array.from({ length: this.count[o.id] }, () => o.id));
    audio.sfx(tools.length ? Sfx.points : Sfx.couponFlip);
    this.scene.close();
    this.resolve({ tools, store: this.store });
  }
}

askScreens['kb-exchange'] = (ctx, ask) => new Counter(ctx, ask as unknown as ExchangeAsk).run();
