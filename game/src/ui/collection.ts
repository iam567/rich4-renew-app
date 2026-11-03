/**
 * 挑戰模式's picture cards (docs/rules/26 §7.2): one card per task, earned by a human on this device with the task's
 * first star in a game, and kept for good — apart from the saves, so deleting a save never loses a card. Each card
 * keeps the best stars ever earned, shown as star stickers laid over the picture. Cards not earned yet show 「？？？」
 * (the user 2026-11-02); tapping one tells the task and what it takes.
 *
 * The proof (the user 2026-11-02, so a card unlocked by cheating stands out): every card shows the day it was first
 * earned and, for its best stars, the day they were reached (real and in the game, the map, who) with a picture of the
 * map at that moment; a better result replaces the proof.
 *
 * Kept as `{task id: Card}`: in the app a file in its data folder (written to a temporary file first), in the browser
 * and as a second copy everywhere `localStorage`; the pictures as files `collection/proof-<id>.webp` in the app,
 * IndexedDB in the browser.
 */
import { Capacitor } from '@capacitor/core';
import { CHALLENGE_MAPS, CHALLENGE_TASKS, fullStars, type ChallengeTask } from '../core/challenge';
import { format } from '../core/date';
import { MONTHLY_RULE, MONTHLY_TASKS, monthlyDesc, type MonthlyTask } from '../core/monthly';
import { ASSETS } from './assets';
import { audio, Sfx } from './audio';
import { saveImage, shareImage } from './share';
import './collection.css';
import { uiFont } from './fonts';

const KEY = 'rich4.cards';
const FILE = 'collection/cards.json';
const ART = `${ASSETS}/maps/remake/challenge`;
/** When a card's best stars were reached: real time (ms), the game's date (packed), map id, the player's name. */
export interface Proof { real: number; game: number; map: number; who: string }
export interface Card { s: number; first?: number; proof?: Proof }
type Cards = Record<string, Card>;
/** What a game reports: stars of a task, the proof and its picture (a data URL). */
export interface Earned { id: string; stars: number; proof: Proof; shot?: string | null }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const merge = (a: Cards, b: Cards): Cards => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const w = o[k];
    const proof = v.s > (w?.s ?? 0) ? v.proof ?? w?.proof : w?.proof ?? v.proof;
    o[k] = { s: Math.max(w?.s ?? 0, v.s), ...(w?.first || v.first ? { first: Math.min(w?.first ?? Infinity, v.first ?? Infinity) } : {}), ...(proof ? { proof } : {}) };
  }
  return o;
};
const parse = (s: string | null | undefined): Cards => {
  try {
    const o = JSON.parse(s ?? '{}') as Record<string, unknown>, out: Cards = {};
    for (const [k, v] of Object.entries(o)) {
      const c = typeof v === 'number' ? { s: v } : v as Card;   // the first builds kept only the stars
      if (c && Number.isInteger(c.s) && c.s > 0 && c.s <= 3) out[k] = c;
    }
    return out;
  } catch { return {}; }
};

const FONT = () => `${uiFont()}, "PingFang SC", "PingFang TC", "Hiragino Sans CNS", "Noto Sans TC", sans-serif`;
const image = (src: string) => new Promise<HTMLImageElement | null>(ok => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = src; });

let cache: Cards | null = null;

const fsMod = () => import('@capacitor/filesystem');

async function readFile(): Promise<Cards> {
  if (!Capacitor.isNativePlatform()) return {};
  try {
    const { Filesystem, Directory, Encoding } = await fsMod();
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    return parse(typeof r.data === 'string' ? r.data : '');
  } catch { return {}; }
}

async function writeFile(cards: Cards) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Filesystem, Directory, Encoding } = await fsMod();
    const tmp = `${FILE}.tmp`, data = JSON.stringify(cards);
    await Filesystem.writeFile({ path: tmp, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => {});
    await Filesystem.rename({ from: tmp, to: FILE, directory: Directory.Data });
  } catch { /* the localStorage copy still has it */ }
}

