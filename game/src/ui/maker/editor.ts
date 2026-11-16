/**
 * 自建地圖 (the user 2026-11-11/12): the in-game map editor. Its look follows the game's own UI and the agreed mockup
 * (docs/prototypes/maker-ui.html): the gold bar on top (選單 撤銷 重做 | name | 檢查 試玩), the drawing tools (a column
 * on the left in landscape, a row in portrait), the materials (the right panel / a row), the map in the middle with the
 * tool's options floating over it. Works in portrait and landscape.
 *
 * This first part paints the ground layer: 畫筆 (sizes), 直線, 方塊 (filled / hollow), 圈地 (four edges), 油漆桶, 橡皮擦, 吸管, 移動; two
 * fingers (or the wheel) zoom and move; 撤銷 / 重做; the map saves itself. The other layers (roads,
 * squares and lots, buildings), 檢查 and 試玩 follow.
 */
import { uiAlert, uiConfirm, uiPrompt } from '../dialog';
import { audio } from '../audio';
import { ASSETS } from '../assets';
import { GroundGL } from './ground-gl';
import type { GameSettings } from '../../core/types';
import { problemList, type Problem } from './check';
import { autoFix, joinEnds as joinRoadEnds } from './fix';
import { randomize, THEMES } from './random';
import { rulesSheet } from './rules';
import { BUILDING_KINDS, DECOR_KINDS, piecesOf, type PieceKind } from './pieces';
import { deckSheet } from './deck';
import { companySlots, stockNames, stockSheet } from './stocks';
import { EDGES, lassoCells, type Edge, type Pt } from './lasso';
import { makeThumbs, playMap } from './compile';
import { covers, drawCompanies, drawLots, drawRoads, drawSquares, drawSteps, drawThings, lotGeom, styleIcon, lotNudge, thingAt } from './layers';
import { dropThumb, fromSample, notOwn, loadThumb, mapStatus, mapStatusTag, NAME_MAX } from './model';
import { CELL, COMPANY_KINDS, companyKind, STYLE_NAMES, DEFAULT_LIGHT, DEFAULT_TEX, DEFAULT_WOOD, deleteMap, parseMap, EVENTS, evInfo, G, GROUNDS, LAND_PRICES, cleared, lastMap, listMaps, loadMap, newMap, PLOT_PRICES, ROAD_STYLES, saveMap, setLastMap, SIZE_MAX, SIZE_MIN, type MakerMap, type MkLight, type MkLot, type MkNode, type MkTex, type MkWood } from './model';
import { browse, CONTACT_KINDS, fetchLib, giveFlower, libraryBase, played, publish, take, type LibAbout, type LibEntry, type LibSort } from './library';
import { addPartyLib, inParty, PARTY_LIB_MAX, PARTY_LIB_ON, partyLibs, removePartyLib } from './party-lib';
import { Woods } from './woods';
import './maker.css';
import { fitToScreen } from '../saves';

const TEX = `${ASSETS}/maps/remake/maker`;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---------------------------------------------------------------- the start sheet and the new map

/** 自建地圖's first sheet: a new map, the maps on this phone, the sample map. */
/** Straight into the editor on map `id` (back from 試玩); the start page when it is gone. */
/**
 * Issue #104 (a phone in landscape, 424 px high: the 自建地圖 sheet's 返回 and the 選單's 存檔並離開 below the screen, no
 * way out): every sheet of the maker, as it appears, is scaled down to fit the screen (saves.ts fitToScreen).
 */
let fitting = false;
function fitSheets() {
  if (fitting || typeof MutationObserver === 'undefined') return;
  fitting = true;
  new MutationObserver(recs => {
    for (const r of recs) for (const n of r.addedNodes) {
      if (!(n instanceof HTMLElement) || !n.classList.contains('mk-ov')) continue;
      const box = n.querySelector<HTMLElement>(':scope > .msg');
      if (box) fitToScreen(n, box);
    }
  }).observe(document.body, { childList: true, subtree: true });
}

export function openMakerMap(app: HTMLElement, id: string, back: () => void, play: (s: GameSettings) => void) {
  fitSheets();
  const m = loadMap(id);
  if (m) openEditor(app, m, back, play); else openMaker(app, back, play);
}

export function openMaker(app: HTMLElement, back: () => void, play: (s: GameSettings) => void) {
  fitSheets();
  const maps = listMaps(), resume = maps.find(e => e.id === lastMap());
  const ov = document.createElement('div');
  ov.className = 'slots-overlay mk-ov';
  ov.innerHTML = `<div class="msg sheet mk-home"><div class="ribbon">自建地圖</div>
    <div class="choices mk-home-acts">
      ${resume ? `<button class="candy yes" data-open="${resume.id}">繼續上次的地圖：${esc(resume.name)}</button>` : ''}
      <button class="candy${resume ? '' : ' yes'}" data-a="new">新建地圖</button>
      <button class="candy" data-a="sample">示例地圖：梨園萊陽</button>
      <button class="candy mk-lib-btn" data-a="lib">創作樂園</button>
    </div>
    <div class="mk-mine"></div>
    <div class="choices"><button class="candy ghost" data-a="back">返回</button></div></div>`;
  app.append(ov);
  // 我的地圖, a page at a time (the user 2026-11-13: many maps) — ‹ › and the page's number
  let page = 0;
  const per = () => (innerHeight < 560 ? 2 : innerHeight < 760 ? 3 : 4);
  const drawMine = () => {
    const box = ov.querySelector<HTMLElement>('.mk-mine')!;
    if (!maps.length) { box.innerHTML = '<p class="mk-none">還沒有自己的地圖，按「新建地圖」開始吧</p>'; return; }
    const n = per(), pages = Math.ceil(maps.length / n);
    page = Math.max(0, Math.min(page, pages - 1));
    box.innerHTML = `<div class="mk-mine-head"><h4>我的地圖 ${maps.length}</h4>${pages > 1 ? `<div class="mk-pager"><button data-pg="-1"${page ? '' : ' disabled'} aria-label="上一頁">‹</button><span>${page + 1} / ${pages}</span><button data-pg="1"${page < pages - 1 ? '' : ' disabled'} aria-label="下一頁">›</button></div>` : ''}</div>
      ${maps.slice(page * n, page * n + n).map(m => `<div class="mk-map"><button class="candy ghost mk-map-row" data-open="${m.id}">${(t => (t ? `<img class="mk-map-pic" src="${t}" alt="">` : '<i class="mk-map-pic"></i>'))(loadThumb(m.id))}<span class="mk-map-top"><b>${esc(m.name)}</b>${mapStatusTag(m)}</span><small>${m.by ? `${esc(m.by)} 做的・` : ''}${m.w} × ${m.h}・${new Date(m.changed).toLocaleDateString()}</small></button><button class="mk-del" data-del="${m.id}" aria-label="刪除">✕</button></div>`).join('')}`;
  };
  drawMine();
  // the maps with no picture yet get one, drawn in turn
  void makeThumbs(maps.map(x => x.id), () => { if (ov.isConnected) drawMine(); });
  ov.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.pg) { if (!(t as HTMLButtonElement).disabled) { page += Number(t.dataset.pg); audio.ui('click'); drawMine(); } return; }
    if (t.dataset.a === 'back') { audio.ui('no'); ov.remove(); back(); return; }
    if (t.dataset.a === 'sample') {
      // 萊陽 (editor/maker_laiyang.py): a copy of it among the player's maps, so the sample itself never changes
      audio.ui('click');
      void fetch(`${TEX}/sample-laiyang.json`).then(r => r.json()).then(raw => {
        const m = parseMap(raw);
        if (!m) throw new Error('sample');
        m.id = newMap('', 1, 1, 0).id; m.created = m.changed = Date.now();
        saveMap(m); ov.remove(); openEditor(app, m, back, play);
      }).catch(() => { audio.ui('error'); void uiAlert('示例地圖載入失敗'); });
      return;
    }
    if (t.dataset.a === 'new') { audio.ui('click'); ov.remove(); newMapSheet(app, back, play); return; }
    if (t.dataset.a === 'lib') { audio.ui('click'); ov.remove(); librarySheet(app, back, play); return; }
    if (t.dataset.open) { const m = loadMap(t.dataset.open); if (m) { audio.ui('yes'); ov.remove(); openEditor(app, m, back, play); } else audio.ui('error'); return; }
    if (t.dataset.del) {
      const name = maps.find(m => m.id === t.dataset.del)?.name ?? '';
      const id = t.dataset.del;
      void uiConfirm(`刪除「${name}」？刪除後無法復原。`, '刪除').then(ok => { if (!ok) return; deleteMap(id); audio.ui('no'); ov.remove(); openMaker(app, back, play); });
    }
  });
}

/** 地圖庫: the maps others sent, newest first, a search; 下載 puts one into 我的地圖 and opens it. */
const LIB_ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  flower: '<svg viewBox="0 0 24 24"><g fill="currentColor"><circle cx="12" cy="6.5" r="3.6"/><circle cx="17.2" cy="10.3" r="3.6"/><circle cx="15.2" cy="16.4" r="3.6"/><circle cx="8.8" cy="16.4" r="3.6"/><circle cx="6.8" cy="10.3" r="3.6"/></g><circle cx="12" cy="12" r="2.8" fill="#ffe27a"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cards: '<svg viewBox="0 0 24 24"><g fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></g></svg>',
  list: '<svg viewBox="0 0 24 24"><g fill="currentColor"><rect x="3" y="4" width="5" height="5" rx="1.5"/><rect x="3" y="15" width="5" height="5" rx="1.5"/><rect x="10" y="5.5" width="11" height="2.4" rx="1.2"/><rect x="10" y="16.5" width="11" height="2.4" rx="1.2"/></g></svg>',
};
/**
 * 直接玩 (the user 2026-11-16: 「必須要下載到我的地圖裡才能玩嗎？」): a library map straight to the new-game sheet
 * (ui/main.ts sets this), the map not kept in 我的地圖.
 */
let playLib: ((m: MakerMap, thumb: string) => void) | null = null;
export const onPlayLib = (f: (m: MakerMap, thumb: string) => void) => { playLib = f; };
/** Flowers this phone gave (one a map). */
const gaveFlower = (id: string) => { try { return (JSON.parse(localStorage.getItem('rich4.maker.flowers') ?? '[]') as string[]).includes(id); } catch { return false; } };
const keepFlower = (id: string) => { try { const l = JSON.parse(localStorage.getItem('rich4.maker.flowers') ?? '[]') as string[]; l.push(id); localStorage.setItem('rich4.maker.flowers', JSON.stringify(l.slice(-2000))); } catch { /* not kept */ } };

/**
 * 地圖庫 (the user 2026-11-12: make the hall look good): cards with each map's picture, its maker, how often played,
 * its flowers and downloads; sorted by 最熱門 (plays), 最多花 or 最新; a card opens the map's page — the maker's 說明,
 * 寄語 and contacts, 送花 and 下載.
 */
