/**
 * The three mini games on the original 640×480 screen (docs/rules/13-mini-games.md, rich4_small_games.asm):
 * 企鵝挖寶 (t = 6), 射氣球 (t = 7) and 喜從天降 (t = 8). The rules of each are mini-logic.ts (the window procedures,
 * tick for tick); this screen loads the art, runs the game's timer, paints a canvas, turns mouse / touch / keys
 * into the original's input and answers the score. Not quittable, as in the original: a game lasts 15-18 s,
 * then the big score shows for 2 s (the penguin's ends early on a click).
 */
import type { Ask } from '../../core/types';
import { askScreens, type ScreenContext } from './registry';
import { phrases } from '../text';
import { el, esc, openScene, type Scene } from './place-scene';
import { audio, Theme } from '../audio';
import { loadClip } from '../effects';
import { Balloons, bigScore, Gifts, libcRand, Penguin, type Sound, type Sprite } from './mini-logic';
import './mini-games.css';
import { sceneWeather } from '../weather-fx';

type MiniAsk = Extract<Ask, { t: 'mini-game' }>;
type Arc = 'Panel' | 'Data';
interface Pic { img: CanvasImageSource; w: number; h: number; ax: number; ay: number }

/**
 * Per game: its theme (fcn_004549cf 0xc / 0xb / 0xa = MIDI13 / 12 / 11), its slot table's sounds (freed at the end),
 * the background, the cursor (Data#0 frames, fcn_004021f8: 0x2a the penguin's target, 9..11 the turning crosshair;
 * the gifts keep the arrow) and the art to load.
 */
interface GameInfo {
  title: string; theme: number; sounds: number[]; bg: number; cursor: number[]; hint: string; values: string;
  /** Panel resources [id, first frame, last frame]. */
  art: [number, number, number][];
}
const GAMES: Record<6 | 7 | 8, GameInfo> = {
  6: {
    title: '企鵝挖寶', theme: Theme.penguin, sounds: [11, 12, 13, 14, 15, 16, 17, 18], bg: 80, cursor: [42],
    hint: '寶物只露出一下，快記住位置！點冰面讓企鵝走過去挖，挖到炸彈就結束。',
    values: '鑽石 20 · 紅寶石 12 · 藍寶石 8 · 金幣 5',
    art: [[80, 0, 9], [82, 0, 31], [83, 0, 31], [84, 0, 7], [85, 0, 5], [86, 0, 5], [87, 0, 5], [88, 0, 5], [89, 0, 5], [90, 0, 5]],
  },
  7: {
    title: '射氣球', theme: Theme.balloons, sounds: [19, 20, 21], bg: 91, cursor: [9, 10, 11],
    hint: '點氣球把它射破！小氣球分數高，×2、÷2 和「？」各有效果。',
    values: '氣球 1～9 分 · 最高 999',
    art: [[91, 0, 13]],
  },
  8: {
    title: '喜從天降', theme: Theme.gifts, sounds: [22, 23, 24, 15], bg: 92, cursor: [],
    hint: '左右移動接住財神撒下的寶物，別碰到小鬼丟的炸彈！（滑鼠移動、手指拖曳、← → 鍵）',
    values: '寶箱 10 · 錢袋 5 · 元寶 3 · 銅錢 1',
    art: [[92, 0, 0], [93, 0, 18], [94, 0, 11], [95, 0, 7], [96, 0, 7], [97, 0, 7], [98, 0, 7], [99, 0, 7]],
  },
};

const decode = (src: string) => new Promise<HTMLImageElement | null>(resolve => {
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => resolve(im);
  im.onerror = () => resolve(null);
  im.src = src;
});

/** Frames by archive / id / frame: the redrawn one when there is one, else the original (FLC via the bank). */
class Art {
  private pics = new Map<string, Pic>();
  constructor(private readonly ctx: ScreenContext) {}
  get(a: Arc, id: number, f: number): Pic | null { return this.pics.get(`${a}/${id}/${f}`) ?? null; }
  async load(a: Arc, id: number, from: number, to: number) {
    const jobs: Promise<void>[] = [];
    for (let f = from; f <= to; f++) {
      const p = this.ctx.bank.art(a, id, f);
      if (p) jobs.push(decode(p.src).then(img => { if (img) this.pics.set(`${a}/${id}/${f}`, { img, w: p.w, h: p.h, ax: p.ax, ay: p.ay }); }));
    }
    await Promise.all(jobs);
    if (jobs.length) return;
    // An original FLC has no per-frame entry: the explosion through loadClip, others through the bank (key colour out).
    if (a === 'Data' && id === 526) {
      const clip = await loadClip(this.ctx.bank, 526).catch(() => null);
      // A cropped frame keeps its place in the clip's square through the anchor.
      clip?.frames.forEach((img, f) => { const r = clip.rects[f]; this.pics.set(`Data/526/${f}`, { img, w: r?.w ?? clip.w, h: r?.h ?? clip.h, ax: -(r?.x ?? 0), ay: -(r?.y ?? 0) }); });
      return;
    }
    const t0 = performance.now();
    const frames = await new Promise<ReturnType<ScreenContext['bank']['frames']>>(resolve => {
      const poll = () => {
        const fr = this.ctx.bank.frames(a, id);
        if (fr || performance.now() - t0 > 4000) resolve(fr); else setTimeout(poll, 60);
      };
      poll();
    });
    frames?.forEach((fr, f) => this.pics.set(`${a}/${id}/${f}`, { img: fr.img, w: fr.w * fr.scale, h: fr.h * fr.scale, ax: fr.ax * fr.scale, ay: fr.ay * fr.scale }));
  }
}

