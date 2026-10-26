/** Title/setup screen and the game controller that plays the engine's flow on screen. */
import './compat'; // older Android / vendor WebViews (issue #7): first, before anything runs
import '@fontsource/huninn/index.css';
import { Capacitor } from '@capacitor/core';
import { CHARACTERS, playerName } from '../core/characters';
import { format, today } from '../core/date';
import { Game, SPEED } from '../core/game';
import { nodeById } from '../core/board';
import { loadGame, reshuffleGame, saveGame, type SaveData } from '../core/save';
import type { Answer, GameSettings } from '../core/types';
import { ASSETS, loadMap, mapList, type MapInfo } from './assets';
import { BoardView } from './board-view';
import { Hud } from './hud';
import { GoButton, Toolbar } from './controls';
import { Calendar, PlayerPanel, SideToday } from './side';
import { Minimap } from './minimap';
import { InfoScreen } from './info';
import { askScreens, closeStuckScreens, fxScreens } from './screens/registry';
import { PartyBar } from './party-chat';
import { openParty } from './party';
import { Lobby, type Room } from './party-net';
import { AUTO_SLOT, TYCOON_AUTO_SLOT, interruptedLoad, loadSlot, markLoading, notice, pickSlot, writeAuto, writeSlot, type Loaded } from './saves';
import { lowerTier } from './mem-tier';
import { memReport } from './mem-report';
import { SpriteBank } from './sprites';
import { MapDirector } from './map-fx';
import { audio, Sfx, Theme } from './audio';
import { holidayMusic } from './holidays';
import { applyOrientation, orientationMode, ORIENTATIONS, setOrientation } from './orientation';
import { GROUND_STYLES, groundIndex, groundStyle, groundStylesFor, setGroundStyle, TiledGround } from './ground';
import { guard, Watchdog } from './watchdog';
import { preloadClips } from './effects';
import { LoadingScreen } from './loading';
import { preloadBoard } from './board-preload';
import { WeatherFx } from './weather-fx';
import { LossNotices } from './losses';
import { autoAnswer, CITY_NAMES, TYCOON_MAPS, tycoonSettings, type World } from '../core/world';
import { isWorldSave, saveWorld } from '../core/save';
import { openCityViewer } from './city-viewer';
import { tycoonEnding } from './tycoon-ending';
import { finaleResults } from './finale-ending'; // 大富翁城 (docs/rules/19)
import { finaleToolbar, noStocks, prepareFinale } from './finale';
import { prepareHotels } from './hotels';
import { prepareAh11 } from './ah11';
import { prepareCityLots } from './city-lots';
import { FINALE_MAP } from '../core/casino-rules';
import { KB_MAP } from '../core/kabukicho';
import { neonMode, prepareKabukicho, setNeonMode, setVehiclesMode, setWalkersMode, STREET_MODES, vehiclesMode, walkersMode } from './kabukicho'; // 歌舞伎町 (docs/rules/21)
import { JQ_QUALITIES, jqMusicMode, jqMusicQuality, musicSetFor, setJqMusicMode, setJqMusicQuality } from './jq-music'; // 激情歲月's own music (docs/rules/24 §16)
import { JQ_MAP, loudspeakerMode, prepareJiqingPlaces, quotesMode, setLoudspeakerMode, setQuotesMode } from './jiqing'; // 激情歲月 (docs/rules/24)
import { applyJqTheme } from './jq-theme';
import { setEraLine } from './era-line';
import { playJqIntro } from './screens/jq-intro';
import { magicHintMode, setMagicHintMode } from './screens/magic'; // 魔法屋提示對象 (issue #8)
import './tycoon-onway';
import './tool-cinema'; // 道具 / 高級卡片 cinematics: wraps the tool and card use (visual only)
import './pad'; // 手把／鍵盤操作 (issue #15): gamepad and keyboard play, idle until used
import { CHAT_MODES, ChatBox, chatMode, CITY_COLORS, cityThumb, installWorldScreens, logPanel, newWorld, registerSprites, resumeWorld, setChatMode, tycoon, WorldBar } from './tycoon';
import { setWeatherMode, WEATHER_MODES, weatherMode } from './weather';
import { initLang, lang, LANGS, setLang } from './lang';
import { attachLedger, gameResults, ledgerOf, worldResults } from '../core/stats';
import { pickNextMap, showResults } from './results';
import { nextSettings, recordResult, type CarriedSettings, type RunRecord } from './next-game';
import { phrases, shrinkText } from './text';

const app = document.getElementById('app')!;
// The orientation chosen in the settings is applied at start, before the title screen is laid out.
void applyOrientation();
const svg = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const ICON_LEFT = svg('M3 12a9 9 0 1 0 3-6.7M3 4v5h5'), ICON_RIGHT = svg('M21 12a9 9 0 1 1-3-6.7M21 4v5h-5');

/**
 * Sizes the original screen blocks to the window: landscape keeps the 640×480 arrangement scaled to the height
 * (toolbar 40, right column 200 original px); portrait puts the toolbar on top and the two panels side by side
 * under the map.
 */
function fitShell(shell: HTMLElement) {
  const fit = () => {
    const w = shell.clientWidth, h = shell.clientHeight;
    const portrait = h > w * 1.05;
    shell.classList.toggle('portrait', portrait);
    if (portrait) {
      shell.style.setProperty('--tu', String(Math.min(1.6, w / 440)));
      shell.style.setProperty('--pu', String(w / 400));
    } else {
      const u = Math.max(0.7, Math.min(2, h / 480));
      shell.style.setProperty('--tu', String(u));
      shell.style.setProperty('--pu', String(u));
    }
  };
  new ResizeObserver(fit).observe(shell);
  fit();
}

let maps: MapInfo[] = [];
const mapName = (id: number) => maps.find(m => m.id === id)?.name ?? `地圖 ${id}`;

/** Hover / click sounds of the original's buttons (slot table 0x48231a) on a container. */
function buttonSounds(root: HTMLElement, sel = 'button') {
  let over: Element | null = null;
  root.addEventListener('pointerover', e => {
    const b = (e.target as HTMLElement).closest(sel);
    if (b && b !== over && (e as PointerEvent).pointerType === 'mouse') audio.ui('hover');
    over = b;
  });
  root.addEventListener('pointerdown', e => { if ((e.target as HTMLElement).closest(sel)) audio.ui('click'); });
}

/** Title screen (Data#1: the world map with START / LOAD / OPTION), then the new-game sheet. */
async function setup() {
  app.innerHTML = '<div class="loading">載入中…</div>';
  try {
    [maps, bank] = await Promise.all([mapList(), bank ?? SpriteBank.create()]);
    await Promise.all([initLang(), warmThumbs(maps)]); // 語言 (lang.ts): 简体 converts the page from here on
  } catch (e) {
    app.innerHTML = `<div class="loading error">${(e as Error).message}</div>`;
    return;
  }
  title();
}

const thumbOf = (id: number) => maps.find(m => m.id === id)?.thumbnail ?? '';

/**
 * The maps' pictures (the 自製地圖 postcards, tools/tycoon-art/map_thumbs.py) are fetched and decoded while the title
 * loads, so the new-game / 下一局 pickers, the save slots and the loading screen never show them popping in. The
 * decoded images are kept referenced for the session (7 small webps); a slow network holds the title at most 1.5 s.
 */
const warmed: HTMLImageElement[] = [];
function warmThumbs(list: MapInfo[]): Promise<unknown> {
  const urls = [...new Set(list.filter(m => !m.hidden && m.thumbnail).map(m => m.thumbnail))];
  const all = urls.map(src => {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    warmed.push(img);
    return typeof img.decode === 'function' ? img.decode().catch(() => undefined) : undefined;
  });
  return Promise.race([Promise.all(all), new Promise(ok => setTimeout(ok, 1500))]);
}

function title() {
  const b = bank!;
  const bg = b.art('Data', 1, 0);
  const tall = b.art('Data', 9001); // remake: the title redrawn for portrait screens (style.css .title)
  // Absolute: a relative url() in a custom property may resolve against style.css (assets/) instead of the page.
  const abs = (src: string) => new URL(src, document.baseURI).href;
  // The three redrawn buttons have different canvases and label plates (plate/canvas width 0.87, 0.80, 0.84):
  // scale each so the gold label plates come out the same width on screen.
  const PLATE: Record<number, number> = { 1: 374 / 432, 3: 342 / 428, 5: 329 / 392 };
  const btn = (key: string, normal: number, label: string) => {
    const n = b.art('Data', 1, normal), h = b.art('Data', 1, normal + 1);
    const k = n?.hd ? PLATE[1] / PLATE[normal] : 1;
    return `<button class="title-btn" style="--k:${k.toFixed(3)}" data-act="${key}" aria-label="${label}">${n ? `<img class="n" src="${n.src}" alt="">` : ''}${h ? `<img class="h" src="${h.src}" alt="">` : ''}${n ? '' : `<span>${label}</span>`}</button>`;
  };
  // 派對模式 (v0.5.0): its own redrawn button (maps/remake/title/party*.webp, tools/tycoon-art/party_button.py).
  const party = `<button class="title-btn party" data-act="party" aria-label="派對模式"><span class="party-live" hidden></span><img class="n" src="${ASSETS}/maps/remake/title/party.webp" alt=""><img class="h" src="${ASSETS}/maps/remake/title/party-hover.webp" alt=""></button>`;
  // The title plays MIDI01 (rich4_ui_main.asm:483); buttons have the hover / click sounds.
  audio.setMusicSet(null); // the title and everything outside 激情歲月 play the original's music
  if (audio.music?.kind !== 'theme' || audio.music.index !== Theme.title) audio.theme(Theme.title, true);
  app.innerHTML = `<div class="title" style="${bg ? `--title-bg:url('${abs(bg.src)}');` : ''}${tall ? `--title-bg-tall:url('${abs(tall.src)}')` : ''}">
    <div class="title-buttons">${btn('start', 1, '開始遊戲')}${party}${btn('load', 3, '讀取進度')}${btn('option', 5, '設定')}</div>
    <div class="title-note">${phrases('只需優化一下界面就是一個好遊戲，但他偏偏選擇了發售了垃圾的第五代。')}</div>
    <div class="title-ver">v${__APP_VERSION__}</div></div>`;
  buttonSounds(app.querySelector('.title-buttons')!, '.title-btn');
  watchParty(app.querySelector<HTMLElement>('.party-live')!);
  app.onclick = async e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) stopWatchingParty();
    if (act === 'start') newGame();
    if (act === 'party') openParty({ app, bank: bank!, maps, play: (settings, room) => start(settings, room), back: () => {} });
    if (act === 'load') void openLoad();
    if (act === 'option') options();
  };
  afterLoadTrouble();
}

/** The title's 讀取進度: the slot list, then the game; a slot that can't be loaded says so and the list comes back. */
async function openLoad() {
  const slot = await pickSlot(app, 'load', mapName, bank, thumbOf);
  if (slot >= 0) void resume(slot, app, openLoad);
}

/**
 * Issue #7 (「安卓版經常出現讀取存檔失敗，然後閃退」): a load that went wrong after the screen had changed comes back to the
 * title (a fresh page: everything the failed load held is freed) and says why there, then the slot list opens again.
 */
