/**
 * 挑戰模式's picture cards (docs/rules/26 §7.2): one card per task, earned by a human on this device with the task's
 * first star in a game, and kept for good — apart from the saves, so deleting a save never loses a card. Each card
 * keeps the best stars ever earned, shown as star stickers laid over the picture. Cards not earned yet show 「？？？」
 * (the user 2026-11-02); tapping one tells the task and what it takes.
 *
 * Kept as `{task id: best stars}`: in the app a file in its data folder (written to a temporary file first, the
 * previous copy kept), in the browser and as a second copy everywhere `localStorage`.
 */
import { Capacitor } from '@capacitor/core';
import { CHALLENGE_MAPS, CHALLENGE_TASKS, fullStars, type ChallengeTask } from '../core/challenge';
import { ASSETS } from './assets';
import { audio } from './audio';
import './collection.css';

const KEY = 'rich4.cards';
const FILE = 'collection/cards.json';
const ART = `${ASSETS}/maps/remake/challenge`;
type Cards = Record<string, number>;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const merge = (a: Cards, b: Cards): Cards => { const o = { ...a }; for (const [k, v] of Object.entries(b)) if (v > (o[k] ?? 0)) o[k] = v; return o; };
const parse = (s: string | null | undefined): Cards => {
  try {
    const o = JSON.parse(s ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isInteger(v) && (v as number) > 0 && (v as number) <= 3)) as Cards;
  } catch { return {}; }
};

let cache: Cards | null = null;

async function readFile(): Promise<Cards> {
  if (!Capacitor.isNativePlatform()) return {};
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const r = await Filesystem.readFile({ path: FILE, directory: Directory.Data, encoding: Encoding.UTF8 });
    return parse(typeof r.data === 'string' ? r.data : '');
  } catch { return {}; }
}

async function writeFile(cards: Cards) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const tmp = `${FILE}.tmp`, data = JSON.stringify(cards);
    await Filesystem.writeFile({ path: tmp, data, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
    await Filesystem.deleteFile({ path: FILE, directory: Directory.Data }).catch(() => {});
    await Filesystem.rename({ from: tmp, to: FILE, directory: Directory.Data });
  } catch { /* the localStorage copy still has it */ }
}

/** Every card earned on this device: task id → best stars. */
export async function loadCards(): Promise<Cards> {
  if (cache) return cache;
  let local: Cards = {};
  try { local = parse(localStorage.getItem(KEY)); } catch { /* none */ }
  cache = merge(local, await readFile());
  return cache;
}

/** Records stars earned (only ever raises a card's stars); resolves with the tasks whose card is new. */
export async function earnCards(got: Cards): Promise<string[]> {
  const had = await loadCards();
  const fresh = Object.keys(got).filter(id => got[id] > 0 && !had[id]);
  const next = merge(had, got);
  if (Object.keys(next).every(k => next[k] === had[k])) return [];
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the file has it */ }
  await writeFile(next);
  return fresh;
}

/** The star stickers over a card. */
const stickers = (n: number) => `<span class="col-stars">${Array.from({ length: n }, (_, i) => `<img src="${ART}/star.webp" alt="" style="--i:${i}">`).join('')}</span>`;

/** One card: the picture, its name and its stars; 「？？？」 while not earned. */
export function cardHtml(t: ChallengeTask, stars: number): string {
  if (!stars) return `<button class="col-card none" data-card="${t.id}"><b>？？？</b></button>`;
  return `<button class="col-card" data-card="${t.id}"><img class="col-pic" src="${ART}/${t.id}.webp" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
    ${stickers(stars)}<span class="col-name">${esc(t.name)}</span></button>`;
}

/** What the task asks (the detail of a card). */
function howHtml(t: ChallengeTask): string {
  const how = t.once ? `可獲得 ${'★'.repeat(t.stars)}` : (t.tiers ?? []).map((x, i) => `${'★'.repeat(i + 1)} ${esc(x)}`).join('・');
  return `<p>${esc(t.desc)}</p>${how ? `<p class="col-how">${how}</p>` : ''}`;
}

/**
 * The 圖鑑 over `root`: a group at a time (通用, then each map), its cards in pages (‹ ›, no scrolling: some devices
 * don't scroll), a tap on a card for the big picture and its task. Resolves when closed.
 */
export async function openCollection(root: HTMLElement, mapName: (id: number) => string): Promise<void> {
  const cards = await loadCards();
  const groups = [{ id: -1, name: '通用' }, ...CHALLENGE_MAPS.map(id => ({ id, name: mapName(id) }))];
  const total = CHALLENGE_TASKS.length, have = CHALLENGE_TASKS.filter(t => cards[t.id]).length;
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
  const tasksOf = () => CHALLENGE_TASKS.filter(t => t.map === groups[group].id);
  const draw = () => {
    const list = tasksOf(), pages = Math.max(1, Math.ceil(list.length / perPage));
    page = Math.max(0, Math.min(pages - 1, page));
    const got = list.filter(t => cards[t.id]).length;
    overlay.querySelector('.col-group b')!.textContent = `${groups[group].name}（${got}/${list.length}）`;
    grid.innerHTML = list.slice(page * perPage, (page + 1) * perPage).map(t => cardHtml(t, cards[t.id] ?? 0)).join('');
    overlay.querySelector('.col-nav span')!.textContent = `${page + 1} / ${pages}`;
    overlay.querySelector<HTMLButtonElement>('[data-p="-1"]')!.disabled = page === 0;
    overlay.querySelector<HTMLButtonElement>('[data-p="1"]')!.disabled = page >= pages - 1;
  };
  /** As many cards per page as fit: columns by width, rows by height (cards are 3:4). */
  const fit = () => {
    const w = grid.clientWidth, h = grid.clientHeight;
    if (!w || !h) return;
    const cols = Math.max(2, Math.floor((w + 8) / 96)), cw = (w - 8 * (cols - 1)) / cols;
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
      if (d.card) showCard(overlay, CHALLENGE_TASKS.find(x => x.id === d.card)!, cards[d.card] ?? 0, mapName);
    };
    let x0: number | null = null;
    grid.addEventListener('pointerdown', e => { x0 = e.clientX; });
    grid.addEventListener('pointerup', e => { if (x0 !== null && Math.abs(e.clientX - x0) > 40) { page += e.clientX < x0 ? 1 : -1; draw(); } x0 = null; });
  });
}

/** A card big, with its task; a tap anywhere closes it. */
function showCard(over: HTMLElement, t: ChallengeTask, stars: number, mapName: (id: number) => string) {
  const box = document.createElement('div');
  box.className = 'col-detail';
  const where = t.map === -1 ? '通用任務' : `${mapName(t.map)}・本圖任務`;
  box.innerHTML = `<div class="col-big">${cardHtml(t, stars)}</div>
    <div class="col-info"><h3>${esc(t.name)}</h3><small>${esc(where)}・最多 ${'★'.repeat(fullStars(t))}</small>${howHtml(t)}
    <p class="col-best">${stars ? `你的最好成績：${'★'.repeat(stars)}` : '還沒拿到：在挑戰模式完成這個任務就能得到這張卡'}</p></div>`;
  box.onclick = e => { e.stopPropagation(); audio.ui('no'); box.remove(); };
  over.append(box);
}