function librarySheet(app: HTMLElement, back: () => void, play: (s: GameSettings) => void) {
  const ov = document.createElement('div');
  ov.className = 'slots-overlay mk-ov';
  // 最多花 first and by default, then 最熱門, 最新 (the user 2026-11-16)
  const SORTS: [LibSort, string][] = [['flowers', '最多花'], ['plays', '最熱門'], ['new', '最新']];
  let sort: LibSort = 'flowers';
  // 卡片 or 列表 (the user 2026-11-12: both, switched), kept on this phone
  let asList = false;
  try { asList = localStorage.getItem('rich4.maker.hallView') === 'list'; } catch { /* cards */ }
  ov.innerHTML = `<div class="msg sheet mk-hall"><div class="ribbon">創作樂園</div>
    <div class="mk-lib-q"><input type="search" maxlength="16" placeholder="找地圖名字或作者"><button class="chip" data-l="q">找</button></div>
    <div class="mk-hall-bar"><div class="chips mk-hall-sort">${SORTS.map(([k, n]) => `<button class="chip${k === sort ? ' on' : ''}" data-sort="${k}">${n}</button>`).join('')}</div>
      <div class="mk-hall-view"><button data-view="cards" title="卡片">${LIB_ICON.cards}</button><button data-view="list" title="列表">${LIB_ICON.list}</button></div></div>
    <div class="mk-hall-list"><p class="mk-none">載入中…</p></div>
    <div class="choices"><button class="candy ghost" data-l="back">返回</button></div></div>`;
  app.append(ov);
  const list = ov.querySelector<HTMLElement>('.mk-hall-list')!, input = ov.querySelector<HTMLInputElement>('input')!;
  let shown: LibEntry[] = [], total = 0, q = '', pic = '';
  const stat = (e: LibEntry) => `<span class="mk-stats"><i title="玩過">${LIB_ICON.play}${e.plays}</i><i class="fl" title="送花">${LIB_ICON.flower}${e.flowers}</i><i title="下載">${LIB_ICON.down}${e.takes}</i></span>`;
  const picOf = (e: LibEntry) => (e.thumb && pic ? `<img src="${pic}/maps/${e.id}.jpg" alt="">` : '<i class="mk-noimg"></i>');
  const draw = () => {
    ov.querySelectorAll<HTMLElement>('[data-view]').forEach(b => b.classList.toggle('on', (b.dataset.view === 'list') === asList));
    list.innerHTML = shown.length ? `<div class="${asList ? 'mk-hall-rows' : 'mk-hall-grid'}">${shown.map((e, i) => `<button class="${asList ? 'mk-lrow' : 'mk-card'}" data-open="${i}">${picOf(e)}
        <span class="mk-card-txt"><b>${PARTY_LIB_ON && inParty(e.id) ? '<i class="mk-ptag">派對</i>' : ''}${esc(e.name)}</b><small>${esc(e.author)} 做的・${e.w}×${e.h}${asList ? `・${new Date(e.at).toLocaleDateString()}` : ''}</small>${stat(e)}</span></button>`).join('')}</div>`
      + (shown.length < total ? '<div class="choices"><button class="candy ghost" data-l="more">更多</button></div>' : '')
      : `<p class="mk-none">${q ? '沒有找到' : '創作樂園還是空的：做一張地圖、試玩通過，就可以發布上來'}</p>`;
  };
  const load = async (more = false) => {
    try {
      pic ||= await libraryBase();
      const r = await browse(more ? shown.length : 0, q, sort);
      shown = more ? [...shown, ...r.maps] : r.maps; total = r.total; draw();
    } catch { list.innerHTML = '<p class="mk-none">連不上創作樂園，檢查網路後再試</p>'; }
  };
  void load();
  /** A map's page. */
  const page = (e: LibEntry) => {
    const pg = document.createElement('div');
    pg.className = 'slots-overlay mk-ov';
    const kind = (k: string) => CONTACT_KINDS.find(x => x[0] === k)?.[1] ?? k;
    const given = gaveFlower(e.id);
    pg.innerHTML = `<div class="msg sheet mk-page"><div class="ribbon">${esc(e.name)}</div>
      <div class="mk-page-top">${picOf(e)}<div class="mk-page-info"><p><b>${esc(e.author)}</b> 做的</p><p class="mk-dim">${e.w} × ${e.h} 格・${new Date(e.at).toLocaleDateString()} 發布</p>${stat(e)}</div></div>
      ${e.note ? `<blockquote class="mk-note">${esc(e.note)}<cite>— ${esc(e.author)}</cite></blockquote>` : ''}
      ${e.desc ? `<div class="mk-page-sec"><h4>地圖說明</h4><p class="mk-desc">${esc(e.desc)}</p></div>` : ''}
      ${e.contact.length ? `<div class="mk-page-sec"><h4>聯絡作者</h4>${e.contact.map(c => `<button class="mk-contact" data-copy="${esc(c.v)}"><span>${kind(c.k)}</span><b>${esc(c.v)}</b><small>點一下複製</small></button>`).join('')}</div>` : ''}
      <div class="choices"><button class="candy ghost" data-g="back">返回</button><button class="candy${given ? ' ghost' : ''}" data-g="flower"${given ? ' disabled' : ''}>${LIB_ICON.flower}${given ? '已送花' : '送花'}</button>${PARTY_LIB_ON ? `<button class="candy" data-g="party">${inParty(e.id) ? '從派對模式移除' : '加到派對模式'}</button>` : ''}<button class="candy" data-g="take"${listMaps().some(x => x.id === `lib-${e.id}`) ? ' disabled>已在我的地圖' : '>下載到我的地圖'}</button><button class="candy yes" data-g="play">${LIB_ICON.play}直接玩</button></div>
      ${PARTY_LIB_ON ? `<p class="mk-deck-hint mk-party-hint">派對模式建房間時可以選加進去的地圖（最多 ${PARTY_LIB_MAX} 張，現在 ${partyLibs().length} 張）</p>` : ''}</div>`;
    app.append(pg);
    pg.addEventListener('click', ev => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>('button');
      if (!t) return;
      if (t.dataset.g === 'back') { audio.ui('no'); pg.remove(); return; }
      if (t.dataset.copy) { void navigator.clipboard?.writeText(t.dataset.copy).then(() => { audio.ui('click'); t.querySelector('small')!.textContent = '已複製'; }).catch(() => {}); return; }
      if (t.dataset.g === 'party') {
        // 加到派對模式 (the user 2026-11-12): three at most; to play another, take one out first
        if (inParty(e.id)) { removePartyLib(e.id); audio.ui('no'); }
        else if (!addPartyLib(e.id, e.name)) { audio.ui('error'); void uiAlert(`派對模式最多放 ${PARTY_LIB_MAX} 張自建地圖：先在創作樂園裡把其中一張「從派對模式移除」，再加這張。\n現在的：${partyLibs().map(x => `「${x.name}」`).join('、')}`); return; }
        else audio.ui('yes');
        t.textContent = inParty(e.id) ? '從派對模式移除' : '加到派對模式';
        pg.querySelector('.mk-party-hint')!.textContent = `派對模式建房間時可以選加進去的地圖（最多 ${PARTY_LIB_MAX} 張，現在 ${partyLibs().length} 張）`;
        draw();
        return;
      }
      if (t.dataset.g === 'flower') {
        (t as HTMLButtonElement).disabled = true;
        void giveFlower(e.id).then(r => { e.flowers = r.flowers; keepFlower(e.id); audio.ui('yes'); t.classList.add('ghost'); t.innerHTML = `${LIB_ICON.flower}已送花`; pg.querySelectorAll('.mk-stats .fl').forEach(x => (x.innerHTML = `${LIB_ICON.flower}${e.flowers}`)); draw(); })
          .catch(err => { (t as HTMLButtonElement).disabled = false; audio.ui('error'); void uiAlert((err as Error).message); });
        return;
      }
      // 下載 keeps it in 我的地圖 and stays here (the user 2026-11-16: not opened in the editor — it is someone else's map)
      if (t.dataset.g === 'take') {
        t.textContent = '下載中…'; (t as HTMLButtonElement).disabled = true;
        void take(e).then(() => { audio.ui('yes'); e.takes++; t.textContent = '已在我的地圖'; pg.querySelectorAll('.mk-stats').forEach(x => (x.outerHTML = stat(e))); draw(); })
          .catch(err => { audio.ui('error'); t.textContent = '下載到我的地圖'; (t as HTMLButtonElement).disabled = false; void uiAlert((err as Error).message); });
        return;
      }
      if (t.dataset.g === 'play' && playLib) {
        const go = playLib;
        t.textContent = '準備中…'; (t as HTMLButtonElement).disabled = true;
        void fetchLib(e).then(m => { audio.ui('yes'); pg.remove(); ov.remove(); go(m, e.thumb && pic ? `${pic}/maps/${e.id}.jpg` : ''); })
          .catch(err => { audio.ui('error'); t.innerHTML = `${LIB_ICON.play}直接玩`; (t as HTMLButtonElement).disabled = false; void uiAlert((err as Error).message); });
      }
    });
  };
  ov.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.l === 'back') { audio.ui('no'); ov.remove(); openMaker(app, back, play); return; }
    if (t.dataset.l === 'q') { q = input.value.trim(); audio.ui('click'); void load(); return; }
    if (t.dataset.l === 'more') { audio.ui('click'); void load(true); return; }
    if (t.dataset.sort) { sort = t.dataset.sort as LibSort; ov.querySelectorAll('[data-sort]').forEach(b => b.classList.toggle('on', b === t)); audio.ui('click'); void load(); return; }
    if (t.dataset.open) { audio.ui('click'); page(shown[Number(t.dataset.open)]); }
    if (t.dataset.view) { asList = t.dataset.view === 'list'; try { localStorage.setItem('rich4.maker.hallView', t.dataset.view); } catch { /* not kept */ } audio.ui('click'); draw(); }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { q = input.value.trim(); void load(); } });
}

/** New map: its name, its size (two free sliders — the user: 「劃到哪算哪」), the ground it starts with. */
function newMapSheet(app: HTMLElement, back: () => void, play: (s: GameSettings) => void) {
  const bases = [['deep-sea', '海'], ['grass', '草地'], ['snow', '雪地'], ['desert', '沙漠']] as const;
  let w = 48, h = 48, base: number = G['deep-sea'];
  const ov = document.createElement('div');
  ov.className = 'slots-overlay mk-ov';
  ov.innerHTML = `<div class="msg sheet mk-new"><div class="ribbon">新建地圖</div>
    <label class="mk-row"><span>名字</span><input class="mk-name" maxlength="${NAME_MAX}" value="地圖${listMaps().length + 1}"></label>
    <div class="mk-size">
      <div class="mk-sliders">
        <label class="mk-row"><span>寬</span><input type="range" min="${SIZE_MIN}" max="${SIZE_MAX}" value="${w}" data-s="w"><b data-v="w"></b></label>
        <label class="mk-row"><span>高</span><input type="range" min="${SIZE_MIN}" max="${SIZE_MAX}" value="${h}" data-s="h"><b data-v="h"></b></label>
        <p class="mk-hint"></p>
      </div>
      <div class="mk-preview"><i class="mk-ref" title="台灣地圖的大小"></i><i class="mk-box"></i></div>
    </div>
    <div class="mk-row"><span>底色</span><div class="chips">${bases.map(([k, n]) => `<button class="chip${G[k] === base ? ' on' : ''}" data-b="${G[k]}"><img src="${TEX}/ground-${k}.webp" alt="">${n}</button>`).join('')}</div></div>
    <div class="choices"><button class="candy ghost" data-a="back">返回</button><button class="candy yes" data-a="go">開始畫</button></div></div>`;
  app.append(ov);
  const show = () => {
    ov.querySelector<HTMLElement>('[data-v="w"]')!.textContent = `${w} 格`;
    ov.querySelector<HTMLElement>('[data-v="h"]')!.textContent = `${h} 格`;
    const area = w * h, tw = 48 * 48;
    ov.querySelector<HTMLElement>('.mk-hint')!.textContent = area < tw * 0.55 ? '小型地圖：一局比較快' : area > tw * 1.6 ? '大型地圖：地方大、一局比較長' : '中型地圖：和台灣地圖差不多大';
    const big = Math.max(w, h, 48), box = ov.querySelector<HTMLElement>('.mk-box')!, ref = ov.querySelector<HTMLElement>('.mk-ref')!;
    box.style.width = `${(w / big) * 100}%`; box.style.height = `${(h / big) * 100}%`;
    ref.style.width = ref.style.height = `${(48 / big) * 100}%`;
  };
  show();
  ov.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.s === 'w') w = Number(t.value);
    if (t.dataset.s === 'h') h = Number(t.value);
    show();
  });
  ov.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    if (t.dataset.b) { base = Number(t.dataset.b); ov.querySelectorAll('[data-b]').forEach(b => b.classList.toggle('on', b === t)); audio.ui('click'); return; }
    if (t.dataset.a === 'back') { audio.ui('no'); ov.remove(); openMaker(app, back, play); return; }
    if (t.dataset.a === 'go') {
      const name = ov.querySelector<HTMLInputElement>('.mk-name')!.value.trim().slice(0, NAME_MAX) || '我的地圖';
      const m = newMap(name, w, h, base);
      saveMap(m);
      audio.ui('yes'); ov.remove(); openEditor(app, m, back, play);
    }
  });
}

// ---------------------------------------------------------------- the editor

type Tool = 'pointer' | 'brush' | 'line' | 'rect' | 'lasso' | 'bucket' | 'eraser' | 'tune' | 'move';
const ICON: Record<string, string> = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  undo: '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  redo: '<path d="m15 7 5 5-5 5M20 12H9a5 5 0 0 0 0 10h2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="M4 12.5 9.5 18 20 6" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  play: '<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>',
  pointer: '<path d="M5 3l13 9-6 1.5L9 20z" fill="currentColor"/>',
  brush: '<path d="M15 4l5 5L9 20H4v-5z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>',
  line: '<path d="M5 19 19 5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="5" cy="19" r="2.5" fill="currentColor"/><circle cx="19" cy="5" r="2.5" fill="currentColor"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2.6"/>',
  lasso: '<path d="M6 8c2-5 12-5 13 1s-6 9-11 7-4-5-2-8z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="3 2.5"/>',
  bucket: '<path d="m4 11 7-7 8 8-7 7z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M20 15c1.5 2 1.5 4 0 4s-1.5-2 0-4z" fill="currentColor"/>',
  eraser: '<path d="m9 20-5-5L15 4l6 6-9 10zM8 11l6 6M4 20h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
  tune: '<path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="m12 3-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  move: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v8c0 4-2.5 7-6 7s-5-2-7-6l-1-2a1.5 1.5 0 0 1 2.6-1.4z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>',
};
const svg = (k: string) => `<svg viewBox="0 0 24 24">${ICON[k]}</svg>`;
const TOOLS: [Tool, string, boolean][] = [['pointer', '指針', true], ['brush', '畫筆', true], ['eraser', '橡皮擦', true], ['line', '直線', true],
  ['rect', '方塊', true], ['lasso', '圈地', true], ['bucket', '油漆桶', true], ['tune', '微調', true], ['move', '移動', true]];
/** The layers, one a tab: what the tools paint (the user 2026-11-12: layers, the eraser takes from one layer only). */
const TABS = ['地面', '道路', '格子', '建築', '裝飾'];
const enum L { Ground, Road, Square, Building, Decor }
const LOT_SMALL = 100, LOT_BIG = 101;    // the 格子 tab's two lot items (beside the events)
/** The 企業大樓 items: CO_ITEM + their index in COMPANY_KINDS (the user 2026-11-16). */
const CO_ITEM = 200;
const isLotItem = (sq: number) => sq === LOT_SMALL || sq === LOT_BIG || sq >= CO_ITEM;
const itemKind = (sq: number): 0 | 1 | 2 => (sq === LOT_SMALL ? 0 : sq === LOT_BIG ? 1 : 2);

interface Snapshot { cells: Uint8Array; nodes: string; lots: string; streets: string; things: string; light: string; tex: string; wood: string; deck: string; stocks: string; switches: string; nextId: number }

