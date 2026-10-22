/**
 * 道具 / 高級卡片 cinematics (the user 2026-10-22: 「都加上像洲際飛彈一樣的動畫特效」, then the cards of 100 點券 and up
 * plus 怪獸卡): when a tool or card really takes effect, four painted film shots (maps/remake/cinema/<key>/shot-1..4,
 * tools/tycoon-art/cinema_art.py) cut together with camera moves, shakes, particles and light in a letterbox, as
 * 洲際飛彈's flight (icbm-flight.ts) — then the game's own effect plays (the missile's clip, the robot, the angel …).
 * A tap skips; the waits follow the game speed as the flight's do; computers' uses play too, as the flight does.
 *
 * Visual only: the rules are untouched. The UI wraps `Tools.use` and `Cards.play` (each phone of 派對模式 the same) and
 * puts one 'cinema' announcement into the stream right before the event the tool's or card's effect starts with, so
 * a cancelled or failed use shows nothing, and a city played without the screen (大富豪模式) never shows it either.
 */
import { Tools, toolIcon } from '../core/modules/tools';
import { Cards, cardName } from '../core/modules/cards';
import { CHARACTERS } from '../core/characters';
import type { Flow } from '../core/flow';
import type { GameEvent, Player } from '../core/types';
import { ASSETS } from './assets';
import { audio, Sfx } from './audio';
import { fxScreens, type ScreenContext } from './screens/registry';
import './tool-cinema.css';

type Cam = 'push' | 'pull' | 'panl' | 'panr' | 'rise' | 'sink' | 'dive';
type Fx = 'sparks' | 'fall' | 'speed' | 'glow' | 'beam' | 'swirl' | 'flash' | 'flicker' | 'aim' | 'shake' | 'quake' | 'sepia';
/** `at`: what to keep in frame when a tall phone screen crops the wide shot (the object-position; centre by default). */
interface Shot { cam: Cam; fx?: Fx[]; c?: string; ms?: number; at?: string; title?: [string, string?]; sfx?: number }
interface Script { name: string; verb: string; shots: [Shot, Shot, Shot, Shot] }