/** The browser's store of proof pictures (IndexedDB `rich4-cards`). */
function proofDb(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open('rich4-cards', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('proof');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function saveShot(id: string, dataUrl: string) {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await fsMod();
      await Filesystem.writeFile({ path: `collection/proof-${id}.webp`, data: dataUrl.slice(dataUrl.indexOf(',') + 1), directory: Directory.Data, recursive: true });
      return;
    }
    const db = await proofDb();
    await new Promise<void>((ok, fail) => { const t = db.transaction('proof', 'readwrite'); t.objectStore('proof').put(dataUrl, id); t.oncomplete = () => ok(); t.onerror = () => fail(t.error); });
  } catch { /* the card keeps its dates without the picture */ }
}

/** The proof picture of a card (a data URL), if there is one. */
export async function loadShot(id: string): Promise<string | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { Filesystem, Directory } = await fsMod();
      const r = await Filesystem.readFile({ path: `collection/proof-${id}.webp`, directory: Directory.Data });
      return typeof r.data === 'string' ? `data:image/webp;base64,${r.data}` : null;
    }
    const db = await proofDb();
    return await new Promise<string | null>(ok => { const q = db.transaction('proof').objectStore('proof').get(id); q.onsuccess = () => ok((q.result as string) ?? null); q.onerror = () => ok(null); });
  } catch { return null; }
}

/** Every card earned on this device. */
export async function loadCards(): Promise<Cards> {
  if (cache) return cache;
  let local: Cards = {};
  try { local = parse(localStorage.getItem(KEY)); } catch { /* none */ }
  cache = merge(local, await readFile());
  return cache;
}

/** The stars this device has on a card (0: not earned); a game takes a proof picture only for more. */
export async function cardStars(id: string): Promise<number> { return (await loadCards())[id]?.s ?? 0; }

/**
 * Records stars earned: a card's stars only ever rise, its first day stays, a better result brings its proof and
 * picture. Resolves with the better results (the stars the card had before: 0 for a new card).
 */
export async function earnCards(got: Earned[]): Promise<{ id: string; stars: number; before: number }[]> {
  const had = await loadCards(), now = Date.now();
  const better = got.filter(x => x.stars > (had[x.id]?.s ?? 0));
  if (!better.length) return [];
  const add: Cards = {};
  for (const x of better) add[x.id] = { s: x.stars, first: now, proof: x.proof };
  const next = merge(had, add);
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the file has it */ }
  await writeFile(next);
  for (const x of better) if (x.shot) await saveShot(x.id, x.shot);
  return better.map(x => ({ id: x.id, stars: x.stars, before: had[x.id]?.s ?? 0 }));
}

/**
 * The achievement scene (the user 2026-11-02: in any mode, an achievement plays its own short scene and goes into the
 * 圖鑑): the card turns over (a new one) or stays (a better result), its new stars land one by one, 「解鎖成就」 and the
 * task. Ends on a tap or after a while.
 */