const AFTER_RELOAD = 'rich4.afterReload';
function backToTitle(text: string, reopenLoad: boolean) {
  markLoading(null);
  try { sessionStorage.setItem(AFTER_RELOAD, JSON.stringify({ text, reopenLoad })); } catch { /* the title without the note */ }
  location.reload();
}
/** On the title: the note of a failed load, or of a load the app did not live through (the system closed it). */
function afterLoadTrouble() {
  let note: { text: string; reopenLoad: boolean } | null = null;
  try {
    const v = sessionStorage.getItem(AFTER_RELOAD);
    sessionStorage.removeItem(AFTER_RELOAD);
    if (v) note = JSON.parse(v) as { text: string; reopenLoad: boolean };
  } catch { /* none */ }
  if (note) { const n = note; void notice(app, n.text).then(() => { if (n.reopenLoad) void openLoad(); }); return; }
  if (interruptedLoad() === null) return;
  // Killed while loading: on a phone that is nearly always memory. The app draws with less from now on.
  const lower = Capacitor.getPlatform() === 'android' ? lowerTier() : null; // Android only (iOS left as it was)
  void notice(app, `上次讀取存檔時，遊戲還沒載入完就被系統關掉了（多半是手機記憶體不夠）。\n存檔沒有損壞，可以再讀取一次。${lower ? '\n已把畫面細節調低一級，比較不佔記憶體。' : '\n讀取前可以先關掉其他程式。'}`)
    .then(() => openLoad());
}

/**
 * The title's live figures over 派對模式 (the user 2026-10-20): 私享 rooms open now and people waiting for partners,
 * from the room list (party-net Lobby, which this phone may come to hold). Only while the title is shown and online.
 */
let titleLobby: Lobby | null = null;
function watchParty(el: HTMLElement) {
  stopWatchingParty();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const lobby = new Lobby();
  titleLobby = lobby;
  lobby.onStats = s => {
    if (titleLobby !== lobby || !el.isConnected) { if (!el.isConnected) stopWatchingParty(); return; }
    el.hidden = !(s.privateRooms || s.waiting);
    el.innerHTML = `${s.privateRooms ? `<b>私享房間 ${s.privateRooms}</b>` : ''}${s.waiting ? `<b>等待夥伴 ${s.waiting} 人</b>` : ''}`;
  };
  void lobby.start();
}
function stopWatchingParty() { titleLobby?.close(); titleLobby = null; }

/** 動畫過程 (RICH4.CFG +1) as far as the remake goes: play the mini games, or take the automatic 50..69 points. */
const MINI_GAME_MODES = ['親自玩', '自動結算'];
/**
 * 自動買地 (the user 2026-10-19), both modes: a human's 「是否買下此地？」/「是否升級？」 on a lot or a large plot is
 * answered yes at once (the rules only ask when the cash is there). Building on an empty large plot of one's own still
 * asks which facility (a choice, not a yes).
 */
const AUTO_BUY_KEY = 'rich4.autobuy', AUTO_BUY_MODES = ['關', '開'];
const AUTO_BUY_KINDS = new Set(['buy-land', 'upgrade-land', 'buy-facility', 'upgrade-facility']);
const autoBuy = () => { try { return localStorage.getItem(AUTO_BUY_KEY) === '1'; } catch { return false; } };
/** 鏡頭跟隨 (issue #11): 0 標準 (default), 1 少動 (BoardView.calm: effects on screen are shown without moving there). */
const CAMERA_MODES = ['標準', '少動'];
const CAMERA_KEY = 'rich4.camera';
const cameraMode = () => { try { return localStorage.getItem(CAMERA_KEY) === '1' ? 1 : 0; } catch { return 0; } };
/** Below the camera point, as a fraction of the view's height, that a dialog must leave free (the actor's feet, a ring). */
const FOCUS_CLEAR = 0.08;
const miniGameMode = () => { try { return Number(localStorage.getItem('rich4.minigame') ?? 0) === 1 ? 1 : 0; } catch { return 0; } };

/**
 * Speed, right-column layout and the mini games, kept for every game (RICH4.CFG in the original): the same compact
 * window as the in-game 系統 (a row per setting, two columns on a landscape screen, one page, no scrolling).
 */
function options() {
  const read = (k: string) => { try { return Number(localStorage.getItem(k) ?? 0); } catch { return 0; } };
  const write = (k: string, v: number) => { try { localStorage.setItem(k, String(v)); } catch { /* not kept */ } };
  const levels = ['關', '1', '2', '3', '4'];
  type Row = { label: string; opts: string[]; cur: () => number; pick: (i: number) => void; even?: boolean; wide?: boolean; nozh?: boolean };
  const stored = (label: string, key: string, opts: string[]): Row => ({ label, opts, cur: () => read(key), pick: i => write(key, i) });
  let grounds: string[] = [];
  const rows = (): Row[] => {
    const list: Row[] = [
      stored('速度', 'rich4.speed', ['慢', '中', '快']),
      stored('右側', 'rich4.layout', ['日曆', '小地圖', '全部']),
      stored('小遊戲', 'rich4.minigame', MINI_GAME_MODES),
      stored('自動買地', AUTO_BUY_KEY, AUTO_BUY_MODES),
      stored('鏡頭跟隨', CAMERA_KEY, CAMERA_MODES),
      // issue #8: the magic house's box naming who its group hits (on by default; off as in the original)
      { label: '魔法屋提示對象', opts: STREET_MODES, cur: () => magicHintMode(), pick: i => setMagicHintMode(i) },
      { label: '畫面', opts: ORIENTATIONS, cur: () => orientationMode(), pick: i => { write('rich4.orientation', i); void applyOrientation(); } },
      { label: '天氣', opts: [...WEATHER_MODES], cur: () => weatherMode(), pick: i => write('rich4.weather', i) },
      // 歌舞伎町's living street (docs/rules/21 §8): kept for every game, used on that map only.
      { label: '街頭行人', opts: STREET_MODES, cur: () => walkersMode(), pick: i => setWalkersMode(i) },
      { label: '街頭車輛', opts: STREET_MODES, cur: () => vehiclesMode(), pick: i => setVehiclesMode(i) },
      { label: '霓虹閃爍', opts: STREET_MODES, cur: () => neonMode(), pick: i => setNeonMode(i) },
      { label: '語言', opts: LANGS.map(l => l.label), nozh: true, cur: () => LANGS.findIndex(l => l.id === lang()),
        pick: i => void setLang(LANGS[i].id).then(render) },
    ];
    if (grounds.length) {
      const styles = GROUND_STYLES.filter(g => !g.id || grounds.includes(g.id));
      const short: Record<string, string> = { '': '原版', ghibli: '吉卜力', monopoly: '桌遊', genshin: '原神' };
      list.push({ label: '地圖', wide: true, opts: styles.map(g => short[g.id] ?? g.name),
        cur: () => Math.max(0, styles.findIndex(g => g.id === (grounds.includes(groundStyle()) ? groundStyle() : ''))),
        pick: i => setGroundStyle(styles[i].id) });
    }
    for (const [label, key] of [['音樂', 'music'], ['音效', 'sfx'], ['語音', 'voice']] as const) {
      list.push({ label, opts: levels, even: true, cur: () => audio.settings[key], pick: i => audio.set({ [key]: i }) });
    }
    list.push({ label: '靜音', opts: ['開', '關'], cur: () => (audio.settings.mute ? 0 : 1), pick: i => audio.set({ mute: i === 0 }) });
    return list;
  };
  const overlay = document.createElement('div');
  overlay.className = 'slots-overlay';
  const box = document.createElement('div');
  box.className = 'msg sheet sys-sheet';
  const grid = document.createElement('div');
  grid.className = 'sys-grid';
  let current: Row[] = [];
  function render() {
    current = rows();
    grid.innerHTML = current.map((r, n) => `<b${r.wide ? ' class="w"' : ''}>${r.label}</b><div class="chips${r.even ? ' even' : ''}${r.wide ? ' w' : ''}"${r.nozh ? ' data-nozh' : ''}>${r.opts.map((o, i) =>
      `<button class="chip${r.cur() === i ? ' on' : ''}" data-row="${n}" data-v="${i}">${o}</button>`).join('')}</div>`).join('');
    fit();
  }
  /** A short screen: shrink the whole window rather than scroll it. */
  function fit() {
    if (!box.isConnected) return;
    box.style.zoom = '';
    const os = getComputedStyle(overlay);
    const room = overlay.clientHeight - parseFloat(os.paddingTop) - parseFloat(os.paddingBottom);
    const need = box.scrollHeight + parseFloat(getComputedStyle(box).marginTop) + 8;
    if (need > room && room > 0) box.style.zoom = String(Math.max(0.6, room / need));
  }
  box.innerHTML = '<div class="ribbon">設定</div>';
  const buttons = document.createElement('div');
  buttons.className = 'choices sys-buttons';
  buttons.innerHTML = '<button class="candy ghost" data-close="1">關閉</button>';
  box.append(grid, buttons);
  overlay.append(box);
  // Styles redrawn for any map (the choice applies to the maps that have it).
  void groundIndex().then(g => { grounds = [...new Set(Object.values(g.maps).flat())]; if (overlay.isConnected) render(); });
  overlay.onclick = e => {
    const t = e.target as HTMLElement, c = t.closest<HTMLElement>('[data-row]');
    if (c) { audio.ui('click'); current[Number(c.dataset.row)].pick(Number(c.dataset.v)); render(); return; }
    if (t === overlay || t.closest('[data-close]')) { audio.ui('no'); ro.disconnect(); overlay.remove(); }
  };
  const ro = new ResizeObserver(fit);
  app.append(overlay);
  ro.observe(overlay);
  render();
}

