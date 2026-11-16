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
import { Balloons, bigScore, cellAt, cellXY, Gifts, libcRand, Penguin, type Phase, type Sound, type Sprite } from './mini-logic';
import './mini-games.css';
import { sceneWeather } from '../weather-fx';
import { uiFont } from '../fonts';

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

/**
 * 小遊戲搗亂 (the user 2026-11-14: 「別的玩家可以看他玩小遊戲，然後進去給他搗亂」): in 派對模式 the phone playing sends
 * what it draws (MiniFrame, about eight a second) and the others watch it in the same screen; a tap there is a 搗亂
 * — 企鵝挖寶 a false treasure (while they are shown) or a red mark on the ice, 射氣球 a tomato over the sky,
 * 喜從天降 a bomb from that spot (a second dazed, not the end). Each one may do it every 2 s. Only the score is the
 * game's answer, so nothing here touches the game every phone plays.
 */
export interface MiniFrame {
  k: 6 | 7 | 8;
  /** The player's character (喜從天降's catcher art). */
  c: number;
  /** The sprites: archive (0 Panel, 1 Data), id, frame, x, y, scale × 100 — six numbers each. */
  s: number[];
  /** Phase: 0 intro, 1 ready, 2 play, 3 result, 4 done. */
  ph: number;
  sc: number;
  /** Tomatoes and marks: kind (1 tomato, 2 mark), x, y, alpha × 100 — four numbers each. */
  fx: number[];
}
export interface Heckle { x: number; y: number; name: string }
/** The phone playing: where its frames go and its 搗亂 come from (main.ts sets it in 派對模式, null otherwise). */
export interface MiniLink { send(f: MiniFrame): void; heckles: boolean; onHeckle: ((h: Heckle) => void) | null }
let miniLink: MiniLink | null = null;
export function setMiniLink(l: MiniLink | null) { miniLink = l; }
/** The 2 s between one phone's 搗亂 (party-net.ts checks it again on the host). */
export const HECKLE_MS = 2000;

const PHASES: Phase[] = ['intro', 'ready', 'play', 'result', 'done'];
const HECKLE_WORDS: Record<6 | 7 | 8, string> = { 6: '點冰面放假寶物、畫紅點', 7: '點畫面扔番茄擋視線', 8: '點上面丟炸彈' };
/** When a 搗亂 counts: 企鵝挖寶 from the treasure's show on (a false one is the point), the sky games once they run. */
const heckleOpen = (kind: 6 | 7 | 8, ph: number) => (kind === 6 ? ph <= 2 : ph === 2);

/** The sprites as numbers (MiniFrame.s) and back. */
const packSprites = (list: Sprite[]) => list.flatMap(p => [p.archive === 'Data' ? 1 : 0, p.id, p.frame, Math.round(p.x), Math.round(p.y), Math.round((p.scale ?? 1) * 100)]);
function unpackSprites(n: number[]): Sprite[] {
  const out: Sprite[] = [];
  for (let i = 0; i + 5 < n.length; i += 6) out.push({ archive: n[i] ? 'Data' : 'Panel', id: n[i + 1], frame: n[i + 2], x: n[i + 3], y: n[i + 4], ...(n[i + 5] !== 100 ? { scale: n[i + 5] / 100 } : {}) });
  return out;
}