export function achievementScene(root: HTMLElement, t: ChallengeTask, stars: number, before: number, who: string): Promise<void> {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = `ach${before ? ' up' : ''}`;
    el.innerHTML = `<div class="ach-rays"></div><div class="ach-box"><p class="ach-title">${before ? '成就升級！' : '解鎖成就！'}</p>
      <div class="ach-card"><div class="ach-back">${cardHtml(t, 0)}</div><div class="ach-front">${cardHtml(t, 0, true)}</div></div>
      <p class="ach-name">${esc(t.name)}</p><p class="ach-who">${esc(who)}・${before ? `${'★'.repeat(before)} → ` : ''}${'★'.repeat(stars)}</p>
      <p class="ach-tap">${before ? '' : '已收進圖鑑・'}點一下繼續</p></div>`;
    root.append(el);
    audio.sfx(Sfx.special);
    // The stars land one by one on the card's front, after the turn (a better result: the old ones are there already).
    const front = el.querySelector<HTMLElement>('.ach-front .col-card')!;
    const row = document.createElement('span');
    row.className = 'col-stars';
    front.append(row);
    const land = (i: number) => {
      const img = document.createElement('img');
      img.src = `${ART}/star.webp`; img.alt = ''; img.style.setProperty('--i', String(i));
      if (i >= before) { img.className = 'ach-star'; audio.sfx(Sfx.points); }
      row.append(img);
    };
    for (let i = 0; i < before; i++) land(i);
    const timers = [...Array(stars - before)].map((_, k) => window.setTimeout(() => land(before + k), (before ? 400 : 900) + k * 380));
    let done = false;
    const close = () => { if (done) return; done = true; timers.forEach(clearTimeout); clearTimeout(auto); el.classList.add('out'); setTimeout(() => { el.remove(); resolve(); }, 250); };
    const auto = window.setTimeout(close, 4200 + stars * 380);
    el.onclick = () => { audio.ui('click'); close(); };
  });
}

/** The player's state shown under a proof picture: tool pictures with counts, card pictures, the last dice, money, god. */
export interface Evidence { tools: { src: string; n: number }[]; cards: string[]; dice?: number[]; money: string; god?: string }

/**
 * The proof picture: the map at the moment (the board's canvas, taken at once), a strip naming who did what, where
 * and when, and the player's state under it (the tools, the cards, the last dice …), so the picture shows what the
 * achievement was about. Null when the canvas can't be read.
 */
export async function proofShot(board: HTMLCanvasElement, line: string, ev: Evidence): Promise<string | null> {
  try {
    const w = Math.min(640, board.width), h = Math.round(board.height * w / board.width);
    const map = document.createElement('canvas');
    map.width = w; map.height = h;
    map.getContext('2d')!.drawImage(board, 0, 0, w, h); // now, before anything below waits
    const [tools, cards] = await Promise.all([Promise.all(ev.tools.map(t => image(t.src))), Promise.all(ev.cards.map(image))]);
    const rowH = 54, rows = 2 + (ev.dice?.length ? 1 : 0) + (ev.god ? 0 : 0), strip = 40, pad = 10;
    const c = document.createElement('canvas');
    c.width = w; c.height = h + strip + pad * 2 + rows * rowH + 34;
    const x = c.getContext('2d')!;
    x.drawImage(map, 0, 0);
    x.fillStyle = '#1c1240'; x.fillRect(0, h, w, c.height - h);
    x.textBaseline = 'middle';
    x.fillStyle = '#ffe27a'; x.font = `bold 18px ${FONT()}`; x.fillText(line, 12, h + strip / 2, w - 24);
    let y = h + strip + pad;
    const label = (s: string) => { x.fillStyle = '#9fb0e8'; x.font = `bold 15px ${FONT()}`; x.fillText(s, 12, y + rowH / 2); };
    label('道具');
    let left = 62;
    tools.forEach((im, i) => {
      if (!im || left > w - 50) return;
      x.drawImage(im, left, y + 5, 44, 44);
      const n = ev.tools[i].n;
      if (n > 1) { x.fillStyle = '#ff5a5a'; x.beginPath(); x.arc(left + 40, y + 12, 10, 0, Math.PI * 2); x.fill(); x.fillStyle = '#fff'; x.font = `bold 13px ${FONT()}`; x.textAlign = 'center'; x.fillText(String(n), left + 40, y + 12); x.textAlign = 'left'; }
      left += 50;
    });
    if (!tools.some(Boolean)) { x.fillStyle = '#6c78a8'; x.font = `15px ${FONT()}`; x.fillText('（沒有道具）', 62, y + rowH / 2); }
    y += rowH;
    label('卡片');
    left = 62;
    for (const im of cards) { if (!im || left > w - 34) break; x.drawImage(im, left, y + 3, 31, 48); left += 35; }
    if (!cards.some(Boolean)) { x.fillStyle = '#6c78a8'; x.font = `15px ${FONT()}`; x.fillText('（沒有卡片）', 62, y + rowH / 2); }
    y += rowH;
    if (ev.dice?.length) {
      label('骰子');
      ev.dice.forEach((v, i) => drawDie(x, 62 + i * 52, y + 5, 44, v));
      y += rowH;
    }
    x.fillStyle = '#e8ecff'; x.font = `15px ${FONT()}`;
    x.fillText(`${ev.money}${ev.god ? `・附身：${ev.god}` : ''}`, 12, y + 15, w - 24);
    return c.toDataURL('image/webp', 0.8);
  } catch { return null; }
}