const GOLD = '#ffd36a', CYAN = '#7ff0ff', RED = '#ff4a3a', PURPLE = '#c48aff', ICE = '#e8f6ff';
export const SCRIPTS: Record<string, Script> = {
  missile: { name: '飛彈', verb: '發射', shots: [
    { cam: 'rise', fx: ['sparks', 'shake', 'glow'], c: '#ff9a3a', sfx: Sfx.missile },
    { at: '78% 40%', cam: 'panr', fx: ['speed'], title: ['飛越市區'] },
    { at: '60% 50%', cam: 'push', fx: ['speed', 'shake'] },
    { cam: 'dive', fx: ['aim', 'speed'], title: ['目標鎖定'] }] },
  nuke: { name: '核子飛彈', verb: '發射', shots: [
    { cam: 'rise', fx: ['sparks', 'quake', 'glow'], c: '#ff7a2a', sfx: Sfx.missile },
    { at: '88% 25%', cam: 'panr', fx: ['glow'], c: '#ffb070', title: ['劃破天際'] },
    { cam: 'push', fx: ['flash', 'quake'], sfx: Sfx.smallBlast },
    { cam: 'pull', fx: ['quake', 'glow', 'sparks'], c: '#ff8a2a', ms: 1300, title: ['毀滅打擊'] }] },
  teleporter: { name: '傳送機', verb: '啟動', shots: [
    { cam: 'push', fx: ['glow', 'sparks'], c: CYAN, sfx: Sfx.magic },
    { cam: 'rise', fx: ['beam', 'sparks'], c: CYAN, title: ['光束鎖定'] },
    { cam: 'push', fx: ['sparks', 'glow'], c: CYAN },
    { cam: 'pull', fx: ['flash', 'glow'], c: CYAN, title: ['瞬間移動'] }] },
  construction: { name: '工程車', verb: '出動', shots: [
    { at: '45% 50%', cam: 'push', fx: ['shake', 'glow'], c: '#ffd040', sfx: Sfx.truck },
    { cam: 'dive', fx: ['quake', 'sparks'], c: '#d8b080', title: ['開路先鋒'] },
    { at: '60% 35%', cam: 'rise', fx: ['shake'] },
    { cam: 'pull', fx: ['flash', 'quake', 'sparks'], c: '#ffcf90', sfx: Sfx.demolishCar, title: ['橫衝直撞'] }] },
  'robot-worker': { name: '機器工人', verb: '出動', shots: [
    { cam: 'push', fx: ['sparks', 'glow'], c: GOLD, sfx: Sfx.robot },
    { at: '70% 35%', cam: 'panr', fx: ['glow'], c: '#fff0b0', title: ['搬運建材'] },
    { cam: 'push', fx: ['sparks', 'shake'], c: GOLD },
    { cam: 'pull', fx: ['glow', 'sparks'], c: '#ffe6a0', title: ['加蓋一層！'] }] },
  'super-worker': { name: '超級工人', verb: '出動', shots: [
    { cam: 'pull', fx: ['flash', 'quake', 'glow'], c: GOLD, sfx: Sfx.robot },
    { cam: 'rise', fx: ['glow', 'sparks'], c: GOLD, title: ['力拔山河'] },
    { cam: 'push', fx: ['swirl', 'sparks', 'shake'], c: GOLD },
    { cam: 'rise', fx: ['sparks', 'glow'], c: '#ffd080', title: ['連蓋兩層！'] }] },
  'time-machine': { name: '時光機', verb: '啟動', shots: [
    { cam: 'push', fx: ['glow', 'sparks'], c: '#8ac8ff', sfx: Sfx.magic },
    { cam: 'pull', fx: ['swirl', 'glow'], c: '#a8d0ff', title: ['時鐘倒轉'] },
    { cam: 'dive', fx: ['speed', 'swirl'], c: '#b090ff' },
    { cam: 'push', fx: ['sepia', 'glow'], c: '#ffd8a0', title: ['時光倒流'] }] },
  'space-time': { name: '時空機', verb: '啟動', shots: [
    { cam: 'push', fx: ['swirl', 'glow'], c: PURPLE, sfx: Sfx.magic },
    { cam: 'dive', fx: ['speed', 'swirl'], c: PURPLE, title: ['穿越蟲洞'] },
    { cam: 'panr', fx: ['glow'], c: '#ffe6a0' },
    { cam: 'pull', fx: ['flash', 'glow', 'sparks'], c: PURPLE, title: ['時空穿越'] }] },
  car: { name: '汽車', verb: '發動', shots: [
    { cam: 'push', fx: ['glow'], c: '#ffe0a0', sfx: Sfx.car },
    { at: '25% 60%', cam: 'push', fx: ['shake', 'glow'], c: '#7ab0ff', title: ['引擎轟鳴'] },
    { at: '45% 60%', cam: 'panl', fx: ['speed', 'shake'] },
    { cam: 'dive', fx: ['speed'], title: ['三顆骰子！'] }] },
  scooter: { name: '機車', verb: '發動', shots: [
    { cam: 'push', fx: ['fall'], c: '#ffd0e0', sfx: Sfx.scooter },
    { at: '65% 50%', cam: 'push', fx: ['shake', 'fall'], c: '#ffd0e0', title: ['噗噗出發'] },
    { cam: 'panr', fx: ['speed'] },
    { at: '72% 60%', cam: 'dive', fx: ['speed', 'fall'], c: '#ffc0d8', title: ['兩顆骰子！'] }] },
  'card-1': { name: '均富卡', verb: '發動', shots: [
    { at: '45% 30%', cam: 'rise', fx: ['glow', 'sparks'], c: GOLD },
    { cam: 'push', fx: ['fall', 'glow'], c: GOLD, title: ['金幣湧出'] },
    { cam: 'pull', fx: ['swirl', 'sparks'], c: GOLD },
    { cam: 'sink', fx: ['fall', 'glow'], c: GOLD, title: ['財富均分'] }] },
  'card-2': { name: '均貧卡', verb: '發動', shots: [
    { cam: 'push', fx: ['glow', 'flicker', 'shake'], c: PURPLE },
    { at: '72% 40%', cam: 'dive', fx: ['swirl', 'speed'], c: PURPLE, title: ['錢財吸走'] },
    { cam: 'panr', fx: ['fall'], c: '#f0e8b0' },
    { cam: 'push', fx: ['glow'], c: GOLD, title: ['一人一半'] }] },
  'card-9': { name: '天使卡', verb: '發動', shots: [
    { cam: 'sink', fx: ['glow', 'fall'], c: '#fff6d0' },
    { cam: 'sink', fx: ['glow', 'fall'], c: '#ffffff', title: ['天使降臨'] },
    { cam: 'push', fx: ['fall', 'glow'], c: GOLD },
    { cam: 'rise', fx: ['sparks', 'glow'], c: '#fff0b0', title: ['整條街加蓋！'] }] },
  'card-10': { name: '惡魔卡', verb: '發動', shots: [
    { cam: 'push', fx: ['flicker', 'glow'], c: RED },
    { at: '55% 25%', cam: 'push', fx: ['glow', 'shake'], c: RED, title: ['惡魔降臨'] },
    { cam: 'dive', fx: ['flicker', 'quake'], c: '#d070ff', sfx: Sfx.devilDust },
    { cam: 'pull', fx: ['sparks', 'quake'], c: '#ff7a3a', title: ['整條街崩塌'] }] },
  'card-11': { name: '怪獸卡', verb: '發動', shots: [
    { cam: 'push', fx: ['shake'] },
    { at: '72% 30%', cam: 'sink', fx: ['quake'], sfx: Sfx.monsterCard, title: ['怪獸出現'] },
    { cam: 'dive', fx: ['quake', 'flash'] },
    { at: '35% 35%', cam: 'panr', fx: ['quake', 'sparks'], c: '#ffb070', title: ['大肆破壞'] }] },
  'card-15': { name: '冬眠卡', verb: '發動', shots: [
    { at: '45% 50%', cam: 'push', fx: ['glow', 'fall'], c: ICE },
    { cam: 'panr', fx: ['fall', 'shake'], c: ICE, title: ['暴風雪來襲'] },
    { cam: 'push', fx: ['fall'], c: ICE },
    { cam: 'pull', fx: ['fall', 'glow'], c: ICE, title: ['全員冬眠'] }] },
  'card-34': { name: '獨裁卡', verb: '發動', shots: [
    { cam: 'rise', fx: ['glow'], c: RED },
    { at: '75% 50%', cam: 'push', fx: ['glow', 'shake'], c: '#ffd890', title: ['獨裁統治'] },
    { at: '35% 45%', cam: 'panr', fx: ['speed'], sfx: Sfx.airplane },
    { cam: 'pull', fx: ['glow'], c: RED, title: ['全部離開！'] }] },
  'card-39': { name: '複製卡', verb: '發動', shots: [
    { cam: 'push', fx: ['glow', 'swirl'], c: CYAN },
    { cam: 'panr', fx: ['beam', 'sparks'], c: CYAN, title: ['掃描中'] },
    { cam: 'dive', fx: ['swirl', 'speed'], c: '#b0d8ff' },
    { cam: 'push', fx: ['flash', 'sparks'], c: GOLD, title: ['完美複製'] }] },
};