function newGame() {
  const b = bank!;
  const state = {
    mapId: 2, count: 4, fundIndex: 1, traffic: 0 as 0 | 1 | 2, daysLimitIndex: 0, victoryIndex: 0, landLimitIndex: 0,
    /** 電腦難度 (core/smart-ai.ts, Game.aiLevel): 0 簡單 = the original's computer, 1 中級, 2 困難; not in 大富豪模式. */
    aiLevel: 0 as 0 | 1 | 2,
    kind: 'orig' as MapInfo['kind'] | 'tycoon',
    slots: [{ character: 9, human: true }, { character: 4, human: false }, { character: 3, human: false }, { character: 0, human: false }],
  };
  const face = (c: number) => b.art('Data', 2, c)?.src ?? '';
  let page = 0;
  const PER_PAGE = 8;
  /** Computer seats get random characters other than the human ones. */
  const reroll = () => {
    const keep = new Set(state.slots.filter((x, i) => i === 0 || x.human).map(x => x.character));
    const pool = CHARACTERS.map(c => c.id).filter(id => !keep.has(id));
    for (let i = 1; i < 4; i++) {
      if (state.slots[i].human) continue;
      const k = Math.floor(Math.random() * pool.length);
      state.slots[i].character = pool.splice(k, 1)[0];
    }
  };
  reroll();
  // The new-game screen plays MIDI02 (rich4_new_game.asm:4009, flag 0x8001: nothing to come back to).
  audio.theme(Theme.setup, true);
  /** The sheet is laid out on a fixed canvas (960×540 / 540×960) and scaled to fit, so everything shows at once. */
  const fit = () => {
    const sheet = app.querySelector<HTMLElement>('.ng-sheet');
    if (!sheet) return;
    const w = app.clientWidth, h = app.clientHeight, portrait = h > w;
    sheet.classList.toggle('portrait', portrait);
    const [dw, dh] = portrait ? [540, 900] : [960, 540];
    // room above for the ribbon (it sits half over the top edge)
    const k = Math.min((w - 12) / dw, (h - 12) / (dh + 34));
    sheet.style.top = `calc(50% + ${Math.round(14 * k)}px)`;
    sheet.style.transform = `translate(-50%, -50%) scale(${k})`;
    shrinkText(sheet, '.ng-seat b, .ng-map span, .ng-pick span', 9);
  };
  window.addEventListener('resize', fit);
  const render = () => {
    // 大富豪模式 (docs/rules/17): the five cities, your character against the other eleven.
    const ty = state.kind === 'tycoon';
    const list = maps.filter(m => m.kind === state.kind && !m.hidden);
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    const shown = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    // One row per option: ‹ value › (tapping the value also steps it).
    const opt = (label: string, key: keyof typeof state, items: string[]) => {
      const v = state[key] as number;
      return `<div class="ng-opt"><span>${label}</span><div class="stepper">
        <button data-step="${key}" data-n="${items.length}" data-d="-1">‹</button>
        <button class="val" data-step="${key}" data-n="${items.length}" data-d="1">${items[v]}</button>
        <button data-step="${key}" data-n="${items.length}" data-d="1">›</button></div></div>`;
    };
    app.querySelector('.ng')?.remove();
    const sheet = document.createElement('div');
    sheet.className = 'ng';
    sheet.innerHTML = `<div class="msg sheet ng-sheet"><div class="ribbon">新遊戲</div>
      <section class="ng-maps-sec"><div class="ng-head"><h3>地圖</h3><div class="chips">
          <button class="chip${state.kind === 'orig' ? ' on' : ''}" data-maps="orig">原版地圖</button>
          <button class="chip${state.kind === 'custom' ? ' on' : ''}" data-maps="custom">自製地圖 ${maps.filter(m => m.custom && !m.hidden).length}</button>
          <button class="chip${ty ? ' on' : ''}" data-maps="tycoon">大富豪模式</button></div>
          ${pages > 1 ? `<div class="ng-pager"><button class="chip" data-page="-1">‹</button><span>${page + 1}/${pages}</span><button class="chip" data-page="1">›</button></div>` : ''}</div>
        ${ty ? `<div class="ng-tycoon">${TYCOON_MAPS.map(id => `<figure><img src="${cityThumb(id)}" alt="" style="--cc:${CITY_COLORS[id]}"><figcaption>${CITY_NAMES[id]}</figcaption></figure>`).join('')}
          <p class="ng-tycoon-note">${phrases('你一人對上其他 11 位角色，大家隨機分散在五座城市。\n搭新幹線、飛機往來各地，讓所有對手破產，就能成為「首富大富豪」。')}</p></div>` : `<div class="ng-maps">${shown.map(m => `<button class="ng-map${m.id === state.mapId ? ' on' : ''}" data-map="${m.id}"><img src="${m.thumbnail}" alt=""><span>${m.name}</span></button>`).join('') || '<p class="info-none">沒有可用的地圖</p>'}</div>`}</section>
      <section class="ng-players-sec"><div class="ng-head"><h3>選擇角色</h3><div class="chips">${ty ? '<span class="ng-ty-who">選你的角色，其他 11 位都是電腦</span>' : `${[2, 3, 4].map(n => `<button class="chip${state.count === n ? ' on' : ''}" data-count="${n}">${n} 人</button>`).join('')}
          <button class="chip" data-reroll="1">重新抽選</button>`}</div></div>
        <div class="ng-roster">${CHARACTERS.map(c => {
          const seat = ty ? (c.id === state.slots[0].character ? 0 : -1) : state.slots.slice(0, state.count).findIndex(x => x.character === c.id);
          return `<button class="ng-pick${seat === 0 ? ' mine' : seat > 0 ? ' taken' : ''}" data-pick="${c.id}" style="--c:#${c.color.toString(16).padStart(6, '0')}">
            <img src="${face(c.id)}" alt=""><span>${c.name}</span>${seat >= 0 ? `<em>${seat + 1}P</em>` : ''}</button>`;
        }).join('')}</div>
        </section>
      <section class="ng-lineup-sec">${ty ? `<div class="ng-lineup tycoon">${[state.slots[0].character, ...CHARACTERS.map(c => c.id).filter(id => id !== state.slots[0].character)].map((c, i) =>
          `<span class="${i ? '' : 'me'}" style="--c:#${CHARACTERS[c].color.toString(16).padStart(6, '0')}" title="${CHARACTERS[c].name}"><img src="${face(c)}" alt=""></span>`).join('')}</div>` : `<div class="ng-lineup">${state.slots.slice(0, state.count).map((s, i) => {
          const ch = CHARACTERS[s.character];
          return `<div class="ng-seat" style="--c:#${ch.color.toString(16).padStart(6, '0')}"><img src="${face(s.character)}" alt=""><b>${i + 1}P ${ch.name}</b>
            <button class="chip${s.human ? ' on' : ''}" data-slot="${i}" data-act="who">${s.human ? '玩家' : '電腦'}</button></div>`;
        }).join('')}</div>`}</section>
      <section class="ng-opts">
        ${opt('總資金', 'fundIndex', ['30萬', '20萬', '10萬', '5萬', '3萬', '1萬'])}
        ${opt('行進方式', 'traffic', ['步行', '機車', '汽車'])}
        ${opt('土地權限', 'landLimitIndex', ['無限期', '二年', '一年', '六個月', '三個月', '一個月'])}
        ${ty ? '<p class="ng-date">遊戲時間：直到所有對手破產</p>' : `${opt('遊戲時間', 'daysLimitIndex', ['無限', '二年', '一年', '六個月', '三個月', '一個月'])}
        ${opt('勝利條件', 'victoryIndex', ['無限', '100倍', '50倍', '10倍', '5倍', '3倍'])}
        ${opt('電腦難度', 'aiLevel', ['簡單', '中級', '困難'])}`}
        <p class="ng-date">開局日期 ${format(today())}</p>
      </section>
      <div class="choices ng-actions"><button class="candy ghost" data-back="1">返回</button><button class="candy yes" data-go="1">開始遊戲</button></div></div>`;
    app.append(sheet);
    fit();
  };
  app.onclick = e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const d = t.dataset;
    // Clicks (#1); picking a character plays its own sound (NEWGAME table 0x46ccd0: Effect#5).
    audio.sfx(d.pick ? 5 : d.go ? 2 : d.back ? 4 : 1);
    if (d.back) { app.querySelector('.ng')?.remove(); window.removeEventListener('resize', fit); title(); return; }
    if (d.page) page = Math.max(0, page + Number(d.page));
    if (d.maps === 'tycoon') { state.kind = 'tycoon'; render(); return; }
    if (d.maps) {
      state.kind = d.maps as MapInfo['kind'];
      const first = maps.find(m => m.kind === state.kind && !m.hidden);
      if (first && !maps.some(m => m.id === state.mapId && m.kind === state.kind && !m.hidden)) state.mapId = first.id;
      page = 0;
    }
    if (d.map) state.mapId = Number(d.map);
    if (d.count) { state.count = Number(d.count); reroll(); }
    if (d.reroll) reroll();
    if (d.pick) {
      // As in the original: pick your character, the other seats are drawn at random from the rest.
      const c = Number(d.pick), other = state.slots.findIndex((x, i) => i > 0 && x.character === c);
      if (other > 0) state.slots[other].character = state.slots[0].character;
      state.slots[0].character = c;
      reroll();
    }
    if (d.opt) (state as Record<string, unknown>)[d.opt] = Number(d.v);
    if (d.step) {
      const n = Number(d.n), cur = (state as unknown as Record<string, number>)[d.step];
      (state as unknown as Record<string, number>)[d.step] = (cur + Number(d.d) + n) % n;
    }
    if (d.slot) {
      const s = state.slots[Number(d.slot)];
      if (d.act === 'who') s.human = !s.human;
      else {
        const used = new Set(state.slots.slice(0, state.count).map(x => x.character));
        let c = s.character;
        do c = (c + (d.act === 'next' ? 1 : 11)) % 12; while (used.has(c) && c !== s.character);
        s.character = c;
      }
    }
    if (d.go && state.kind === 'tycoon') {
      window.removeEventListener('resize', fit);
      void startTycoon(tycoonSettings(state.slots[0].character, {
        fundIndex: state.fundIndex, traffic: state.traffic, landLimitIndex: state.landLimitIndex, startDate: today(), seed: (Math.random() * 2 ** 32) >>> 0,
      }));
      return;
    }
    if (d.go) {
      window.removeEventListener('resize', fit);
      const players = state.slots.slice(0, state.count);
      if (!players.some(p => p.human)) players[0].human = true;
      start({
        mapId: state.mapId, players, fundIndex: state.fundIndex, traffic: state.traffic, landLimitIndex: state.landLimitIndex,
        daysLimitIndex: state.daysLimitIndex, victoryIndex: state.victoryIndex, startDate: today(), seed: (Math.random() * 2 ** 32) >>> 0,
        ...(state.aiLevel ? { aiLevel: state.aiLevel } : {}),
      });
      return;
    }
    render();
  };
  render();
}

let bank: SpriteBank | null = null;

/** Bumped whenever a game starts or is loaded; a controller loop from an older session stops. */
let session = 0;
let currentView: BoardView | null = null;
let currentWeather: WeatherFx | null = null;

function start(settings: GameSettings, room?: Room) {
  // Every game keeps the statistics ledger (core/stats.ts) for the results screen.
  begin(settings.mapId, board => { const g = new Game(settings, board); attachLedger(g.players); return g; }, false, undefined, room);
}

/** Maps cleared and characters beaten in this run of games (docs/rules/20 §5; memory only, like the original's tables). */
let run: RunRecord = { cleared: [], defeated: [] };

/**
 * 「下一局」 from the results (docs/rules/20 §5): the next map over the results, three random opponents, the same
 * settings. True when the new game starts.
 */
async function nextGame(root: HTMLElement, carried: CarriedSettings, humans: number[], mapId: number): Promise<boolean> {
  const pick = await pickNextMap(bank!, root, maps, mapId, run, humans);
  if (!pick) return false;
  const settings = nextSettings(carried, pick.mapId, humans, pick.opponents, today(), (Math.random() * 2 ** 32) >>> 0);
  setTimeout(() => start(settings), 0);
  return true;
}

/** 大富豪模式: build the world from the five cities' records, then show the human's city (docs/rules/17). */
async function startTycoon(settings: import('../core/world').TycoonSettings, world?: World) {
  if (!world) bootScreen('大富豪模式', '', '建立大富豪世界中…');
  let w: World;
  try { w = world ?? await newWorld(settings); } catch (e) { backToTitle(`無法建立大富豪世界：${(e as Error).message}`, false); return; }
  if (!ledgerOf(w.players)) attachLedger(w.players); // statistics (core/stats.ts); an old save starts an empty one
  const flow = w.run();
  showCity(w, flow, !!world);
}

/** Shows the world's current city (a new game, a load, or after the human travelled), the world's flow going on. */
function showCity(w: World, flow: ReturnType<World['run']>, loaded: boolean) {
  const v = Math.max(0, w.view());
  begin(w.mapId(v), () => w.cities[v], loaded, { world: w, flow });
}

/**
 * Loads a slot. Nothing that goes wrong here may stop the app (issue #7): a slot that can't be read says so over
 * `parent` and `back` follows (the title's slot list again; in a game the game goes on); a damaged newest copy is
 * replaced by the one before it, with a word; a failure once the loading screen is up goes back to the title.
 */