/** One die face (white with black pips; the 1 red, as dice are drawn in the game). */
function drawDie(x: CanvasRenderingContext2D, left: number, top: number, s: number, v: number) {
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(left, top, s, s, 8); x.fill();
  const P: Record<number, [number, number][]> = { 1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]], 4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
    5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]], 6: [[.27, .22], [.73, .22], [.27, .5], [.73, .5], [.27, .78], [.73, .78]] };
  x.fillStyle = v === 1 ? '#d22' : '#111';
  for (const [a, b] of P[v] ?? []) { x.beginPath(); x.arc(left + a * s, top + b * s, s * (v === 1 ? .13 : .09), 0, Math.PI * 2); x.fill(); }
}

/** The star stickers over a card. */
const stickers = (n: number) => `<span class="col-stars">${Array.from({ length: n }, (_, i) => `<img src="${ART}/star.webp" alt="" style="--i:${i}">`).join('')}</span>`;

/** One card: the picture, its name and its stars; 「？？？」 while not earned (`shown`: the picture anyway). */
export function cardHtml(t: ChallengeTask, stars: number, shown = stars > 0): string {
  if (!shown) return `<button class="col-card none" data-card="${t.id}"><b>？？？</b></button>`;
  return `<button class="col-card" data-card="${t.id}"><img class="col-pic" src="${ART}/${t.id}.webp" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    ${stickers(stars)}<span class="col-name">${esc(t.name)}</span></button>`;
}

/** What the task asks (the detail of a card). */
/** Every card: the tasks', then the 每月任務 (docs/rules/27, group −2). */
const ALL: ChallengeTask[] = [...CHALLENGE_TASKS, ...MONTHLY_TASKS];
/** Where a task belongs (通用 / 每月 / a map's). */
const whereOf = (t: ChallengeTask, mapName: (id: number) => string) => (t.map === -1 ? '通用任務' : t.map === -2 ? '每月任務' : `${mapName(t.map)}・本圖任務`);
/** What a task asks: a 每月任務's goal at price index 1. */
const descOf = (t: ChallengeTask) => (t.map === -2 ? monthlyDesc(t as MonthlyTask, (t as MonthlyTask).goal) : t.desc);

function howHtml(t: ChallengeTask): string {
  if (t.map === -2) return `<p>${esc(descOf(t))}</p><p class="col-how">${esc(MONTHLY_RULE[(t as MonthlyTask).kind])}</p>`;
  const how = t.once ? `可獲得 ${'★'.repeat(t.stars)}` : (t.tiers ?? []).map((x, i) => `${'★'.repeat(i + 1)} ${esc(x)}`).join('・');
  return `<p>${esc(t.desc)}</p>${how ? `<p class="col-how">${how}</p>` : ''}`;
}

/**
 * The 圖鑑 over `root`: a group at a time (通用, then each map), its cards in pages (‹ ›, no scrolling: some devices
 * don't scroll), a tap on a card for the big picture and its task. Resolves when closed.
 */