export function openEditor(app: HTMLElement, m: MakerMap, back: () => void, play: (s: GameSettings) => void) {
  setLastMap(m.id);
  let tool: Tool = 'brush', layer = L.Ground, size = 2, hollow = false, edge: Edge = 0, lassoPath: Pt[] = [];
  let ground: number = G.grass, road = 0, square = 14, piece = { [L.Building]: 0, [L.Decor]: 0 } as Record<number, number>;
  let selLot = -1, selThing = -1, selNode = -1;
  /** The look each kind of 企業大樓 is built with next (its category → a style). */
  const coStyle: Record<number, number> = {};
  /** 強制放置 (the user 2026-11-12): a lot goes on any open cell, its squares chosen by hand (linkLot), any squares. */
  let force = false, linkLot: number | null = null;
  /** 檢查's rings on the map (world px), until the next change. */
  let marks: { x: number; y: number }[] = [];
  /** 加入這條街: while set, a lot tapped with the pointer joins this street. */
  let joining: number | null = null;
  /** Streets no lot belongs to any more go. */
  const pruneStreets = () => { const used = new Set(m.lots.map(l => l.street)); m.streets = m.streets.filter(st => used.has(st.id)); };
  let pieces: number[] = [];
  const undo: Snapshot[] = [], redo: Snapshot[] = [];
  const root = document.createElement('div');
  root.className = 'mk-ed';
  root.innerHTML = `
    <div class="mk-top">
      <button class="mk-tb" data-a="menu">${svg('menu')}<span class="lbl">選單</span></button>
      <button class="mk-tb" data-a="undo">${svg('undo')}<span class="lbl">撤銷</span></button>
      <button class="mk-tb" data-a="redo">${svg('redo')}<span class="lbl">重做</span></button>
      <div class="mk-name"><b>${esc(m.name)}</b><small class="mk-saved">已自動存檔</small></div>
      <button class="mk-tb" data-a="check">${svg('check')}<span class="lbl">檢查</span></button>
      <button class="mk-tb play" data-a="play">${svg('play')}<span class="lbl">試玩</span></button>
    </div>
    <div class="mk-tools">${TOOLS.map(([k, n, ok]) => `<button class="mk-tool${k === tool ? ' on' : ''}${ok ? '' : ' soon'}" data-t="${k}"><i>${svg(k)}</i>${n}</button>`).join('')}</div>
    <div class="mk-mats">
      <div class="mk-tabs">${TABS.map((t, i) => `<button class="mk-tab${i ? '' : ' on'}" data-tab="${i}">${t}</button>`).join('')}</div>
      <div class="mk-grid"></div>
      <div class="mk-opts"></div>
    </div>
    <div class="mk-stage"><canvas class="mk-over"></canvas><div class="mk-float"></div>
      <div class="mk-zoom"><button data-z="1">＋</button><span></span><button data-z="-1">－</button></div>
      <div class="mk-toast" hidden></div></div>`;
  app.append(root);
  const stage = root.querySelector<HTMLElement>('.mk-stage')!, over = root.querySelector<HTMLCanvasElement>('.mk-over')!;
  const toastEl = root.querySelector<HTMLElement>('.mk-toast')!, grid = root.querySelector<HTMLElement>('.mk-grid')!;
  /** 建築 / 裝飾: the kind of piece shown (pieces.ts). */
  const kind: Record<number, PieceKind> = {};
  let toastT = 0;
  const toast = (t: string) => { toastEl.textContent = t; toastEl.hidden = false; clearTimeout(toastT); toastT = window.setTimeout(() => (toastEl.hidden = true), 2400); };
  fetch(`${TEX}/pieces.json`).then(r => r.json()).then((ids: number[]) => { pieces = ids; if (layer >= L.Building) showGrid(); }).catch(() => {});

  // -------------------------------------------------- the view
  const view = { x: 0, y: 0, s: 1 };     // world point at the stage's top-left, css px per world px
  let gl: GroundGL;
  try { gl = new GroundGL(m, `${TEX}/atlas.webp`, () => dirty()); }
  catch { root.remove(); void uiAlert('這台裝置不支援地圖編輯器需要的繪圖功能（WebGL）'); back(); return; }
  stage.prepend(gl.canvas);
  const woods = new Woods(m, () => dirty());
  gl.canvas.className = 'mk-gl';
  const fit = () => {
    const r = stage.getBoundingClientRect();
    view.s = Math.min(r.width / (m.w * CELL), r.height / (m.h * CELL)) * 0.94;
    view.x = (m.w * CELL) / 2 - r.width / 2 / view.s; view.y = (m.h * CELL) / 2 - r.height / 2 / view.s;
  };
  let frame = 0;
  const dirty = () => { if (!frame) frame = requestAnimationFrame(render); };
  let preview: ((c: CanvasRenderingContext2D) => void) | null = null;
  function render() {
    frame = 0;
    const r = stage.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    for (const c of [gl.canvas, over]) {
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    }
    gl.draw(view.x, view.y, view.s * dpr);
    const c = over.getContext('2d')!;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, over.width, over.height);
    // the layers, in world coordinates
    c.setTransform(dpr * view.s, 0, 0, dpr * view.s, -view.x * view.s * dpr, -view.y * view.s * dpr);
    woods.changed(); woods.draw(c);
    drawRoads(c, m, dirty);
    drawSteps(c, m);
    drawLots(c, m, selLot, layer === L.Square);
    drawSquares(c, m, dirty, tool === 'tune' ? selNode : -1);
    drawCompanies(c, m, dirty);
    drawThings(c, m, dirty, selThing);
    // where the lot chosen fits (green), while placing lots
    if (layer === L.Square && tool === 'brush' && isLotItem(square) && linkLot === null) {
      c.fillStyle = 'rgba(90, 255, 120, .30)'; c.strokeStyle = 'rgba(160, 255, 170, .85)'; c.lineWidth = 1.5;
      for (const k of placeHints(square === LOT_SMALL ? 0 : 1)) { const x = (k % m.w) * CELL, y = Math.floor(k / m.w) * CELL; c.fillRect(x + 2, y + 2, CELL - 4, CELL - 4); c.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4); }
    }
    // 關聯格子: the squares that may be tapped
    if (linkLot !== null) {
      const l = m.lots.find(x => x.id === linkLot), owned = new Set(m.lots.filter(x => x !== l).flatMap(x => x.nodes));
      for (const n of m.nodes) {
        c.strokeStyle = l?.nodes.includes(n.id) ? '#fff36b' : owned.has(n.id) ? 'rgba(255, 90, 90, .7)' : 'rgba(120, 255, 140, .95)'; c.lineWidth = 3;
        c.beginPath(); c.arc((n.cx + .5) * CELL, (n.cy + .5) * CELL, 15, 0, Math.PI * 2); c.stroke();
      }
    }
    // 檢查's rings
    for (const p of marks) {
      c.strokeStyle = 'rgba(255, 40, 40, .35)'; c.lineWidth = 12; c.beginPath(); c.arc(p.x, p.y, 34, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#ff2b2b'; c.lineWidth = 4; c.beginPath(); c.arc(p.x, p.y, 34, 0, Math.PI * 2); c.stroke();
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the map's border
    c.strokeStyle = 'rgba(255, 243, 107, .9)'; c.lineWidth = 2; c.setLineDash([8, 6]);
    c.strokeRect(-view.x * view.s, -view.y * view.s, m.w * CELL * view.s, m.h * CELL * view.s);
    c.setLineDash([]);
    preview?.(c);
    root.querySelector<HTMLElement>('.mk-zoom span')!.textContent = `${Math.round(view.s * 100)}%`;
  }
  const toWorld = (cx: number, cy: number) => { const r = stage.getBoundingClientRect(); return { x: view.x + (cx - r.left) / view.s, y: view.y + (cy - r.top) / view.s }; };
  const cellOf = (p: { x: number; y: number }) => ({ cx: Math.floor(p.x / CELL), cy: Math.floor(p.y / CELL) });
  const inMap = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < m.w && cy < m.h;
  const zoomAt = (cx: number, cy: number, f: number) => {
    const p = toWorld(cx, cy), r = stage.getBoundingClientRect();
    view.s = Math.min(4, Math.max(0.12, view.s * f));
    view.x = p.x - (cx - r.left) / view.s; view.y = p.y - (cy - r.top) / view.s;
    dirty();
  };

  // -------------------------------------------------- changes: a snapshot before each, saved by itself after
  const snap = (): Snapshot => ({ cells: m.cells.slice(), nodes: JSON.stringify(m.nodes), lots: JSON.stringify(m.lots), streets: JSON.stringify(m.streets), things: JSON.stringify(m.things), light: JSON.stringify(m.light ?? null), tex: JSON.stringify(m.tex ?? null), wood: JSON.stringify(m.wood ?? null), deck: JSON.stringify(m.deck ?? null), stocks: JSON.stringify(m.stocks ?? null), switches: JSON.stringify(m.switches ?? null), nextId: m.nextId });
  const restore = (s: Snapshot) => { m.cells = s.cells.slice(); m.nodes = JSON.parse(s.nodes); m.lots = JSON.parse(s.lots); m.streets = JSON.parse(s.streets); m.things = JSON.parse(s.things); m.light = JSON.parse(s.light) ?? undefined; m.tex = JSON.parse(s.tex) ?? undefined; m.wood = JSON.parse(s.wood) ?? undefined; m.deck = JSON.parse(s.deck) ?? undefined; m.stocks = JSON.parse(s.stocks) ?? undefined; m.switches = JSON.parse(s.switches) ?? undefined; m.nextId = s.nextId; };
  let before: Snapshot | null = null;
  const begin = () => { before = snap(); };
  const commit = () => {
    if (!before) return;
    const now = snap();
    if (now.nodes === before.nodes && now.lots === before.lots && now.streets === before.streets && now.things === before.things && now.light === before.light && now.tex === before.tex && now.wood === before.wood && now.deck === before.deck && now.stocks === before.stocks && now.switches === before.switches && now.cells.every((v, i) => v === before!.cells[i])) { before = null; return; }
    undo.push(before);
    if (undo.length > 120) undo.shift();
    redo.length = 0;
    before = null;
    changed();
  };
  // Every change is saved at once (the user 2026-11-12: one square placed, saved — closing the app loses nothing), and
  // once more when the app goes to the background or closes.
  const savedEl = root.querySelector<HTMLElement>('.mk-saved')!;
  // (the top bar says too whether the map as it is now may go to the library: a change to its play undoes a 試玩)
  const saveNow = () => { const ok = saveMap(m); savedEl.textContent = ok ? `已自動存檔・${mapStatus({ won: cleared(m), pub: !!m.published && cleared(m) })[0]}` : '存檔失敗（手機空間不足）'; if (!ok) toast('存檔失敗：手機的存儲空間不足'); };
  function changed() { hints = null; marks = []; gl.uploadCells(); dirty(); saveNow(); }
  const onHide = () => { if (before) commit(); saveNow(); };
  const onVis = () => { if (document.visibilityState === 'hidden') onHide(); };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);

  // -------------------------------------------------- the ground layer
  const setCell = (cx: number, cy: number, g: number) => { if (inMap(cx, cy)) m.cells[cy * m.w + cx] = g; };
  const dab = (p: { x: number; y: number }, g: number) => {
    const { cx, cy } = cellOf(p), r = size - 1;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r) setCell(cx + dx, cy + dy, g);
  };
  const strokeGround = (a: { x: number; y: number }, b: { x: number; y: number }, g: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 3)));
    for (let k = 0; k <= n; k++) dab({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, g);
  };
  const fillGround = (cx: number, cy: number, g: number) => {
    if (!inMap(cx, cy)) return;
    const from = m.cells[cy * m.w + cx];
    if (from === g) return;
    const st = [[cx, cy]];
    while (st.length) {
      const [x, y] = st.pop()!;
      if (!inMap(x, y) || m.cells[y * m.w + x] !== from) continue;
      m.cells[y * m.w + x] = g;
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  };

  // -------------------------------------------------- the road layer: squares on cells, linked step by step
  const nodeAt = (cx: number, cy: number) => m.nodes.find(n => Math.abs(n.cx - cx) < 0.05 && Math.abs(n.cy - cy) < 0.05);
  /** The square nearest a world point, within 0.6 of a cell (a square on a 45° road sits off the cells' centres). */
  const nodeNear = (p: { x: number; y: number }) => {
    let best: MkNode | undefined, d = 0.6 * CELL;
    for (const n of m.nodes) { const e = Math.hypot((n.cx + .5) * CELL - p.x, (n.cy + .5) * CELL - p.y); if (e < d) { d = e; best = n; } }
    return best;
  };
  /** The lot drawn under a world point (lots are drawn beside their squares, layers.lotGeom), else the one on that cell. */
  const lotAtPoint = (p: { x: number; y: number }) => m.lots.find(l => {
    const g = lotGeom(m, l), c = Math.cos(-g.angle), s = Math.sin(-g.angle), dx = p.x - g.x, dy = p.y - g.y;
    return Math.abs(c * dx - s * dy) <= g.size / 2 + 4 && Math.abs(s * dx + c * dy) <= g.size / 2 + 4;
  }) ?? lotAt(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
  const lotAt = (cx: number, cy: number) => m.lots.find(l => cx >= l.cx && cy >= l.cy && cx < l.cx + (l.kind ? 2 : 1) && cy < l.cy + (l.kind ? 2 : 1));
  /** Woods, flowers, fields, rock and mud under a square or a lot give way to plain grass. */
  const BUSY = new Set([G.forest, G.flowers, G.farmland, G.rock, G.mud, G.gravel]);
  const clearGround = (cx: number, cy: number) => { if (inMap(cx, cy) && BUSY.has(m.cells[cy * m.w + cx] as never)) m.cells[cy * m.w + cx] = G.grass; };
  const ensureNode = (cx: number, cy: number) => {
    if (!inMap(cx, cy) || lotAt(cx, cy)) return null;
    let n = nodeAt(cx, cy);
    if (!n) { n = { id: m.nextId++, cx, cy, links: [], ev: 0, style: road }; m.nodes.push(n); clearGround(cx, cy); }
    return n;
  };
  const link = (a: MkNode, b: MkNode) => {
    // (one step apart: across, down or along 45°; a little more or less where a 45° road meets a straight one, issue #95)
    if (a === b || Math.abs(Math.hypot(a.cx - b.cx, a.cy - b.cy) - 1) > 0.3) return;
    if (!a.links.includes(b.id)) a.links.push(b.id);
    if (!b.links.includes(a.id)) b.links.push(a.id);
  };
  /**
   * Two road ends one step apart are joined (the user 2026-11-13: a road drawn in several strokes looked whole, but a
   * stroke begun beside another's end was not linked to it — 「路沒有全部連在一起」 where nothing showed a gap). Run
   * after every road stroke and before the check; returns how many joins it made.
   */
  /** (fix.ts) road ends on one spot or a step apart joined: after every road stroke and before the check. */
  const joinEnds = () => joinRoadEnds(m);
  const removeNode = (n: MkNode) => {
    m.nodes = m.nodes.filter(x => x !== n);
    for (const x of m.nodes) x.links = x.links.filter(id => id !== n.id);
    for (const l of m.lots) l.nodes = l.nodes.filter(id => id !== n.id);
    m.lots = m.lots.filter(l => l.nodes.length);
  };
  /**
   * The cells from a to b in rook's steps only (the user 2026-11-12: roads straight across or straight down, every step
   * the same length — a diagonal step was 1.4 of a straight one): a diagonal stroke becomes a staircase of straight steps.
   */
  const cellsBetween = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => {
    const out = [{ cx: a.cx, cy: a.cy }];
    let { cx, cy } = a;
    const sx = Math.sign(b.cx - a.cx), sy = Math.sign(b.cy - a.cy), n = Math.abs(b.cx - a.cx) + Math.abs(b.cy - a.cy);
    for (let k = 0; k < n; k++) {
      // step along the axis that is further behind the straight line from a to b
      const tx = Math.abs(b.cx - a.cx) ? Math.abs(cx - a.cx) / Math.abs(b.cx - a.cx) : 1, ty = Math.abs(b.cy - a.cy) ? Math.abs(cy - a.cy) / Math.abs(b.cy - a.cy) : 1;
      if (tx <= ty && cx !== b.cx) cx += sx; else cy += sy;
      out.push({ cx, cy });
    }
    return out;
  };
  /**
   * A line's end snapped across, down or along 45° (roads in straight pieces like the originals); on 45° the squares are
   * one step apart along the line, so its end may fall between cells' centres.
   */
  const snap8 = (a: { cx: number; cy: number }, b: { cx: number; cy: number }) => {
    const dx = b.cx - a.cx, dy = b.cy - a.cy;
    if (Math.abs(dx) > 2 * Math.abs(dy)) return { cx: b.cx, cy: a.cy };
    if (Math.abs(dy) > 2 * Math.abs(dx)) return { cx: a.cx, cy: b.cy };
    const k = Math.round(Math.hypot(dx, dy)), s = Math.SQRT1_2;
    return { cx: a.cx + Math.sign(dx) * k * s, cy: a.cy + Math.sign(dy) * k * s };
  };
  /** The squares of a straight line from a, `k` steps of one cell along (ux, uy). */
  const lineTo = (a: MkNode, ux: number, uy: number, k: number) => {
    let prev = a;
    for (let i = 1; i <= k; i++) {
      const cx = Math.round((a.cx + ux * i) * 1000) / 1000, cy = Math.round((a.cy + uy * i) * 1000) / 1000;
      if (!inMap(Math.floor(cx + .5), Math.floor(cy + .5))) break;
      // a square already this close is the one (issue #95: a straight line begun beside a 45° road's end made a second
      // square a quarter step from it, and the two never joined)
      let n = nodeAt(cx, cy) ?? m.nodes.find(o => o !== prev && Math.hypot(o.cx - cx, o.cy - cy) < 0.6);
      if (!n) { n = { id: m.nextId++, cx, cy, links: [], ev: 0, style: road }; m.nodes.push(n); clearGround(Math.floor(cx + .5), Math.floor(cy + .5)); }
      link(prev, n); prev = n;
    }
  };
  let roadLast: MkNode | null = null;
  const roadTo = (c: { cx: number; cy: number }) => {
    const path = roadLast ? cellsBetween(roadLast, c) : [c];
    for (const p of path) {
      const n = ensureNode(p.cx, p.cy);
      if (!n) { roadLast = null; continue; }
      if (roadLast) link(roadLast, n);
      roadLast = n;
    }
  };
  const roadStyleFill = (n: MkNode, st: number) => {
    const seen = new Set<number>(), todo = [n.id], byId = new Map(m.nodes.map(x => [x.id, x]));
    while (todo.length) { const id = todo.pop()!; if (seen.has(id)) continue; seen.add(id); const x = byId.get(id); if (!x) continue; x.style = st; todo.push(...x.links); }
  };

  // -------------------------------------------------- the squares layer: events on squares, lots beside the road
  const lotNames = (kind: number) => { const k = m.lots.filter(l => l.kind === kind).length + 1; return kind ? `大型用地${k}` : `地段${k}`; };
  const lotCells = (cx: number, cy: number, kind: 0 | 1 | 2) => (kind ? [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]] : [[cx, cy]]);
  /**
   * Whether a lot fits at (cx, cy) and the squares it would belong to, else why not (the user 2026-11-12: say why; a
   * lot belongs to plain squares only — a large plot had taken an empty square and a 點券 square). 強制放置 asks only
   * for open cells.
   */
  const placeCheck = (cx: number, cy: number, kind: 0 | 1 | 2, forced = false): { use: MkNode[] } | { why: string } => {
    const cells = lotCells(cx, cy, kind);
    if (cells.some(([x, y]) => !inMap(x, y))) return { why: '超出地圖了' };
    if (cells.some(([x, y]) => m.nodes.some(n => Math.hypot(n.cx - x, n.cy - y) < 0.7))) return { why: '這裡是路：地塊要放在路旁邊' };
    if (cells.some(([x, y]) => lotAt(x, y))) return { why: '這裡已經有地塊了' };
    if (forced) return { use: [] };
    const owned = new Set(m.lots.flatMap(l => l.nodes));
    const beside = m.nodes.filter(n => cells.some(([x, y]) => Math.hypot(n.cx - x, n.cy - y) <= 1.08));
    const near = beside.filter(n => !owned.has(n.id) && !n.ev);
    if (!near.length) return { why: beside.length ? '旁邊的格子是事件格或已經屬於別的地塊了' : '要緊貼著路：旁邊要有一格普通的路' };
    if (!kind) return { use: near.slice(0, 1) };
    // a large plot takes two squares of its own, side by side along the road (the user 2026-11-12: one was put where
    // the squares beside it were the small lots' already, taking the one left)
    const pair = near.flatMap(a => near.filter(b => b !== a && a.links.includes(b.id)).map(b => [a, b]))[0];
    return pair ? { use: pair } : { why: `${kind === 2 ? '企業大樓' : '大型用地'}要旁邊有兩格相連、還沒有地塊的普通格` };
  };
  /** Where a lot of the kind chosen fits now (the green on the map while placing, the user 2026-11-12: like a strategy game). */
  let hints: { kind: 0 | 1; force: boolean; cells: Set<number> } | null = null;
  const placeHints = (kind: 0 | 1) => {
    if (hints && hints.kind === kind && hints.force === force) return hints.cells;
    const cells = new Set<number>(), tried = new Set<number>();
    const tryAt = (x: number, y: number) => {
      if (!inMap(x, y) || tried.has(y * m.w + x)) return;
      tried.add(y * m.w + x);
      if ('use' in placeCheck(x, y, kind, force)) for (const [a, b] of lotCells(x, y, kind)) cells.add(b * m.w + a);
    };
    if (force) for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) tryAt(x, y);
    else for (const n of m.nodes) for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) tryAt(Math.round(n.cx) + dx, Math.round(n.cy) + dy);
    hints = { kind, force, cells };
    return cells;
  };
  const placeLot = (cx: number, cy: number, kind: 0 | 1 | 2, co?: (typeof COMPANY_KINDS)[number]) => {
    const r = placeCheck(cx, cy, kind, force);
    if ('why' in r) { toast(`這裡放不下：${r.why}`); audio.ui('error'); return false; }
    const lot: MkLot = kind === 2 && co
      ? { id: m.nextId++, kind, cx, cy, nodes: r.use.map(n => n.id), price: 0, name: co.name, co: co.cat, style: coStyle[co.cat] ?? co.styles[0], ...(force ? { free: true } : {}) }
      : { id: m.nextId++, kind, cx, cy, nodes: r.use.map(n => n.id), price: kind ? 5000 : 1000, name: lotNames(kind), ...(force ? { free: true } : {}) };
    // a company is one of the map's 12 stocks (stocks.ts companySlots): none left, no building
    if (kind === 2 && !companySlots({ ...m, lots: [...m.lots, lot] }).has(lot.id)) { m.nextId--; toast('12 支股票都已經是公司了，蓋不下更多企業大樓'); audio.ui('error'); return false; }
    if (!kind) {
      // beside a lot of a street (touching it): that street; else a new street of its own (the player renames it)
      const near = m.lots.find(o => !o.kind && o.street !== undefined && Math.max(Math.abs(o.cx - cx), Math.abs(o.cy - cy)) === 1);
      if (near) lot.street = near.street;
      else { const st = { id: m.nextId++, name: `新街${m.streets.length + 1}`, price: 1000 }; m.streets.push(st); lot.street = st.id; }
    }
    m.lots.push(lot);
    selLot = lot.id;
    // a lot stands on open ground (the user 2026-11-12: not in a field or a wood): the busy grounds under it give way
    for (const [x, y] of lotCells(cx, cy, kind)) clearGround(x, y);
    // 強制放置: its squares next, tapped on the road
    if (force) linkLot = lot.id;
    return true;
  };
  /** 關聯格子: a square tapped joins the lot (or leaves it); a small lot takes one, a large plot two. */
  const linkTap = (n: MkNode) => {
    const l = m.lots.find(x => x.id === linkLot);
    if (!l) { linkLot = null; return; }
    const other = m.lots.find(x => x !== l && x.nodes.includes(n.id));
    if (other) { toast(`這一格已經屬於「${other.name}」`); audio.ui('error'); return; }
    begin();
    if (l.nodes.includes(n.id)) l.nodes = l.nodes.filter(id => id !== n.id);
    else { l.nodes.push(n.id); while (l.nodes.length > (l.kind ? 2 : 1)) l.nodes.shift(); }
    commit(); audio.ui('click');
    if (l.nodes.length >= (l.kind ? 2 : 1)) { linkLot = null; toast(`「${l.name}」關聯好了`); }
    showOptions(); dirty();
  };

  // -------------------------------------------------- pointers: one finger draws (or moves), two zoom and move
  const pts = new Map<number, { x: number; y: number }>();
  let last: { x: number; y: number } | null = null, start: { x: number; y: number } | null = null, pinch: { d: number; cx: number; cy: number } | null = null;
  let dragThing: { i: number; dx: number; dy: number; x0: number; y0: number } | null = null;
  /**
   * 微調 (the user 2026-11-12, in place of the picker): a lot or a piece pressed is dragged at once; a square of the road
   * is tapped to choose it first, then dragged — the road bends with it and its lots follow (layers.lotGeom).
   */
  let tuneDrag: { k: 'lot' | 'thing' | 'node'; id: number; from: { x: number; y: number } } | null = null;
  const tuneHit = (p: { x: number; y: number }): { k: 'lot' | 'thing' | 'node'; id: number } | null => {
    const near = (n: MkNode, r: number) => Math.hypot((n.cx + .5) * CELL - p.x, (n.cy + .5) * CELL - p.y) < r * CELL;
    const sn = m.nodes.find(n => n.id === selNode);
    if (sn && near(sn, .55)) return { k: 'node', id: sn.id };
    const n = m.nodes.filter(x => near(x, .4)).sort((a, b) => Math.hypot((a.cx + .5) * CELL - p.x, (a.cy + .5) * CELL - p.y) - Math.hypot((b.cx + .5) * CELL - p.x, (b.cy + .5) * CELL - p.y))[0];
    if (n) return { k: 'node', id: n.id };
    const t = thingAt(m, p.x, p.y);
    if (t >= 0) return { k: 'thing', id: t };
    const l = lotAtPoint(p);
    return l ? { k: 'lot', id: l.id } : null;
  };
  const drawTools = new Set<Tool>(['brush', 'eraser', 'line', 'rect', 'lasso']);
  stage.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('.mk-zoom, .mk-float')) return;
    try { stage.setPointerCapture(e.pointerId); } catch { /* (a pointer the browser does not track) */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {               // a second finger: undo what the first began, zoom
      if (before) { restore(before); before = null; gl.uploadCells(); }
      preview = null; start = last = null; roadLast = null; dragThing = null;
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      return;
    }
    const p = toWorld(e.clientX, e.clientY), c = cellOf(p);
    if (tool === 'move' || e.button === 1 || e.button === 2) { last = { x: e.clientX, y: e.clientY }; return; }
    if (linkLot !== null && layer === L.Square) {
      const n = nodeNear(p);
      if (n) linkTap(n); else last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (tool === 'tune') {
      const h = tuneHit(p);
      if (!h) { if (selLot >= 0 || selThing >= 0 || selNode >= 0) { selLot = selThing = selNode = -1; showOptions(); dirty(); } last = { x: e.clientX, y: e.clientY }; return; }
      if (h.k === 'node' && h.id !== selNode) { selNode = h.id; selLot = selThing = -1; showOptions(); dirty(); audio.ui('click'); return; }
      selNode = h.k === 'node' ? h.id : -1; selLot = h.k === 'lot' ? h.id : -1; selThing = h.k === 'thing' ? h.id : -1;
      begin(); tuneDrag = { ...h, from: p };
      showOptions(); dirty(); return;
    }
    if (tool === 'pointer') {
      if (layer === L.Square) {
        const l = lotAtPoint(p);
        if (joining !== null && l && !l.kind) {       // 加入這條街: the lot tapped joins it
          begin(); l.street = joining; pruneStreets(); commit(); audio.ui('click'); dirty(); return;
        }
        joining = null;
        selLot = l?.id ?? -1; showOptions(); dirty(); return;
      }
      if (layer >= L.Building) {
        selThing = thingAt(m, p.x, p.y);
        if (selThing >= 0) { begin(); const t = m.things[selThing]; dragThing = { i: selThing, dx: t.x - p.x, dy: t.y - p.y, x0: t.x, y0: t.y }; }
        showOptions(); dirty(); return;
      }
      toast('指針：在「格子」頁點地塊、在「建築」「裝飾」頁點物件，可以修改'); return;
    }
    if (tool === 'bucket') {
      begin();
      if (layer === L.Ground) fillGround(c.cx, c.cy, ground);
      else if (layer === L.Road) { const n = nodeNear(p); if (n) roadStyleFill(n, road); }
      else toast('油漆桶用在「地面」和「道路」');
      commit(); return;
    }
    if (!drawTools.has(tool)) { toast('這個工具正在製作中'); return; }
    if (tool === 'lasso' && layer !== L.Ground) { toast('圈地用在「地面」：圈一圈，圈裡換成選好的地面'); return; }
    begin(); start = last = p;
    if (tool === 'lasso') lassoPath = [{ x: p.x / CELL, y: p.y / CELL }];
    if (layer === L.Ground && (tool === 'brush' || tool === 'eraser')) { dab(p, tool === 'eraser' ? m.base : ground); gl.uploadCells(); dirty(); }
    if (layer === L.Road) {
      if (tool === 'brush') { roadLast = null; roadTo(c); dirty(); }
      if (tool === 'eraser') { eraseRoad(c); dirty(); }
    }
    if (layer === L.Square) {
      if (tool === 'eraser') {
        const l = lotAtPoint(p), n = nodeNear(p);
        if (l) { m.lots = m.lots.filter(x => x !== l); pruneStreets(); } else if (n) n.ev = 0;
      } else if (isLotItem(square)) placeLot(c.cx, c.cy, itemKind(square), COMPANY_KINDS[square - CO_ITEM]);
      else {
        const n = nodeNear(p), l = n && m.lots.find(x => x.nodes.includes(n.id));
        if (!n) toast('事件格要放在路上：先在「道路」頁畫路');
        else if (l && square && !force) { toast(`這一格屬於地塊「${l.name}」，地塊只能屬於普通格（要放就開「強制放置」）`); audio.ui('error'); }
        else n.ev = square;
      }
      commit(); start = last = null; return;
    }
    if (layer >= L.Building) {
      if (tool === 'eraser') { const i = thingAt(m, p.x, p.y); if (i >= 0) m.things.splice(i, 1); selThing = -1; }
      else if (piece[layer]) {
        const t = { res: piece[layer], x: Math.round(p.x), y: Math.round(p.y), s: 1, face: 0 };
        if (covers(m, t)) { toast('這裡會壓住路或地塊，換個地方放'); audio.ui('error'); }
        else { m.things.push(t); selThing = m.things.length - 1; showOptions(); }
      }
      else toast('先在右邊選一個物件');
      commit(); start = last = null; return;
    }
  });
  function eraseRoad(c: { cx: number; cy: number }) {
    const r = size - 1;
    for (const n of [...m.nodes]) { const dx = n.cx - c.cx, dy = n.cy - c.cy; if (dx * dx + dy * dy <= r * r + r + 0.3) removeNode(n); }
  }
  stage.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) { if (drawTools.has(tool) && tool !== 'lasso' && (layer === L.Ground || layer === L.Road)) hover(e); return; }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      view.x -= (cx - pinch.cx) / view.s; view.y -= (cy - pinch.cy) / view.s;
      zoomAt(cx, cy, d / pinch.d);
      pinch = { d, cx, cy };
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (tuneDrag) {
      const wdx = p.x - tuneDrag.from.x, wdy = p.y - tuneDrag.from.y;
      tuneDrag.from = p;
      if (tuneDrag.k === 'node') {
        const n = m.nodes.find(x => x.id === tuneDrag!.id);
        if (n) { n.cx = Math.max(-.2, Math.min(m.w - .8, n.cx + wdx / CELL)); n.cy = Math.max(-.2, Math.min(m.h - .8, n.cy + wdy / CELL)); }
      } else if (tuneDrag.k === 'lot') {
        const l = m.lots.find(x => x.id === tuneDrag!.id);
        if (l) { const d = lotNudge(m, l, wdx, wdy); l.adj = { a: 0, s: 1, ...l.adj, u: (l.adj?.u ?? 0) + d.u, v: (l.adj?.v ?? 0) + d.v }; }
      } else { const t = m.things[tuneDrag.id]; if (t) { t.x += wdx; t.y += wdy; } }
      dirty(); return;
    }
    if (dragThing) { const t = m.things[dragThing.i]; t.x = Math.round(p.x + dragThing.dx); t.y = Math.round(p.y + dragThing.dy); dirty(); return; }
    if (!start && last) { view.x -= (e.clientX - last.x) / view.s; view.y -= (e.clientY - last.y) / view.s; last = { x: e.clientX, y: e.clientY }; dirty(); return; }
    if (!start || !last) return;
    if (layer === L.Ground && (tool === 'brush' || tool === 'eraser')) { strokeGround(last, p, tool === 'eraser' ? m.base : ground); last = p; gl.uploadCells(); dirty(); return; }
    if (layer === L.Road && tool === 'brush') { roadTo(cellOf(p)); last = p; dirty(); return; }
    if (layer === L.Road && tool === 'eraser') { eraseRoad(cellOf(p)); last = p; dirty(); return; }
    if (tool === 'lasso') {
      const q = lassoPath[lassoPath.length - 1], x = p.x / CELL, y = p.y / CELL;
      if (Math.hypot(x - q.x, y - q.y) > .35) lassoPath.push({ x, y });
      preview = lassoPreview; dirty(); return;
    }
    last = p;
    const a = start;
    preview = cx => shapePreview(cx, a, p);
    dirty();
  });
  const end = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; return; }
    if (tuneDrag) { tuneEnd(); return; }
    if (dragThing) {
      const t = m.things[dragThing.i];
      if (covers(m, t)) { t.x = dragThing.x0; t.y = dragThing.y0; toast('那裡會壓住路或地塊，放回原處了'); audio.ui('error'); }
      dragThing = null; commit(); dirty(); return;
    }
    if (start && last && (tool === 'line' || tool === 'rect')) {
      const a = cellOf(start);
      let b = cellOf(last);
      if (layer === L.Ground) {
        if (tool === 'line') {
          const n = Math.max(Math.abs(b.cx - a.cx), Math.abs(b.cy - a.cy), 1);
          for (let k = 0; k <= n; k++) dab({ x: (a.cx + ((b.cx - a.cx) * k) / n + .5) * CELL, y: (a.cy + ((b.cy - a.cy) * k) / n + .5) * CELL }, ground);
        } else {
          const [x0, x1] = [Math.min(a.cx, b.cx), Math.max(a.cx, b.cx)], [y0, y1] = [Math.min(a.cy, b.cy), Math.max(a.cy, b.cy)];
          for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!hollow || x === x0 || x === x1 || y === y0 || y === y1) setCell(x, y, ground);
        }
      } else if (layer === L.Road) {
        if (tool === 'line') {
          const from = nodeNear(start) ?? ensureNode(a.cx, a.cy);
          if (from) {
            const e = snap8(from, cellOf(last)), dx = e.cx - from.cx, dy = e.cy - from.cy, k = Math.round(Math.hypot(dx, dy));
            if (k) lineTo(from, dx / Math.hypot(dx, dy), dy / Math.hypot(dx, dy), k);
          }
        }
        else {   // a loop of road round the box
          const [x0, x1] = [Math.min(a.cx, b.cx), Math.max(a.cx, b.cx)], [y0, y1] = [Math.min(a.cy, b.cy), Math.max(a.cy, b.cy)];
          roadLast = null;
          for (const q of [{ cx: x0, cy: y0 }, { cx: x1, cy: y0 }, { cx: x1, cy: y1 }, { cx: x0, cy: y1 }, { cx: x0, cy: y0 }]) roadTo(q);
        }
      }
    }
    if (start && tool === 'lasso' && lassoPath.length >= 3) {
      for (const [x, y] of lassoCells(lassoPath, edge, m.w, m.h, (Math.random() * 2 ** 31) | 0)) setCell(x, y, ground);
      gl.uploadCells();
    }
    lassoPath = [];
    preview = null; start = last = null; roadLast = null;
    if (layer === L.Road) joinEnds();
    commit();
    dirty();
  };
  /** The end of a 微調 drag: kept, or put back when it went where it may not. */
  function tuneEnd() {
    const d = tuneDrag!;
    tuneDrag = null;
    let why = '';
    if (d.k === 'node') {
      const n = m.nodes.find(x => x.id === d.id);
      if (n) {
        if (m.nodes.some(o => o !== n && Math.hypot(o.cx - n.cx, o.cy - n.cy) < .6)) why = '離別的格子太近了';
        else if (n.links.some(id => { const o = m.nodes.find(x => x.id === id); return o && Math.hypot(o.cx - n.cx, o.cy - n.cy) > 2.6; })) why = '和相鄰的格子拉得太遠了';
        n.cx = Math.round(n.cx * 1000) / 1000; n.cy = Math.round(n.cy * 1000) / 1000;
      }
    } else if (d.k === 'lot') {
      const l = m.lots.find(x => x.id === d.id);
      if (l?.adj) { l.adj.u = Math.round(l.adj.u); l.adj.v = Math.round(l.adj.v); }
    } else {
      const t = m.things[d.id];
      if (t) { t.x = Math.round(t.x); t.y = Math.round(t.y); if (covers(m, t)) why = '那裡會壓住路或地塊'; }
    }
    if (why && before) { restore(before); before = null; gl.uploadCells(); toast(`${why}，放回原處了`); audio.ui('error'); }
    else commit();
    showOptions(); dirty();
  }
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('contextmenu', e => e.preventDefault());
  stage.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  function hover(e: PointerEvent) {
    const p = toWorld(e.clientX, e.clientY);
    preview = c => {
      const { cx, cy } = cellOf(p);
      c.strokeStyle = '#fff36b'; c.lineWidth = 2;
      c.beginPath();
      const r = layer === L.Road && tool === 'brush' ? 0.5 : size - .5;
      c.arc(((cx + .5) * CELL - view.x) * view.s, ((cy + .5) * CELL - view.y) * view.s, r * CELL * view.s, 0, Math.PI * 2);
      c.stroke();
    };
    dirty();
  }
  function lassoPreview(c: CanvasRenderingContext2D) {
    if (lassoPath.length < 2) return;
    c.beginPath();
    lassoPath.forEach((q, i) => { const x = (q.x * CELL - view.x) * view.s, y = (q.y * CELL - view.y) * view.s; if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.closePath();
    c.fillStyle = 'rgba(255, 243, 107, .22)'; c.fill();
    c.strokeStyle = '#fff36b'; c.lineWidth = 2; c.setLineDash([8, 6]); c.stroke(); c.setLineDash([]);
  }
  function shapePreview(c: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }) {
    const A = cellOf(a);
    let B = cellOf(b);
    if (layer === L.Road && tool === 'line') { const e = snap8(A, B); B = { cx: e.cx, cy: e.cy }; }
    const sx = (x: number) => (x * CELL - view.x) * view.s, sy = (y: number) => (y * CELL - view.y) * view.s;
    c.strokeStyle = '#fff36b'; c.fillStyle = 'rgba(255, 243, 107, .25)'; c.lineWidth = 2; c.setLineDash([8, 6]);
    if (tool === 'rect') {
      const x0 = Math.min(A.cx, B.cx), y0 = Math.min(A.cy, B.cy), x1 = Math.max(A.cx, B.cx) + 1, y1 = Math.max(A.cy, B.cy) + 1;
      if (!hollow && layer === L.Ground) c.fillRect(sx(x0), sy(y0), sx(x1) - sx(x0), sy(y1) - sy(y0));
      c.strokeRect(sx(x0), sy(y0), sx(x1) - sx(x0), sy(y1) - sy(y0));
    } else {
      c.lineWidth = Math.max(4, (layer === L.Road ? 1 : size * 2 - 1) * CELL * view.s * (layer === L.Road ? .6 : 1));
      c.strokeStyle = 'rgba(255, 243, 107, .5)'; c.setLineDash([]); c.lineCap = 'round';
      c.beginPath(); c.moveTo(sx(A.cx + .5), sy(A.cy + .5)); c.lineTo(sx(B.cx + .5), sy(B.cy + .5)); c.stroke();
    }
    c.setLineDash([]);
  }

  // -------------------------------------------------- tabs, materials, options
  const opts = root.querySelector<HTMLElement>('.mk-opts')!, float = root.querySelector<HTMLElement>('.mk-float')!;
  /** A 企業大樓's name: its company's stock name (改名 renames the stock). */
  const coName = (l: MkLot) => { const b = companySlots(m).get(l.id); return b ? stockNames(m)[b.slot] : l.name; };
  /** The looks of a kind of 企業大樓 to choose from (the user 2026-11-16: 多做幾種風格). */
  const styleChips = (k: (typeof COMPANY_KINDS)[number] | undefined, on: number | undefined) => !k ? '' : k.styles.length < 2 ? '' : `<span class="mk-dim">風格</span><div class="chips mk-styles">${k.styles.map(r => `<button class="chip mk-style${r === (on ?? k.styles[0]) ? ' on' : ''}" data-style="${r}" title="${STYLE_NAMES[r] ?? ''}">${styleIcon(r) ? `<img src="${styleIcon(r)}" alt="${STYLE_NAMES[r] ?? ''}">` : STYLE_NAMES[r] ?? r}</button>`).join('')}</div>`;
  function showGrid() {
    let html = '';
    if (layer === L.Ground) html = GROUNDS.map((g, i) => `<button class="mk-sw${i === ground ? ' on' : ''}" data-g="${i}"><img src="${TEX}/ground-${g.key}.webp" alt="">${g.name}</button>`).join('');
    else if (layer === L.Road) html = ROAD_STYLES.map((r, i) => `<button class="mk-sw${i === road ? ' on' : ''}" data-r="${i}"><i class="mk-road" style="--s:${r.surface};--v:${r.verge};--m:${r.mid || 'transparent'}"></i>${r.name}</button>`).join('');
    else if (layer === L.Square) html = `<button class="mk-sw${square === LOT_SMALL ? ' on' : ''}" data-sq="${LOT_SMALL}"><i class="mk-lot"></i>小地塊</button><button class="mk-sw${square === LOT_BIG ? ' on' : ''}" data-sq="${LOT_BIG}"><i class="mk-lot big"></i>大型用地</button>`
      + COMPANY_KINDS.map((k, i) => { const ic = styleIcon(coStyle[k.cat] ?? k.styles[0]); return `<button class="mk-sw${square === CO_ITEM + i ? ' on' : ''}" data-sq="${CO_ITEM + i}">${ic ? `<img src="${ic}" alt="" class="piece co">` : '<i class="mk-lot big"></i>'}${k.name}</button>`; }).join('')
      + EVENTS.map(e => `<button class="mk-sw${e.ev === square ? ' on' : ''}" data-sq="${e.ev}">${e.pad >= 0 ? `<img src="${ASSETS}/hd/map/0024-SMP/frame-${String(e.pad).padStart(3, '0')}.webp" alt="" class="pad">` : '<i class="mk-dot"></i>'}${e.name}</button>`).join('');
    else {
      // the kind chosen (pieces.ts), its pieces
      const kinds = layer === L.Building ? BUILDING_KINDS : DECOR_KINDS, k = kind[layer] ?? kinds[0];
      const ids = piecesOf(pieces, k);
      const cats = `<div class="mk-cats">${kinds.map(x => `<button class="chip${x === k ? ' on' : ''}" data-kind="${x}">${x}</button>`).join('')}</div>`;
      if (!piece[layer] && ids.length) piece[layer] = ids[0];
      html = cats + (ids.length ? ids.map(id => `<button class="mk-sw${id === piece[layer] ? ' on' : ''}" data-p="${id}"><img loading="lazy" src="${ASSETS}/maps/remake/sprites/${id}/frame-000.webp" alt="" class="piece"></button>`).join('') : `<p class="mk-none">${pieces.length ? '這一類還沒有物件' : '載入中…'}</p>`);
    }
    grid.innerHTML = html;
    grid.classList.toggle('pieces', layer >= L.Building);
  }
  function showOptions() {
    const sizes = `<div class="chips">${[1, 2, 3, 4, 5].map(n => `<button class="chip${n === size ? ' on' : ''}" data-size="${n}">${['小', '', '中', '', '大'][n - 1] || n}</button>`).join('')}</div>`;
    let html = '';
    if (layer === L.Ground) {
      const name = GROUNDS[ground].name;
      if (tool === 'brush' || tool === 'line') html = `<span>${tool === 'brush' ? '畫筆' : '直線'}・${name}</span><span class="mk-dim">粗細</span>${sizes}`;
      else if (tool === 'eraser') html = `<span>橡皮擦：擦回「${GROUNDS[m.base].name}」</span><span class="mk-dim">粗細</span>${sizes}`;
      else if (tool === 'rect') html = `<span>方塊・${name}</span><div class="chips"><button class="chip${hollow ? '' : ' on'}" data-hollow="0">實心</button><button class="chip${hollow ? ' on' : ''}" data-hollow="1">空心</button></div>`;
      else if (tool === 'bucket') html = `<span>油漆桶：把連在一起的同一種地面換成「${name}」</span>`;
      else if (tool === 'lasso') html = `<span>圈地・${name}</span><span class="mk-dim">邊緣</span><div class="chips">${EDGES.map((e, i) => `<button class="chip${i === edge ? ' on' : ''}" data-edge="${i}">${e}</button>`).join('')}</div>`;
    } else if (layer === L.Road) {
      const name = ROAD_STYLES[road].name;
      if (tool === 'brush') html = `<span>畫路・${name}：手指走過的格子連成路，每格一步</span>`;
      else if (tool === 'line') html = `<span>直線路・${name}：橫、豎或斜 45 度，每一步一樣長</span>`;
      else if (tool === 'rect') html = `<span>方塊：拉出一圈環形的${name}</span>`;
      else if (tool === 'eraser') html = `<span>橡皮擦：只擦路</span><span class="mk-dim">粗細</span>${sizes}`;
      else if (tool === 'bucket') html = `<span>油漆桶：點一條路，整條換成${name}</span>`;
    } else if (layer === L.Square) {
      const l = m.lots.find(x => x.id === selLot);
      const st = l && m.streets.find(x => x.id === l.street);
      if (tool === 'pointer' && joining !== null) {
        const js = m.streets.find(x => x.id === joining);
        html = `<span>點其他小地塊，加入「${esc(js?.name ?? '')}」</span><button class="chip on" data-lot="joined">好了</button>`;
      } else if (tool === 'pointer' && l && st) {
        const n = m.lots.filter(x => x.street === st.id).length;
        html = `<span>街名</span><input class="mk-in" data-st="name" maxlength="7" value="${esc(st.name)}"><span>底價</span><input class="mk-in num" data-st="price" type="number" min="100" max="9900" step="100" value="${st.price}"><span class="mk-dim">${n} 塊</span>`
          + `<button class="chip" data-lot="join">這條街加地塊</button><button class="chip" data-lot="alone">拆成單獨一條街</button><button class="chip" data-lot="link">重新關聯格子</button><button class="chip" data-lot="del">刪除地塊</button>`;
      } else if (tool === 'pointer' && l && l.kind === 2) {
        const k = companyKind(l.co);
        html = `<span>${esc(coName(l))}</span><span class="mk-dim">${k?.name ?? ''}</span>${styleChips(k, l.style)}<button class="chip" data-lot="rename">改名</button><button class="chip" data-lot="link">重新關聯格子</button><button class="chip" data-lot="del">刪除</button>`;
      } else if (tool === 'pointer' && l) {
        const prices = l.kind ? PLOT_PRICES : LAND_PRICES;
        html = `<span>${esc(l.name)}</span><div class="chips">${prices.map(v => `<button class="chip${v === l.price ? ' on' : ''}" data-price="${v}">${v}</button>`).join('')}</div><button class="chip" data-lot="rename">改名</button><button class="chip" data-lot="link">重新關聯格子</button><button class="chip" data-lot="del">刪除</button>`;
      } else if (tool === 'pointer') html = '<span>指針：點一塊地，改街名、底價，或把地塊編進一條街</span>';
      else if (tool === 'eraser') html = '<span>橡皮擦：點地塊刪掉，點事件格變回普通格</span>';
      else if (square >= CO_ITEM) { const k = COMPANY_KINDS[square - CO_ITEM]; html = `<span>${k.name}：${force ? '點空地放下，再點路上的格子' : '綠色的地方可以放'}</span>${styleChips(k, coStyle[k.cat])}`; }
      else html = square === LOT_SMALL || square === LOT_BIG ? `<span>${square === LOT_BIG ? '大型用地（2×2 格）' : '小地塊'}：${force ? '點任何空地放下，再點路上的格子關聯' : '綠色的地方可以放'}</span>` : `<span>${evInfo(square).name}：點路上的格子</span>`;
      if (tool === 'brush') html += `<button class="chip${force ? ' on' : ''}" data-force="1">強制放置</button>`;
    } else {
      const t = m.things[selThing];
      if (tool === 'pointer' && t) html = `<span>轉向</span><button class="chip" data-th="left">↺</button><button class="chip" data-th="right">↻</button><span>大小</span><button class="chip" data-th="small">－</button><span>${Math.round(t.s * 100)}%</span><button class="chip" data-th="big">＋</button><button class="chip" data-th="del">刪除</button>`;
      else if (tool === 'pointer') html = '<span>指針：點物件選中，可以拖動、轉向、放大縮小</span>';
      else if (tool === 'eraser') html = '<span>橡皮擦：點物件刪掉</span>';
      else html = '<span>點地圖擺上選中的物件</span>';
    }
    if (linkLot !== null && layer === L.Square) {
      const l = m.lots.find(x => x.id === linkLot);
      html = `<span>關聯格子・${esc(l?.name ?? '')}：點路上的格子（${l?.kind ? '大型用地要 2 格' : '小地塊要 1 格'}，已選 ${l?.nodes.length ?? 0}）</span><button class="chip on" data-lot="linked">好了</button>`;
    }
    if (tool === 'tune') {
      const l = m.lots.find(x => x.id === selLot), t = m.things[selThing], n = m.nodes.find(x => x.id === selNode);
      if (l) html = `<span>微調・${esc(l.name)}</span><span class="mk-dim">旋轉</span><input class="mk-range" type="range" data-tune="a" min="-45" max="45" step="1" value="${Math.round(((l.adj?.a ?? 0) * 180) / Math.PI)}"><span class="mk-dim">大小</span><input class="mk-range" type="range" data-tune="s" min="60" max="160" step="5" value="${Math.round((l.adj?.s ?? 1) * 100)}"><button class="chip" data-tn="reset">復原</button>`;
      else if (t) html = `<span>微調：拖動擺放</span><span>轉向</span><button class="chip" data-th="left">↺</button><button class="chip" data-th="right">↻</button><span>大小</span><button class="chip" data-th="small">－</button><span>${Math.round(t.s * 100)}%</span><button class="chip" data-th="big">＋</button>`;
      else if (n) html = '<span>選中了這一格：拖動它，路跟著彎，旁邊的地塊也跟著走</span><button class="chip" data-tn="grid">對齊格子</button>';
      else html = '<span>微調：按住地塊或建築拖動；點路上的格子選中，再拖動它讓路變形</span>';
    }
    if (tool === 'move') html = '<span>移動：拖動地圖（兩根手指也可以縮放、移動）</span>';
    float.innerHTML = html;
    opts.innerHTML = html;
  }
  function pick(l: number, v: number) {
    if (l === L.Ground) ground = v; else if (l === L.Road) road = v; else if (l === L.Square) square = v; else piece[l] = v;
    if (tool === 'tune' || tool === 'eraser' || tool === 'move') setTool('brush');
    showGrid(); showOptions();
    audio.ui('click');
  }
  function setTool(t: Tool) {
    tool = t;
    root.querySelectorAll<HTMLElement>('.mk-tool').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    preview = null; dirty();
    showOptions();
  }
  function setLayer(l: L) {
    layer = l; selLot = -1; selThing = -1; selNode = -1;
    root.querySelectorAll<HTMLElement>('.mk-tab').forEach(b => b.classList.toggle('on', Number(b.dataset.tab) === l));
    if (l === L.Square && tool !== 'pointer' && tool !== 'eraser') setTool('brush');
    showGrid(); showOptions(); dirty();
  }
  showGrid(); showOptions();
  // 街名 / 底價 typed in the options: the whole street takes them
  // 微調's sliders: the chosen lot turns and grows as the slider moves; one undo step for the move
  root.addEventListener('input', e => {
    const t = e.target as HTMLInputElement, k = t.dataset.tune, l = m.lots.find(x => x.id === selLot);
    if (!k || !l) return;
    if (!before) begin();
    l.adj = { u: 0, v: 0, a: 0, s: 1, ...l.adj };
    if (k === 'a') l.adj.a = (Number(t.value) * Math.PI) / 180; else l.adj.s = Number(t.value) / 100;
    dirty();
  });
  root.addEventListener('change', e => {
    if ((e.target as HTMLElement).dataset.tune) { commit(); return; }
    const t = e.target as HTMLInputElement, k = t.dataset.st;
    if (!k) return;
    const l = m.lots.find(x => x.id === selLot), st = l && m.streets.find(x => x.id === l.street);
    if (!st) return;
    begin();
    if (k === 'name') { const v = t.value.trim().slice(0, 7); if (v) st.name = v; }
    else { const v = Math.round(Number(t.value) / 100) * 100; st.price = Math.max(100, Math.min(9900, v || st.price)); }
    commit(); showOptions(); dirty();
  });
  root.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.t) {
      if (b.classList.contains('soon')) { toast('這個工具正在製作中'); audio.ui('error'); return; }
      audio.ui('click'); setTool(b.dataset.t as Tool); return;
    }
    if (b.dataset.tab) { audio.ui('click'); setLayer(Number(b.dataset.tab)); return; }
    if (b.dataset.g) { pick(L.Ground, Number(b.dataset.g)); return; }
    if (b.dataset.r) { pick(L.Road, Number(b.dataset.r)); return; }
    if (b.dataset.sq) { const v = Number(b.dataset.sq); pick(L.Square, v); if (v >= CO_ITEM) { const k = COMPANY_KINDS[v - CO_ITEM]; toast(`${k.name}（2×2 格，要兩格相連的路）：${k.what}`); } return; }
    if (b.dataset.p) { pick(layer, Number(b.dataset.p)); return; }
    if (b.dataset.kind) { kind[layer] = b.dataset.kind as PieceKind; audio.ui('click'); showGrid(); grid.scrollTo({ left: 0, top: 0 }); return; }
    if (b.dataset.size) { size = Number(b.dataset.size); audio.ui('click'); showOptions(); return; }
    if (b.dataset.edge) { edge = Number(b.dataset.edge) as Edge; audio.ui('click'); showOptions(); return; }
    if (b.dataset.hollow) { hollow = b.dataset.hollow === '1'; audio.ui('click'); showOptions(); return; }
    if (b.dataset.style) {
      const v = Number(b.dataset.style), l = m.lots.find(x => x.id === selLot && x.kind === 2);
      if (l && tool === 'pointer') { begin(); l.style = v; commit(); dirty(); }
      else if (square >= CO_ITEM) { coStyle[COMPANY_KINDS[square - CO_ITEM].cat] = v; showGrid(); }
      audio.ui('click'); showOptions(); return;
    }
    if (b.dataset.price) { const l = m.lots.find(x => x.id === selLot); if (l) { begin(); l.price = Number(b.dataset.price); commit(); showOptions(); } return; }
    if (b.dataset.force) { force = !force; audio.ui('click'); showOptions(); dirty(); return; }
    if (b.dataset.lot === 'linked') { linkLot = null; audio.ui('click'); showOptions(); dirty(); return; }
    if (b.dataset.lot) {
      const l = m.lots.find(x => x.id === selLot);
      if (!l) return;
      begin();
      if (b.dataset.lot === 'del') { m.lots = m.lots.filter(x => x !== l); selLot = -1; pruneStreets(); }
      else if (b.dataset.lot === 'join') { joining = l.street ?? null; before = null; showOptions(); audio.ui('click'); return; }
      else if (b.dataset.lot === 'joined') { joining = null; before = null; showOptions(); dirty(); return; }
      else if (b.dataset.lot === 'link') { linkLot = l.id; before = null; audio.ui('click'); showOptions(); dirty(); return; }
      else if (b.dataset.lot === 'alone') {
        const old = m.streets.find(x => x.id === l.street);
        const st = { id: m.nextId++, name: `新街${m.streets.length + 1}`, price: old?.price ?? 1000 };
        m.streets.push(st); l.street = st.id; pruneStreets();
      }
      else if (l.kind === 2) {
        // the company's name is its stock's (the 股票 sheet shows the same name)
        before = null;
        const slot = companySlots(m).get(l.id)?.slot;
        void uiPrompt('公司的名字（也是它的股票名）', coName(l), 7, '最多 7 個字').then(n => {
          if (!n || slot === undefined) return;
          begin(); m.stocks ??= { group: 0, names: [] };
          while (m.stocks.names.length <= slot) m.stocks.names.push('');
          m.stocks.names[slot] = n; commit(); showOptions(); dirty();
        });
        return;
      }
      else { before = null; void uiPrompt('地塊的名字', l.name, 7, '最多 7 個字').then(n => { if (!n) return; begin(); l.name = n; commit(); showOptions(); dirty(); }); return; }
      commit(); showOptions(); dirty(); return;
    }
    if (b.dataset.tn) {
      begin();
      const l = m.lots.find(x => x.id === selLot), n = m.nodes.find(x => x.id === selNode);
      if (b.dataset.tn === 'reset' && l) delete l.adj;
      if (b.dataset.tn === 'grid' && n) {
        const cx = Math.round(n.cx), cy = Math.round(n.cy);
        if (m.nodes.some(o => o !== n && Math.hypot(o.cx - cx, o.cy - cy) < .6)) toast('那一格已經有別的格子了');
        else { n.cx = cx; n.cy = cy; }
      }
      audio.ui('click'); commit(); showOptions(); dirty(); return;
    }
    if (b.dataset.th) {
      const t = m.things[selThing];
      if (!t) return;
      begin();
      const k = b.dataset.th;
      if (k === 'left') t.face = (t.face + 7) % 8;
      if (k === 'right') t.face = (t.face + 1) % 8;
      if (k === 'small') t.s = Math.max(0.4, Math.round((t.s - 0.1) * 10) / 10);
      if (k === 'big') { t.s = Math.min(2.5, Math.round((t.s + 0.1) * 10) / 10); if (covers(m, t)) { t.s = Math.round((t.s - 0.1) * 10) / 10; toast('再大就會壓住路或地塊了'); } }
      if (k === 'del') { m.things.splice(selThing, 1); selThing = -1; }
      commit(); showOptions(); dirty(); return;
    }
    if (b.dataset.z) { const r = stage.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, b.dataset.z === '1' ? 1.25 : 0.8); return; }
    switch (b.dataset.a) {
      case 'undo': { const s = undo.pop(); if (s) { redo.push(snap()); restore(s); changed(); audio.ui('click'); } else audio.ui('error'); return; }
      case 'redo': { const s = redo.pop(); if (s) { undo.push(snap()); restore(s); changed(); audio.ui('click'); } else audio.ui('error'); return; }
      case 'check': { mendEnds(); const p = problemList(m); if (p.length) showProblems(p, false); else { toast('檢查通過，可以試玩了'); audio.ui('yes'); } return; }
      case 'play': {
        mendEnds();
        const p = problemList(m);
        if (p.length) { showProblems(p, true); return; }
        startPlay();
        return;
      }
      case 'menu': menu(); return;
    }
  });
  /**
   * 試玩 (the user 2026-11-12): its own kind of game — 10 萬 and no 點券, 1 to 3 computers, a faster speed, ended at any
   * time, no saving; a bankruptcy in it lets the map be published. Back to this map in the editor when it ends.
   */
  function startPlay() {
    let n = 3;
    try { n = Math.max(1, Math.min(3, Number(localStorage.getItem('rich4.maker.trialCpus') ?? 3))); } catch { /* 3 */ }
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov';
    const draw = () => `<div class="msg sheet mk-trial"><div class="ribbon">試玩</div>
      <ul><li>資金固定 10 萬、點券 0</li><li>不能存檔，隨時可以按「結束試玩」</li><li>可以用「試玩超快」的速度（系統設定裡）</li><li>玩到<b>有一位玩家破產</b>，這張地圖就可以發布</li></ul>
      <div class="mk-row"><span>電腦人數</span><div class="chips">${[1, 2, 3].map(k => `<button class="chip${k === n ? ' on' : ''}" data-cpu="${k}">${k} 個</button>`).join('')}</div></div>
      <div class="choices"><button class="candy ghost" data-t="no">取消</button><button class="candy yes" data-t="go">開始試玩</button></div></div>`;
    ov.innerHTML = draw();
    root.append(ov);
    ov.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.cpu) { n = Number(b.dataset.cpu); ov.innerHTML = draw(); audio.ui('click'); return; }
      if (b.dataset.t === 'no') { audio.ui('no'); ov.remove(); return; }
      if (b.dataset.t !== 'go') return;
      ov.remove();
      try { localStorage.setItem('rich4.maker.trialCpus', String(n)); sessionStorage.setItem('rich4.maker.back', m.id); } catch { /* not kept */ }
      saveNow(); audio.ui('yes'); played(m);
      toast('準備試玩…');
      void playMap(m, s => { close(); play(s); }, n).catch(err => toast(`試玩失敗：${(err as Error).message}`));
    });
  }
  /** Shows the map's point (world px) in the middle of the stage, near enough to see. */
  const goTo = (q: { x: number; y: number }) => {
    const r = stage.getBoundingClientRect();
    view.s = Math.max(view.s, 1);
    view.x = q.x - r.width / 2 / view.s; view.y = q.y - r.height / 2 / view.s;
    dirty();
  };
  /**
   * 檢查 / 試玩 with problems (the user 2026-11-12: the toast was easy to miss and named nothing): a list over the map,
   * each with where it is — tapped, the map goes there and rings it in red; 強制試玩 when none is one the game cannot
   * run without.
   */
  /** Before the check: road ends left beside each other (maps drawn before joinEnds) joined, as one undo step. */
  function mendEnds() {
    begin();
    const k = joinEnds();
    commit();
    if (k) { dirty(); toast(`已把 ${k} 處挨著的路接上`); }
  }
  /** After 強制修復: what was changed (復原 takes it all back), then the check again if anything is left. */
  function fixReport(did: string[], left: Problem[], forPlay: boolean) {
    audio.ui(did.length ? 'yes' : 'error');
    const box = document.createElement('div');
    box.className = 'mk-probs';
    box.innerHTML = `<div class="mk-probs-head">強制修復${did.length ? `：改了 ${did.length} 處` : ''}</div>
      <div class="mk-probs-list">${(did.length ? did : ['沒有能自動修的地方']).map(t => `<div class="mk-prob done"><span>${esc(t)}</span></div>`).join('')}
      ${left.length ? `<div class="mk-dim">還剩 ${left.length} 個問題要自己改</div>` : '<div class="mk-dim">檢查通過，可以試玩了；不滿意可以按「復原」退回去</div>'}</div>
      <div class="mk-probs-acts">${left.length ? '<button class="chip" data-pa="left">看剩下的問題</button>' : forPlay ? '<button class="chip" data-pa="play">試玩</button>' : ''}<button class="chip on" data-pa="close">關閉</button></div>`;
    stage.append(box);
    box.addEventListener('pointerdown', e => e.stopPropagation());
    box.addEventListener('click', e => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      box.remove();
      if (b.dataset.pa === 'left') showProblems(left, forPlay);
      else if (b.dataset.pa === 'play') startPlay();
      else audio.ui('click');
    });
  }
  function showProblems(list: Problem[], forPlay: boolean) {
    stage.querySelector('.mk-probs')?.remove();
    audio.ui('error');
    const hard = list.some(p => p.hard);
    const box = document.createElement('div');
    box.className = 'mk-probs';
    box.innerHTML = `<div class="mk-probs-head">${forPlay ? '還不能試玩' : '檢查'}：${list.length} 個問題${list.some(p => p.at) ? '，點一條看位置' : ''}</div>
      <div class="mk-probs-list">${list.map((p, i) => `<button class="mk-prob${p.hard ? ' hard' : ''}" data-pi="${i}"><span>${esc(p.text)}</span>${p.at ? '<i>看位置</i>' : ''}</button>`).join('')}</div>
      <div class="mk-probs-acts">${hard ? '<span class="mk-dim">紅色的問題要先改好才能試玩</span>' : '<button class="chip" data-pa="force">強制試玩</button>'}<button class="chip mk-fix" data-pa="fix">強制修復</button><button class="chip on" data-pa="close">關閉</button></div>`;
    stage.append(box);
    const show = (p: Problem) => { if (!p.at) return; marks = p.at; goTo(p.at[0]); };
    const first = list.find(p => p.at);
    if (first) show(first);
    box.addEventListener('pointerdown', e => e.stopPropagation());
    box.addEventListener('click', e => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.pi) { audio.ui('click'); show(list[Number(b.dataset.pi)]); return; }
      if (b.dataset.pa === 'force') { box.remove(); marks = []; startPlay(); return; }
      if (b.dataset.pa === 'fix') {
        // 強制修復 (fix.ts, the user 2026-11-14): the map put right by itself, one undo step; what it did, and what is left
        begin();
        const did = autoFix(m);
        commit();
        box.remove(); marks = []; dirty();
        const left = problemList(m);
        fixReport(did, left, forPlay);
        return;
      }
      if (b.dataset.pa === 'close') { box.remove(); marks = []; dirty(); audio.ui('click'); }
    });
  }
  /** The whole map as a small picture for the library (a JPEG data: URL): drawn once fitted, the view put back after. */
  function mapPicture(S = 360): string {
    const keep = { ...view }, sel = [selLot, selThing, selNode, marks] as const;
    selLot = selThing = selNode = -1; marks = [];
    fit(); render();
    const r = stage.getBoundingClientRect(), dpr = gl.canvas.width / Math.max(1, r.width);
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d')!;
    x.fillStyle = '#123a7a'; x.fillRect(0, 0, S, S);
    const sx = -view.x * view.s * dpr, sy = -view.y * view.s * dpr, sw = m.w * CELL * view.s * dpr, sh = m.h * CELL * view.s * dpr;
    const k = Math.min(S / sw, S / sh), dw = sw * k, dh = sh * k;
    for (const src of [gl.canvas, over]) x.drawImage(src, sx, sy, sw, sh, (S - dw) / 2, (S - dh) / 2, dw, dh);
    Object.assign(view, keep); [selLot, selThing, selNode] = sel; marks = sel[3]; dirty();
    return c.toDataURL('image/jpeg', S > 240 ? 0.72 : 0.7);
  }
  /**
   * 發布到地圖庫 (the user 2026-11-12): the maker's name, the map's 說明 and a 寄語 for its players, and contacts (微信,
   * LINE, IG, Telegram — up to two, shown on the map's page in the hall); the name and contacts kept for next time.
   */
  function publishSheet() {
    let mine: Partial<LibAbout> = {}, here: Partial<LibAbout> = {};
    try { mine = JSON.parse(localStorage.getItem('rich4.maker.about') ?? '{}'); here = JSON.parse(localStorage.getItem(`rich4.maker.about.${m.id}`) ?? '{}'); } catch { /* none yet */ }
    let nick = mine.author ?? '';
    try { nick ||= localStorage.getItem('rich4.party.name') ?? ''; } catch { /* none */ }
    const cs = [...(mine.contact ?? []), { k: 'wechat', v: '' }, { k: 'ig', v: '' }].slice(0, 2);
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov';
    ov.innerHTML = `<div class="msg sheet mk-pub"><div class="ribbon">${m.published ? '更新到創作樂園' : '發布到創作樂園'}</div>
      <label class="mk-pub-row"><span>作者</span><input data-p="author" maxlength="12" value="${esc(nick)}" placeholder="你的名字"></label>
      <label class="mk-pub-row top"><span>地圖說明</span><textarea data-p="desc" maxlength="300" rows="3" placeholder="這張地圖的特色、玩法、靈感…">${esc(here.desc ?? '')}</textarea></label>
      <label class="mk-pub-row"><span>寄語</span><input data-p="note" maxlength="60" value="${esc(here.note ?? '')}" placeholder="想對來玩的人說的一句話"></label>
      ${cs.map((c, i) => `<div class="mk-pub-row"><span>${i ? '' : '聯絡方式'}</span><select data-ck="${i}">${CONTACT_KINDS.map(([k, n]) => `<option value="${k}"${k === c.k ? ' selected' : ''}>${n}</option>`).join('')}</select><input data-cv="${i}" maxlength="40" value="${esc(c.v)}" placeholder="選填"></div>`).join('')}
      <p class="mk-deck-hint">說明、寄語和聯絡方式會顯示在創作樂園裡，所有人都看得到。</p>
      <div class="choices"><button class="candy ghost" data-p="cancel">取消</button><button class="candy yes" data-p="go">發布</button></div></div>`;
    root.append(ov);
    ov.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.p === 'cancel') { audio.ui('no'); ov.remove(); return; }
      if (b.dataset.p !== 'go') return;
      const val = (k: string) => ov.querySelector<HTMLInputElement>(`[data-p="${k}"]`)!.value.trim();
      const about: LibAbout = { author: val('author').slice(0, 12), desc: val('desc').slice(0, 300), note: val('note').slice(0, 60),
        contact: [0, 1].map(i => ({ k: ov.querySelector<HTMLSelectElement>(`[data-ck="${i}"]`)!.value, v: ov.querySelector<HTMLInputElement>(`[data-cv="${i}"]`)!.value.trim().slice(0, 40) })).filter(c => c.v) };
      if (!about.author) { toast('要填作者名字'); audio.ui('error'); return; }
      try {
        localStorage.setItem('rich4.maker.about', JSON.stringify({ author: about.author, contact: about.contact }));
        localStorage.setItem(`rich4.maker.about.${m.id}`, JSON.stringify({ desc: about.desc, note: about.note }));
      } catch { /* not kept */ }
      ov.remove(); toast('發布中…');
      void publish(m, about, mapPicture()).then(() => { audio.ui('yes'); toast('已發布到創作樂園'); }).catch(err => { audio.ui('error'); void uiAlert((err as Error).message); });
    });
  }
  /** 隨機創建: the themes; one picked makes the whole map anew (one undo step). */
  function randomSheet() {
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov';
    ov.innerHTML = `<div class="msg sheet mk-themes"><div class="ribbon">隨機創建</div>
      <p class="mk-deck-hint">選一個主題，系統會用 ${m.w} × ${m.h} 的大小做一張能玩的地圖：路、事件、地塊、建築和樹都擺好，你再慢慢微調。現在的地圖會被換掉（可以按「撤銷」換回來）。</p>
      <div class="mk-theme-grid">${THEMES.map((t, i) => `<button class="mk-theme" data-th-i="${i}" style="--bg:url('${TEX}/ground-${GROUNDS[t.key === 'island' ? G['shallow-sea'] : t.land].key}.webp')"><b>${t.name}</b><small>${t.desc}</small></button>`).join('')}</div>
      <div class="choices"><button class="candy ghost" data-th-i="x">取消</button></div></div>`;
    root.append(ov);
    ov.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-th-i]');
      if (!b) return;
      if (b.dataset.thI === 'x') { audio.ui('no'); ov.remove(); return; }
      const th = THEMES[Number(b.dataset.thI)];
      ov.remove(); audio.ui('yes'); toast(`正在創建「${th.name}」地圖…`);
      void (async () => {
        try {
          const ids = pieces.length ? pieces : ((await fetch(`${TEX}/pieces.json`).then(r => r.json())) as number[]);
          begin();
          await randomize(m, { theme: th, seed: (Math.random() * 2 ** 31) | 0, pieces: ids });
          selLot = selThing = selNode = -1; linkLot = null;
          commit(); fit(); showOptions(); dirty();
          toast(`「${th.name}」地圖做好了：用「微調」和畫筆慢慢改吧`);
        } catch (err) { before = null; toast(`創建失敗：${(err as Error).message}`); audio.ui('error'); }
      })();
    });
  }
  function menu() {
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov';
    // (the user 2026-11-12: in neat rows) three groups of three, then publishing and leaving
    const sec = (title: string, bs: [string, string][]) => `<h4>${title}</h4><div class="mk-menu-grid">${bs.map(([k, t]) => `<button class="candy" data-m="${k}">${t}</button>`).join('')}</div>`;
    ov.innerHTML = `<div class="msg sheet mk-menu"><div class="ribbon">選單</div>
      ${sec('地圖', [['random', '隨機創建'], ['rename', '改名字'], ['fit', '看整張地圖']])}
      ${sec('玩法', [['deck', '新聞命運卡'], ['stocks', '股票'], ['rules', '特殊規則']])}
      ${sec('外觀', [['wood', '樹林樣式'], ['tex', '地面紋理'], ['light', '光影設定']])}
      <div class="mk-menu-grid two"><button class="candy" data-m="grid">${gl.grid ? '隱藏格線' : '顯示格線'}</button><button class="candy" data-m="publish">${m.published ? '更新到創作樂園' : '發布到創作樂園'}</button></div>
      <div class="mk-menu-grid two"><button class="candy ghost" data-m="close">繼續畫</button><button class="candy no" data-m="quit">存檔並離開</button></div></div>`;
    root.append(ov);
    ov.addEventListener('click', e => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.m;
      if (!k) return;
      ov.remove();
      if (k === 'light') lightSheet();
      if (k === 'random') randomSheet();
      if (k === 'tex') texSheet();
      if (k === 'wood') woodSheet();
      if (k === 'publish') {
        // only a map its maker has won on, as it is now (the user 2026-11-12); the maker's name goes with it
        if (notOwn(m)) { audio.ui('error'); void uiAlert(`${fromSample(m) ? '示例地圖「梨園萊陽」' : '從創作樂園下載的地圖'}和用它改出來的地圖可以自己玩，但不能發布到創作樂園。\n想發布的話，用「新建地圖」或「隨機創建」做一張自己的地圖吧！`); return; }
        if (!cleared(m)) { audio.ui('error'); void uiAlert('要先用「試玩」把這張地圖玩到有一位玩家破產（或玩贏一局），才能發布到創作樂園。\n之後如果又改了格子、地塊、街道、卡片、股票或特殊規則，要再試玩一次。'); return; }
        publishSheet();
      }
      if (k === 'stocks') { begin(); stockSheet(root, m, () => { commit(); begin(); }); }
      if (k === 'deck') { begin(); deckSheet(root, m, () => { commit(); begin(); }); }
      if (k === 'rules') { begin(); rulesSheet(root, m, () => { commit(); begin(); }); }
      if (k === 'grid') { gl.grid = !gl.grid; dirty(); }
      if (k === 'fit') { fit(); dirty(); }
      if (k === 'rename') {
        void uiPrompt('地圖的名字', m.name, NAME_MAX, `最多 ${NAME_MAX} 個字`).then(n => { if (n) { m.name = n; root.querySelector('.mk-name b')!.textContent = m.name; saveMap(m); } });
      }
      if (k === 'quit') { saveNow(); audio.ui('no'); close(); openMaker(app, back, play); }
    });
  }
  /** 光影設定 (the user 2026-11-12): the shadows' direction, length, softness and strength, and the border line. */
  function lightSheet() {
    const L = { ...DEFAULT_LIGHT, ...m.light };
    const rows: [keyof MkLight, string, number, number, number, (v: number) => string][] = [
      ['angle', '方向', 0, 355, 5, v => ['右', '右下', '下', '左下', '左', '左上', '上', '右上'][Math.round(v / 45) % 8]],
      ['length', '長短', 0, 20, 1, v => `${v}`], ['soft', '虛實', 0, 1, 0.05, v => (v < .35 ? '實' : v > .7 ? '虛' : '中')],
      ['strength', '深淺', 0, 1, 0.05, v => `${Math.round(v * 100)}%`], ['rim', '邊線', 0, 1, 0.05, v => `${Math.round(v * 100)}%`]];
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov mk-light-ov';
    ov.innerHTML = `<div class="msg sheet mk-menu"><div class="ribbon">光影設定</div>
      ${rows.map(([k, n, lo, hi, st]) => `<label class="mk-row"><span>${n}</span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${L[k]}" data-l="${k}"><b data-lv="${k}"></b></label>`).join('')}
      <div class="choices"><button class="candy ghost" data-l="reset">恢復預設</button><button class="candy yes" data-l="ok">好</button></div></div>`;
    root.append(ov);
    const show = () => rows.forEach(([k, , , , , f]) => { ov.querySelector<HTMLElement>(`[data-lv="${k}"]`)!.textContent = f(L[k]); });
    show();
    begin();
    ov.addEventListener('input', e => {
      const t = e.target as HTMLInputElement, k = t.dataset.l as keyof MkLight;
      if (!k) return;
      L[k] = Number(t.value); m.light = { ...L }; show(); dirty();
    });
    ov.addEventListener('click', e => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.l;
      if (k === 'reset') { Object.assign(L, DEFAULT_LIGHT); m.light = { ...L }; ov.querySelectorAll<HTMLInputElement>('input[data-l]').forEach(i => (i.value = String(L[i.dataset.l as keyof MkLight]))); show(); dirty(); }
      if (k === 'ok') { ov.remove(); commit(); audio.ui('yes'); }
    });
  }
  /** 樹林樣式 (the user 2026-11-12): trees planted one by one or the texture; how many, how big, how varied. */
  function woodSheet() {
    const W = { ...DEFAULT_WOOD, ...m.wood };
    const rows: [keyof MkWood, string, number, number, number, (v: number) => string][] = [
      ['density', '密度', 0, 1, 0.05, v => `${Math.round(v * 100)}%`], ['size', '大小', 0.6, 1.6, 0.05, v => `${Math.round(v * 100)}%`],
      ['spread', '大小差異', 0, 1, 0.05, v => `${Math.round(v * 100)}%`], ['colour', '顏色差異', 0, 1, 0.05, v => `${Math.round(v * 100)}%`],
      ['strays', '林邊零星', 0, 1, 0.05, v => `${Math.round(v * 100)}%`]];
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov mk-light-ov';
    ov.innerHTML = `<div class="msg sheet mk-menu"><div class="ribbon">樹林樣式</div>
      <div class="chips"><button class="chip" data-w="mode0">一棵棵種樹</button><button class="chip" data-w="mode1">樹林貼圖</button></div>
      ${rows.map(([k, n, lo, hi, st]) => `<label class="mk-row"><span>${n}</span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${W[k]}" data-w="${k}"><b data-wv="${k}"></b></label>`).join('')}
      <div class="choices"><button class="candy ghost" data-w="seed">重新隨機</button><button class="candy ghost" data-w="reset">恢復預設</button><button class="candy yes" data-w="ok">好</button></div></div>`;
    root.append(ov);
    const show = () => {
      rows.forEach(([k, , , , , f]) => { ov.querySelector<HTMLElement>(`[data-wv="${k}"]`)!.textContent = f(W[k]); });
      ov.querySelectorAll<HTMLElement>('[data-w^=mode]').forEach(b => b.classList.toggle('on', b.dataset.w === `mode${W.mode}`));
      ov.querySelectorAll<HTMLElement>('.mk-row, [data-w=seed]').forEach(r => r.classList.toggle('mk-off', W.mode === 1));
    };
    show();
    begin();
    const apply = () => { m.wood = { ...W }; show(); dirty(); };
    ov.addEventListener('input', e => {
      const t = e.target as HTMLInputElement, k = t.dataset.w as keyof MkWood;
      if (!k || k === 'mode' || k === 'seed') return;
      (W as Record<string, number>)[k] = Number(t.value); apply();
    });
    ov.addEventListener('click', e => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.w;
      if (k === 'mode0' || k === 'mode1') { W.mode = k === 'mode0' ? 0 : 1; audio.ui('click'); apply(); }
      if (k === 'seed') { W.seed = (W.seed % 9999) + 1; audio.ui('click'); apply(); }
      if (k === 'reset') { Object.assign(W, DEFAULT_WOOD, { seed: W.seed }); ov.querySelectorAll<HTMLInputElement>('input[data-w]').forEach(i => (i.value = String(W[i.dataset.w as keyof MkWood]))); apply(); }
      if (k === 'ok') { ov.remove(); commit(); audio.ui('yes'); }
    });
  }
  /** 地面紋理 (the user 2026-11-12): the textures' size, angle and randomness, live on the map. */
  function texSheet() {
    const T = { ...DEFAULT_TEX, ...m.tex };
    const rows: [keyof MkTex, string, number, number, number, (v: number) => string][] = [
      ['size', '大小', 16, 160, 2, v => `${Math.round((v / 48) * 100)}%`], ['angle', '角度', 0, 355, 5, v => `${v}°`],
      ['random', '隨機度', 0, 1, 0.05, v => `${Math.round(v * 100)}%`]];
    const ov = document.createElement('div');
    ov.className = 'slots-overlay mk-ov mk-light-ov';
    ov.innerHTML = `<div class="msg sheet mk-menu"><div class="ribbon">地面紋理</div>
      ${rows.map(([k, n, lo, hi, st]) => `<label class="mk-row"><span>${n}</span><input type="range" min="${lo}" max="${hi}" step="${st}" value="${T[k]}" data-x="${k}"><b data-xv="${k}"></b></label>`).join('')}
      <div class="choices"><button class="candy ghost" data-x="reset">恢復預設</button><button class="candy yes" data-x="ok">好</button></div></div>`;
    root.append(ov);
    const show = () => rows.forEach(([k, , , , , f]) => { ov.querySelector<HTMLElement>(`[data-xv="${k}"]`)!.textContent = f(T[k]); });
    show();
    begin();
    ov.addEventListener('input', e => {
      const t = e.target as HTMLInputElement, k = t.dataset.x as keyof MkTex;
      if (!k) return;
      T[k] = Number(t.value); m.tex = { ...T }; show(); dirty();
    });
    ov.addEventListener('click', e => {
      const k = (e.target as HTMLElement).closest<HTMLElement>('button')?.dataset.x;
      if (k === 'reset') { Object.assign(T, DEFAULT_TEX); m.tex = { ...T }; ov.querySelectorAll<HTMLInputElement>('input[data-x]').forEach(i => (i.value = String(T[i.dataset.x as keyof MkTex]))); show(); dirty(); }
      if (k === 'ok') { ov.remove(); commit(); audio.ui('yes'); }
    });
  }
  const ro = new ResizeObserver(() => dirty());
  ro.observe(stage);
  // (its picture is drawn again from the map as it now is: compile.ts makeThumbs, in 我的地圖)
  function close() { saveNow(); dropThumb(m.id); ro.disconnect(); cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); root.remove(); }
  requestAnimationFrame(() => { fit(); dirty(); });
}