/** A tomato's splat or a red mark, drawn on the 640×480 picture. */
function paintFx(c: CanvasRenderingContext2D, fx: number[]) {
  for (let i = 0; i + 3 < fx.length; i += 4) {
    const [k, x, y, a] = [fx[i], fx[i + 1], fx[i + 2], fx[i + 3] / 100];
    if (a <= 0) continue;
    c.save();
    c.globalAlpha = Math.min(1, a);
    if (k === 1) {
      // a tomato: a red splash, drops round it, a lighter heart
      c.fillStyle = '#d8281c';
      c.beginPath(); c.arc(x, y, 46, 0, Math.PI * 2); c.fill();
      for (let j = 0; j < 9; j++) { const t = j * 0.7 + x * 0.01, r = 52 + (j % 3) * 14; c.beginPath(); c.arc(x + Math.cos(t) * r, y + Math.sin(t) * r * 0.8, 9 + (j % 4) * 4, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#ff6a4a'; c.beginPath(); c.arc(x - 10, y - 12, 18, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3d9b2a'; c.beginPath(); c.ellipse(x + 4, y - 40, 14, 6, 0.3, 0, Math.PI * 2); c.fill();
    } else {
      c.strokeStyle = '#ff2a2a'; c.lineWidth = 5; c.fillStyle = 'rgba(255, 40, 40, .35)';
      c.beginPath(); c.ellipse(x, y, 30, 16, 0, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    c.restore();
  }
}

function drawSprite(c: CanvasRenderingContext2D, art: Art, s: Sprite) {
  const p = art.get(s.archive ?? 'Panel', s.id, s.frame);
  if (!p) return;
  const k = s.scale ?? 1; // the anchor stays unscaled (fcn_004568c2)
  c.drawImage(p.img, s.x - p.ax, s.y - p.ay, p.w * k, p.h * k);
}
/** The sprites in order; in the two sky games the balloons and the falling things are cut at the digit strip. */
function paintSprites(c: CanvasRenderingContext2D, art: Art, list: Sprite[], kind: 6 | 7 | 8) {
  for (const p of list) {
    const sky = (kind === 7 && p.id === 91 && p.frame > 0) || (kind === 8 && p.id >= 95 && p.id <= 99);
    if (sky) { c.save(); c.beginPath(); c.rect(0, 0, 640, SKY_H); c.clip(); drawSprite(c, art, p); c.restore(); } else drawSprite(c, art, p);
  }
}

/** The score's words over the result (both the one playing and the watchers). */
function paintScore(c: CanvasRenderingContext2D, score: number) {
  c.save();
  c.font = `700 22px ${uiFont()}, "PingFang SC", "PingFang TC", sans-serif`;
  c.textAlign = 'center';
  c.lineJoin = 'round';
  c.lineWidth = 5;
  c.strokeStyle = 'rgba(30, 10, 50, .85)';
  c.fillStyle = '#fff6c8';
  const text = `得點券 ${score} 點`;
  c.strokeText(text, 320, 222);
  c.fillText(text, 320, 222);
  c.restore();
}

/** The art a game needs (its own, READY GO, the digits, the cursor; 喜從天降 the catcher `character`'s frames). */
function loadArt(ctx: ScreenContext, art: Art, info: GameInfo, kind: 6 | 7 | 8, character: number) {
  const bodyId = 100 + character;
  const jobs: Promise<void>[] = [
    art.load('Panel', 79, 0, 19), art.load('Panel', READY.id, 0, READY.frames - 1),
    ...info.cursor.map(f => art.load('Data', 0, f, f)),
    ...info.art.map(([id, from, to]) => art.load('Panel', id, from, to)),
  ];
  if (kind === 8) jobs.push(art.load('Panel', bodyId, 0, Math.max(0, ctx.bank.boxes('Panel', bodyId).length - 1)), art.load('Data', 526, 0, 7));
  return Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 12000))]);
}