export async function openCollection(root: HTMLElement, mapName: (id: number) => string): Promise<void> {
  const cards = await loadCards();
  const groups = [{ id: -1, name: '通用' }, { id: -2, name: '每月任務' }, ...CHALLENGE_MAPS.map(id => ({ id, name: mapName(id) }))];
  const total = ALL.length, have = ALL.filter(t => cards[t.id]).length;
  const starsOf = (id: string) => cards[id]?.s ?? 0;
  let group = 0, page = 0, perPage = 8;
  const overlay = document.createElement('div');
  overlay.className = 'col-overlay';
  overlay.innerHTML = `<div class="msg sheet col-sheet"><div class="ribbon">圖鑑</div>
    <p class="col-count">已收集 ${have} / ${total} 張</p>
    <div class="col-group"><button class="chip" data-g="-1">‹</button><b></b><button class="chip" data-g="1">›</button></div>
    <div class="col-grid"></div>
    <div class="col-nav"><button class="chip" data-p="-1">‹</button><span></span><button class="chip" data-p="1">›</button></div>
    <div class="choices"><button class="candy ghost" data-close="1">關閉</button></div></div>`;
  root.append(overlay);
  const grid = overlay.querySelector<HTMLElement>('.col-grid')!;
  const tasksOf = () => ALL.filter(t => t.map === groups[group].id);
  const draw = () => {
    const list = tasksOf(), pages = Math.max(1, Math.ceil(list.length / perPage));
    page = Math.max(0, Math.min(pages - 1, page));
    const got = list.filter(t => cards[t.id]).length;
    overlay.querySelector('.col-group b')!.textContent = `${groups[group].name}（${got}/${list.length}）`;
    grid.innerHTML = list.slice(page * perPage, (page + 1) * perPage).map(t => cardHtml(t, starsOf(t.id))).join('');
    overlay.querySelector('.col-nav span')!.textContent = `${page + 1} / ${pages}`;
    overlay.querySelector<HTMLButtonElement>('[data-p="-1"]')!.disabled = page === 0;
    overlay.querySelector<HTMLButtonElement>('[data-p="1"]')!.disabled = page >= pages - 1;
  };
  /** As many cards per page as fit: columns by width, rows by height (cards are 3:4). */
  const fit = () => {
    const w = grid.clientWidth, h = grid.clientHeight;
    if (!w || !h) return;
    // A short landscape screen: smaller cards, more to a row (one row is all the height there holds).
    const min = innerWidth > innerHeight && innerHeight < 560 ? 80 : 96;
    let cols = Math.max(2, Math.floor((w + 8) / min)), cw = (w - 8 * (cols - 1)) / cols;
    // not even one row of that size fits (an iPhone SE on its side): narrower cards until a whole row does
    while (cw * 4 / 3 > h && cols < 14) { cols++; cw = (w - 8 * (cols - 1)) / cols; }
    const rows = Math.max(1, Math.floor((h + 8) / (cw * 4 / 3 + 8)));
    grid.style.setProperty('--cols', String(cols));
    if (cols * rows !== perPage) { const first = page * perPage; perPage = cols * rows; page = Math.floor(first / perPage); }
    draw();
  };
  const ro = new ResizeObserver(fit);
  ro.observe(grid);
  draw();
  return new Promise(resolve => {
    overlay.onclick = e => {
      const t = e.target as HTMLElement, d = t.closest<HTMLElement>('[data-g],[data-p],[data-close],[data-card]')?.dataset;
      if (!d) { if (t === overlay) { audio.ui('no'); ro.disconnect(); overlay.remove(); resolve(); } return; }
      if (d.close) { audio.ui('no'); ro.disconnect(); overlay.remove(); resolve(); return; }
      audio.ui('click');
      if (d.g) { group = (group + Number(d.g) + groups.length) % groups.length; page = 0; draw(); }
      if (d.p) { page += Number(d.p); draw(); }
      if (d.card) showCard(overlay, ALL.find(x => x.id === d.card)!, cards[d.card], mapName, have);
    };
    let x0: number | null = null;
    grid.addEventListener('pointerdown', e => { x0 = e.clientX; });
    grid.addEventListener('pointerup', e => { if (x0 !== null && Math.abs(e.clientX - x0) > 40) { page += e.clientX < x0 ? 1 : -1; draw(); } x0 = null; });
  });
}