async function resume(slot: number, parent: HTMLElement, back?: () => void) {
  let got: Loaded<SaveData> = { damaged: false };
  try { got = await loadSlot(slot); } catch { /* reported below */ }
  const data = got.save;
  if (!data) {
    await notice(parent, got.damaged ? '這個存檔的檔案損壞了，讀不出來。\n請改選其他存檔或自動存檔。' : '無法讀取這個存檔。\n請改選其他存檔或自動存檔。');
    back?.();
    return;
  }
  if (got.damaged) await notice(parent, '這個存檔最新的一份檔案損壞了，\n已改讀它的上一份備份（進度會早一點）。');
  markLoading(slot);
  if (isWorldSave(data)) {
    bootScreen('大富豪模式', '', '讀取大富豪世界中…');
    let w: World;
    try { w = await resumeWorld(data); } catch (e) { backToTitle(`讀取大富豪世界失敗：${(e as Error).message}\n請改選其他存檔或自動存檔。`, true); return; }
    void startTycoon(data.settings, w);
    return;
  }
  let saved: SaveData | null = data;
  // Names of stocks and companies from the map as it is now (a city that got its own local firms later).
  begin(data.settings.mapId, board => {
    // The parsed save is not kept for the whole game once the game is built from it (memory on a small phone).
    const s = saved!;
    saved = null;
    const g = loadGame(s, board);
    reshuffleGame(g, crypto.getRandomValues(new Uint32Array(1))[0]); // issue #5: not the same dice as the last time from this save
    if (!ledgerOf(g.players)) attachLedger(g.players);
    return g;
  }, true);
}

/** The loading screen (ui/loading.ts) alone on the page. */
function bootScreen(name: string, thumb: string, what: string, sub = ''): LoadingScreen {
  const boot = new LoadingScreen(name, thumb, sub);
  boot.progress(0, what);
  app.replaceChildren(boot.el);
  return boot;
}

