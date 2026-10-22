/**
 * 激情歲月's living street (docs/rules/24 §8, purely decorative, never touches the rules): the passers-by of the era on
 * the sidewalks (ui/kb-crowd.ts, keeping right as Beijing did), bicycles in strings on 長安街 and 前三門, buses,
 * trolleybuses, 解放 lorries, jeeps, the odd 上海 sedan, tricycles and carts in the curb lanes; the movements of §8.3 —
 * marches with flags, a banner and drums, the 廣播體操 on the square and at the campus, the 忠字舞 (one dancer always
 * a little late), 腰鼓, readers at the 大字報 walls, queues at the department store and the 供銷社, children skipping
 * by the hutongs, pigeons on the square — and the loudspeakers (ui/jq-loudspeaker.ts) with their announcements as
 * banners. Its clock is its own: it stops under any dialog or screen and while the page is hidden.
 *
 * The board (ui/board-view.ts) treats it like 歌舞伎町's KbStreet: `advance`, `collect`, `walkerSprites`, `covers`.
 */
import type { Game } from '../core/game';
import { buildTracks, Crowd, nearestView, prng, walkerFacing } from './kb-crowd';
import type { AddItem, StreetView } from './kb-ambient';
import { onStreetSettings, vehiclesMode, walkersMode } from './kabukicho';
import { loudspeakerMode, onJqSettings } from './jiqing';
import { Loudspeakers, type Program } from './jq-loudspeaker';
import { memTier } from './mem-tier';

/** The passers-by (map/3401..3407: 紅衛兵, 幹部, 工人, 農民, 女青年, 少先隊員, 老人), 16 frames each: row × 4 + phase. */
const WALKER = 3401, KINDS = 7;
/** The ambient sprites (map/3411..3429, tools/tycoon-art/kb_ambient.py RICH4_AMBIENT=jiqing). */
export const JQA = {
  truck: 3411, jeep: 3412, sedan: 3413, tricycle: 3414, bicycle: 3415, cart: 3416, bus: 3417, trolley: 3418,
  flag: 3419, drummer: 3420, banner: 3421, marcher: 3422, reader: 3423, gymnast: 3424, dancer: 3425, waistdrum: 3426,
  queuer: 3427, skipper: 3428, pigeon: 3429,
};
/** Landmarks the street gathers round (editor/jiqing_layout.py SPRITE_IDS). */
const LM = { tiananmen: 3201, monument: 3206, qianmen: 3208, dept: 3213, loud: 3221, dazibao: 3223, campus: 3224, hutong: 3225 };
/** Paces (map px / s): the seven kinds, then the cyclist. */
const PACE: [number, number][] = [[20, 27], [16, 22], [18, 25], [14, 20], [17, 24], [20, 28], [10, 15], [40, 52]];
/** Screens that cover the map or ask something: the street stands still meanwhile. */
const COVERS = '.ui-layer.show, .pl-scene, .fx-overlay, .te-cover, .shop, .bk-atm-ov, .bk-counter-ov, .dv-ov, .bm-overlay, .slots-overlay, .rd-ov, .kbm-root, .jq-intro';
const SIDEWALK = 9;

/** The loudspeakers' announcements (§9.2), shown as banners (no voice yet): original, playful, of the era. */
export const ANNOUNCEMENTS = [
  '社員同志們，今天的工分已經記好了，請不要再去找記工員',
  '供銷社到了一批暖水瓶，每戶限購一個，請帶好購貨本',
  '最新消息：本市自行車突破一百萬輛，請大家注意靠右行駛',
  '現在開始做第五套廣播體操，預備——起！',
  '請各位同志節約用水，公共水龍頭用完記得關緊',
  '今晚七點，廣場放映露天電影，請自帶小板凳',
  '冬儲大白菜到貨了，請各戶憑本領取',
  '請各位社員注意：誰家的雞跑進了生產隊的麥地，請速來領回',
  '愛國衛生運動：明天上午大掃除，每戶出一人',
  '糧店通知：本月細糧供應不變，請按時購買',
  '請騎自行車的同志注意：車鈴要響，車閘要靈',
  '大字報欄即將更換，請同志們抓緊時間抄寫',
  '天氣預報：明天晴轉多雲，適宜晾曬被褥',
  '請排隊購買郵票，不要擁擠',
  '防空演習通知：聽到警報請有序進入防空洞',
  '理髮店通知：本週推出新髮型「青年頭」，歡迎同志們來理髮',
  '失物招領：有同志在長椅上丟了一本語錄，請到廣播站認領',
  '請小朋友們放學後直接回家，不要在馬路上跳皮筋',
  '副食店到了一批鹹菜，數量有限，先到先得',
  '下面請收聽廣播站的音樂節目',
];
/** The marches' banners (§8.3): the game lays the words on the blank cloth. */
const BANNERS = ['熱烈慶祝本市自行車突破一百萬輛', '熱烈慶祝暖水瓶到貨', '熱烈慶祝冬儲大白菜豐收', '熱烈慶祝廣播體操第五套推行', '熱烈慶祝副食店擴建完工'];