const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };

/** Wraps `text` into lines no wider than `w` (Chinese breaks anywhere). */
function wrap(x: CanvasRenderingContext2D, text: string, w: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of text) { if (x.measureText(line + ch).width > w && line) { out.push(line); line = ch; } else line += ch; }
  if (line) out.push(line);
  return out;
}

/**
 * The brag card (the user 2026-11-02: 「做一個炫耀用的」, to save to the photos or share): one portrait picture with the
 * card and its stars, the task, the day it was reached, who and where, and the proof picture.
 */
async function bragCanvas(t: ChallengeTask, card: Card, mapName: (id: number) => string, have: number): Promise<HTMLCanvasElement> {
  const W = 1080, H = 1720, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d')!;
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#2b3f9e'); bg.addColorStop(.55, '#1a2466'); bg.addColorStop(1, '#120f3a');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  // Rays behind the card.
  x.save(); x.translate(W / 2, 560); x.fillStyle = 'rgba(255, 214, 90, .10)';
  for (let i = 0; i < 18; i++) { x.rotate(Math.PI / 9); x.beginPath(); x.moveTo(0, 0); x.lineTo(-90, -1100); x.lineTo(90, -1100); x.closePath(); x.fill(); }
  x.restore();
  const text = (s: string, px: number, y: number, color: string, weight = 700, align: CanvasTextAlign = 'center', left = W / 2) => {
    x.font = `${weight} ${px}px ${FONT()}`; x.fillStyle = color; x.textAlign = align; x.fillText(s, left, y);
  };
  text('大富翁4・成就卡', 44, 92, '#ffe27a', 800);
  // The card: the picture in a white frame, its stars, its name.
  const cw = 560, ch = 747, cx = (W - cw) / 2, cy = 140;
  x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 40; x.shadowOffsetY = 16;
  x.fillStyle = '#fff'; x.beginPath(); x.roundRect(cx - 14, cy - 14, cw + 28, ch + 28, 34); x.fill(); x.restore();
  const pic = await image(`${ART}/${t.id}.webp`);
  x.save(); x.beginPath(); x.roundRect(cx, cy, cw, ch, 24); x.clip();
  if (pic) x.drawImage(pic, cx, cy, cw, ch); else { x.fillStyle = '#34407a'; x.fillRect(cx, cy, cw, ch); }
  const band = x.createLinearGradient(0, cy + ch - 150, 0, cy + ch);
  band.addColorStop(0, 'rgba(20,10,40,0)'); band.addColorStop(1, 'rgba(20,10,40,.88)');
  x.fillStyle = band; x.fillRect(cx, cy + ch - 150, cw, 150);
  x.restore();
  x.save(); x.font = `800 54px ${FONT()}`; x.textAlign = 'center'; x.lineWidth = 8; x.strokeStyle = '#3a1450'; x.strokeText(t.name, W / 2, cy + ch - 34);
  x.fillStyle = '#fff'; x.fillText(t.name, W / 2, cy + ch - 34); x.restore();
  const star = await image(`${ART}/star.webp`);
  if (star) for (let i = 0; i < card.s; i++) {
    x.save(); x.translate(cx + 70 + i * 104, cy + 70 + (i === 1 ? 14 : 0)); x.rotate((i - 1) * .17);
    x.drawImage(star, -68, -68, 136, 136); x.restore();
  }
  // The task and the record.
  let y = cy + ch + 96;
  text(`${whereOf(t, mapName)}　${'★'.repeat(card.s)} / ${'★'.repeat(fullStars(t))}`, 34, y, '#ffd76a');
  x.font = `500 32px ${FONT()}`;
  for (const l of wrap(x, descOf(t), W - 160).slice(0, 3)) { y += 50; text(l, 32, y, '#e8ecff', 500); }
  const f = card.proof;
  y += 74;
  text(f ? `${dayOf(f.real)} 達成` : card.first ? `${dayOf(card.first)} 第一次拿到` : '', 46, y, '#ffffff', 800);
  if (f) { y += 52; text(`${f.who}・${mapName(f.map)}・遊戲裡 ${format(f.game)}`, 30, y, '#bfd2ff', 500); }
  // The proof picture.
  const shot = f ? await loadShot(t.id).then(src => (src ? image(src) : null)) : null;
  y += 40;
  if (shot) {
    // The whole picture (its strip of words included), as large as fits.
    const k = Math.min((W - 200) / shot.width, (H - y - 110) / shot.height), sw = Math.round(shot.width * k), sh = Math.round(shot.height * k), sx = (W - sw) / 2;
    x.save(); x.fillStyle = '#fff'; x.beginPath(); x.roundRect(sx - 8, y - 8, sw + 16, sh + 16, 22); x.fill();
    x.beginPath(); x.roundRect(sx, y, sw, sh, 16); x.clip(); x.drawImage(shot, sx, y, sw, sh); x.restore();
  }
  text(`圖鑑收集 ${have} / ${ALL.length}`, 30, H - 48, 'rgba(255,255,255,.6)', 500);
  return c;
}

