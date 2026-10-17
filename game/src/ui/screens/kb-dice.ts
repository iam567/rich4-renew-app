/**
 * 確變骰子's choice (docs/rules/21 §7.5): the n + 1 dice thrown, as big faces in the board dice's art (Panel#3), and
 * the player taps the ones to KEEP (「點你要的骰子」): each tapped die lights up with a check (a tap on a lit one lets it
 * go again), the kept total shows live; when n are lit it confirms by itself — the other die greys out and flies
 * away. Walking (2 dice) is one tap. The question is { t: 'kb-dice-keep', values, keep } (core/kabukicho.ts
 * rollDice); the answer the kept indices. One page, upright or sideways; the dice are the tap targets (≥ 44 px).
 */
import { askScreens } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import './kb-dice.css';

interface KeepAsk { t: 'kb-dice-keep'; p: number; values: number[]; keep: number }

askScreens['kb-dice-keep'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as KeepAsk, vals = a.values, need = a.keep;
  const ov = fitOverlay(ctx.area, 'kbd-ov', tall => (tall ? [420, 520] : [620, 340]), undefined, 12);
  const { scene } = ov;
  scene.classList.add('kbd-scene');
  const face = (v: number) => ctx.bank.art('Panel', 3, v - 1)?.src ?? '';
  scene.innerHTML = `<div class="kbd-card">
      <div class="kbd-title">確變骰子</div>
      <div class="kbd-hint">點你要的骰子（選 ${need} 顆）</div>
      <div class="kbd-dice">${vals.map((v, i) => `<button class="kbd-die" data-i="${i}" aria-label="${v} 點">${face(v) ? `<img src="${face(v)}" alt="" draggable="false">` : `<b>${v}</b>`}<i class="kbd-check">✓</i></button>`).join('')}</div>
      <div class="kbd-sum">走 <em>0</em> 步</div>
    </div>`;
  const picked = new Set<number>();
  let done = false;
  const sum = scene.querySelector<HTMLElement>('.kbd-sum em')!;
  const update = () => {
    sum.textContent = String([...picked].reduce((t, i) => t + vals[i], 0));
    scene.querySelectorAll<HTMLElement>('.kbd-die').forEach(d => d.classList.toggle('on', picked.has(Number(d.dataset.i))));
  };
  scene.querySelectorAll<HTMLButtonElement>('.kbd-die').forEach(d => {
    d.onclick = () => {
      if (done) return;
      const i = Number(d.dataset.i);
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      audio.ui('click');
      update();
      if (picked.size === need) {
        done = true;
        // The die not kept greys out and flies away, then the answer.
        scene.querySelectorAll<HTMLElement>('.kbd-die').forEach(x => { if (!picked.has(Number(x.dataset.i))) x.classList.add('gone'); });
        scene.querySelector('.kbd-card')!.classList.add('done');
        setTimeout(() => { ov.close(); resolve([...picked].sort((x, y) => x - y)); }, Math.max(350, 700 * ctx.scale()));
      }
    };
  });
  update();
});