type Pt = [number, number];
interface Lane { a: Pt; b: Pt; len: number; dx: number; dy: number; avenue: boolean }
interface Car { res: number; lane: Lane; s: number; speed: number; pace: number; kind: 'car' | 'bike' }
/** How long each vehicle is along its lane (map px, from the drawn sprites): the gap the next one keeps behind it. */
const LENGTH: Record<number, number> = { 3411: 46, 3412: 34, 3413: 38, 3414: 30, 3415: 30, 3416: 46, 3417: 66, 3418: 70 };
const lengthOf = (res: number) => LENGTH[res] ?? 36;
interface March { lane: Lane; s: number; members: number[]; banner: string; speed: number }
interface Spot { x: number; y: number }

export class JqStreet {
  readonly crowd: Crowd;
  /** As KbStreet's (the board lends it the sprite frames): unused here. */
  readonly ambient: { frameInfo: unknown } = { frameInfo: null };
  private readonly loud = new Loudspeakers();
  private readonly r: () => number;
  private last = 0;
  private frame = 0;
  private covered = false;
  private hidden = false;
  private clock = 0;
  private walkOn = walkersMode() === 0;
  private carsOn = vehiclesMode() === 0;
  private loudOn = loudspeakerMode() === 0;
  private lanes: Lane[] = [];
  private avenues: Lane[] = [];
  private cars: Car[] = [];
  private nextCar = 0;
  private nextPack = 3;
  private march: March | null = null;
  private nextMarch = 25;
  private nextProgram = 14;
  private nextAnnounce = 6;
  private readonly maxCars: number;
  private readonly spots: { square: Spot; dept: Spot | null; qianmen: Spot | null; campus: Spot | null; walls: Spot[]; hutongs: Spot[]; horns: Spot[] };
  private pigeons: { x: number; y: number; t: number; fr: number; fly: number; vx: number; vy: number; z: number }[] = [];
  private banner: HTMLElement | null = null;
  private readonly unlisten: () => void;