/** The tools and cards that have a cinematic, by id. */
const TOOL_KEY: Record<number, string> = { 5: 'scooter', 6: 'car', 7: 'missile', 9: 'robot-worker', 10: 'time-machine', 11: 'teleporter', 12: 'construction', 13: 'nuke', 14: 'super-worker', 16: 'space-time' };
const CARD_KEY: Record<number, string> = { 1: 'card-1', 2: 'card-2', 9: 'card-9', 10: 'card-10', 11: 'card-11', 15: 'card-15', 34: 'card-34', 39: 'card-39' };

const SHOT = (key: string, n: number) => `${ASSETS}/maps/remake/cinema/${key}/shot-${n}.webp`;
const warmed = new Set<string>();
/** The four shots start loading as soon as the tool or card is picked (the target is chosen meanwhile). */
function warm(key: string) {
  if (warmed.has(key) || typeof Image === 'undefined') return;
  warmed.add(key);
  for (let n = 1; n <= 4; n++) { const im = new Image(); im.decoding = 'async'; im.src = SHOT(key, n); }
}

type Ev = GameEvent;
const isAsk = (s: unknown) => !!s && typeof s === 'object' && 'ask' in (s as object);
/** The event a tool's effect starts with: the cinematic goes right before it. */
function toolStarts(tool: number, s: Ev): boolean {
  const fx = s.t === 'fx' ? s.kind : '';
  switch (tool) {
    case 5: return fx === 'scooter';
    case 6: return fx === 'car';
    case 7: return fx === 'missile';
    case 13: return fx === 'nuke';
    case 9: case 14: return fx === 'robot-worker';
    case 10: return fx === 'time-machine';
    case 12: return fx === 'construction';
    // 傳送機 / 時空機: the move itself (a person), the board (a lot or a thing), the crossing (another city).
    case 11: case 16: return s.t === 'teleport' || s.t === 'board' || fx === 'space-time' || fx === 'tycoon-notice';
  }
  return false;
}
/** A card's effect starts with its first announcement (or the board), not with the card shown, a line or a refusal. */
const cardStarts = (s: Ev) => (s.t === 'fx' && !['card', 'card-failed', 'card-line'].includes(s.kind)) || s.t === 'board' || s.t === 'teleport';