/** A short line over the picture: who did a 搗亂, what the watcher just did. */
function shout(stage: HTMLElement, text: string) {
  const b = el('div', 'mn-shout');
  b.textContent = text;
  stage.append(b);
  setTimeout(() => b.remove(), 1600);
}

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
  const link = miniLink;
  /** 搗亂 on show: tomatoes and marks (until `end`), false treasure while the real ones show. */
  const fx: { k: 1 | 2; x: number; y: number; at: number; end: number }[] = [];
  const fakes: Sprite[] = [];
  let sentAt = 0;
  let sceneStage: HTMLElement | null = null;
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

    /** Everything drawn this moment, in order (what the watchers get too). */
    const frame = (): Sprite[] => {
      const out: Sprite[] = [{ id: info.bg, frame: 0, x: 0, y: 0 }];
      const phase = game.phase, playing = phase === 'play' || phase === 'result';
      if (penguin) {
        out.push(...penguin.paint());
        if (!playing) out.push(...penguin.treasure(), ...fakes);
        if (penguin.scoreShown) out.push(...bigScore(penguin.score)); // painted into the background
        if (playing) out.push(...penguin.sprites);
      } else if (balloons) {
        out.push(...balloons.sprites);
      } else if (gifts) {
        const [items, people] = [gifts.sprites.filter(p => p.id >= 95 && p.id <= 99), gifts.sprites.filter(p => p.id < 95 || p.id > 99)];
        out.push(...items, ...people);
        if (gifts.boom) out.push({ archive: 'Data', id: 526, frame: Math.min(7, gifts.boom.frame), x: gifts.boom.x, y: gifts.boom.y });
        if (gifts.pop) out.push({ archive: 'Data', id: 526, frame: Math.min(7, gifts.pop.frame), x: gifts.pop.x, y: gifts.pop.y, scale: 0.6 });
      }
      out.push(...game.hud());
      if (phase === 'result' || phase === 'done') out.push(...bigScore(game.score));
      if (ready >= 0) out.push({ id: READY.id, frame: ready, x: 0, y: 0 });
      return out;
    };
    const fxNow = (): number[] => {
      const now = performance.now();
      for (let i = fx.length - 1; i >= 0; i--) if (now >= fx[i].end) fx.splice(i, 1);
      return fx.flatMap(f => [f.k, Math.round(f.x), Math.round(f.y), Math.round(Math.min(1, (f.end - now) / 600) * 100)]);
    };

    const render = () => {
      if (!cv || !loaded) return;
      const c = cv.getContext('2d')!;
      c.setTransform(R, 0, 0, R, 0, 0);
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      const list = frame(), phase = game.phase, effects = fxNow();
      paintSprites(c, art, list, kind);
      paintFx(c, effects);
      if (phase === 'result' || phase === 'done') paintScore(c, game.score);
      // the watchers (派對模式): about eight pictures a second
      const now = performance.now();
      if (link && now - sentAt >= 120) { sentAt = now; try { link.send({ k: kind, c: me?.character ?? 0, s: packSprites(list), ph: PHASES.indexOf(phase), sc: game.score, fx: effects }); } catch { /* the next */ } }
      // The game's own cursor once it runs (fcn_004021f8 after READY GO), drawn like the original's software cursor.
      const cur = info.cursor;
      const own = phase === 'play' && cur.length > 0 && !!mouse;
      cv.classList.toggle('own-cursor', own);
      if (own && mouse) draw(c, { archive: 'Data', id: 0, frame: cur[ticks % cur.length], x: mouse.x, y: mouse.y });
    };

    // 搗亂 from someone watching (派對模式)
    if (link) link.onHeckle = h => {
      if (finished || !link.heckles || !heckleOpen(kind, PHASES.indexOf(game.phase))) return;
      const now = performance.now();
      if (penguin) {
        const cell = cellAt(h.x, h.y);
        const at = cell ? cellXY(cell.c, cell.r) : { x: h.x, y: h.y };
        if (game.phase === 'intro' || game.phase === 'ready') fakes.push({ id: 80, frame: 4 + Math.floor(Math.random() * 5), ...at });
        else fx.push({ k: 2, x: at.x, y: at.y, at: now, end: now + 3000 });
      } else if (balloons) fx.push({ k: 1, x: h.x, y: h.y, at: now, end: now + 2600 });
      else if (gifts) gifts.heckle(h.x);
      if (sceneStage) shout(sceneStage, `${h.name} 搗亂！`);
      render();
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      if (link) link.onHeckle = null;
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
      sceneStage = s.stage;
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
    void loadArt(ctx, art, info, kind, me?.character ?? 0).then(() => {
      if (finished) return;
      loaded = true;
      loadingBox?.remove();
      loadingBox = null;
      render();
      timer = window.setInterval(step, game.tickMs);
    });
  });
}