  constructor(readonly game: Game, paths: [number, number][][]) {
    const tier = memTier(), seed = (game.settings.seed ^ 0x6a71) >>> 0, b = game.board;
    this.r = prng(seed ^ 0x5157);
    this.maxCars = tier.vehicles + 2;
    const nodes = b.nodes;
    const roadDir = (x: number, y: number): [number, number] | null => {
      let best: [number, number] | null = null, bd = 90 * 90;
      for (const n of nodes) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bd) { bd = d; best = [n.x - x, n.y - y]; } }
      return best;
    };
    // The sidewalks (both sides of each street, 46 px apart) a little off the road, and the road's centre between them.
    const mid = (p: Pt[]) => [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
    const centres: { a: Pt; b: Pt }[] = [];
    const side = paths.map(p => {
      if (p.length !== 2) return p;
      const [a, c] = p, l = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, nx = -(c[1] - a[1]) / l, ny = (c[0] - a[0]) / l, m = mid(p);
      let best: Pt[] | null = null, bd = Infinity;
      for (const q of paths) {
        if (q === p || q.length !== 2) continue;
        const n = mid(q), off = (n[0] - m[0]) * nx + (n[1] - m[1]) * ny, alongD = Math.abs((n[0] - m[0]) * ny - (n[1] - m[1]) * nx);
        if (Math.abs(Math.abs(off) - 46) < 8 && alongD < 30 && alongD < bd) { bd = alongD; best = q; }
      }
      if (best && paths.indexOf(best) > paths.indexOf(p)) {
        // one centre line per street: the middle of the two sidewalks, the same way as p
        const q = Math.hypot(best[0][0] - a[0], best[0][1] - a[1]) < Math.hypot(best[1][0] - a[0], best[1][1] - a[1]) ? best : [best[1], best[0]];
        centres.push({ a: [(a[0] + q[0][0]) / 2, (a[1] + q[0][1]) / 2], b: [(c[0] + q[1][0]) / 2, (c[1] + q[1][1]) / 2] });
      }
      const d = best ? [mid(best)[0] - m[0], mid(best)[1] - m[1]] : roadDir(m[0], m[1]);
      const s = d && d[0] * nx + d[1] * ny > 0 ? -SIDEWALK : SIDEWALK;
      return p.map(([x, y]) => [x + nx * s, y + ny * s] as Pt);
    });
    // The curb lanes (keep right: the lane right of the way it goes, 12 px off the centre), streets of 240 px or more.
    // 長安街 and 前三門 are the avenues: the streets through the two banks' junctions (府右街口, 崇文門).
    const banks = nodes.filter(n => n.event === 14).map(n => n.y);
    for (const c of centres) {
      const len = Math.hypot(c.b[0] - c.a[0], c.b[1] - c.a[1]);
      if (len < 240) continue;
      const horizontal = Math.abs(c.b[1] - c.a[1]) < 20, cy = (c.a[1] + c.b[1]) / 2;
      const avenue = horizontal && banks.some(y => Math.abs(y - cy) < 40);
      for (const [a, e] of [[c.a, c.b], [c.b, c.a]] as const) {
        const dx = (e[0] - a[0]) / len, dy = (e[1] - a[1]) / len, ox = -dy * 12, oy = dx * 12;
        const lane: Lane = { a: [a[0] + ox, a[1] + oy], b: [e[0] + ox, e[1] + oy], len, dx, dy, avenue };
        this.lanes.push(lane);
        if (avenue) this.avenues.push(lane);
      }
    }
    // Busiest round 王府井, the square and 前門大街.
    const busy = (x: number, y: number) => 0.4 + 1.6 * Math.exp(-(((x - 1500) ** 2 + (y - 800) ** 2) / (420 * 420))) + 1.4 * Math.exp(-(((x - 1250) ** 2 + (y - 1300) ** 2) / (450 * 450)));
    this.crowd = new Crowd(buildTracks(side), tier.walkers, seed, roadDir, tier.bikes + 2, busy, { kinds: KINDS, pace: PACE, keepRight: true });
    // Where the movements gather (from the landmarks, wherever the layout puts them).
    const at = (res: number) => b.landscapes.filter(l => l.resource + 38 === res).map(l => ({ x: l.x, y: l.y }));
    const sq = at(LM.monument)[0] ?? { x: 1250, y: 1200 };
    this.spots = { square: sq, dept: at(LM.dept)[0] ?? null, qianmen: at(LM.qianmen)[0] ?? null, campus: at(LM.campus)[0] ?? null,
      walls: at(LM.dazibao), hutongs: at(LM.hutong), horns: [...at(LM.loud), sq, ...nodes.filter(n => n.event === 2).map(n => ({ x: n.x, y: n.y }))] };
    const r = this.r;
    for (let i = 0; i < (tier.name === 'low' ? 5 : 10); i++) this.pigeons.push({ x: sq.x + 40 + (r() - 0.5) * 90, y: sq.y - 50 + (r() - 0.5) * 60, t: r() * 2, fr: 0, fly: 0, vx: 0, vy: 0, z: 0 });
    for (let i = 0; i < this.maxCars - 2; i++) this.spawnCar(r() * 0.8);
    const update = () => {
      this.walkOn = walkersMode() === 0; this.carsOn = vehiclesMode() === 0; this.loudOn = loudspeakerMode() === 0;
      if (!this.loudOn) this.loud.place(0, 0, 0, false);
    };
    const off = onJqSettings(update);
    const offKb = onStreetSettings(update);   // 街頭行人 / 街頭車輛 live in ui/kabukicho.ts's settings
    const vis = () => { this.hidden = document.hidden; if (this.hidden) this.loud.place(0, 0, 0, false); };
    try { document.addEventListener('visibilitychange', vis); } catch { /* no document (tests) */ }
    this.unlisten = () => { off(); offKb(); try { document.removeEventListener('visibilitychange', vis); } catch { /* none */ } this.loud.close(); this.banner?.remove(); };
  }

  destroy() { this.unlisten(); }

  /** The news board's jingle (§9.3: the 廣播站 plays its 1-second jingle wherever the camera is). */
  newsJingle() { this.loud.newsJingle(this.loudOn); }

  // ------------------------------------------------------------------ the clock

  private spawnCar(at = 0, pack = false) {
    const r = this.r;
    if (!this.lanes.length) return;
    if (pack) {
      // A string of bicycles on an avenue, one behind the other (§8.2).
      const lane = (this.avenues.length ? this.avenues : this.lanes)[Math.floor(r() * (this.avenues.length || this.lanes.length))];
      // One behind the other with a real gap (a bicycle is about 30 px long): never drawn on top of each other.
      const n = 3 + Math.floor(r() * 4), speed = 34 + r() * 8;
      let s0 = at * lane.len;
      if (this.cars.some(c => c.lane === lane && Math.abs(c.s - s0) < 120)) return;
      for (let i = 0; i < n; i++) { this.cars.push({ res: JQA.bicycle, lane, s: s0, speed, pace: speed, kind: 'bike' }); s0 -= lengthOf(JQA.bicycle) + 8 + r() * 14; }
      return;
    }
    const avenue = r() < 0.6 && this.avenues.length;
    const pool = avenue ? this.avenues : this.lanes, lane = pool[Math.floor(r() * pool.length)];
    const u = r();
    const res = lane.avenue
      ? (u < 0.22 ? JQA.trolley : u < 0.42 ? JQA.bus : u < 0.6 ? JQA.truck : u < 0.75 ? JQA.jeep : u < 0.82 ? JQA.sedan : u < 0.92 ? JQA.tricycle : JQA.bicycle)
      : (u < 0.25 ? JQA.tricycle : u < 0.45 ? JQA.cart : u < 0.62 ? JQA.truck : u < 0.75 ? JQA.jeep : JQA.bicycle);
    const speed = res === JQA.cart ? 14 + r() * 4 : res === JQA.tricycle || res === JQA.bicycle ? 28 + r() * 10 : 46 + r() * 22;
    const s = at * lane.len;
    if (this.cars.some(c => c.lane === lane && Math.abs(c.s - s) < (lengthOf(c.res) + lengthOf(res)) / 2 + 40)) return;
    this.cars.push({ res, lane, s, speed, pace: speed, kind: res === JQA.bicycle ? 'bike' : 'car' });
  }

  /** One screen frame: the street's clock moves on unless something covers the map. */
  advance() {
    const now = performance.now(), dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    if (this.frame++ % 12 === 0) this.covered = typeof document !== 'undefined' && (document.hidden || !!document.querySelector(COVERS));
    if (this.covered || !dt) return;
    this.clock += dt;
    const r = this.r;
    if (this.walkOn) this.crowd.step(dt, this.clock);
    if (this.carsOn) {
      const motor = this.cars.filter(c => c.kind === 'car').length;
      if ((this.nextCar -= dt) <= 0 && motor < this.maxCars) { this.spawnCar(); this.nextCar = 1.2 + r() * 3; }
      if ((this.nextPack -= dt) <= 0) { this.spawnCar(0, true); this.nextPack = (memTier().name === 'low' ? 14 : memTier().name === 'mid' ? 8 : 5) + r() * 5; }
    } else this.cars = [];
    for (const c of this.cars) {
      c.pace = c.speed;
      for (const o of this.cars) {
        if (o === c || o.lane !== c.lane) continue;
        const ahead = o.s - c.s;
        const gap = (lengthOf(c.res) + lengthOf(o.res)) / 2 + 6;
        if (ahead > 0 && ahead < gap + 14) c.pace = Math.min(c.pace, ahead < gap ? 0 : o.pace * 0.95);
      }
      if (this.march && this.march.lane === c.lane && this.march.s - c.s > 0 && this.march.s - c.s < 40 + 12 * this.march.members.length) c.pace = Math.min(c.pace, 4);
      c.s += c.pace * dt;
    }
    this.cars = this.cars.filter(c => c.s < c.lane.len);
    // A march every 2–3 minutes along an avenue (§8.3).
    if (this.march) {
      this.march.s += this.march.speed * dt;
      if (this.march.s - 100 - this.march.members.length * 10 > this.march.lane.len) this.march = null;
    } else if (this.walkOn && (this.nextMarch -= dt) <= 0 && this.avenues.length) {
      const lane = this.avenues[Math.floor(r() * this.avenues.length)], n = 10 + Math.floor(r() * 9);
      this.march = { lane, s: 0, speed: 13, banner: BANNERS[Math.floor(r() * BANNERS.length)],
        members: [JQA.flag, JQA.flag, JQA.banner, JQA.drummer, JQA.drummer, ...Array.from({ length: n }, () => JQA.marcher)] };
      this.nextMarch = 120 + r() * 60;
    }
    // Pigeons: peck, hop, now and then fly off over the square and come back.
    for (const p of this.pigeons) {
      if (p.fly > 0) { p.fly -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z = Math.min(60, p.z + 40 * dt); if (p.fly <= 0) { p.z = 0; p.x -= p.vx * 3; p.y -= p.vy * 3; } continue; }
      if ((p.t -= dt) <= 0) { p.fr = Math.floor(r() * 3); p.t = 0.4 + r() * 1.5; if (r() < 0.04) { p.fly = 3; const a = r() * 6.28; p.vx = Math.cos(a) * 30; p.vy = Math.sin(a) * 20; } }
    }
    this.program(dt);
  }

  // ------------------------------------------------------------------ the loudspeakers' programs and the movements' times

  /** Where in its cycle a movement is: on (with its seconds in) or off. Gymnastics every 90 s for 25 s, the 忠字舞 every 120 s for 20 s (between), 腰鼓 every 150 s for 24 s. */
  private phase(period: number, len: number, offset: number): number { const t = (this.clock + offset) % period; return t < len ? t : -1; }
  private gym(): number { return this.phase(90, 25, 30); }
  private dancing(): number { return this.phase(120, 20, 0); }
  private drums(): number { return this.phase(150, 24, 95); }

  private program(dt: number) {
    const loudOk = this.loudOn && !this.covered && !this.hidden;
    if (this.gym() >= 0 && this.gym() < dt * 1.5 && loudOk && !this.loud.busy()) { this.loud.play('march', 22); this.announce(ANNOUNCEMENTS[3]); }
    if (this.dancing() >= 0 && this.dancing() < dt * 1.5 && loudOk && !this.loud.busy()) this.loud.play('dance', 18);
    if ((this.nextProgram -= dt) <= 0) {
      this.nextProgram = 60 + this.r() * 60;
      if (loudOk && !this.loud.busy()) {
        const kind: Program = 'opera';
        this.loud.play(kind, 16 + this.r() * 10);
        this.announce(ANNOUNCEMENTS[Math.floor(this.r() * ANNOUNCEMENTS.length)]);
      }
    }
    if ((this.nextAnnounce -= dt) <= 0) { this.nextAnnounce = 90 + this.r() * 60; if (this.loudOn) this.announce(ANNOUNCEMENTS[Math.floor(this.r() * ANNOUNCEMENTS.length)]); }
  }

  /** An announcement's text as a banner over the map (§9.2: no voice yet), about 6 s. */
  private announce(text: string) {
    if (typeof document === 'undefined') return;
    const stage = document.querySelector('main.game .stage');
    if (!stage) return;
    this.banner?.remove();
    const el = document.createElement('div');
    el.className = 'jq-announce';
    el.innerHTML = '<i class="jq-horn"></i><span></span>';
    // 「大喇叭」, not 「廣播站」: these are the street's loudspeakers, not the 廣播站 square's news (that one has its card).
    el.querySelector('span')!.textContent = `大喇叭：${text}`;
    stage.append(el);
    this.banner = el;
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 600); }, 6500);
  }

  // ------------------------------------------------------------------ drawing

  /** The street's drawings for the board's y-sorted list (map px → screen through the board's view). */
  collect(v: StreetView, add: AddItem) {
    const z = v.zoom, t = this.clock;
    // The nearest horn (screen distance from the view's centre): loudness, pan, dullness.
    let best = Infinity, bx = v.W / 2;
    for (const h of this.spots.horns) { const q = v.project(h.x, h.y), d = Math.hypot(q.x - v.W / 2, q.y - v.H / 2); if (d < best) { best = d; bx = q.x; } }
    const rr = Math.max(v.W, v.H) * 0.6;
    this.loud.place(1 / (1 + (best / rr) ** 2), (bx - v.W / 2) / (v.W / 2), best / (2 * rr), this.loudOn && !this.covered && !this.hidden);
    const deg = (dx: number, dy: number) => { const s = v.toScreen(dx, dy); return Math.atan2(s.y, s.x) * 180 / Math.PI; };
    const flipOf = (dx: number, dy: number) => v.toScreen(dx, dy).x < 0;
    if (this.walkOn) {
      for (const w of this.crowd.walkers) {
        const p = v.visible(w.x, w.y, 60);
        if (!p) continue;
        const h = this.crowd.facing(w), d = deg(Math.cos(h), Math.sin(h));
        if (w.kind === this.crowd.bike) { const k = nearestView(d); add(p.y, () => v.sprite(JQA.bicycle, k, p.x, p.y)); continue; }
        const f = walkerFacing(0, d), phase = w.stop > 0 ? 0 : Math.floor(w.anim) % 4;
        add(p.y, () => v.sprite(WALKER + w.kind, f.row * 4 + phase, p.x, p.y, f.flip));
      }
    }
    if (this.carsOn) {
      for (const c of this.cars) {
        if (c.s < 0) continue;
        const x = c.lane.a[0] + c.lane.dx * c.s, y = c.lane.a[1] + c.lane.dy * c.s, p = v.visible(x, y, 120);
        if (!p) continue;
        // fade in and out at the junctions (they turn off into the side streets)
        const alpha = Math.max(0, Math.min(1, c.s / 30, (c.lane.len - c.s) / 30));
        const k = nearestView(deg(c.lane.dx, c.lane.dy));
        add(p.y, () => v.sprite(c.res, k, p.x, p.y, false, alpha));
      }
    }
    if (!this.walkOn) return;
    // ---- the march: flags, the banner (its words laid on), drums, the marchers in twos
    const m = this.march;
    if (m) {
      const flip = flipOf(m.lane.dx, m.lane.dy);
      m.members.forEach((res, i) => {
        const s = m.s - (i < 5 ? i * 20 : 100 + Math.floor((i - 5) / 2) * 19);
        if (s < 0 || s > m.lane.len) return;
        const pair = i >= 5 && (i - 5) % 2 === 1 ? 12 : i >= 5 ? -12 : i === 1 ? 12 : i === 0 ? -12 : 0;
        const x = m.lane.a[0] + m.lane.dx * s - m.lane.dy * pair, y = m.lane.a[1] + m.lane.dy * s + m.lane.dx * pair, p = v.visible(x, y, 80);
        if (!p) return;
        const fr = Math.floor(t * 4 + i * 0.7) % 4, alpha = Math.max(0, Math.min(1, s / 25, (m.lane.len - s) / 25));
        add(p.y, () => {
          v.sprite(res, fr, p.x, p.y, flip, alpha);
          if (res === JQA.banner && alpha > 0.5) this.bannerText(v, m.banner, p.x, p.y - 29 * z, z);
        });
      });
    }
    // ---- groups standing in formation: the 廣播體操, the 忠字舞, the 腰鼓 (in their times), the readers, queues, children
    const S = this.spots;
    const group = (res: number, c: Spot | null, rows: number, cols: number, gap: number, fps: number, fade: number, late = -1) => {
      if (!c) return;
      for (let i = 0; i < rows * cols; i++) {
        const x = c.x + (i % cols - (cols - 1) / 2) * gap, y = c.y + (Math.floor(i / cols) - (rows - 1) / 2) * gap * 0.9, p = v.visible(x, y, 60);
        if (!p) continue;
        // One dancer is always half a beat late, and now and then faces the wrong way for a moment (§8.3).
        const lag = i === late ? 0.5 : 0, wrong = i === late && Math.floor(t / 3.3) % 4 === 1;
        const fr = Math.floor(t * fps + lag) % 4;
        add(p.y, () => v.sprite(res, fr, p.x, p.y, wrong, fade));
      }
    };
    const fadeOf = (s: number, len: number) => Math.max(0, Math.min(1, s / 1.5, (len - s) / 1.5));
    const g = this.gym();
    if (g >= 0) {
      group(JQA.gymnast, { x: S.square.x - 85, y: S.square.y - 80 }, 3, 5, 22, 2.2, fadeOf(g, 25));
      if (S.campus) group(JQA.gymnast, { x: S.campus.x, y: S.campus.y + 70 }, 2, 4, 22, 2.2, fadeOf(g, 25));
    }
    const d = this.dancing();
    if (d >= 0) {
      group(JQA.dancer, { x: S.square.x + 72, y: S.square.y + 10 }, 2, 5, 23, 3.2, fadeOf(d, 20), 7);
      if (S.dept) group(JQA.dancer, { x: S.dept.x - 40, y: S.dept.y + 90 }, 2, 4, 23, 3.2, fadeOf(d, 20), 2);
    }
    const dr = this.drums();
    if (dr >= 0 && S.qianmen) group(JQA.waistdrum, { x: S.qianmen.x + 60, y: S.qianmen.y + 70 }, 1, 6, 21, 3.5, fadeOf(dr, 24));
    for (const [wi, w] of S.walls.entries()) for (let i = 0; i < 6; i++) {
      const x = w.x + (i - 2.5) * 17, y = w.y + 38 + (i % 2) * 10, p = v.visible(x, y, 60);
      if (p) add(p.y, () => v.sprite(JQA.reader, Math.floor(t * 0.7 + i * 1.3 + wi) % 4, p.x, p.y, (i + wi) % 3 === 0));
    }
    const queue = (c: Spot, n: number, dx: number, dy: number, key: number) => {
      // a step forward now and then
      const step = (t * 0.3 + key) % 1 < 0.15 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const x = c.x + dx * i, y = c.y + dy * i, p = v.visible(x, y, 60);
        if (p) add(p.y, () => v.sprite(JQA.queuer, (i + step + Math.floor(t * 0.5)) % 4, p.x, p.y, dx < 0));
      }
    };
    if (S.dept) queue({ x: S.dept.x - 30, y: S.dept.y + 52 }, 7, -17, 5, 0);
    for (const f of this.game.board.facilities) if (f.type === 2 && f.level > 0 && f.owner) queue({ x: f.x - 28, y: f.y + 46 }, 4, -17, 5, f.id * 0.37);
    for (const [hi, h] of S.hutongs.entries()) for (let i = 0; i < 3; i++) {
      const x = h.x + 46 + i * 19, y = h.y + 40 + (i === 1 ? 6 : 0), p = v.visible(x, y, 60);
      if (p) add(p.y, () => v.sprite(JQA.skipper, Math.floor(t * 4 + i + hi) % 4, p.x, p.y, i === 2));
    }
    for (const pg of this.pigeons) {
      const p = v.visible(pg.x, pg.y, 40);
      if (!p) continue;
      const y = p.y - pg.z * z * 0.86, fr = pg.fly > 0 ? 3 : pg.fr;
      add(p.y, () => v.sprite(JQA.pigeon, fr, p.x, y, pg.vx < 0));
    }
  }

  /** The march banner's words on its cloth (CSS px at the board's zoom). */
  private bannerText(v: StreetView, text: string, x: number, y: number, z: number) {
    const ctx = v.ctx, size = Math.max(5, 4.4 * z);
    ctx.save();
    ctx.font = `800 ${size}px "Noto Serif TC", "Songti TC", "PingFang TC", serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffe58a';
    const w = Math.min(ctx.measureText(text).width, 44 * z);
    ctx.fillText(text, x, y, w);
    ctx.restore();
  }

  /** No street prop is hidden by this street. */
  covers(_x: number, _y: number): boolean { return false; }
  drawGround(_ctx: CanvasRenderingContext2D) { /* the roads are the ground's own */ }
  beginFrame() { /* no neon */ }
  glow() { /* no neon */ }

  /** The walkers' and the ambient sprites (for the loading screen; none while they are off). */
  walkerSprites(): number[] {
    const out = this.walkOn ? Array.from({ length: KINDS }, (_, i) => WALKER + i) : [];
    if (this.walkOn) out.push(JQA.bicycle, JQA.flag, JQA.banner, JQA.drummer, JQA.marcher, JQA.reader, JQA.gymnast, JQA.dancer, JQA.waistdrum, JQA.queuer, JQA.skipper, JQA.pigeon);
    if (this.carsOn) out.push(JQA.truck, JQA.jeep, JQA.sedan, JQA.tricycle, JQA.bicycle, JQA.cart, JQA.bus, JQA.trolley);
    return [...new Set(out)];
  }
}