/** `room`: 派對模式 (party-net.ts) — the other phones' seats wait for their answers, this phone's answers are sent. */
async function begin(mapId: number, make: (board: import('../core/board').Board) => Game, loaded: boolean, ty?: { world: World; flow: ReturnType<World['run']> }, room?: Room) {
  const me = ++session;
  currentView?.destroy();
  currentView = null;
  currentWeather?.destroy();
  currentWeather = null;
  app.onclick = null;
  // The loading screen covers everything until the board's first view is complete (ui/board-preload.ts).
  const boot = bootScreen(mapName(mapId), thumbOf(mapId), '載入地圖資料…', ty ? '大富豪模式' : '');
  // 大富豪模式: the same world on another city (the human travelled) keeps its music going.
  const sameWorld = !!ty && tycoon.world === ty.world;
  tycoon.world = ty?.world ?? null;
  // The loading scene stops the music and forgets the stack (fcn_00454edc).
  if (!sameWorld) { audio.stopMusic(true); audio.holiday = 0; }
  let art, game: Game;
  // 地圖風格: this map's redrawn ground in the chosen style, or the original when it has none; loaded with the
  // map so the board's first frame already has it.
  let groundStyles: string[] = [];
  let groundWant = '';
  let firstGround: TiledGround | null = null;
  try {
    [art, bank, firstGround] = await Promise.all([loadMap(mapId), bank ?? SpriteBank.create(), groundStylesFor(mapId).then(st => {
      groundStyles = st;
      groundWant = st.includes(groundStyle()) ? groundStyle() : '';
      return groundWant ? TiledGround.load(mapId, groundWant) : null;
    })]);
    boot.progress(0.12, '載入地圖資料…');
    bank.addMapSprites(art.sprites);
    if (ty) { await registerSprites(bank); installWorldScreens(); }
    await prepareHotels(bank); // the 旅館's redrawn levels 4 and 5 (ui/hotels.ts)
    await prepareAh11(bank); // the APARTMENT HOTEL 11 towers on 日本 and the five cities (ui/ah11.ts)
    await prepareCityLots(bank, mapId); // the five cities' own shops on the small lots (ui/city-lots.ts)
    if (ty || mapId === FINALE_MAP) await prepareFinale(bank); // 大富翁城's halls (docs/rules/19)
    if (mapId === KB_MAP) prepareKabukicho(bank); // 歌舞伎町's tool icons (docs/rules/21 §7.5)
    await prepareJiqingPlaces(bank, mapId === JQ_MAP); // 激情歲月's place screens (docs/rules/24 §11.3); off on every other map
    game = make(art.board);
  } catch (e) {
    firstGround?.dispose(); boot.dispose();
    if (me !== session) return;
    backToTitle(`${loaded ? '讀取存檔失敗' : '無法開始這局遊戲'}：${(e as Error).message}${loaded ? '\n請改選其他存檔或自動存檔。' : ''}`, loaded);
    return;
  }
  if (me !== session) { firstGround?.dispose(); return; }
  app.replaceChildren(boot.el);
  // The original's slot sounds for this map's loops are not left running from an old game.
  for (const id of [Sfx.walk, Sfx.scooter, Sfx.car, Sfx.truck, Sfx.boat, Sfx.doll, Sfx.bombTick]) audio.stop(id);
  // The original screen (docs/rules/09 §1): toolbar over the map, the player panel and calendar beside it.
  const shell = document.createElement('main');
  shell.className = 'game';
  setEraLine(null); // a map's own wording of the place screens: only 激情歲月's (below)
  if (mapId === JQ_MAP) applyJqTheme(shell); // 激情歲月's skin and words (docs/rules/24 §3, §11)
  const toolbar = new Toolbar(bank);
  const stage = document.createElement('section');
  stage.className = 'stage';
  const side = document.createElement('aside');
  side.className = 'side';
  const panel = new PlayerPanel(game, bank), calendar = new Calendar(game, bank);
  const panelBox = document.createElement('div'), calBox = document.createElement('div'), mapBox = document.createElement('div');
  panelBox.className = 'pp-box'; calBox.className = 'cal-box'; mapBox.className = 'mm-box';
  panelBox.append(panel.el); calBox.append(calendar.el);
  // Portrait's corner under the right-hand widget (side.ts SideToday, style.css): the other widget small + today.
  const today = new SideToday(game), todayBox = document.createElement('div');
  todayBox.className = 'st-box';
  todayBox.append(today.el);
  side.append(panelBox, mapBox, calBox, todayBox);
  shell.append(toolbar.el, stage, side);
  finaleToolbar(toolbar.el, game); // 大富翁城: no stock market
  app.append(shell);
  fitShell(shell);
  const view = new BoardView(stage, game, art, bank);
  view.setGround(firstGround);
  currentView = view;
  // 天氣 (docs/rules/16): the day's weather over the map, from the map's climate and the calendar.
  const weather = new WeatherFx(view, game);
  currentWeather = weather;
  // The redrawn style's preview when there is one (the original picture is then never decoded).
  const minimap = new Minimap(game, bank, view, firstGround?.preview ?? art.ground);
  mapBox.append(minimap.el);
  // The small map shows in 日曆 mode too once the screen turns portrait (and grows / shrinks with the layout):
  // drawn again whenever its box changes size, not only on the HUD's refresh.
  new ResizeObserver(() => { if (mapBox.clientWidth) minimap.update(); }).observe(mapBox);
  // Another style chosen in 系統.
  const applyGround = async () => {
    const want = groundStyles.includes(groundStyle()) ? groundStyle() : '';
    groundWant = want;
    const g = want ? await TiledGround.load(mapId, want) : null;
    if (me !== session || groundWant !== want) { g?.dispose(); return; }
    // The minimap takes the new picture before the view releases the old one.
    minimap.ground = g?.preview ?? art.ground;
    view.setGround(g);
    minimap.update();
  };
  const hud = new Hud(stage, game, bank, panel, calendar);
  hud.shell = shell;
  for (const c of ty?.world.cities ?? [game]) c.animation = miniGameMode() === 0;
  // Debug handle for screenshots and tests: open any screen without playing up to it.
  (window as unknown as { __rich4: unknown }).__rich4 = { game, hud, view, weather, room, ctx: () => hud.context(shell), askScreens, fxScreens, world: ty?.world,
    ending: ty ? (winner: number) => tycoonEnding(hud.context(shell), ty.world, winner) : undefined,
    results: (winner: number) => (ty ? tycoonEnding(hud.context(shell), ty.world, winner, () => Promise.resolve(false))
      : showResults(bank!, shell, gameResults(game, winner), { mapName: mapName(game.settings.mapId), next: () => nextGame(shell, game.settings, game.players.filter(p => p.human).map(p => p.character), game.settings.mapId) })) };
  const baseRefresh = hud.refresh.bind(hud);
  hud.refresh = () => { baseRefresh(); today.update(); if (layout !== 0 || shell.classList.contains('portrait')) minimap.update(); };
  // 視窗組 (RICH4.CFG +5): what the right column shows; kept between games.
  const LAYOUTS = ['日曆', '小地圖', '全部'];
  let layout = 0;
  try { layout = Math.max(0, Math.min(2, Number(localStorage.getItem('rich4.layout') ?? 0))); } catch { /* default */ }
  const applyLayout = () => {
    shell.classList.remove('layout-0', 'layout-1', 'layout-2');
    shell.classList.add(`layout-${layout}`);
    panel.compact = layout === 2;
    hud.refresh();
  };
  applyLayout();
  const go = new GoButton(bank, stage);
  // GO rides beside the current player, as in the original (its view is always centred on the player).
  go.anchor = () => {
    const q = view.screenOf(game.current);
    if (!q) return null;
    const c = view.canvas.getBoundingClientRect(), a = stage.getBoundingClientRect();
    return { x: q.x + c.left - a.left, y: q.y + c.top - a.top, zoom: q.zoom };
  };
  // Keep the actor above an open dialog: put the camera point midway in the visible strip — only when the box would
  // cover it (issue #11: a message at the bottom slid the map up and back for every box), and a box closing with the
  // next one opening right after leaves it where it is instead of back and forth.
  let focusBack: ReturnType<typeof setTimeout> | undefined;
  hud.onModal = top => {
    clearTimeout(focusBack);
    if (top === null) { focusBack = setTimeout(() => { view.focusY = 0.5; }, 350); return; }
    view.focusY = top >= 0.5 + FOCUS_CLEAR ? 0.5 : Math.min(0.5, Math.max(0.2, top * 0.55));
  };
  view.calm = cameraMode() === 1;
  // Game speed 0/1/2: the original ticks every 120/80/40 ms (docs/rules/08 §2.3); the remake runs the board
  // twice as fast (60/40/20 ms) and keeps message boxes and pauses at the original's times (`wait`), so text
  // stays readable.
  const speeds = [{ label: '慢', ms: 60, wait: 1 }, { label: '中', ms: 40, wait: 80 / 120 }, { label: '快', ms: 20, wait: 40 / 120 }];
  let speed = 0;
  try { speed = Math.max(0, Math.min(2, Number(localStorage.getItem('rich4.speed') ?? 0))); } catch { /* default */ }
  view.tickMs = speeds[speed].ms;
  const scale = () => speeds[speed].wait;
  hud.scale = scale;
  const rotate = document.createElement('div');
  rotate.className = 'view-tools';
  rotate.innerHTML = `<button data-v="left" title="地圖向左旋轉 (Q)">${ICON_LEFT}</button><button data-v="right" title="地圖向右旋轉 (E)">${ICON_RIGHT}</button>`;
  rotate.onclick = e => {
    const v = (e.target as HTMLElement).closest('button')?.dataset.v;
    if (v === 'left') view.rotate(-1);
    if (v === 'right') view.rotate(1);
  };
  stage.append(rotate);

  /** State at the open turn menu: what a save stores (loading resumes at that menu). */
  let turnSave: SaveData | null = null;
  let lastAuto = '';
  /**
   * The dice picked on GO before a card / tool / stock action in the same turn: the turn menu opens again with that
   * choice instead of the player's last roll's count (the user 2026-10-26: picked 1, used 路障, GO showed 3 again).
   */
  let keptDice: { key: string; dice: number } | null = null;
  // Going to the background at the turn menu stores that turn again (the app may be closed or crash out there).
  const saveOnHide = () => {
    if (me !== session) { document.removeEventListener('visibilitychange', saveOnHide); return; }
    if (document.visibilityState === 'hidden' && turnSave && lastAuto) writeAuto(ty ? TYCOON_AUTO_SLOT : AUTO_SLOT, turnSave, `${me}:${lastAuto}`).catch(() => {});
  };
  document.addEventListener('visibilitychange', saveOnHide);
  /** Answers the open turn (GO or a toolbar action); null while no human decides to roll. */
  let answerTurn: ((a: Answer) => void) | null = null;
  const thumb = (id: number) => maps.find(m => m.id === id)?.thumbnail ?? '';
  toolbar.onAction = async key => {
    const turn = answerTurn;
    const needTurn = () => { if (!turn) hud.flash('請在自己的回合使用', 1000); return !!turn; };
    // 派對模式: no loading another game, no 托管 (both would change this phone's game alone).
    if (room && (key === 'load' || key === 'autopilot')) { hud.flash(key === 'load' ? '派對模式不能讀取進度' : '派對模式不能托管', 1200); return; }
    switch (key) {
      case 'save': {
        if (!turnSave) { hud.flash('請在自己的回合開始時存檔', 1200); return; }
        const data = turnSave;
        const slot = await pickSlot(shell, 'save', mapName, bank, thumb);
        if (slot >= 0) writeSlot(slot, data).then(() => hud.flash(`已存到存檔 ${slot}`, 900), () => hud.flash('存檔失敗', 1200));
        return;
      }
      case 'load': {
        const slot = await pickSlot(shell, 'load', mapName, bank, thumb);
        if (slot >= 0) void resume(slot, shell);
        return;
      }
      case 'card': case 'tool': case 'stock': case 'trade':
        if (!needTurn()) return;
        if (key === 'stock' && noStocks(game)) { hud.flash(ty ? '大富翁城沒有股市\n（股票進城時已換成現金）' : '大富翁城沒有股市', 1400); return; }
        // The menu is about to open: the clips of what can be used from it start loading now.
        if (key === 'card' || key === 'tool') warmFor(game.players[game.current], key);
        go.cancel(); turn!({ action: key });
        return;
      case 'autopilot': {
        const p = game.players[game.current];
        if (!p || !p.human) return;
        if (p.autopilot) { p.autopilot = false; hud.flash(`${nameOf(p.id)}取消托管\n下回合起自己操作`, 1300); hud.refresh(); return; }
        if (!needTurn()) return;
        go.cancel(); turn!({ action: 'autopilot' });
        return;
      }
      case 'system': {
        // One compact window: each row is one setting, a tap applies it at once (no scrolling, no explanations).
        const levels = ['關', '1', '2', '3', '4'];
        let syncTracks = () => {}; // the 曲目 row follows 專屬音樂 (five tracks or the original's eight)
        const rows: { label: string; opts: string[]; cur: () => number; pick: (i: number) => void; even?: boolean; wide?: boolean; nozh?: boolean }[] = [
          { label: '速度', opts: speeds.map(s => s.label), cur: () => speed, pick: i => {
            speed = i; view.tickMs = speeds[speed].ms;
            try { localStorage.setItem('rich4.speed', String(speed)); } catch { /* not kept */ }
          } },
          { label: '右側', opts: LAYOUTS, cur: () => layout, pick: i => {
            layout = i;
            try { localStorage.setItem('rich4.layout', String(layout)); } catch { /* not kept */ }
            applyLayout();
          } },
          { label: '小遊戲', opts: MINI_GAME_MODES, cur: () => (game.animation ? 0 : 1), pick: i => {
            for (const c of ty?.world.cities ?? [game]) c.animation = i === 0;
            try { localStorage.setItem('rich4.minigame', String(i)); } catch { /* not kept */ }
          } },
          { label: '自動買地', opts: AUTO_BUY_MODES, cur: () => (autoBuy() ? 1 : 0), pick: i => { try { localStorage.setItem(AUTO_BUY_KEY, String(i)); } catch { /* not kept */ } } },
          { label: '鏡頭跟隨', opts: CAMERA_MODES, cur: () => cameraMode(), pick: i => {
            try { localStorage.setItem(CAMERA_KEY, String(i)); } catch { /* not kept */ }
            view.calm = i === 1;
          } },
          { label: '魔法屋提示對象', opts: STREET_MODES, cur: () => magicHintMode(), pick: i => setMagicHintMode(i) },
          { label: '畫面', opts: ORIENTATIONS, cur: () => orientationMode(), pick: i => void setOrientation(i) },
          { label: '天氣', opts: [...WEATHER_MODES], cur: () => weatherMode(), pick: i => { setWeatherMode(i); hud.refresh(); } },
          // 歌舞伎町's living street (docs/rules/21 §8).
          ...(mapId === KB_MAP ? [{ label: '街頭行人', opts: STREET_MODES, cur: () => walkersMode(), pick: (i: number) => setWalkersMode(i) },
            { label: '街頭車輛', opts: STREET_MODES, cur: () => vehiclesMode(), pick: (i: number) => setVehiclesMode(i) },
            { label: '霓虹閃爍', opts: STREET_MODES, cur: () => neonMode(), pick: (i: number) => setNeonMode(i) }] : []),
          // 激情歲月 (docs/rules/24 §7–§10): its street, the loudspeakers, the quotations, the intro again.
          ...(mapId === JQ_MAP ? [{ label: '街頭行人', opts: STREET_MODES, cur: () => walkersMode(), pick: (i: number) => setWalkersMode(i) },
            { label: '街頭車輛', opts: STREET_MODES, cur: () => vehiclesMode(), pick: (i: number) => setVehiclesMode(i) },
            { label: '大喇叭廣播', opts: STREET_MODES, cur: () => loudspeakerMode(), pick: (i: number) => setLoudspeakerMode(i) },
            { label: '語錄開場白', opts: STREET_MODES, cur: () => quotesMode(), pick: (i: number) => setQuotesMode(i) },
            { label: '穿越片頭', opts: ['重播'], cur: () => -1, pick: () => { replayIntro = true; } },
            // its own music (§16): off plays the original's tracks on this map too, at once
            { label: '專屬音樂', opts: STREET_MODES, cur: () => jqMusicMode(), pick: (i: number) => {
              setJqMusicMode(i);
              audio.setMusicSet(musicSetFor(mapId, { tycoon: !!ty }), true);
              syncTracks();
            } },
            // its sound (issue #11): the loudspeaker treatment (default) or the clean files, switched at once in place
            { label: '音樂音質', opts: JQ_QUALITIES, cur: () => jqMusicQuality(), pick: (i: number) => {
              setJqMusicQuality(i);
              if (audio.ownMusic) audio.swapMusicFiles(musicSetFor(mapId, { tycoon: !!ty }));
            } }] : []),
          // 大富豪模式: the chat box's 播報 (docs/rules/17 §10).
          ...(chat ? [{ label: '播報', opts: CHAT_MODES, cur: () => chatMode(), pick: (i: number) => { setChatMode(i); chat.refresh(); } }] : []),
          { label: '語言', opts: LANGS.map(l => l.label), nozh: true, cur: () => LANGS.findIndex(l => l.id === lang()),
            pick: i => void setLang(LANGS[i].id).then(() => { render(); hud.refresh(); }) },
        ];
        if (groundStyles.length) {
          const list = GROUND_STYLES.filter(g => !g.id || groundStyles.includes(g.id));
          const short: Record<string, string> = { '': '原版', ghibli: '吉卜力', monopoly: '桌遊', genshin: '原神' };
          rows.push({ label: '地圖', wide: true, opts: list.map(g => short[g.id] ?? g.name),
            cur: () => Math.max(0, list.findIndex(g => g.id === (groundStyles.includes(groundStyle()) ? groundStyle() : ''))),
            pick: i => { setGroundStyle(list[i].id); void applyGround(); } });
        }
        for (const [label, key] of [['音樂', 'music'], ['音效', 'sfx'], ['語音', 'voice']] as const) {
          rows.push({ label, opts: levels, even: true, cur: () => audio.settings[key], pick: i => { audio.set({ [key]: i }); } });
        }
        // (激情歲月 with its own music: its five tracks)
        let tracks = audio.bgmCount;
        const trackOpts = () => [...Array.from({ length: tracks }, (_, i) => String(i + 1)), '靜音'];
        syncTracks = () => { tracks = audio.bgmCount; const r = rows.find(x => x.label === '曲目'); if (r) r.opts = trackOpts(); };
        rows.push({ label: '曲目', even: true, wide: true, opts: trackOpts(),
          cur: () => (audio.settings.mute ? tracks : audio.music?.kind === 'bgm' ? audio.music.index : -1),
          pick: i => {
            if (i === tracks) { audio.set({ mute: !audio.settings.mute }); return; }
            if (audio.settings.mute) audio.set({ mute: false });
            if (!audio.holiday) audio.background(i + 1);
          } });
        const grid = document.createElement('div');
        grid.className = 'sys-grid';
        const render = () => {
          grid.innerHTML = rows.map((r, n) => `<b${r.wide ? ' class="w"' : ''}>${r.label}</b><div class="chips${r.even ? ' even' : ''}${r.wide ? ' w' : ''}"${r.nozh ? ' data-nozh' : ''}>${r.opts.map((o, i) =>
            `<button class="chip${r.cur() === i ? ' on' : ''}" data-row="${n}" data-v="${i}">${o}</button>`).join('')}</div>`).join('');
        };
        grid.addEventListener('click', e => {
          const c = (e.target as HTMLElement).closest<HTMLElement>('[data-row]');
          if (!c) return;
          audio.ui('click');
          rows[Number(c.dataset.row)].pick(Number(c.dataset.v));
          render();
        });
        render();
        let replayIntro = false;
        const v = await hud.settingsSheet('系統', grid,
          [{ label: '投降', kind: 'no', value: 'surrender' }, { label: '回到標題', value: 'title' }]);
        if (v === 'surrender' && needTurn() && confirm('確定要投降嗎？')) { go.cancel(); turn!({ action: 'surrender' }); }
        if (v === 'title' && confirm('回到標題畫面？（未存檔的進度會遺失）')) location.reload();
        if (replayIntro) await playJqIntro(shell, game, bank!, scale());
        return;
      }
      case 'info':
        await hud.sheetNode('查詢', new InfoScreen(game, bank!).el);
        return;
      case 'map': {
        // 大富豪模式 (docs/rules/17 §12): any of the five cities as it is now, at the turn menu (the game waits).
        if (ty && turn) { await openCityViewer(hud, ty.world, bank!, Math.max(0, ty.world.view())); view.syncAll(); return; }
        // The original's full-screen small map (09 §7.9): tap a spot to look there.
        const big = new Minimap(game, bank!, view, minimap.ground);
        const size = Math.min(stage.clientWidth - 60, stage.clientHeight - 150, 520);
        const wrap = document.createElement('div');
        wrap.className = 'mm-big';
        wrap.style.width = wrap.style.height = `${size}px`;
        big.el.style.transform = `scale(${size / 200})`;
        big.res = size / 200;
        wrap.append(big.el);
        big.update();
        await hud.sheetNode('地圖', wrap);
        return;
      }
      case 'help':
        await hud.panelScreen('說明', [
          '輪到你時，按地圖上的 GO 擲骰子出發；\nGO 左邊的小骰子，可以選擇骰子數（騎車、開車時）。',
          '上方工具列：讀檔、存檔、地圖、查詢、道具、卡片、交易、股市，\n用法和原版一樣。',
          '右邊是目前玩家的資料，點右側分頁切換；\n日曆點太陽／月亮，切換日、月檢視。',
        ].map(t => `<p>${phrases(t, h => h.replace(/GO/g, '<b>GO</b>'))}</p>`).join(''));
        return;
    }
  };
  const pause = (ms: number) => new Promise(r => setTimeout(r, ms * scale()));
  const nameOf = (p: number) => playerName(game.players[p]);
  const colorOf = (p: number) => CHARACTERS[game.players[p].character].color;
  const isPlayer = (p: number) => p >= 0 && p < game.players.length;
  /**
   * Starts decoding the big one-off clips a player may set off from the tool or card menu (robot worker,
   * missiles, the monster and demolish cards), so playing them never decodes on the fly.
   */
  const warmFor = (p: import('../core/types').Player | undefined, menu?: 'tool' | 'card') => {
    if (!p) return;
    const ids: number[] = [];
    if (menu !== 'card') {
      if (p.tools[8] > 0) ids.push(553);      // 機器工人 (Data#553)
      if (p.tools[6] > 0) ids.push(528);      // 飛彈
      if (p.tools[12] > 0) ids.push(530);     // 核子飛彈
    }
    if (menu !== 'tool') {
      const has = (id: number) => (p.cards as number[]).includes(id);
      if (has(11)) ids.push(557); // 怪獸卡
      if (has(12)) ids.push(529); // 拆除卡
    }
    if (ids.length) void preloadClips(bank!, ids);
  };
  /** Walking actors stand still again once something other than a step happens. */
  const walking = new Set<number>();
  /**
   * The moving actor's looping sound (rich4.asm:5480-5770, player_utils.asm:1000-1125): footsteps / scooter / car /
   * engineering truck by vehicle (slot 0xb + v), the speedboat on water nodes (slot 0xf), the robot doll's steps
   * (slot 9), and the ticking of a carried time bomb (slot 3). They stop when the walk ends and around anything
   * that happens on the way (ATM, events), and start again with the next step.
   */
  let engine = -1;
  const moveSound = (actor: number, to: number) => {
    const water = nodeById(game.board, to).noDrop;
    const p = actor < game.npcBase ? game.players[actor] : undefined;
    const id = actor === game.dollId ? Sfx.doll : water ? Sfx.boat : p ? [Sfx.walk, Sfx.scooter, Sfx.car, Sfx.truck][p.traffic & 3] : Sfx.walk;
    if (engine !== id) { if (engine >= 0) audio.stop(engine); engine = id; }
    audio.loop(id);
    if (p?.bomb) audio.loop(Sfx.bombTick); else audio.stop(Sfx.bombTick);
  };
  const quiet = () => {
    if (engine >= 0) audio.stop(engine);
    engine = -1;
    audio.stop(Sfx.bombTick);
  };
  const settle = () => {
    quiet();
    for (const id of walking) view.stop(id);
    walking.clear();
    view.stepsLeft = null;
    view.syncAll();
  };

  // Everything the first view shows, loaded and decoded before the loading screen goes (within the device's memory
  // tier, ui/mem-tier.ts); a new game's first landing clip too.
  const lander = game.players[game.current];
  await preloadBoard(view, { root: shell, alive: () => me === session, clips: lander && !lander.placed ? [559 + lander.character] : [],
    onProgress: (f, what) => boot.progress(0.12 + 0.88 * f, what) });
  if (me !== session) return;
  // A new game starts with the first background track (fcn_00415872: fcn_00454d91(1)); a loaded one with the
  // next in turn (_rich4_start_game_loop(1) / save_load.asm:978: fcn_00454d91(0)).
  // 激情歲月 rotates its own tracks (docs/rules/24 §16); every other map and mode the original's.
  if (!sameWorld) audio.setMusicSet(musicSetFor(mapId, { tycoon: !!ty }));
  if (!sameWorld) audio.background(loaded ? 0 : 1);
  // The game goes on once the board shows whole (its first move would otherwise start under the fading screen).
  await boot.close();
  markLoading(null); // the load lived through (issue #7: a note left means the app was closed while loading)
  if (me !== session) return;
  // 激情歲月's 「穿越」 intro (docs/rules/24 §10): once when a new game on the map starts, never for a loaded one.
  if (mapId === JQ_MAP && !loaded && !ty) { await playJqIntro(shell, game, bank!, scale()); if (me !== session) return; audio.fanfare(); }
  /** The original's small map effects and lines for each event (docs/rules/11). */
  const director = new MapDirector(game, view, hud);
  (window as unknown as { __rich4: Record<string, unknown> }).__rich4.director = director;
  // Hang guard: every step below beats; a stall (no step, nobody human asked) is logged with what is still
  // awaited, then the view finishes whatever it holds (camera moves, walks, effects), so the game goes on.
  const wd = new Watchdog(15000, () => ({
    day: game.daysElapsed, current: game.current, view: view.debugState(), director: director.debugState(),
  }), () => view.unstick());
  wd.start();
  (window as unknown as { __rich4: Record<string, unknown> }).__rich4.watch = () => wd.report();
  (window as unknown as { __rich4Mem: unknown }).__rich4Mem = () => memReport(bank, view); // memory by kind (ui/mem-report.ts)
  const stopWatch = () => { wd.stop(); };
  // The last line of defence (issue #9: 「觸發事件時經常卡死…音效重複播放，界面可以點擊，但事件無法結算」): every effect,
  // screen and camera move an event shows is awaited through `shown`, which gives up on it after a generous time the
  // page was in front (a slow phone decoding pictures still has plenty; 3× while a human is the one the screen waits
  // for). Giving up logs it, finishes what the view holds, closes screens left open and stops looping sounds, and the
  // game goes on with the next event — the rules never wait on the screen, so nothing of the game is lost.
  const LONG_FX = new Set(['month-report', 'auction', 'auction-end', 'lottery-draw', 'dividends', 'finale-start', 'finale-blinds',
    'casino-result', 'tycoon-title', 'travel-onway', 'travel-depart', 'magic']);
  const limitFor = (long: boolean) => () => (long ? 150000 : 40000) * (0.5 + scale()) * (wd.human ? 3 : 1);
  /** The screens over the map or the whole game screen (an event's own, the wheel, the films …). */
  const overlays = () => [...shell.querySelectorAll<HTMLElement>('.fx-overlay, .pl-scene, .tc')];
  const shown = <T,>(label: string, start: () => Promise<T>, fallback: T, long = false): Promise<T> => {
    const before = new Set(overlays());
    return guard(label, start(), limitFor(long), fallback, () => {
      view.unstick();
      quiet();
      audio.stopLoops();
      audio.stopVoice();
      closeStuckScreens();
      hud.dismiss();
      // What this event opened and never closed would cover the next screens (and take their taps): taken down.
      for (const el of overlays()) if (!before.has(el)) el.remove();
    });
  };
  // 大富豪模式 (docs/rules/17 §10): the world bar (city, rivals left, the other cities' ticker; tap for the log).
  const bar = ty ? new WorldBar(ty.world) : null;
  const chat = ty ? new ChatBox(ty.world, bank) : null;
  const openLog = () => void hud.sheetNode('各地動態', logPanel(ty!.world, bank!));
  if (bar) { stage.append(bar.el); bar.onOpen = openLog; }
  if (chat) { stage.append(chat.el); chat.onOpen = openLog; }
  // What a player lost (cards, tools) in a box, a computer's in the log / chat box (ui/losses.ts).
  const losses = new LossNotices(game, () => hud.context(shell), { idle: () => director.idle(), note: (t, c) => hud.note(t, c),
    chat: chat ? l => chat.push(l) : undefined, mapIndex: () => ty?.world.view() ?? 0 });
  const flow = ty ? ty.flow : game.run();
  let answer: Answer = undefined;
  // 派對模式: the game's questions are numbered; this phone sends its seats' answers, waits for the others'.
  let askSeq = 0, sendSeq = -1, warnedDesync = false;
  const waiting = document.createElement('div');
  waiting.className = 'pt-waiting'; waiting.hidden = true;
  if (room) {
    stage.append(waiting);
    // The richest player can't be voted out (the same game state on every phone, so the same answer everywhere); a
    // tie (the start) protects nobody.
    room.richest = seat => {
      const me2 = game.players[seat];
      if (!me2 || me2.bankrupt || !me2.whoPlays) return false;
      const w = game.wealth(me2);
      return game.players.every(q => q === me2 || q.bankrupt || !q.whoPlays || game.wealth(q) < w);
    };
    room.onStatus = t => {
      if (room.kicked || room.refused) {
        // Its own notice over everything (a box could queue behind the game's), then back to the title. (refused: the
        // room's host turned out to be another version, party-version.ts — it says which, so it stays longer.)
        const out = document.createElement('div');
        out.className = 'pt-out';
        const why = room.kicked ? '你已被投票請出房間' : t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/\n/g, '<br>');
        out.innerHTML = `<div class="msg"><div class="msg-text">${why}<br>返回標題畫面…</div></div>`;
        document.body.append(out);
        setTimeout(() => location.reload(), room.kicked ? 2500 : 6000);
        return;
      }
      if (t) { waiting.textContent = t; waiting.hidden = false; } else waiting.hidden = true;
    };
  }
  // 派對模式's clock (the user 2026-10-19: no stalling): a turn not rolled within 60 s after GO first shows — card and
  // tool menus included — goes to the computer (托管); 取消托管 hands it back from the next turn.
  const TURN_MS = 60000;
  let turnDeadline = 0;
  const cancelAuto = new Set<number>();
  /** 托管 asked for from the bar, waiting for this phone's next turn. */
  let wantAuto = false;
  const clock = document.createElement('div');
  clock.className = 'pt-clock'; clock.hidden = true;
  const unauto = document.createElement('button');
  unauto.className = 'candy yes pt-unauto'; unauto.hidden = true;
  if (room) {
    stage.append(clock, unauto);
    unauto.onclick = e => {
      e.stopPropagation(); audio.ui('click');
      for (const seat of room.mine) if (game.players[seat]?.autopilot) cancelAuto.add(seat);
    };
    const tick = window.setInterval(() => {
      if (me !== session) { clearInterval(tick); return; }
      const left = turnDeadline ? Math.ceil((turnDeadline - Date.now()) / 1000) : 99;
      clock.hidden = left > 20 || left < 0;
      clock.textContent = `還剩 ${left} 秒`;
      const auto = [...room.mine].some(seat => game.players[seat]?.autopilot && !game.players[seat].bankrupt);
      unauto.hidden = !auto;
      unauto.textContent = [...room.mine].some(s2 => cancelAuto.has(s2)) ? '下回合恢復手動' : '托管中・取消托管';
    }, 400);
    // The row of 派對模式 buttons under the toolbar (party-chat.ts PartyBar): chat, quick phrases, reactions, players,
    // votes, 托管. 托管 asked for here answers this phone's next turn with the computer (in step on every phone, like
    // the 60 s clock); off again: 取消托管 from the next turn.
    const mine = () => [...room.mine].map(seat => game.players[seat]).filter(p => p && !p.bankrupt);
    const partyBar = new PartyBar(stage, room, c => bank!.art('Data', 2, c)?.src ?? '', {
      state: () => mine().some(p => p.autopilot) ? ([...room.mine].some(seat => cancelAuto.has(seat)) ? 'back' : 'auto') : wantAuto ? 'pending' : 'manual',
      toggle: () => {
        if (mine().some(p => p.autopilot)) {
          const back = [...room.mine].some(seat => cancelAuto.has(seat));
          for (const seat of room.mine) if (back) cancelAuto.delete(seat); else if (game.players[seat]?.autopilot) cancelAuto.add(seat);
          return;
        }
        wantAuto = !wantAuto;
        if (wantAuto && answerTurn && room.mine.has(game.current)) { wantAuto = false; void hud.flash('改由電腦托管\n（再按「取消托管」恢復手動）', 1600); go.cancel(); answerTurn({ action: 'autopilot' } as Answer); }
      },
    });
    shell.insertBefore(partyBar.el, stage);
    shell.classList.add('party');
  }
  /** The rest of this phone's turn clock (null when it does not run for this question). */
  const expires = (p: number): Promise<void> | null => {
    if (!room || !room.mine.has(p) || p !== game.current) return null;
    if (!turnDeadline) turnDeadline = Date.now() + TURN_MS;
    return new Promise(res => setTimeout(res, Math.max(0, turnDeadline - Date.now())));
  };
  /** `ui` or, when the clock runs out first, `late()`. */
  // `late` runs only while this question is still open: the clock of a question answered in time used to fire anyway
  // later and close whatever was open then (a card menu, the stock market) and hide the next GO (issue #4).
  const timed = async <T,>(ui: Promise<T>, clockRun: Promise<void> | null, late: () => T): Promise<T> => {
    if (!clockRun) return ui;
    let settled = false;
    const never = new Promise<T>(() => {});
    const r = await Promise.race([ui.then(v => { settled = true; return v; }), clockRun.then(() => (settled ? never : late()))]);
    settled = true;
    return r;
  };
  const dropped = new Map<number, number>();
  const digest = () => {
    let h = game.rng.seed >>> 0;
    for (const p of game.players) for (const v of [p.cash, p.bank, p.node, p.points, p.cards.length]) h = (Math.imul(h ^ v, 0x01000193) >>> 0);
    return h;
  };
  for (;;) {
    if (me !== session) { stopWatch(); room?.close(); return; }
    if (room && sendSeq >= 0) { room.answer(sendSeq, answer); sendSeq = -1; }
    const r = flow.next(answer);
    answer = undefined;
    if (r.done) break;
    const s = r.value;
    // One event a screen cannot show (say, a player still on another city's square) is skipped and logged; it must
    // never stop the game (the user lost games to that: 小財神's payers, a summoned rival).
    try {
    await shown('losses', () => losses.before(s), undefined);
    wd.beat('ask' in s ? `ask:${s.t}` : s.t === 'fx' ? `fx:${s.kind}` : s.t);
    if (!('ask' in s) && (s.t === 'step' || s.t === 'actor-step')) {
      await shown('director.idle', () => director.idle(), undefined);
      if (s.t === 'actor-step') director.actorStep(s);
      const id = s.t === 'step' ? s.p : s.actor;
      walking.add(id);
      view.followActor(id);
      view.stepsLeft = s.t === 'step' ? s.left + 1 : null;
      const speedPx = s.t === 'step' ? SPEED[game.players[s.p].traffic & 3] : 8;
      moveSound(id, s.to);
      await shown(`view.move ${id}`, () => view.move(id, s.to, s.dir, speedPx), undefined);
      view.stepsLeft = s.t === 'step' ? s.left : null;
      if (s.t === 'step' && s.left === 0) {
        // Stopping on a special square (E 2..16) first plays its sound (core_actions:322-345, table 0x475299):
        // the points and card squares (10..13) slot 16, the others slot 10. Sleepwalkers trigger nothing.
        quiet();
        const e = nodeById(game.board, s.to).event;
        if (e >= 2 && e <= 16 && !game.players[s.p].sleepwalk) audio.sfx(e >= 10 && e <= 13 ? Sfx.points : Sfx.special);
      }
      continue;
    }
    settle();
    if ('ask' in s) {
      await shown('director.idle', () => director.idle(), undefined);
      view.followActor(s.p);
      hud.refresh();
      if (room) {
        const seq = askSeq++;
        if (s.t === 'turn' && !room.digest(seq, digest()) && !warnedDesync) { warnedDesync = true; void hud.flash('和房主的遊戲不同步了\n請把這局截圖給開發者', 2600); }
        if (!room.mine.has(s.p)) {
          // Another phone's player decides: wait for the answer. A seat sent away (voted out) is answered by the
          // host for the computer: 托管 at its turn (then the rules play it), the safe answer otherwise.
          // A phone gone for 10 s counts as dropped: the host answers it the same way (the user 2026-10-19).
          const auto = () => (s.t === 'turn' ? { action: 'autopilot' } : s.t === 'auto-turn' ? 0 : autoAnswer(s)) as Answer;
          wd.setHuman(true);
          let got: { v: Answer } | null = null;
          while (!got) {
            if (room.host) {
              if (room.ownerConnected(s.p)) dropped.delete(s.p); else if (!dropped.has(s.p)) dropped.set(s.p, Date.now());
              if (room.kickedSeats.has(s.p) || Date.now() - (dropped.get(s.p) ?? Infinity) >= 10000) { answer = auto(); sendSeq = seq; break; }
            }
            waiting.textContent = room.kickedSeats.has(s.p) ? `${nameOf(s.p)} 由電腦接手…` : `等待 ${nameOf(s.p)} 操作…`; waiting.hidden = false;
            // (untilHost only for a guest: it is already settled on the host, and racing it there spun forever)
            got = await Promise.race([room.wait(seq).then(v => ({ v: v as Answer })), ...(room.host ? [] : [room.untilHost().then(() => null)]), new Promise<null>(r => setTimeout(() => r(null), 1000))]);
          }
          if (got) answer = got.v;
          wd.setHuman(false);
          waiting.hidden = true;
          continue;
        }
        // This phone's seat but no connection: the host may have answered it meanwhile (dropped): take that.
        if (!room.connected()) {
          waiting.textContent = '與房主的連線中斷，重新連線中…'; waiting.hidden = false;
          const fromLog = await Promise.race([room.wait(seq).then(v => ({ v: v as Answer })), room.untilConnected().then(() => null)]);
          waiting.hidden = true;
          if (fromLog) { answer = fromLog.v; continue; }
        }
        sendSeq = seq;
        if (s.t === 'auto-turn') { answer = (cancelAuto.delete(s.p) ? 1 : 0) as Answer; continue; }
        if (s.t === 'turn' && wantAuto) { wantAuto = false; answer = { action: 'autopilot' } as Answer; continue; }
      }
      if (s.t === 'turn') {
        // Auto-save when a human's turn opens, before the dice (one per turn): slot 0, or 大富豪模式's own automatic slot.
        turnSave = ty ? (saveWorld(ty.world) as unknown as SaveData) : saveGame(game);
        const key = `${game.daysElapsed}:${game.current}`;
        if (key !== lastAuto) {
          lastAuto = key;
          // A failed automatic save says so plainly (it used to be a log line nobody saw), and is tried again.
          const slot = ty ? TYCOON_AUTO_SLOT : AUTO_SLOT, data = turnSave;
          // The last five turns are kept (saves.ts writeAuto); the same turn again rewrites its own copy.
          const turn = `${me}:${key}`;
          writeAuto(slot, data, turn).catch(() => writeAuto(slot, data, turn)).catch(() => { if (me === session) void hud.flash('自動存檔失敗！\n請用「存檔」手動存一次', 2600); });
        }
        const p = game.players[s.p];
        wd.setHuman(true);
        // The human decides: the map may be dragged, turned and tapped for information (09 §1.4).
        view.setMode('free');
        // Idle time: get the big clips of what this player can use ready, so they never load while playing.
        warmFor(p);
        answer = await timed(new Promise<Answer>(resolve => {
          answerTurn = resolve;
          toolbar.setTurnOpen(true);
          go.show(p.traffic & 3, keptDice?.key === key ? keptDice.dice : p.dice, s.maxDice, p.stay !== 0, p.turtle !== 0).then(dice => resolve({ dice }));
        }), expires(s.p), () => { go.cancel(); void hud.flash('60 秒沒有前進\n改由電腦托管（可按「取消托管」）', 2200); return { action: 'autopilot' } as Answer; });
        answerTurn = null;
        // Another action first (card, tool, stocks…): keep the dice picked on GO for when the turn menu opens again.
        keptDice = answer && typeof answer === 'object' && 'dice' in answer ? null : { key, dice: go.picked() };
        wd.setHuman(false);
        view.setMode('locked');
        toolbar.setTurnOpen(false);
        go.hide();
        turnSave = null;
        continue;
      }
      if (s.t === 'yesno' && s.kind && AUTO_BUY_KINDS.has(s.kind) && autoBuy()) { answer = true as Answer; continue; } // 自動買地
      if (s.t === 'pick-city-node') {
        // 洲際飛彈 on another city: the square tapped on that city's map in the city viewer.
        wd.setHuman(true);
        answer = (ty ? await openCityViewer(hud, ty.world, bank!, s.city, { nodes: s.nodes, title: s.title }) : 0) as unknown as Answer;
        wd.setHuman(false);
        view.syncAll();
        continue;
      }
      if (s.t === 'pick-node' || s.t === 'pick-map') {
        // Pick on the map itself, as the original does (09 §7.5, 04 §2.4).
        const hint = document.createElement('div');
        hint.className = 'pick-hint';
        hint.innerHTML = `<span>${s.title}：點選發光的位置</span>${s.cancellable ? '<button class="candy ghost">取消</button>' : ''}`;
        // Picking on the map (ui_use_tool.asm:900-935): a valid spot confirms (Effect#2), a wrong one errs (#3),
        // cancelling #4.
        const onMiss = () => {
          audio.ui('error');
          hint.classList.remove('miss'); void hint.offsetWidth; hint.classList.add('miss');
        };
        if (s.onScreen) view.snapTo(s.p);
        const pick = s.t === 'pick-node'
          ? view.pickNode(s.nodes, onMiss, !!s.onScreen, !!s.plot, s.p)
          : view.pickSpots(s.spots, {
            onMiss, onScreen: !!s.onScreen, self: s.p,
            // Several choices under one finger (players on one square …): name them.
            choose: async idx => Number(await hud.ask({ t: 'choose', p: s.p, title: s.title, options: idx.map(i => ({ label: s.spots[i].label, value: i })), cancellable: true })),
          });
        const none = s.t === 'pick-node' ? 0 : -1;
        if (!pick.count) {
          pick.cancel();
          await pick.done;
          await hud.flash('畫面內沒有可選擇的對象', 1500);
          answer = none as unknown as Answer;
          continue;
        }
        stage.append(hint);
        shrinkText(hint, 'span', 10); // a long title stays on its one line, smaller rather than cut off
        stage.classList.add('picking');
        hint.querySelector('button')?.addEventListener('click', () => pick.cancel());
        // An on-screen pick (every card and tool but the missiles) keeps the map still, as the original does;
        // the missiles may look round the whole map (selector flag 0x80, 05 §2.6).
        view.setMode(s.onScreen ? 'pick' : 'pick-scroll');
        wd.setHuman(true);
        answer = await timed(pick.done as Promise<Answer>, expires(s.p), () => { pick.cancel(); return none as unknown as Answer; });
        wd.setHuman(false);
        view.setMode('locked');
        stage.classList.remove('picking');
        audio.ui(answer !== none ? 'yes' : 'no');
        hint.remove();
        view.followActor(game.current);
        continue;
      }
      if (s.t === 'pick-player') {
        // Card targets are picked on the map in the original (04 §2.4), so only who is on the player's screen.
        const near = s.players.filter(id => view.inViewOf(s.p, id));
        if (!near.length) { await hud.flash('畫面內沒有可選擇的對象', 1500); answer = -1 as unknown as Answer; continue; }
        wd.setHuman(true);
        answer = (await hud.ask({ ...s, players: near })) as Answer;
        wd.setHuman(false);
        continue;
      }
      wd.setHuman(true);
      // The wheel and the slot machine only want the moment of a tap (the rules stop them by themselves for anyone
      // else): one never stopped is stopped for the player after a long while, rather than holding the game for good.
      const asked = s.t === 'wheel' || s.t === 'slot-machine' ? shown(`ask ${s.t}`, () => hud.ask(s), 0 as unknown) : hud.ask(s);
      answer = await timed(asked as Promise<Answer>, expires(s.p), () => { hud.dismiss(); return autoAnswer(s); });
      wd.setHuman(false);
      continue;
    }
    switch (s.t) {
      case 'turn':
        turnDeadline = 0; // 派對模式: a new turn, a new clock
        view.unmark();
        view.followActor(s.p);
        // Anyone's turn (a computer's too): the big clips of the tools they hold start loading in idle time.
        warmFor(game.players[s.p]);
        hud.refresh();
        await pause(250);
        break;
      case 'airdrop':
        view.followActor(s.p);
        hud.note(`${nameOf(s.p)}降落在地圖上`, colorOf(s.p));
        await shown('airdrop', () => director.airdrop(s), undefined);
        view.place(s.p, s.node);
        await pause(200);
        break;
      case 'teleport':
        view.place(s.p, s.node);
        view.syncAll(); // the facing on arrival (the exit closest to the old one) shows at once
        // The camera goes along to where they land (docs/rules/11 §7.1), then back to the one whose turn it is.
        await shown('teleported', () => director.teleported(s.p, s.node), undefined);
        await pause(300);
        view.unmark();
        view.refollow();
        break;
      case 'dice':
        view.followActor(s.p);
        hud.note(`${nameOf(s.p)}擲出 ${s.values.join(' + ')}`, colorOf(s.p));
        await shown('view.dice', () => view.dice(s.p, s.values), undefined);
        break;
      case 'buy': {
        const thing = s.kind === 'land' ? game.board.lands[s.id - 1].name : game.board.facilities[s.id - 1].name;
        hud.note(`${nameOf(s.p)}買下${thing}，花費 ${s.price.toLocaleString()} 元`, colorOf(s.p));
        audio.sfx(Sfx.buyLand);
        hud.refresh();
        await pause(500);
        await shown('buy', () => director.buy(s), undefined);
        break;
      }
      case 'build': {
        const thing = s.kind === 'land' ? game.board.lands[s.id - 1].name : game.board.facilities[s.id - 1].name;
        hud.note(`${nameOf(s.p)}在${thing}蓋到 ${s.level} 級（${s.cost.toLocaleString()} 元）`, colorOf(s.p));
        audio.sfx(Sfx.build);
        hud.refresh();
        await pause(500);
        await shown('build', () => director.build(s), undefined);
        break;
      }
      case 'pay': {
        const to = isPlayer(s.to) ? nameOf(s.to) : s.to === -1 ? '樂透獎池' : s.to === -2 ? '黑市' : s.to === -3 ? '交通' : '企業';
        const from = isPlayer(s.from) ? nameOf(s.from) : '企業';
        // Money "paid to the system" (fines, cheats, the beggar …) goes into the lottery jackpot as in the original
        // (06 §0.2), but the player paid a fine, not the lottery: say what it was, mention the jackpot only in the log.
        const toPot = s.to === -1;
        hud.note(toPot ? `${from}：${s.reason} ${s.amount.toLocaleString()} 元（進樂透獎池）` : `${from} → ${to}：${s.reason} ${s.amount.toLocaleString()} 元`, isPlayer(s.from) ? colorOf(s.from) : undefined);
        if (isPlayer(s.from) && !s.quiet) {
          // Paying for a lot or a facility's service (core_actions:492 / 1231) rings the till (slot 20).
          if (/費$/.test(s.reason) && s.reason !== '保護費') audio.sfx(Sfx.rent);
          // 大富豪模式: a payer in another city (小財神's eleven rivals) has no square on this map.
          const payer = game.players[s.from], n = game.here(payer) ? game.node(payer.node) : undefined;
          view.highlight = n && n.ref > 2000 && n.ref < 4000 ? n.ref - 2001 : null;
          await shown('pay box', () => hud.flash(toPot ? `${from}\n\n${s.reason}\n${s.amount.toLocaleString()} 元` : `${from}付給${to}\n\n${s.reason}\n${s.amount.toLocaleString()} 元`, 1300), undefined);
          view.highlight = null;
        }
        hud.refresh();
        await shown('pay', () => director.pay(s), undefined);
        break;
      }
      case 'points':
        hud.note(`${nameOf(s.p)}得到 ${s.amount} 點券`, colorOf(s.p));
        hud.refresh();
        if (await shown('points', () => director.points(s), true)) break;
        await pause(300);
        break;
      case 'bank':
        hud.refresh();
        break;
      case 'say':
        if (!s.text) break;
        hud.note(s.log ?? s.text, s.p !== undefined && isPlayer(s.p) ? colorOf(s.p) : undefined);
        if (await shown('say', () => director.say(s), true)) break;
        // A player's line is their speech cloud (09 §6.3); anything else is the message box.
        await shown('say box', () => s.p !== undefined && isPlayer(s.p) ? hud.say(s.p, s.text) : hud.flash(s.text), undefined);
        break;
      case 'bankrupt':
        hud.note(`${nameOf(s.p)}破產了！`, colorOf(s.p));
        hud.refresh();
        await shown('bankrupt', () => director.bankrupt(s), undefined);
        await shown('bankrupt box', () => hud.flash(`${nameOf(s.p)}破產了！`, 1800), undefined);
        break;
      case 'day':
        // Holiday music counts its days down, then today's holiday may start (fcn_0041cf67 / fcn_00452444).
        {
          // 激情歲月 (docs/rules/24): no Christmas or New-Year music in 1966 Beijing's map (it is built on the Japan slot).
          const h = game.settings.mapId === JQ_MAP ? null : holidayMusic(s.date, game.mapSlot);
          audio.newDay(h?.music ?? null, h?.days);
        }
        hud.refresh();
        bar?.update();
        hud.note(`—— ${format(s.date)} ——`);
        break;
      case 'fx':
        if (fxScreens[s.kind]) {
          if (typeof s.data?.text === 'string') hud.note(s.data.text, s.p !== undefined && isPlayer(s.p) ? colorOf(s.p) : undefined);
          hud.refresh();
          await shown('director.idle', () => director.idle(), undefined);
          // A screen a human plays (the slot machine's lever, a mini game) waits for them; a computer's runs alone.
          const actor = s.p !== undefined && isPlayer(s.p) ? game.players[s.p] : undefined;
          await shown(`locate ${s.kind}`, () => director.locate(s), undefined);
          wd.setHuman(!!actor && game.isHuman(actor));
          await shown(`screen ${s.kind}`, () => fxScreens[s.kind](hud.context(shell), s), undefined, LONG_FX.has(s.kind));
          wd.setHuman(false);
          hud.refresh();
          await shown(`after ${s.kind}`, () => director.after(s), undefined);
          break;
        }
        const took = await shown(`fx ${s.kind}`, () => director.fx(s), true);
        if (s.kind === 'robot-doll' && s.node) view.place(game.dollId, s.node);
        if (s.kind === 'robot-doll-end') view.hide(game.dollId);
        if (typeof s.data?.text === 'string') {
          hud.note(s.data.text, s.p !== undefined && isPlayer(s.p) ? colorOf(s.p) : undefined);
          if (s.kind === 'news' || s.kind === 'fate') {
            hud.refresh();
            const kind = s.kind, text = s.data.text, id = typeof s.data.id === 'number' ? s.data.id : undefined;
            await shown(`board ${kind}`, () => hud.board(kind, text, id, kind === 'news' ? 2400 : 1800), undefined);
            break;
          }
        }
        hud.refresh();
        if (!took) await pause(200);
        break;
      case 'board':
        hud.refresh();
        break;
      case 'ticker':
        chat?.push(s);
        bar?.update();
        break;
      case 'world-sync':
        view.syncAll();
        hud.refresh();
        bar?.update();
        break;
      case 'world-view':
        // The human travelled: the destination city is shown now, the world's flow goes on there.
        stopWatch();
        if (ty) showCity(ty.world, ty.flow, true);
        return;
      case 'gameover':
        hud.refresh();
        quiet();
        await shown('gameover', () => director.gameover(s.winner), undefined);
        // The ending (fcn_004075c1, jump.mkf) plays MIDI07 (flag 0x8006).
        // (激情歲月 with its own music: its fanfare, then its tracks go on; docs/rules/24 §16)
        if (audio.ownMusic) audio.fanfare(); else audio.theme(Theme.ending, true);
        stopWatch();
        // 大富豪模式: 大富翁城's results, then the podium or the losing scene in the results screen (docs/rules/17 §11).
        if (ty) {
          const w = ty.world, h = w.human();
          run = recordResult(run, worldResults(w, s.winner));
          await finaleResults(hud.context(shell), w, s.winner);
          const carried: CarriedSettings = { fundIndex: w.settings.fundIndex, traffic: w.settings.traffic, landLimitIndex: w.settings.landLimitIndex, daysLimitIndex: 0, victoryIndex: 0 };
          const act = await tycoonEnding(hud.context(shell), w, s.winner, () => nextGame(shell, carried, h ? [h.character] : [], -1));
          if (act === 'home') location.reload();
          return;
        }
        {
          // The results screen (docs/rules/20 §4), then 「下一局」 (another map, the same settings) or the title.
          const results = gameResults(game, s.winner);
          run = recordResult(run, results);
          const humans = game.players.filter(p => p.human).map(p => p.character);
          const act = await showResults(bank!, shell, results, { mapName: mapName(game.settings.mapId), next: () => nextGame(shell, game.settings, humans, game.settings.mapId) });
          if (act === 'home') location.reload();
        }
        return;
    }
    } catch (e) {
      // A screen that fails on one event (say, a player in another city) must not stop the game: the rules go on.
      console.error('event', JSON.stringify(s).slice(0, 300), (e as Error)?.stack ?? e);
      view.highlight = null;
      hud.note('（畫面略過一個事件）');
    }
  }
}

setup();