/**
 * 小遊戲搗亂, the others' side: the game of `who` as its phone draws it (frame() with each MiniFrame), and a tap is a
 * 搗亂 (`heckle`, every 2 s; none when the room turned it off). Opened with the first picture (main.ts): a phone of
 * 1.2.0 sends none, and the waiting line is all.
 */
export function watchMini(ctx: ScreenContext, kind: 6 | 7 | 8, who: string, character: number, heckle: ((x: number, y: number) => void) | null): { frame(f: MiniFrame): void; close(): void } {
  const info = GAMES[kind], art = new Art(ctx);
  let cv: HTMLCanvasElement | null = null, bar: HTMLElement | null = null, stage: HTMLElement | null = null;
  let R = 2, loaded = false, last: MiniFrame | null = null, closed = false, readyAt = 0;
  const render = () => {
    if (!cv || !loaded || !last) return;
    const c = cv.getContext('2d')!;
    c.setTransform(R, 0, 0, R, 0, 0);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.fillStyle = '#0c1424'; c.fillRect(0, 0, 640, 480);
    paintSprites(c, art, unpackSprites(last.s), kind);
    paintFx(c, last.fx);
    if (last.ph >= 3) paintScore(c, last.sc);
  };
  const drawBar = () => {
    if (!bar) return;
    const left = Math.max(0, readyAt - performance.now());
    const open = !!last && heckleOpen(kind, last.ph);
    bar.innerHTML = `<b>${esc(who)} 正在玩${esc(info.title)}</b>${heckle ? `<span>${!open ? (last && last.ph >= 3 ? '玩完了' : '遊戲開始後就能搗亂') : left > 0 ? `${(left / 1000).toFixed(1)} 秒後可以再搗亂` : `搗亂：${HECKLE_WORDS[kind]}`}</span>` : '<span>房主關掉了搗亂，只能看</span>'}`;
    bar.classList.toggle('cool', left > 0 || !open);
  };
  const timer = window.setInterval(() => {
    if (closed) return;
    drawBar();
  }, 200);
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    if (!heckle || !cv || !last || !heckleOpen(kind, last.ph)) { audio.ui('error'); return; }
    const now = performance.now();
    if (now < readyAt) { audio.ui('error'); return; }
    const r = cv.getBoundingClientRect(), x = ((e.clientX - r.left) * 640) / r.width, y = ((e.clientY - r.top) * 480) / r.height;
    readyAt = now + HECKLE_MS;
    heckle(x, y);
    audio.ui('click');
    if (stage) shout(stage, kind === 7 ? '扔出番茄！' : kind === 8 ? '丟下炸彈！' : '放了假記號！');
    drawBar();
  };
  const scene = openScene(ctx, `mn-scene mn-${kind} mn-watch`, p => (p ? [640, 620] : [640, 480]), sc => {
    const k = Math.min(sc.root.clientWidth / sc.w, sc.root.clientHeight / sc.h) || 1;
    R = Math.min(3, Math.max(1, Math.ceil(k * (window.devicePixelRatio || 1))));
    cv = el('canvas', 'mn-canvas');
    cv.width = 640 * R; cv.height = 480 * R;
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    sc.stage.append(cv);
    stage = sc.stage;
    bar = sc.box(sc.portrait ? 'mn-panel mn-watchbar' : 'mn-watchbar', sc.portrait ? 0 : 40, sc.portrait ? 480 : 420, sc.portrait ? 640 : 560, sc.portrait ? sc.h - 480 : 52, '');
    drawBar();
    render();
  });
  void loadArt(ctx, art, info, kind, character).then(() => { loaded = true; render(); });
  const handle = {
    frame(f: MiniFrame) {
      if (closed || f.k !== kind) return;
      last = f;
      render();
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      scene.close();
    },
  };
  return handle;
}

askScreens['mini-game'] = (ctx, a) => playMini(ctx, a as MiniAsk);