/** Passes `flow` through, putting the 'cinema' announcement of `key` before the first event `starts` accepts. */
function* withCinema<T>(flow: Flow<T>, p: Player, key: string, starts: (s: Ev) => boolean): Flow<T> {
  warm(key);
  let shown = false;
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if (!shown && !isAsk(s) && starts(s as Ev)) {
      shown = true;
      yield { t: 'fx', kind: 'cinema', p: p.id, data: { key } } as Ev;
    }
    r = flow.next(yield s);
  }
  return r.value;
}

let installed = false;
/** Wraps the rules' tool and card use (once; the UI only — the rules and their tests never see it). */
export function installCinema() {
  if (installed) return;
  installed = true;
  const use = Tools.prototype.use;
  Tools.prototype.use = function (this: Tools, p: Player, tool: number, param?: number) {
    const key = TOOL_KEY[tool];
    return key ? withCinema(use.call(this, p, tool, param), p, key, s => toolStarts(tool, s)) : use.call(this, p, tool, param);
  };
  const proto = Cards.prototype as unknown as { play: (p: Player, id: number, human: boolean) => Flow<boolean> };
  const play = proto.play;
  proto.play = function (this: Cards, p: Player, id: number, human: boolean) {
    const key = CARD_KEY[id];
    return key ? withCinema(play.call(this, p, id, human), p, key, cardStarts) : play.call(this, p, id, human);
  };
}
installCinema();