/** A card big: a card not earned tells its task; an earned one is its brag card, to save or share. */
function showCard(over: HTMLElement, t: ChallengeTask, card: Card | undefined, mapName: (id: number) => string, have: number) {
  const box = document.createElement('div');
  box.className = 'col-detail';
  const where = whereOf(t, mapName);
  const close = () => { audio.ui('no'); box.remove(); };
  if (!card?.s) {
    box.innerHTML = `<div class="col-big">${cardHtml(t, 0)}</div>
      <div class="col-info"><h3>${esc(t.name)}</h3><small>${esc(where)}・最多 ${'★'.repeat(fullStars(t))}</small>${howHtml(t)}
      <p class="col-best">還沒拿到：完成這個任務就能得到這張卡</p></div>`;
    box.onclick = e => { e.stopPropagation(); close(); };
    over.append(box);
    return;
  }
  box.classList.add('brag');
  box.innerHTML = `<div class="col-poster"><p>製作中…</p></div>
    <div class="choices col-share"><button class="candy opt" data-s="save" disabled>保存到相冊</button><button class="candy opt" data-s="share" disabled>分享</button><button class="candy ghost" data-s="close">關閉</button></div>`;
  over.append(box);
  let canvas: HTMLCanvasElement | null = null;
  void bragCanvas(t, card, mapName, have).then(cv => {
    canvas = cv;
    const im = new Image();
    im.src = cv.toDataURL('image/jpeg', .9);
    im.alt = t.name;
    box.querySelector('.col-poster')!.replaceChildren(im);
    box.querySelectorAll<HTMLButtonElement>('[data-s]').forEach(b => { b.disabled = false; });
  });
  box.onclick = async e => {
    e.stopPropagation();
    const s = (e.target as HTMLElement).closest<HTMLElement>('[data-s]')?.dataset.s;
    if (s === 'close' || e.target === box) { close(); return; }
    if (!canvas || !s) return;
    audio.ui('click');
    const name = `rich4-${t.id}`;
    try {
      if (s === 'save') { await saveImage(canvas, name); flash(box, '已保存到相冊'); }
      if (s === 'share') { const r = await shareImage(canvas, name, `我在《大富翁4》達成成就「${t.name}」${'★'.repeat(card.s)}！`); if (r === 'downloaded') flash(box, '已下載圖片'); }
    } catch { flash(box, '沒有成功，請再試一次'); }
  };
}

/** A short word over the brag card. */
function flash(box: HTMLElement, text: string) {
  const n = document.createElement('div');
  n.className = 'col-flash';
  n.textContent = text;
  box.append(n);
  setTimeout(() => n.remove(), 1600);
}
