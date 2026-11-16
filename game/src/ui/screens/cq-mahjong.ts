/**
 * 重慶's 麻將館 聽牌 puzzle (docs/rules/33 §6.1, core/chongqing.ts mahjong): the 13 tiles of a hand one tile from
 * winning across the top, 8 candidate tiles below, 5 seconds. Level 1–2: one tap on a winning tile answers; from
 * level 3 every winning tile is to be picked, then 確定 (or the time runs out with what is picked). The question is
 * { t: 'cq-mahjong', level, name, hand, choices, many, seconds }; the answer the picked candidates' indices. The tiles
 * are the HD set (tools/still-redraw/mahjong-tiles/tiles.py) at maps/remake/mahjong/<id>.webp.
 */
import { askScreens, fxScreens } from './registry';
import { fitOverlay } from './bank';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import './cq-mahjong.css';

interface MjAsk { t: 'cq-mahjong'; p: number; level: number; name: string; hand: string[]; choices: string[]; many: boolean; seconds: number }

const tile = (id: string) => `${ASSETS}/maps/remake/mahjong/${id}.webp`;

askScreens['cq-mahjong'] = (ctx, ask) => new Promise(resolve => {
  const a = ask as unknown as MjAsk;
  const ov = fitOverlay(ctx.area, 'cqm-ov', tall => (tall ? [420, 600] : [720, 400]), undefined, 10);
  const { scene } = ov;
  scene.classList.add('cqm-scene');
  scene.innerHTML = `<div class="cqm-card">
      <div class="cqm-title">${a.name}麻將館・${a.level}級</div>
      <div class="cqm-hint">${a.many ? '聽哪幾張？全部選出來，再按確定' : '再摸哪一張能胡？'}</div>
      <div class="cqm-hand">${a.hand.map(t => `<img src="${tile(t)}" alt="" draggable="false">`).join('')}</div>
      <div class="cqm-choices">${a.choices.map((t, i) => `<button class="cqm-pick" data-i="${i}"><img src="${tile(t)}" alt="" draggable="false"><i>✓</i></button>`).join('')}</div>
      <div class="cqm-foot"><div class="cqm-time"><b></b></div>${a.many ? '<button class="cqm-ok">確定</button>' : ''}</div>
    </div>`;
  const picked = new Set<number>();
  let done = false;
  const bar = scene.querySelector<HTMLElement>('.cqm-time b')!;
  const t0 = performance.now(), ms = a.seconds * 1000;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    scene.querySelector('.cqm-card')!.classList.add('done');
    setTimeout(() => { ov.close(); resolve([...picked].sort((x, y) => x - y)); }, 250);
  };
  let raf = 0;
  const tick = () => {
    const k = Math.max(0, 1 - (performance.now() - t0) / ms);
    bar.style.width = `${k * 100}%`;
    bar.classList.toggle('low', k < 0.35);
    if (k <= 0) { finish(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  scene.querySelectorAll<HTMLButtonElement>('.cqm-pick').forEach(b => {
    b.onclick = () => {
      if (done) return;
      const i = Number(b.dataset.i);
      audio.ui('click');
      if (!a.many) { picked.add(i); b.classList.add('on'); finish(); return; }
      if (picked.has(i)) picked.delete(i); else picked.add(i);
      b.classList.toggle('on', picked.has(i));
    };
  });
  const ok = scene.querySelector<HTMLButtonElement>('.cqm-ok');
  if (ok) ok.onclick = () => { audio.ui('click'); finish(); };
});

/** The answer: the winning tiles shown (right / partly / wrong), briefly. */
fxScreens['cq-mahjong-result'] = (ctx, fx) => new Promise(resolve => {
  const d = (fx.data ?? {}) as { result?: string; waits?: string[] };
  const ov = fitOverlay(ctx.area, 'cqm-ov', tall => (tall ? [380, 300] : [560, 260]), undefined, 10);
  const { scene } = ov;
  scene.classList.add('cqm-scene');
  const head = d.result === 'right' ? '答對了！' : d.result === 'part' ? '只對一部分' : '答錯了！';
  scene.innerHTML = `<div class="cqm-card cqm-res ${d.result ?? ''}"><div class="cqm-title">${head}</div>
    <div class="cqm-hint">聽：</div><div class="cqm-hand">${(d.waits ?? []).map(t => `<img src="${tile(t)}" alt="">`).join('')}</div></div>`;
  setTimeout(() => { ov.close(); resolve(); }, Math.max(900, 1800 * ctx.scale()));
});