/** READY GO (Panel #78): 20 frames, 114 ms apart (its FLC header), over the frozen picture (fcn_0045144f flags 1). */
const READY = { id: 78, frames: 20, ms: 114 };
/** The balloons and gifts are drawn in the picture above the digit strip (640×387, ref_00411fdc / ref_00411ff8). */
const SKY_H = 0x183;

function playMini(ctx: ScreenContext, a: MiniAsk): Promise<number> {
  const g = ctx.game, me = g.players[a.p];
  const kind = a.game === 7 ? 7 : a.game === 8 ? 8 : 6;
  const info = GAMES[kind];
  const sound: Sound = { play: (id, loop) => audio.sfx(id, !!loop), stop: id => audio.stop(id) };
  const bodyId = 100 + (me?.character ?? 0);
  const penguin = kind === 6 ? new Penguin(libcRand, sound) : null;
  const balloons = kind === 7 ? new Balloons(libcRand, sound) : null;
  const gifts = kind === 8 ? new Gifts(ctx.bank.boxes('Panel', bodyId), bodyId, libcRand, sound) : null;
  const game = (penguin ?? balloons ?? gifts)!;
  const art = new Art(ctx);
  // Debug handle (like window.__rich4): the running game's state.
  (window as unknown as { __rich4Mini: unknown }).__rich4Mini = game;
  audio.theme(info.theme);

  return new Promise(resolve => {
    let cv: HTMLCanvasElement | null = null;
    let hintBox: HTMLElement | null = null;
    let loadingBox: HTMLElement | null = null;
    let R = 2;
    let loaded = false, finished = false;
    let timer = 0, ticks = 0;
    /** The READY GO frame on show, −1 none. */
    let ready = -1;
    /** The mouse over the canvas (for the drawn cursor); touches draw none. */
    let mouse: { x: number; y: number } | null = null;

    const draw = (c: CanvasRenderingContext2D, s: Sprite) => {
      const p = art.get(s.archive ?? 'Panel', s.id, s.frame);
      if (!p) return;
      const k = s.scale ?? 1; // the anchor stays unscaled (fcn_004568c2)
      c.drawImage(p.img, s.x - p.ax, s.y - p.ay, p.w * k, p.h * k);
    };
    const sky = (c: CanvasRenderingContext2D, list: Sprite[]) => {
      c.save();
      c.beginPath(); c.rect(0, 0, 640, SKY_H); c.clip();
      for (const s of list) draw(c, s);
      c.restore();
    };

    const render = () => {
      if (!cv || !loaded) return;
      const c = cv.getContext('2d')!;
      c.setTransform(R, 0, 0, R, 0, 0);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      draw(c, { id: info.bg, frame: 0, x: 0, y: 0 });
      const phase = game.phase, playing = phase === 'play' || phase === 'result';
      if (penguin) {
        for (const s of penguin.paint()) draw(c, s);
        if (!playing) for (const s of penguin.treasure()) draw(c, s);
        if (penguin.scoreShown) for (const s of bigScore(penguin.score)) draw(c, s); // painted into the background
        if (playing) for (const s of penguin.sprites) draw(c, s);
      } else if (balloons) {
        sky(c, balloons.sprites);
      } else if (gifts) {
        const [items, people] = [gifts.sprites.filter(s => s.id >= 95 && s.id <= 99), gifts.sprites.filter(s => s.id < 95 || s.id > 99)];
        sky(c, items);
        for (const s of people) draw(c, s);
        if (gifts.boom) draw(c, { archive: 'Data', id: 526, frame: Math.min(7, gifts.boom.frame), x: gifts.boom.x, y: gifts.boom.y });
      }
      for (const s of game.hud()) draw(c, s);
      if (phase === 'result' || phase === 'done') {
        for (const s of bigScore(game.score)) draw(c, s);
        c.save();
        c.font = '700 22px Huninn, "PingFang TC", sans-serif';
        c.textAlign = 'center';
        c.lineJoin = 'round';
        c.lineWidth = 5;
        c.strokeStyle = 'rgba(30, 10, 50, .85)';
        c.fillStyle = '#fff6c8';
        const text = `得點券 ${game.score} 點`;
        c.strokeText(text, 320, 222);
        c.fillText(text, 320, 222);
        c.restore();
      }
      if (ready >= 0) draw(c, { id: READY.id, frame: ready, x: 0, y: 0 });
      // The game's own cursor once it runs (fcn_004021f8 after READY GO), drawn like the original's software cursor.
      const cur = info.cursor;
      const own = phase === 'play' && cur.length > 0 && !!mouse;
      cv.classList.toggle('own-cursor', own);
      if (own && mouse) draw(c, { archive: 'Data', id: 0, frame: cur[ticks % cur.length], x: mouse.x, y: mouse.y });
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
      for (const id of info.sounds) audio.stop(id); // fcn_00454240 frees the slot table
      audio.restore();
      scene.close();
      resolve(game.score);
    };

    const playReady = async () => {
      for (let f = 0; f < READY.frames && !finished; f++) {
        ready = f;
        render();
        await new Promise(r => setTimeout(r, READY.ms));
      }
      ready = -1;
      hintBox?.classList.add('out');
      game.start();
      render();
    };

    const step = () => {
      if (finished) return;
      const before = game.phase;
      game.tick();
      ticks += 1;
      if (before === 'intro' && game.phase === 'ready') void playReady();
      if (game.phase === 'done') { finish(); return; }
      render();
    };

    const toGame = (e: PointerEvent) => {
      const r = cv!.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * 640) / r.width, y: ((e.clientY - r.top) * 480) / r.height };
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const p = toGame(e);
      if (e.pointerType === 'mouse') { mouse = p; if (e.button !== 0) return; }
      if (penguin) penguin.click(p.x, p.y);
      // Touch: about 16 CSS px of finger tolerance around a balloon's body (the small ones are tiny on a phone).
      if (balloons) balloons.click(p.x, p.y, e.pointerType === 'mouse' ? 0 : (16 * 640) / cv!.getBoundingClientRect().width);
      if (gifts) { gifts.aim(p.x); try { cv!.setPointerCapture(e.pointerId); } catch { /* not capturable */ } }
      render();
    };
    const onMove = (e: PointerEvent) => {
      const p = toGame(e);
      if (e.pointerType === 'mouse') mouse = p;
      if (gifts && (e.pointerType === 'mouse' || e.buttons)) gifts.aim(p.x);
      if (info.cursor.length) render();
    };
    const onLeave = (e: PointerEvent) => { if (e.pointerType === 'mouse') { mouse = null; render(); } };
    /** Keys for the gifts: ← / → (A / D) run to that side while held (like the original's flick of the mouse). */
    const held = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      if (!gifts) return;
      const k = e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' ? 'L' : e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' ? 'R' : '';
      if (!k) return;
      e.preventDefault();
      if (e.type === 'keydown') held.add(k); else held.delete(k);
      gifts.aim(held.has('L') && !held.has('R') ? 0 : held.has('R') && !held.has('L') ? 639 : gifts.px);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);

    const build = (s: Scene) => {
      const k = Math.min(s.root.clientWidth / s.w, s.root.clientHeight / s.h) || 1;
      R = Math.min(3, Math.max(1, Math.ceil(k * (window.devicePixelRatio || 1))));
      cv = el('canvas', 'mn-canvas');
      cv.width = 640 * R; cv.height = 480 * R;
      cv.addEventListener('pointerdown', onDown);
      cv.addEventListener('pointermove', onMove);
      cv.addEventListener('pointerleave', onLeave);
      cv.addEventListener('contextmenu', e => e.preventDefault());
      s.stage.append(cv);
      // The two sky games (射氣球, 喜從天降) are outdoors: a light touch of the day's rain or snow (docs/rules/16).
      if (balloons || gifts) sceneWeather(s.stage, ctx.game);
      const text = `<b>${esc(info.title)}</b><span>${phrases(info.hint)}</span><em>${phrases(info.values)}</em>`;
      // Portrait: a panel under the screen. Landscape: a banner over the top strip (no cell or item there) until
      // the game starts.
      if (s.portrait) s.box('mn-panel', 0, 480, 640, s.h - 480, text);
      else hintBox = s.box(`mn-hint${game.phase === 'intro' || game.phase === 'ready' ? '' : ' out'}`, 40, 4, 560, 56, text);
      loadingBox = loaded ? null : s.box('mn-loading', 0, 0, 640, 480, '載入中…');
      render();
    };
    const scene = openScene(ctx, `mn-scene mn-${kind}`, p => (p ? [640, 620] : [640, 480]), build);

    // Load everything first; the timer starts with the first picture (the original's WM_PAINT ends its 99 wait).
    const jobs: Promise<void>[] = [
      art.load('Panel', 79, 0, 19), art.load('Panel', READY.id, 0, READY.frames - 1),
      ...info.cursor.map(f => art.load('Data', 0, f, f)),
      ...info.art.map(([id, from, to]) => art.load('Panel', id, from, to)),
    ];
    if (gifts) jobs.push(art.load('Panel', bodyId, 0, Math.max(0, ctx.bank.boxes('Panel', bodyId).length - 1)), art.load('Data', 526, 0, 7));
    void Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 12000))]).then(() => {
      if (finished) return;
      loaded = true;
      loadingBox?.remove();
      loadingBox = null;
      render();
      timer = window.setInterval(step, game.tickMs);
    });
  });
}

askScreens['mini-game'] = (ctx, a) => playMini(ctx, a as MiniAsk);
