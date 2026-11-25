/**
 * 清明上河's 黃泥岡 智取生辰綱 (core/qingming.ts gang, docs/rules/35 §黃泥岡): fx 'qm-slot' { value 0..99,999, human }.
 * The gods' slot machine (slot-machine.ts, docs/rules/06 §5.7: the message box over Panel#67's machine, the lever
 * #67.2 / #67.3) with FIVE reels in its window, stopping one by one on the value's digits, then 劫得生辰綱 N 元. The
 * value is the rules' own (fair, drawn before): a human's pull of the lever (a tap or a key) only starts the stop, and
 * the machine pulls by itself after a few seconds; a computer's runs by itself. A tap at the end closes it.
 */
import { fxScreens, onStuck, type ScreenContext } from './registry';
import { esc, frameSrcs, openScene, preload, type Scene } from './place-scene';
import { audio, Sfx } from '../audio';
import { QM_THEME } from '../jq-music';
import { screenMusic } from '../screen-music';
import './slot-machine.css';
import './qm-slot.css';

/** The four-reel machine's window spans x 145..292 at y 320 (slot-machine.ts REEL_X): five narrower reels in it. */
const REEL_X = [145, 175, 205, 235, 265], REEL_W = 27, REEL_H = 36, REEL_Y = 320, LEVER_X = 317;
const BOX = { x: 97, y: 39, w: 249, h: 170 };
const MACHINE = { x: 124, y: 222, w: 224, h: 183 };
const STACK = { w: 272, h: 384, box: [-88, -30], machine: [-88, -30] };
const SIDE = { w: 505, h: 199, box: [8 - BOX.x, 14 - BOX.y], machine: [8 + BOX.w + 16 - MACHINE.x, 8 - MACHINE.y] };

const live = new Set<Scene>();
/** Its own piece while it shows (清明上河's set, jq-music.ts QM_THEME). */
const music = screenMusic();
onStuck(() => { for (const s of [...live]) s.close(); audio.stop(Sfx.slot); music(false, QM_THEME.slot); });