/** Plays the cinematic `key` for player `pid`; resolves when it has played or was tapped through. */
export async function toolCinema(ctx: ScreenContext, key: string, pid?: number): Promise<void> {
  const sc = SCRIPTS[key];
  if (!sc) return;
  warm(key);
  const who = pid !== undefined ? ctx.game.players[pid] : undefined;
  const face = who ? ctx.bank.art('Data', 2, who.character) : null;
  const tool = Number(Object.keys(TOOL_KEY).find(t => TOOL_KEY[+t] === key) ?? 0);
  const card = Number(Object.keys(CARD_KEY).find(c => CARD_KEY[+c] === key) ?? 0);
  const ic = tool ? (t => ctx.bank.art(t.archive, t.id, t.frame))(toolIcon(tool)) : card ? ctx.bank.art('Data', 570 + card, 0) : null;
  const name = card ? cardName(card) : sc.name;
  const k = Math.max(0.7, ctx.scale());
  const dots = (n: number) => Array.from({ length: n }, (_, i) => `<i style="--x:${(i * 37) % 100};--dl:${((i * 0.13) % 1.4).toFixed(2)}s;--s:${0.5 + (i % 5) * 0.25}"></i>`).join('');
  const layer = (f: Fx) => {
    switch (f) {
      case 'sparks': return `<div class="tc-sparks">${dots(26)}</div>`;
      case 'fall': return `<div class="tc-fall">${dots(30)}</div>`;
      case 'speed': return '<div class="tc-speed"></div>';
      case 'glow': return '<div class="tc-glow"></div>';
      case 'beam': return '<div class="tc-beam"></div>';
      case 'swirl': return '<div class="tc-swirl"></div>';
      case 'flicker': return '<div class="tc-flicker"></div>';
      case 'aim': return '<div class="tc-aim"></div>';
      default: return '';
    }
  };
  const root = document.createElement('div');
  root.className = 'tc';
  root.innerHTML = sc.shots.map((s, i) => {
    const fx = s.fx ?? [];
    const cls = ['tc-shot', `cam-${s.cam}`, ...fx.filter(f => f === 'shake' || f === 'quake' || f === 'sepia' || f === 'flash').map(f => `fx-${f}`)].join(' ');
    return `<div class="${cls}" style="--d:${Math.round((s.ms ?? 1050) * k + 300)}ms;${s.c ? `--c:${s.c}` : ''}"><div class="tc-cam"><img src="${SHOT(key, i + 1)}" alt=""${s.at ? ` style="object-position:${s.at}"` : ''}></div>${fx.map(layer).join('')}</div>`;
  }).join('') + `
    <div class="tc-bars"><i></i><i></i></div>
    <div class="tc-who">${face ? `<span class="tc-face"><img src="${face.src}" alt=""></span>` : ''}${ic ? `<span class="tc-icon"><img src="${ic.src}" alt=""></span>` : ''}</div>
    <div class="tc-title"><b></b><small></small></div>
    <div class="tc-skip">點一下跳過</div>`;
  // The first shot is up before it starts (a black frame otherwise), at most a moment's wait.
  const first = root.querySelector<HTMLImageElement>('.tc-shot img')!;
  await Promise.race([first.decode().catch(() => undefined), new Promise(r => setTimeout(r, 700))]);
  ctx.open(root, true);
  const title = (big: string, small = '') => {
    const t = root.querySelector<HTMLElement>('.tc-title')!;
    t.querySelector('b')!.textContent = big; t.querySelector('small')!.textContent = small;
    t.classList.remove('in'); void t.offsetWidth; t.classList.add('in');
  };
  let skipped = false;
  const skip = new Promise<void>(res => root.addEventListener('pointerup', () => { skipped = true; res(); }, { once: true }));
  const shots = [...root.querySelectorAll<HTMLElement>('.tc-shot')];
  const play = (async () => {
    for (let i = 0; i < shots.length && !skipped; i++) {
      const s = sc.shots[i];
      shots.forEach((el, j) => el.classList.toggle('on', j === i));
      if (i === 0) { root.classList.add('intro'); title(who ? CHARACTERS[who.character]?.name ?? '' : '', `${name}　${sc.verb}`); }
      else { root.classList.remove('intro'); if (s.title) title(s.title[0], s.title[1]); }
      if (s.sfx !== undefined) audio.sfx(s.sfx);
      await new Promise(res => setTimeout(res, (s.ms ?? 1050) * k));
    }
    if (!skipped) { root.classList.add('out'); await new Promise(res => setTimeout(res, 260)); }
  })();
  await Promise.race([play, skip]);
  ctx.close();
}

fxScreens['cinema'] = (ctx, s) => toolCinema(ctx, String(s.data?.key ?? ''), s.p);