fxScreens['qm-slot'] = async (ctx: ScreenContext, fx) => {
  const d = (fx.data ?? {}) as { value?: number; human?: boolean };
  const value = Math.max(0, Math.min(99999, Math.floor(Number(d.value) || 0))), human = d.human !== false;
  const digits = String(value).padStart(5, '0').split('').map(Number);
  await preload(frameSrcs(ctx, 'Panel', 67, 0, 3), 1500);
  let side = false, lever: HTMLImageElement | null = null, text: HTMLElement | null = null, hint: HTMLElement | null = null;
  let reels: HTMLElement[] = [], cur: Scene | null = null;
  /** What the screen shows now (kept across a rebuild when the screen turns). */
  const st = { pulled: false, stopped: 0, result: false, waiting: false };
  const area = ctx.area;
  const scene = openScene(ctx, 'sm-scene qms-scene', () => {
    const W = area.clientWidth || 440, H = area.clientHeight || 440;
    side = Math.min(W / SIDE.w, H / SIDE.h) > Math.min(W / STACK.w, H / STACK.h) * 1.08;
    return side ? [SIDE.w, SIDE.h] : [STACK.w, STACK.h];
  }, s => {
    cur = s;
    s.root.classList.toggle('side', side);
    const L = side ? SIDE : STACK;
    const boxG = s.box('sm-group', L.box[0], L.box[1], 0, 0), machG = s.box('sm-group', L.machine[0], L.machine[1], 0, 0);
    const box = s.box('msg scene-msg sm-msg', BOX.x + 4, BOX.y + 24, BOX.w - 8, BOX.h - 28,
      `<div class="ribbon">黃泥岡</div><div class="scene-msg-text sm-text"></div><div class="sm-hint"></div>`, boxG);
    text = box.querySelector<HTMLElement>('.sm-text'); hint = box.querySelector<HTMLElement>('.sm-hint');
    s.art('Panel', 67, 0, 220, REEL_Y, 'sm-body spin', machG);
    const strip = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map(n => `<b${n === 7 ? ' class="seven"' : ''}>${n}</b>`).join('');
    reels = REEL_X.map(x => s.box('sm-reel qms-reel', x, REEL_Y, REEL_W, REEL_H, `<div class="sm-strip">${strip}</div>`, machG));
    // the old machine's fourth-reel window spans these five: a dark backing behind the narrower drums
    machG.insertBefore(s.box('qms-window', REEL_X[0] - 1, REEL_Y - 1, REEL_X[4] + REEL_W - REEL_X[0] + 2, REEL_H + 2, '', machG), reels[0]);
    lever = s.art('Panel', 67, st.pulled ? 3 : 2, LEVER_X, 240, 'sm-lever', machG);
    draw();
  }, { parent: area });
  live.add(scene);
  music(true, QM_THEME.slot);

  function draw() {
    if (text) text.innerHTML = st.result
      ? `<span>劫得生辰綱</span><span class="sm-amount">${esc(value.toLocaleString('en-US'))}元</span>`
      : '<span>智取生辰綱</span><span class="qms-sub">楊志押送的十萬貫金珠寶貝</span>';
    if (hint) { hint.classList.toggle('on', st.waiting); hint.textContent = st.waiting ? '點一下畫面，拉下拉桿！' : ''; }
    lever?.classList.toggle('glow', st.waiting);
    cur?.swap(lever, 'Panel', 67, st.pulled && !st.result ? 3 : 2);
    reels.forEach((r, i) => {
      const strip = r.firstElementChild as HTMLElement;
      if (i < st.stopped) { r.classList.remove('spin'); strip.style.transform = `translateY(${-digits[i] * REEL_H}px)`; }
      else { r.classList.add('spin'); strip.style.transform = ''; }
    });
    cur?.root.querySelector('.sm-body')?.classList.toggle('spin', !st.result);
  }

  audio.loop(Sfx.slot);
  draw();
  // the pull: a human's tap / key (or by itself after a while); a computer's after a short spin
  st.waiting = human;
  draw();
  await new Promise<void>(resolve => {
    let done = false;
    const go = () => { if (done) return; done = true; clearTimeout(t); scene.root.removeEventListener('pointerup', go); window.removeEventListener('keyup', go); resolve(); };
    const t = window.setTimeout(go, human ? 6000 : Math.max(700, 1300 * ctx.scale()));
    if (human) setTimeout(() => { if (!done) { scene.root.addEventListener('pointerup', go); window.addEventListener('keyup', go); } }, 250);
  });
  if (scene.closed) { audio.stop(Sfx.slot); live.delete(scene); if (!live.size) music(false, QM_THEME.slot); return; }
  st.waiting = false; st.pulled = true;
  audio.ui('click');
  draw();
  // the reels stop left to right on the value's digits
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, i ? Math.max(220, 380 * ctx.scale()) : 450));
    if (scene.closed) break;
    st.stopped = i + 1;
    draw();
    const r = reels[i];
    r.classList.remove('land'); void r.offsetWidth; r.classList.add('land');
  }
  audio.stop(Sfx.slot);
  if (!scene.closed) {
    st.result = true;
    draw();
    audio.sfx(value >= 50000 ? Sfx.fireworks : Sfx.points);
    if (value >= 50000) scene.root.classList.add('sm-jackpot');
    await new Promise<void>(resolve => {
      let done = false;
      const end = () => { if (done) return; done = true; clearTimeout(t); scene.root.removeEventListener('pointerup', end); resolve(); };
      const t = window.setTimeout(end, Math.max(1600, 2600 * ctx.scale()) + (human ? 800 : 0));
      setTimeout(() => { if (!done) scene.root.addEventListener('pointerup', end); }, 300);
    });
  }
  scene.close();
  live.delete(scene);
  if (!live.size) music(false, QM_THEME.slot);
};

export {};
