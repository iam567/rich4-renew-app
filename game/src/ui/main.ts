/** Title/setup screen and the game controller that plays the engine's flow on screen. */
import './compat'; // older Android / vendor WebViews (issue #7): first, before anything runs
import './log-start'; // the error log (log.ts), before the game's own modules
import '@fontsource/huninn/index.css';
import { applyFont, fontMode, FONTS, setFont } from './fonts';
import { Capacitor } from '@capacitor/core';
import { CHARACTERS, playerName } from '../core/characters';
import { format, today } from '../core/date';
import { Game, PACE_NAMES, SPEED } from '../core/game';
import { PACE_HINTS } from '../core/types';
import { nodeById } from '../core/board';
import { loadGame, reshuffleGame, saveGame, type SaveData } from '../core/save';
import type { Answer, Ask, GameSettings, Step } from '../core/types';
import { Realtime, RT, RT_LENGTHS, rtMapOk, type RtEvent } from '../core/realtime';
import { RtClock } from './rt-clock';
import { addClear, clearStamp, loadClears } from './clears';
import { cardName } from '../core/modules/cards';
import { toolDef, toolIcon, TOOLS } from '../core/modules/tools';
import { MAGIC_GROUPS, MAGIC_NAMES } from '../core/modules/places';
import { BAD_GODS } from '../core/modules/objects';
import { restoreKeepsakes } from './keepsake';
import { desktopFull, isDesktop, quitDesktop, setDesktopFull } from './desktop-window';
import { RtMsgs } from './rt-msgs';
import { RtCool } from './rt-cool';
import { RtWatch } from './rt-watch';
import { RtAlert, GOD_EFFECT } from './rt-alert';
import { RtRank } from './rt-rank';
import { TitleBook } from './titles';
import { RtQuick } from './rt-quick';
import { quickWheel } from './screens/wheel';
import { closeQuestionScenes } from './screens/place-scene';
import { watchNotices } from './notice';
import { fatePicture, newsPicture } from './screens/news';
import { regionalPicture } from './screens/regional';
import { ASSETS, FULL_ONLY, fullOnlyMsg, loadMap, mapLacks, makerName, makerWon, mapList, type MapInfo } from './assets';
import { BoardView } from './board-view';
import { Hud } from './hud';
import { StatusStrip } from './status-strip';
import { GoButton, Toolbar } from './controls';
import { Calendar, PlayerPanel, PlayerStrip, sideFlag, SideToday } from './side';
import { Minimap } from './minimap';
import { InfoScreen } from './info';
import { askScreens, closeStuckScreens, fxScreens } from './screens/registry';
import { PartyBar } from './party-chat';
import { CheerFx, PlayerGifts, SpectatorBar, setWatchFx, WATCH_FX_KEY, WATCH_FX_MODES, watchFxOn } from './spectate';
import { uiAlert, uiConfirm } from './dialog';
import { setOrigArt } from './maker/deck';
import { setMapArt } from './maker/layers';
import { afterWin, keepPlayClock, openRanks, pendingRanks, prefetchTicket, rankRecorder, startRanked, ticketSeed } from './ranks';
import { keepAwake } from './awake';
import { libraryPlayed, makeMyMapThumbs, loadMyMap, myMapTag, myMapThumb, myMaps, onPlayLib, openMaker, openMakerMap, prepareMakerMap, restoreMakerMap, savedMyMap } from './maker';
import { openParty } from './party';
import { RULE_ITEMS, RULE_LABELS } from './rule-options';
import { Lobby, Room, TURN_SECONDS } from './party-net';
import { StockScreen } from './stock-screen';
import { formatPrice, type Stock } from '../core/modules/stocks';
import { AUTO_SLOT, TYCOON_AUTO_SLOT, interruptedLoad, loadSlot, markLoading, notice, pickSlot, saveStep, writeAuto, writeSlot, type Loaded } from './saves';
import { lowerTier } from './mem-tier';
import { memReport } from './mem-report';
import { logStep, setLogState } from './log';
import { SpriteBank } from './sprites';
import { MapDirector } from './map-fx';
import { audio, boardVoice, Sfx, Theme } from './audio';
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
import { fetchHeadCount, inParty } from './party-presence';
import { netConfig } from './net-peer';
import { probe } from './private-server';
import { PingTags, seatPing } from './party-hud';
import { askDoing, LOCAL_DOING } from './party-doing';
import { ActsLine, heldDiff, heldOf, type Held } from './party-acts';
import { setMiniLink, watchMini, type MiniFrame, type MiniLink } from './screens/mini-games';
import { flagHtml } from './region-flag';
import { nextGameMsg } from './party-net';
import { keptMoney } from '../core/game';
import { gameAt, gameEnd, gameStart, reportParty, reportSaveFailed } from './party-report';
import { chipGame, finaleToolbar, noStocks, prepareFinale } from './finale';
import { prepareHotels } from './hotels';
import { prepareAh11 } from './ah11';
import { prepareCityLots } from './city-lots';
import { FINALE_MAP } from '../core/casino-rules';
import { KB_MAP } from '../core/kabukicho';
import '../core/changan'; // 長安's rules (RULE_SETS.changan: 博戲坊)
import '../core/qingming'; // 清明上河's rules (map 111: 漕運, 梁山令, 聚義廳, the 水滸 squares)
import { mapAnimMode, prepareKabukicho, setMapAnimMode, STREET_MODES } from './kabukicho'; // 歌舞伎町 (docs/rules/21)
import { JQ_QUALITIES, QM_MAP_ID, jqMusicMode, jqMusicQuality, musicSetFor, setJqMusicMode, setJqMusicQuality } from './jq-music'; // 激情歲月's own music (docs/rules/24 §16)
import { JQ_MAP, loudspeakerMode, prepareJiqingPlaces, quotesMode, setLoudspeakerMode, setQuotesMode } from './jiqing'; // 激情歲月 (docs/rules/24)
import { applyJqTheme } from './jq-theme';
import { applyCnTheme } from './cn-theme';
import { setEraLine } from './era-line';
import { playJqIntro } from './screens/jq-intro';
import { playCnIntro } from './screens/cn-intro';
import { CHANGAN_MAP } from '../core/changan';
import { QINGMING_MAP } from '../core/qingming';
import { magicHintMode, setMagicHintMode } from './screens/magic'; // 魔法屋提示對象 (issue #8)
import './tycoon-onway';
import { setToolAnimMode, TOOL_ANIM_MODES, toolAnimMode } from './tool-cinema'; // 道具 / 高級卡片 cinematics: wraps the tool and card use (visual only)
import { padFor, padCount } from './pad';
import { openPadTest } from './pad-test'; // 手把／鍵盤操作 (issue #15): gamepad and keyboard play, idle until used
import { CHAT_MODES, ChatBox, chatMode, CITY_COLORS, cityThumb, installWorldScreens, logPanel, newWorld, registerSprites, resumeWorld, setChatMode, tycoon, WorldBar } from './tycoon';
import { setWeatherMode, WEATHER_MODES, weatherMode } from './weather';
import { initLang, lang, LANGS, setLang } from './lang';
import { attachLedger, gameResults, ledgerOf, worldResults } from '../core/stats';
import { CHALLENGE_MAPS, CHALLENGE_YEARS } from '../core/challenge';
import { ChallengeBar, MonthWatch, monthNotice, StarWatch, starTable, taskList } from './challenge';
import { monthlyById } from '../core/monthly';
import { achievementScene, earnCards, openCollection, proofShot, type Earned, type Evidence } from './collection';
import { itemIconSrc } from './screens/item-text';
import { OBJECT_NAMES } from '../core/modules/objects';
import { pickNextMap, showResults } from './results';
import { nextSettings, recordResult, type CarriedSettings, type RunRecord } from './next-game';
import { phrases, shrinkText } from './text';
import { canUpdate, checkUpdate, confirmStart, offerOnTitle, partyNeedsUpdate, pickVersion } from './update';
import { sayHello } from './install-stats';
import { openChangelog } from './changelog';
import { openBackup } from './save-backup';

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
    // Near-square screens (unfolded foldables, issue #24: OPPO Find N 540×596, Galaxy Z Fold ~0.83-0.9) keep the
    // landscape arrangement: portrait's bottom panels are 0.7 × the width tall and left the map a thin strip there.
    // Phones (≤ 0.6) and iPads (0.65-0.75) held upright stay portrait.
    const portrait = h > w * 1.25;
    shell.classList.toggle('portrait', portrait);
    if (portrait) {
      shell.style.setProperty('--tu', String(Math.min(1.6, w / 440)));
      // The panels under the map are 400 × 280 original px, as wide as the screen — but never more than about a third
      // of its height (the user 2026-11-03: on a wide portrait screen, an iPad held upright, they took half and left
      // the map small); there they stay that size, centred (style.css .game.portrait .side).
      const pu = Math.min(w / 400, (h * 0.34) / 280);
      shell.style.setProperty('--pu', String(pu));
      shell.classList.remove('roomy');
      // the room left beside them (issue #91: two empty strips on an iPad): the players' cards (side.ts PlayerStrip)
      const gaps = (w - 400 * pu) / 2 >= 96;
      if (gaps && !shell.classList.contains('gaps')) queueMicrotask(() => shell.dispatchEvent(new Event('gaps')));
      shell.classList.toggle('gaps', gaps);
    } else {
      // The right column takes at most ~36 % of the width (only near-square screens reach that cap).
      // (at least 0.6: an iPhone SE on its side, 320 px high, needs 0.67 for the panel and the calendar to fit)
      const u = Math.max(0.6, Math.min(2, h / 480, (w * 0.36) / 200));
      shell.style.setProperty('--tu', String(u));
      shell.style.setProperty('--pu', String(u));
      shell.classList.remove('gaps');
      // That cap leaves room under the panel and the calendar (480 original px): the small map goes there (日曆 mode).
      const spare = h - 480 * u, roomy = u < Math.min(2, h / 480) && spare >= 100 * u;
      shell.classList.toggle('roomy', roomy);
      if (roomy) shell.style.setProperty('--ms', String(Math.min(u, spare / 200)));
    }
  };
  new ResizeObserver(fit).observe(shell);
  fit();
}

let maps: MapInfo[] = [];
const mapName = (id: number) => makerName(id) ?? maps.find(m => m.id === id)?.name ?? `地圖 ${id}`; // (自建地圖: its own name; a 地圖庫 map's from the library)

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
  applyFont(); // 設定 → 字體 (fonts.ts)
  app.innerHTML = '<div class="loading">載入中…</div>';
  try {
    [maps, bank] = await Promise.all([mapList(), bank ?? SpriteBank.create()]);
    { const b = bank; setOrigArt(id => b.art('Data', id)?.src ?? null); setMapArt((res, f) => b.art('map', res, f)); } // 自建地圖's 新聞命運卡: the original cards' pictures
    await Promise.all([initLang(), warmThumbs(maps), loadClears(), restoreKeepsakes()]); // 語言 (lang.ts): 简体 converts the page from here on
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
  keepAwake(false);
  keepPlayClock(null);
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
  // 自建地圖 (the user 2026-11-11): the in-game map editor, its button drawn like 派對模式's (tools/tycoon-art/editor_button.py).
  const maker = `<button class="title-btn maker" data-act="maker" aria-label="自建地圖"><img class="n" src="${ASSETS}/maps/remake/title/maker.webp" alt=""><img class="h" src="${ASSETS}/maps/remake/title/maker-hover.webp" alt=""></button>`;
  // The title plays MIDI01 (rich4_ui_main.asm:483); buttons have the hover / click sounds.
  audio.setMusicSet(null); // the title and everything outside 激情歲月 play the original's music
  if (audio.music?.kind !== 'theme' || audio.music.index !== Theme.title) audio.theme(Theme.title, true);
  // (updated in the game: the program without the 1.3 installer's two maps — the user 2026-11-25: 「1.3.0 simple版」)
  const edition = Object.keys(FULL_ONLY).some(id => mapLacks(Number(id))) ? ' simple' : '';
  app.innerHTML = `<div class="title" style="${bg ? `--title-bg:url('${abs(bg.src)}');` : ''}${tall ? `--title-bg-tall:url('${abs(tall.src)}')` : ''}">
    <button class="title-cards" data-act="cards" aria-label="圖鑑"><img class="tc-icon" src="${ASSETS}/maps/remake/challenge/icon.webp" alt=""><img class="tc-label hant" src="${ASSETS}/maps/remake/challenge/label-hant.webp" alt=""><img class="tc-label hans" src="${ASSETS}/maps/remake/challenge/label-hans.webp" alt=""></button>
    <button class="title-ranks" data-act="ranks" aria-label="排行榜"><img class="tr-icon" src="${ASSETS}/maps/remake/ranks/icon.webp" alt=""><img class="tr-label" src="${ASSETS}/maps/remake/ranks/label.webp" alt=""></button>
    <div class="title-buttons">${btn('start', 1, '開始遊戲')}${party}${maker}${btn('load', 3, '讀取進度')}${btn('option', 5, '設定')}</div>
    <div class="title-note">${phrases('這款遊戲是大家一起完成的，感謝 GitHub 回報問題的朋友和 B 站留言區的每一條意見。')}</div>
    <button class="title-log" data-act="log">更新日誌</button>
    ${isDesktop() ? `<button class="title-quit" data-act="quit" aria-label="回到桌面"><img class="tq-icon" src="${ASSETS}/maps/remake/quit/icon.webp" alt=""><img class="tq-label" src="${ASSETS}/maps/remake/quit/label.webp" alt=""></button>` : ''}
    ${canUpdate() ? `<button class="title-ver" data-act="ver" aria-label="選擇版本">v${__APP_VERSION__}${edition} ▾</button>` : `<div class="title-ver">v${__APP_VERSION__}${edition}</div>`}</div>`;
  buttonSounds(app.querySelector('.title-buttons')!, '.title-btn');
  watchParty(app.querySelector<HTMLElement>('.party-live')!);
  app.onclick = async e => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act) stopWatchingParty();
    if (act === 'start') newGame();
    // 派對模式 on a version that plays with the newest (update.ts: one of its family since 1.2.2); alone, any version.
    if (act === 'party') void partyNeedsUpdate(app).then(go => { if (go) openParty({ app, bank: bank!, maps, play: (settings, room) => start(settings, room), back: () => { const el = app.querySelector<HTMLElement>('.party-live'); if (el) watchParty(el); } }); else title(); });
    if (act === 'load') void openLoad();
    if (act === 'option') options();
    if (act === 'maker') openMaker(app, () => title(), settings => start(settings));
    if (act === 'cards') void openCollection(app, mapName); // 挑戰模式's picture cards (docs/rules/26 §7.2)
    if (act === 'ranks') void openRanks(app, bank!, maps); // 排行榜 (ranks.ts)
    if (act === 'log') void openChangelog(app); // 更新日誌 (changelog.ts)
    // the PC / Mac app (the user 2026-11-23: 「Windows 版和 Mac 版…加一個回到桌面的按鈕」, then 「做個圖標，放排行榜下面」 — beside
    // 更新日誌 it was tapped by mistake): an icon under 排行榜, top right
    if (act === 'quit') void uiConfirm('回到桌面？', '離開').then(ok => { if (ok) quitDesktop(); });
    if (act === 'ver') void pickVersion(app); // 版本選擇 (update.ts): back to an older 1.2.x, or up again
  };
  afterLoadTrouble();
  // 自建地圖's 試玩 ended (the page reloaded): back to that map in the editor
  let trialMap = '';
  try { trialMap = sessionStorage.getItem('rich4.maker.back') ?? ''; sessionStorage.removeItem('rich4.maker.back'); } catch { /* none */ }
  if (trialMap) openMakerMap(app, trialMap, () => title(), settings => start(settings));
  // 在線更新 (update.ts): this version reached the title (it starts fine); a newer one is offered once per start.
  void confirmStart();
  void offerOnTitle(app);
  void sayHello(); // 玩家統計 (install-stats.ts): once a day
  void pendingRanks(app, bank!); // 排行榜: a game won while offline, offered now
  prefetchTicket(); // 排行榜's 開局券 ready before 開始遊戲 is pressed
  watchNotices(); // 系統公告 (notice.ts)
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
let titleCount = 0;
function watchParty(el: HTMLElement) {
  stopWatchingParty();
  inParty(null); // back at the title: no longer in 派對模式
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const lobby = new Lobby();
  titleLobby = lobby;
  // 派對模式's head count from the relay (party-presence.ts, the user 2026-11-03), read every 20 s here.
  let online = 0, stats = { privateRooms: 0, waiting: 0 };
  const draw = () => {
    if (titleLobby !== lobby || !el.isConnected) { if (!el.isConnected) stopWatchingParty(); return; }
    // on a 私服 (the user 2026-11-23: 「連接上私服的玩家，在主界面的派對模式按鈕上方，應該顯示當前在私服模式」): that line first,
    // and the head count is the 私服's own
    const srv = netConfig.server;
    el.hidden = !(srv || online || stats.privateRooms || stats.waiting);
    el.innerHTML = `${srv ? `<b class="srv">目前在私服模式：${srv.name.replace(/[&<>"]/g, '')}</b>` : ''}${online ? `<b>${srv ? '私服' : '派對模式'} ${online} 人在線</b>` : ''}${stats.privateRooms ? `<b>私享房間 ${stats.privateRooms}</b>` : ''}${stats.waiting ? `<b>等待夥伴 ${stats.waiting} 人</b>` : ''}`;
  };
  lobby.onStats = s => { stats = s; draw(); };
  const count = async () => {
    const srv = netConfig.server;
    const n = srv ? (await probe(srv.addr))?.info : await fetchHeadCount();
    if (titleLobby !== lobby) return; online = n?.online ?? 0; draw();
  };
  void count();
  titleCount = window.setInterval(() => void count(), 20_000);
  void lobby.start();
}
function stopWatchingParty() { titleLobby?.close(); titleLobby = null; clearInterval(titleCount); titleCount = 0; }

/** 電腦難度's names (Game.aiLevel 0–3; 地獄: the computers play their best and all against the humans, core/smart-ai.ts). */
const AI_LEVEL_NAMES = ['簡單', '中等', '困難', '地獄'];

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
 * The rows of 系統 / 設定: a cell per setting (its label, then its chips). The cell is `display: contents` (label and
 * chips sit in the grid's own columns) except on a portrait phone, where two cells share a line, each label above its
 * chips (style.css).
 */
function sysRowsHtml(rows: { label: string; opts: string[]; cur: () => number; even?: boolean; wide?: boolean; nozh?: boolean }[]): string {
  return rows.map((r, n) => `<div class="cell${r.wide ? ' w' : ''}${r.even ? ' even' : ''}"><b${r.wide ? ' class="w"' : ''}>${r.label}</b><div class="chips${r.even ? ' even' : ''}${r.wide ? ' w' : ''}"${r.nozh ? ' data-nozh' : ''}>${r.opts.map((o, i) =>
    `<button class="chip${r.cur() === i ? ' on' : ''}" data-row="${n}" data-v="${i}">${o}</button>`).join('')}</div></div>`).join('');
}

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
      stored('速度', 'rich4.speed', ['慢', '中', '快', '極快']),
      stored('右側', 'rich4.layout', ['日曆', '小地圖', '全部']),
      stored('小遊戲', 'rich4.minigame', MINI_GAME_MODES),
      { label: '道具動畫', opts: TOOL_ANIM_MODES, cur: () => toolAnimMode(), pick: i => setToolAnimMode(i) },
      stored('自動買地', AUTO_BUY_KEY, AUTO_BUY_MODES),
      stored('鏡頭跟隨', CAMERA_KEY, CAMERA_MODES),
      // 手把 (pad.ts): ○ 確定 the PlayStation way (the user 2026-11-08, the default), or A 確定 as on Xbox and the handhelds
      // 手把測試 (pad-test.ts, the user 2026-11-08): its own screen — 1P–4P connected, each button lit, the layout and what the buttons do
      { label: '手把', opts: ['搖桿測試（按鍵說明）'], cur: () => -1, pick: () => openPadTest(() => render()) },
      // issue #8: the magic house's box naming who its group hits (on by default; off as in the original)
      { label: '魔法屋提示對象', opts: STREET_MODES, cur: () => magicHintMode(), pick: i => setMagicHintMode(i) },
      { label: '畫面', opts: ORIENTATIONS, cur: () => orientationMode(), pick: i => { write('rich4.orientation', i); void applyOrientation(); } },
      // the PC / Mac app (issue #72): full screen or a window, and a way out
      ...(isDesktop() ? [{ label: '視窗', opts: ['全螢幕', '視窗'], cur: () => (desktopFull() ? 0 : 1), pick: (i: number) => void setDesktopFull(i === 0).then(render) },
        { label: '結束遊戲', opts: ['結束'], cur: () => -1, pick: () => { void uiConfirm('結束遊戲？', '結束').then(ok => { if (ok) quitDesktop(); }); } }] : []),
      { label: '天氣', opts: [...WEATHER_MODES], cur: () => weatherMode(), pick: i => write('rich4.weather', i) },
      // 歌舞伎町's / 激情歲月's living street (docs/rules/21 §8, 24): 行人, 車輛 and 霓虹 as one (the user 2026-11-03).
      { label: '地圖動畫', opts: STREET_MODES, cur: () => mapAnimMode(), pick: i => setMapAnimMode(i) },
      { label: '語言', opts: LANGS.map(l => l.label), nozh: true, cur: () => LANGS.findIndex(l => l.id === lang()),
        pick: i => void setLang(LANGS[i].id).then(render) },
      // 派對模式's 圍觀 (spectate.ts, the user 2026-11-03): the spectators' cheers on this screen, or only a log line.
      stored('禮物特效', WATCH_FX_KEY, WATCH_FX_MODES),
      // fonts.ts (the user 2026-11-03): 粉圓 / 文楷 / 圓體 / 系統, at once on every screen.
      { label: '字體', wide: true, opts: FONTS.map(f => f.label), cur: () => fontMode(), pick: i => setFont(i) },
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
    grid.innerHTML = sysRowsHtml(current);
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
  buttons.innerHTML = '<button class="candy ghost" data-backup="1">存檔備份</button><button class="candy ghost" data-close="1">關閉</button>';
  box.append(grid, buttons);
  overlay.append(box);
  // Styles redrawn for any map (the choice applies to the maps that have it).
  void groundIndex().then(g => { grounds = [...new Set(Object.values(g.maps).flat())]; if (overlay.isConnected) render(); });
  overlay.onclick = e => {
    const t = e.target as HTMLElement, c = t.closest<HTMLElement>('[data-row]');
    if (c) { audio.ui('click'); current[Number(c.dataset.row)].pick(Number(c.dataset.v)); render(); return; }
    if (t.closest('[data-backup]')) { audio.ui('click'); void openBackup(app); return; } // save-backup.ts
    if (t === overlay || t.closest('[data-close]')) { audio.ui('no'); ro.disconnect(); overlay.remove(); }
  };
  const ro = new ResizeObserver(fit);
  app.append(overlay);
  ro.observe(overlay);
  render();
}

// 創作樂園's 直接玩: the new-game sheet with that map picked, not kept in 我的地圖
onPlayLib((m, thumb) => newGame({ m, thumb }));

const LIB_PICK = '@lib';
/** The new-game sheet's smallest scale on a portrait screen (a 320 px phone is ~0.57): only shorter screens than that (a folded phone) scroll the settings (the user 2026-11-23: 「盡可能不要上下滑動，實在實在實在很極端的情況下不行的情況再滑動」). */
const NG_MIN_SCALE = 0.5;
/** `lib`: a map from 創作樂園 played as it is (直接玩), first among 我的地圖 and picked. */
function newGame(lib?: { m: import('./maker/model').MakerMap; thumb: string }) {
  prefetchTicket(); // 排行榜's 開局券, while the settings are chosen
  const b = bank!;
  const state = {
    mapId: 2, count: 4, fundIndex: 1, traffic: 0 as 0 | 1 | 2, daysLimitIndex: 0, victoryIndex: 0, landLimitIndex: 0,
    /** 電腦難度 (core/smart-ai.ts, Game.aiLevel): 0 簡單 = the original's computer, 1 中級, 2 困難, 3 地獄; 大富豪模式 too. */
    aiLevel: 0 as 0 | 1 | 2 | 3,
    /** 挑戰模式's deadline (docs/rules/26 §1): CHALLENGE_YEARS[i]. */
    yearsIndex: 0,
    /** 挑戰模式's 每月任務 (docs/rules/27): 1 on (the default), 0 off. */
    monthly: 1,
    /** 挑戰模式 (docs/rules/30, the user 2026-11-03): 關 / 每月 1 張 / 每月 2 張 / 完成就抽 (settings.monthTasks). */
    monthTasks: 0,
    /** 玩法 (docs/rules/31): 0 回合制, 1 即時制（測試版）; its length RT_LENGTHS[rtLen] (the user: 20 minutes first, 無限制 too). */
    realtime: 0,
    rtLen: 0,
    /** 遊戲節奏 (docs/rules/36, the user 2026-11-23): 0 慢節奏, 1 原版 (the default), 2 快節奏 (settings.pace). */
    pace: 1,
    kind: (lib ? 'mine' : 'orig') as MapInfo['kind'] | 'tycoon' | 'challenge' | 'mine',
    /** 我的地圖 (自建地圖, ui/maker): the map picked there (`lib`'s: LIB_PICK). */
    mine: lib ? LIB_PICK : '',
    slots: [{ character: 9, human: true }, { character: 4, human: false }, { character: 3, human: false }, { character: 0, human: false }],
  };
  const face = (c: number) => b.art('Data', 2, c)?.src ?? '';
  let page = 0;
  const PER_PAGE = 8;
  /** The seat the roster picks for (a comment on 2026-11-04: 「2p沒法選擇角色」): a seat made 玩家, or tapped once it is one. */
  let picking = 0;
  const chooser = () => (state.kind !== 'tycoon' && picking < state.count && state.slots[picking].human ? picking : 0);
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
  /**
   * The sheet is laid out on a fixed canvas (960×540 / 540×960) and scaled to fit, so everything shows at once. On a
   * short portrait screen (the user 2026-11-23: 「萬一豎屏被摺疊了，要允許他們上下滑動開局設置的開關」) it is scaled no
   * smaller than NG_MIN_SCALE (nor wider than the screen): the sheet is cut to the screen's height and the settings
   * scroll up and down, 返回 / 開始遊戲 staying under them; landscape's settings scroll in their column as well.
   */
  const fit = () => {
    const sheet = app.querySelector<HTMLElement>('.ng-sheet');
    if (!sheet) return;
    const w = app.clientWidth, h = app.clientHeight, portrait = h > w;
    sheet.classList.toggle('portrait', portrait);
    sheet.classList.remove('scroll');
    sheet.style.height = '';
    // Portrait: as tall as its content (style.css: height auto, the settings two to a row), at most 900.
    const natural = portrait ? sheet.offsetHeight || 900 : 540;
    const [dw, dh] = portrait ? [540, Math.min(900, natural)] : [960, 540];
    // room above for the ribbon (it sits half over the top edge)
    const kw = (w - 12) / dw;
    let k = Math.min(kw, (h - 12) / (dh + 34));
    if (portrait) {
      k = Math.max(k, Math.min(kw, NG_MIN_SCALE));
      const room = Math.floor((h - 12) / k - 34);
      if (natural > room) { sheet.style.height = `${room}px`; sheet.classList.add('scroll'); }
    }
    sheet.style.top = `calc(50% + ${Math.round(14 * k)}px)`;
    sheet.style.transform = `translate(-50%, -50%) scale(${k})`;
    shrinkText(sheet, '.ng-seat b, .ng-map span, .ng-pick span', 9);
    const opts = sheet.querySelector<HTMLElement>('.ng-opts');
    if (opts) { const more = () => opts.classList.toggle('more', opts.scrollTop + opts.clientHeight < opts.scrollHeight - 2); opts.onscroll = more; more(); }
  };
  window.addEventListener('resize', fit);
  /** 即時制 alone: one player against the computers (the user 2026-11-08: one phone, one view; several only in 派對模式). */
  /** 遊戲節奏: 原版 is no field at all (as every game before it). */
  const pace = () => (state.pace === 0 || state.pace === 2 ? { pace: state.pace as 0 | 2 } : {});
  const rtSolo = () => state.kind !== 'tycoon' && state.kind !== 'challenge' && !!state.realtime && rtOk(state.mapId);
  const render = () => {
    // 大富豪模式 (docs/rules/17): the five cities, your character against the other eleven.
    const ty = state.kind === 'tycoon', cm = state.kind === 'challenge', mine = state.kind === 'mine';
    if (rtSolo()) { state.slots.forEach((x, i) => { x.human = i === 0; }); picking = 0; }
    const who = chooser(), several = !ty && state.slots.slice(0, state.count).filter(x => x.human).length > 1;
    // 挑戰模式 (docs/rules/26): the maps with a task list, original and custom together.
    const list = maps.filter(m => !m.hidden && (cm ? CHALLENGE_MAPS.includes(m.id) : m.kind === state.kind));
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    const shown = list.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
    // One row per option: ‹ value › (tapping the value also steps it).
    const opt = (label: string, key: keyof typeof state, items: readonly string[], cls = '') => {
      const v = state[key] as number;
      return `<div class="ng-opt${cls}"><span>${label}</span><div class="stepper">
        <button data-step="${key}" data-n="${items.length}" data-d="-1">‹</button>
        <button class="val" data-step="${key}" data-n="${items.length}" data-d="1">${items[v]}</button>
        <button data-step="${key}" data-n="${items.length}" data-d="1">›</button></div></div>`;
    };
    const scrolled = app.querySelector<HTMLElement>('.ng-opts')?.scrollTop ?? 0; // (a tap on a lower setting keeps the list where it was)
    app.querySelector('.ng')?.remove();
    // 回合制 / 即時制: with the rules (the user 2026-11-13: beside the map tabs it broke their names onto two lines)
    const modeHtml = ty || cm || mine ? '' : `<div class="ng-mode${rtOk(state.mapId) ? '' : ' off'}" title="即時制是測試版"><button class="${state.realtime ? '' : 'on'}" data-opt="realtime" data-v="0">回合制</button><button class="${state.realtime ? 'on' : ''}" data-opt="realtime" data-v="1">即時制</button></div>`;
    const sheet = document.createElement('div');
    sheet.className = 'ng';
    sheet.innerHTML = `<div class="msg sheet ng-sheet"><div class="ribbon">新遊戲</div>
      <section class="ng-maps-sec"><div class="ng-head"><h3>地圖</h3><div class="chips">
          <button class="chip${state.kind === 'orig' ? ' on' : ''}" data-maps="orig">原版地圖</button>
          <button class="chip${state.kind === 'custom' ? ' on' : ''}" data-maps="custom">自製地圖 ${maps.filter(m => m.custom && !m.hidden).length}</button>
          <button class="chip${state.kind === 'mine' ? ' on' : ''}" data-maps="mine">我的地圖 ${myMaps().length}</button>
          <button class="chip${ty ? ' on' : ''}" data-maps="tycoon">大富豪模式</button></div>
</div>
        ${ty ? `<div class="ng-tycoon">${TYCOON_MAPS.map(id => `<figure><img src="${cityThumb(id)}" alt="" style="--cc:${CITY_COLORS[id]}"><figcaption>${CITY_NAMES[id]}</figcaption></figure>`).join('')}
          <p class="ng-tycoon-note">${phrases('你一人對上其他 11 位角色，大家隨機分散在五座城市。\n搭新幹線、飛機往來各地，讓所有對手破產，就能成為「首富大富豪」。')}</p></div>` : mine ? `<div class="ng-maps-wrap"><div class="ng-maps">${lib ? `<button class="ng-map ng-mine${state.mine === LIB_PICK ? ' on' : ''}" data-mine="${LIB_PICK}">${lib.thumb ? `<img src="${escHtml(lib.thumb)}" alt="">` : `<i>${lib.m.w} × ${lib.m.h}</i>`}<em class="mk-st pub">創作樂園</em><span>${escHtml(lib.m.name)}</span></button>` : ''}${myMaps().filter(e => !lib || e.id !== lib.m.id).map(e => `<button class="ng-map ng-mine${e.id === state.mine ? ' on' : ''}" data-mine="${escHtml(e.id)}">${(t => (t ? `<img src="${t}" alt="">` : `<i>${e.w} × ${e.h}${e.by ? `<br>${escHtml(e.by)} 做的` : ''}</i>`))(myMapThumb(e.id))}${myMapTag(e)}<span>${escHtml(e.name)}</span></button>`).join('') || (lib ? '' : '<p class="info-none">還沒有自己的地圖：在標題畫面按「自建地圖」做一張，或從創作樂園下載</p>')}</div></div>` : `<div class="ng-maps-wrap"><div class="ng-maps">${shown.map(m => `<button class="ng-map${m.id === state.mapId ? ' on' : ''}" data-map="${m.id}"><img src="${m.thumbnail}" alt=""><span>${m.name}</span>${m.lacks ? '<em class="ng-lacks">需完整版</em>' : clearStamp(m.id, 'ng-clear')}</button>`).join('') || '<p class="info-none">沒有可用的地圖</p>'}</div>
          ${pages > 1 ? `<button class="ng-pg prev" data-page="-1"${page === 0 ? ' disabled' : ''} aria-label="上一頁">‹</button><button class="ng-pg next" data-page="1"${page >= pages - 1 ? ' disabled' : ''} aria-label="下一頁">›<small>${page + 1}/${pages}</small></button>` : ''}</div>`}</section>
      <section class="ng-players-sec"><div class="ng-head"><h3>${several ? `${who + 1}P ` : ''}選擇角色</h3><div class="chips">${ty ? '<span class="ng-ty-who">選你的角色，其他 11 位都是電腦</span>' : `${[2, 3, 4].map(n => `<button class="chip${state.count === n ? ' on' : ''}" data-count="${n}">${n} 人</button>`).join('')}
          <button class="chip" data-reroll="1">重新抽選</button>`}</div></div>
        <div class="ng-roster">${CHARACTERS.map(c => {
          const seat = ty ? (c.id === state.slots[0].character ? 0 : -1) : state.slots.slice(0, state.count).findIndex(x => x.character === c.id);
          return `<button class="ng-pick${seat === who ? ' mine' : seat >= 0 ? ' taken' : ''}" data-pick="${c.id}" style="--c:#${c.color.toString(16).padStart(6, '0')}">
            <img src="${face(c.id)}" alt=""><span>${c.name}</span>${seat >= 0 ? `<em>${seat + 1}P</em>` : ''}</button>`;
        }).join('')}</div>
        </section>
      <section class="ng-lineup-sec">${ty ? `<div class="ng-lineup tycoon">${[state.slots[0].character, ...CHARACTERS.map(c => c.id).filter(id => id !== state.slots[0].character)].map((c, i) =>
          `<span class="${i ? '' : 'me'}" style="--c:#${CHARACTERS[c].color.toString(16).padStart(6, '0')}" title="${CHARACTERS[c].name}"><img src="${face(c)}" alt=""></span>`).join('')}</div>` : `<div class="ng-lineup">${state.slots.slice(0, state.count).map((s, i) => {
          const ch = CHARACTERS[s.character];
          return `<div class="ng-seat${several && i === who ? ' picking' : ''}"${s.human ? ` data-seat="${i}"` : ''} style="--c:#${ch.color.toString(16).padStart(6, '0')}"><img src="${face(s.character)}" alt=""><b>${i + 1}P ${ch.name}</b>
            <button class="chip${s.human ? ' on' : ''}"${rtSolo() ? ' disabled title="即時制只能一位玩家"' : ''} data-slot="${i}" data-act="who">${s.human ? '玩家' : '電腦'}</button></div>`;
        }).join('')}</div>`}</section>
      <section class="ng-opts">
        ${opt(RULE_LABELS.fundIndex, 'fundIndex', RULE_ITEMS.fundIndex)}
        ${opt(RULE_LABELS.traffic, 'traffic', RULE_ITEMS.traffic)}
        ${opt(RULE_LABELS.landLimitIndex, 'landLimitIndex', RULE_ITEMS.landLimitIndex)}
        ${ty ? `${opt('電腦難度', 'aiLevel', AI_LEVEL_NAMES)}<p class="ng-date">遊戲時間：直到所有對手破產</p>` : cm ? `${opt('期限', 'yearsIndex', CHALLENGE_YEARS.map(y => (y ? `${y} 年` : '不限')))}
        ${opt('每月任務', 'monthly', ['關', '開'])}
        <p class="ng-date">${CHALLENGE_YEARS[state.yearsIndex] ? '期限到時星最多的人獲勝' : '先拿到 100 顆星的人獲勝'}・欠債不破產</p>` : rtOk(state.mapId) && state.realtime ? `${opt('對局時間', 'rtLen', RT_LENGTHS.map(m => (m ? `${m} 分鐘` : '無限制')))}
        ${opt('電腦難度', 'aiLevel', AI_LEVEL_NAMES)}
        <p class="ng-date">即時制（測試版）：大家同時走・一天 12 秒・只有 1P 是玩家</p>` : `${opt(RULE_LABELS.daysLimitIndex, 'daysLimitIndex', RULE_ITEMS.daysLimitIndex)}
        ${opt(RULE_LABELS.victoryIndex, 'victoryIndex', RULE_ITEMS.victoryIndex)}
        ${opt('電腦難度', 'aiLevel', AI_LEVEL_NAMES)}
        ${state.mapId === FINALE_MAP || mine ? '' : opt('挑戰模式', 'monthTasks', ['關', '每月 1 張', '每月 2 張', '完成就抽'], state.monthTasks ? ' hot on' : ' hot')}`}
        ${modeHtml ? `<div class="ng-opt ng-mode-opt"><span>玩法</span>${modeHtml}</div>` : ''}
        ${ty || cm ? '' : opt('遊戲節奏', 'pace', PACE_NAMES)}
        ${ty || cm || state.pace === 1 ? '' : `<p class="ng-date ng-pace">${PACE_HINTS[state.pace]}・不上排行榜</p>`}
      </section>
      <div class="choices ng-actions"><span class="ng-start">開局日期<br>${format(today())}</span><button class="candy ghost" data-back="1">返回</button><button class="candy yes" data-go="1">開始遊戲</button></div></div>`;
    app.append(sheet);
    fit();
    const opts = sheet.querySelector<HTMLElement>('.ng-opts');
    if (opts && scrolled) { opts.scrollTop = scrolled; opts.onscroll?.(new Event('scroll')); }
  };
  // A swipe across the maps turns their page (the arrows beside them do too).
  let swipe: number | null = null;
  app.onpointerdown = e => { swipe = (e.target as HTMLElement).closest('.ng-maps') ? e.clientX : null; };
  app.onpointerup = e => {
    if (swipe === null) return;
    const dx = e.clientX - swipe;
    swipe = null;
    if (Math.abs(dx) < 40) return;
    const list = maps.filter(m => !m.hidden && (state.kind === 'challenge' ? CHALLENGE_MAPS.includes(m.id) : m.kind === state.kind));
    const next = Math.max(0, Math.min(Math.ceil(list.length / PER_PAGE) - 1, page + (dx < 0 ? 1 : -1)));
    if (next !== page) { page = next; audio.sfx(1); render(); }
  };
  app.onclick = e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button, [data-seat]');
    if (!t) return;
    const d = t.dataset;
    // Clicks (#1); picking a character plays its own sound (NEWGAME table 0x46ccd0: Effect#5).
    audio.sfx(d.pick ? 5 : d.go ? 2 : d.back ? 4 : 1);
    if (d.back) { app.querySelector('.ng')?.remove(); window.removeEventListener('resize', fit); title(); return; }
    if (d.page) page = Math.max(0, page + Number(d.page));
    if (d.maps === 'tycoon') { state.kind = 'tycoon'; render(); return; }
    if (d.maps === 'mine') {
      state.kind = 'mine'; state.mine ||= myMaps()[0]?.id ?? ''; state.realtime = 0; render();
      // pictures for the maps that have none yet, the list redrawn as each comes
      void makeMyMapThumbs(myMaps().map(e => e.id), () => { if (state.kind === 'mine' && app.querySelector('.ng-sheet')) render(); });
      return;
    }
    if (d.mine) { state.mine = d.mine; render(); return; }
    if (d.maps === 'challenge') {
      state.kind = 'challenge';
      if (!CHALLENGE_MAPS.includes(state.mapId)) state.mapId = CHALLENGE_MAPS[0];
      page = 0;
    } else if (d.maps) {
      state.kind = d.maps as MapInfo['kind'];
      const first = maps.find(m => m.kind === state.kind && !m.hidden && !m.lacks);
      if (first && !maps.some(m => m.id === state.mapId && m.kind === state.kind && !m.hidden && !m.lacks)) state.mapId = first.id;
      page = 0;
    }
    const lacks = d.map ? maps.find(m => m.id === Number(d.map) && m.lacks) : undefined;
    if (lacks) { audio.ui('error'); void uiAlert(fullOnlyMsg(lacks.name)); return; }   // (its pictures are only in the full installer, assets.ts FULL_ONLY)
    if (d.map) state.mapId = Number(d.map);
    if (d.count) { state.count = Number(d.count); reroll(); }
    if (d.reroll) reroll();
    if (d.pick) {
      // As in the original: pick your character, the other seats are drawn at random from the rest.
      const who = chooser(), c = Number(d.pick), other = state.slots.findIndex((x, i) => i !== who && x.character === c);
      if (other >= 0) state.slots[other].character = state.slots[who].character;
      state.slots[who].character = c;
      reroll();
    }
    if (d.seat) picking = Number(d.seat);
    if (d.opt) (state as Record<string, unknown>)[d.opt] = Number(d.v);
    if (d.step) {
      const n = Number(d.n), cur = (state as unknown as Record<string, number>)[d.step];
      (state as unknown as Record<string, number>)[d.step] = (cur + Number(d.d) + n) % n;
    }
    if (d.slot) {
      const s = state.slots[Number(d.slot)];
      if (d.act === 'who') { if (rtSolo()) return; s.human = !s.human; picking = s.human ? Number(d.slot) : 0; }
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
        ...(state.aiLevel ? { aiLevel: state.aiLevel } : {}),
      }));
      return;
    }
    if (d.go && state.kind === 'mine') {
      // 我的地圖: the map built for the game first (its ground picture takes a moment), then the usual rules
      const m = lib && state.mine === LIB_PICK ? lib.m : state.mine ? loadMyMap(state.mine) : null;
      if (!m) { audio.sfx(4); return; }
      const players = state.slots.slice(0, state.count);
      if (!players.some(p => p.human)) players[0].human = true;
      t.textContent = '準備地圖中…'; (t as HTMLButtonElement).disabled = true;
      libraryPlayed(m); // 地圖庫: a game begun on a map taken from it
      void prepareMakerMap(m).then(({ mapId, extra }) => {
        window.removeEventListener('resize', fit);
        start({
          mapId, players, fundIndex: state.fundIndex, traffic: state.traffic, landLimitIndex: state.landLimitIndex,
          daysLimitIndex: state.daysLimitIndex, victoryIndex: state.victoryIndex, startDate: today(), seed: (Math.random() * 2 ** 32) >>> 0,
          ...(state.aiLevel ? { aiLevel: state.aiLevel } : {}), ...pace(), ...extra, myMap: savedMyMap(m),
        });
      }).catch(err => { t.textContent = '開始遊戲'; (t as HTMLButtonElement).disabled = false; void uiAlert(`地圖準備失敗：${(err as Error).message}`); });
      return;
    }
    if (d.go) {
      window.removeEventListener('resize', fit);
      const players = state.slots.slice(0, state.count);
      if (!players.some(p => p.human)) players[0].human = true;
      const cm = state.kind === 'challenge';
      if (!cm && state.realtime && rtOk(state.mapId)) {
        // 即時制: one player on this phone, the computers for the other seats; no 挑戰模式, no day or money target
        start({
          mapId: state.mapId, players: players.map((p, i) => ({ ...p, human: i === 0 })), fundIndex: state.fundIndex, traffic: state.traffic,
          landLimitIndex: state.landLimitIndex, daysLimitIndex: 0, victoryIndex: 0, startDate: today(), seed: (Math.random() * 2 ** 32) >>> 0,
          ...(state.aiLevel ? { aiLevel: state.aiLevel } : {}), ...pace(), realtime: { length: RT_LENGTHS[state.rtLen] * 60_000 },
        });
        return;
      }
      start({
        mapId: state.mapId, players, fundIndex: state.fundIndex, traffic: state.traffic, landLimitIndex: state.landLimitIndex,
        // (排行榜: the server's 開局券 gives the seed — a game that may rank cannot be picked for its luck, ranks.ts)
        daysLimitIndex: cm ? 0 : state.daysLimitIndex, victoryIndex: cm ? 0 : state.victoryIndex, startDate: today(), seed: ticketSeed() ?? (Math.random() * 2 ** 32) >>> 0,
        ...(cm ? { challenge: true, challengeYears: CHALLENGE_YEARS[state.yearsIndex], challengeMonthly: !!state.monthly } : state.aiLevel ? { aiLevel: state.aiLevel } : {}),
        ...(cm ? {} : pace()),
        // 大富翁城 has no 挑戰模式 (the user 2026-11-03).
        ...(!cm && state.monthTasks && state.mapId !== FINALE_MAP ? { monthTasks: state.monthTasks as 1 | 2 | 3 } : {}),
      });
      return;
    }
    render();
  };
  render();
}

/** 即時制: the other players' effects still shown — what blows up or comes down (the user 2026-11-08: their lines and boxes
 * only in the log; the rest of the board follows the game state by itself). */
/** 即時制: how far behind the rules' clock the walks are shown (ms). */
const RT_VIEW_DELAY = 140;
const RT_BOARD_FX = new Set(['missile', 'nuke', 'bomb-explode', 'mine', 'demolish', 'dog', 'doll-clear']); // (dog: its bite, or knocked away by a car / scooter)
/** 即時制: this player's own effects still shown on the board — what moves, gets built or blows up; the rest is a message. */
const RT_MY_FX = new Set([...RT_BOARD_FX, 'enter-hotel', 'leave-hotel', 'leave-hospital', 'leave-prison', 'reappear', 'construction', 'construction-end',
  'free-upgrade', 'robot-doll', 'robot-doll-end', 'robot-worker', 'swap-house', 'swap-land', 'turn-around', 'place-object', 'demolish-object', 'toll-street', 'remote-dice']);
const rtOk = rtMapOk;
const escHtml = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

let bank: SpriteBank | null = null;

/** Bumped whenever a game starts or is loaded; a controller loop from an older session stops. */
let session = 0;
let currentView: BoardView | null = null;
let currentWeather: WeatherFx | null = null;

// (dev only: ?play=<map id> starts a game on that map straight away — testing a map's screens without the menus)
if (import.meta.env.DEV) {
  const play = Number(new URLSearchParams(location.search).get('play'));
  // (once the title is up: it is drawn after the assets load and would cover the game)
  const go = () => (document.querySelector('#app .title') ? start({ mapId: play, players: [6, 0, 4, 11].map((character, i) => ({ character, human: i === 0 })), fundIndex: 1, traffic: 0,
    landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: today(), seed: 12345 }) : setTimeout(go, 300));
  if (play) setTimeout(go, 300);
}

function start(settings: GameSettings, room?: Room) {
  // 派對模式, back after the app closed (issue #50): the game from the room's newest turn, the answers since follow.
  const back = room?.resume;
  if (back) {
    begin(settings.mapId, board => { const g = loadGame(JSON.parse(back.save) as SaveData, board); if (!ledgerOf(g.players)) attachLedger(g.players); return g; }, true, undefined, room);
    return;
  }
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
  // 我的地圖: the map built again under the save's id (its id was only the run's that began the game)
  if (data.settings.mapId >= 5000 && !data.settings.libMap) {
    try { await restoreMakerMap(data.settings, data.board); } catch (e) { backToTitle(`讀取存檔失敗：${(e as Error).message}\n請改選其他存檔或自動存檔。`, true); return; }
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
  const me = ++session, roomGen = room?.gen;
  keepAwake(true); // 圍觀, 托管, waiting for the others: the phone does not lock while a game is on screen
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
    await prepareJiqingPlaces(bank, mapId === JQ_MAP || (art.theme ?? false)); // 激情歲月's / 長安's place screens (docs/rules/24 §11.3); off on every other map
    game = make(art.board);
    chipGame.game = ty ? null : game;
    // 排行榜: a game loaded from a save never ranks (the user 2026-11-16: 存讀檔一次的就不上排行榜)
    if (loaded) { const l = ledgerOf(game.players); if (l) l.loaded = true; }
    keepPlayClock(ty ? null : game); // 排行榜's 最快榜: real time played
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
  if (art.theme === 'changan' || art.theme === 'qingming') applyCnTheme(shell, art.theme); // 長安's / 清明上河's words and skin: 文, 博戲坊 / 交子務 … (ui/cn-theme.ts)
  const toolbar = new Toolbar(bank);
  const stage = document.createElement('section');
  stage.className = 'stage';
  const side = document.createElement('aside');
  side.className = 'side';
  sideFlag.of = () => '';
  const panel = new PlayerPanel(game, bank), calendar = new Calendar(game, bank);
  const panelBox = document.createElement('div'), calBox = document.createElement('div'), mapBox = document.createElement('div');
  panelBox.className = 'pp-box'; calBox.className = 'cal-box'; mapBox.className = 'mm-box';
  panelBox.append(panel.el); calBox.append(calendar.el);
  // Portrait's corner under the right-hand widget (side.ts SideToday, style.css): the other widget small + today.
  const today = new SideToday(game), todayBox = document.createElement('div');
  todayBox.className = 'st-box';
  todayBox.append(today.el);
  side.append(panelBox, mapBox, calBox, todayBox);
  // 玩家一覽 (issue #91): the room left and right of the panels on a wide portrait screen
  const strip = new PlayerStrip(game, bank);
  shell.append(toolbar.el, stage, side, strip.left, strip.right);
  shell.addEventListener('gaps', () => strip.update());
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
  // 重慶 (docs/rules/33): the small map shows the three plates over the river island, as seen from above.
  const flatGround = (): CanvasImageSource => {
    if (!art.plates) return art.ground;
    const c = document.createElement('canvas'), n = 600;
    c.width = c.height = n;
    const x = c.getContext('2d')!;
    for (const im of [art.ground, art.plates[1], art.plates[2], art.plates[3]]) x.drawImage(im, 0, 0, n, n);
    return c;
  };
  // 重慶 (§1): the small map of one level: the background and the levels under it darker, nothing above it.
  const levelGrounds: HTMLCanvasElement[] = [];
  const levelGround = (k: number): CanvasImageSource => {
    if (levelGrounds[k]) return levelGrounds[k];
    const c = document.createElement('canvas'), n = 600;
    c.width = c.height = n;
    const x = c.getContext('2d')!;
    x.drawImage(art.ground, 0, 0, n, n);
    for (let j = 1; j <= k; j++) {
      x.fillStyle = 'rgba(10, 14, 32, .4)';
      x.fillRect(0, 0, n, n);
      if (art.plates?.[j]) x.drawImage(art.plates[j], 0, 0, n, n);
    }
    return (levelGrounds[k] = c);
  };
  const minimap = new Minimap(game, bank, view, firstGround?.preview ?? flatGround());
  if (art.plates) minimap.groundFor = levelGround;
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
    minimap.ground = g?.preview ?? flatGround();
    view.setGround(g);
    minimap.update();
  };
  const hud = new Hud(stage, game, bank, panel, calendar);
  hud.shell = shell;
  hud.facSprites = art.builds?.fac ?? null;
  // 派對模式: every phone plays the 小遊戲 by hand (issue #100: the setting is each phone's own, and one 自動結算 while
  // another played by hand split the game — the others waited for a 小遊戲 that was never played)
  for (const c of ty?.world.cities ?? [game]) c.animation = game.settings.party ? true : miniGameMode() === 0;
  // 排行榜 (ranks.ts): a game that might rank keeps its answers from its start, and the server keeps its time
  if (!ty && !room && !loaded) startRanked(game);
  const rec = rankRecorder(game);
  setMiniLink(null); // (派對模式 sets its own below)
  // Debug handle for screenshots and tests: open any screen without playing up to it.
  (window as unknown as { __rich4: unknown }).__rich4 = { game, hud, view, weather, room, ctx: () => hud.context(shell), askScreens, fxScreens, world: ty?.world,
    ending: ty ? (winner: number) => tycoonEnding(hud.context(shell), ty.world, winner) : undefined,
    results: (winner: number) => (ty ? tycoonEnding(hud.context(shell), ty.world, winner, () => Promise.resolve(false))
      : showResults(bank!, shell, gameResults(game, winner), { mapName: mapName(game.settings.mapId), next: () => nextGame(shell, game.settings, game.players.filter(p => p.human).map(p => p.character), game.settings.mapId) })) };
  // 狀態條 (ui/status-strip.ts): the timed states running (坐牢還剩3天, 股市休市 …) at the map's top right
  const statusStrip = new StatusStrip(stage, game, bank);
  const baseRefresh = hud.refresh.bind(hud);
  hud.refresh = () => { baseRefresh(); today.update(); statusStrip.update(); if (shell.classList.contains('gaps')) strip.update(); if (layout !== 0 || shell.classList.contains('portrait') || shell.classList.contains('roomy')) minimap.update(); };
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
  // stays readable. 極快 (the user 2026-11-03: streamers found 快 still slow): the board twice as fast again, notices
  // a glance long.
  const speeds = [{ label: '慢', ms: 60, wait: 1 }, { label: '中', ms: 40, wait: 80 / 120 }, { label: '快', ms: 20, wait: 40 / 120 },
    { label: '極快', ms: 10, wait: 0.15 }];
  // 自建地圖's 試玩 (the user 2026-11-12): one more, faster than 極快, for trying a map out
  if (game.settings.trial) speeds.push({ label: '試玩超快', ms: 4, wait: 0.05 });
  let speed = 0;
  try { speed = Math.max(0, Math.min(speeds.length - 1, Number(localStorage.getItem('rich4.speed') ?? 0))); } catch { /* default */ }
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
  // 試玩: 結束試玩 at any time (back to the map in the editor), and passed once someone goes bankrupt
  let trialPassed = false;
  const trialBtn = document.createElement('button');
  if (game.settings.trial) {
    trialBtn.className = 'trial-end';
    trialBtn.textContent = '結束試玩';
    trialBtn.onclick = () => {
      // (sessionStorage rich4.maker.back: the title opens the map in the editor)
      if (trialPassed) { location.reload(); return; }
      void uiConfirm('結束試玩，回到地圖編輯器？', '結束試玩', '繼續玩').then(ok => { if (ok) location.reload(); });
    };
    stage.append(trialBtn);
  }

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
  /** 派對模式: this phone's living seat while the turn is someone else's; -1 otherwise (a spectator, its own turn, gone bankrupt). */
  const waitSeat = () => {
    if (!room || room.watching || room.mine.has(game.current)) return -1;
    return [...room.mine].find(seat => { const q = game.players[seat]; return q && !q.bankrupt; }) ?? -1;
  };
  /** What a 查詢 or 股市 sheet opened while waiting does as the game goes on. */
  let waitLive = null as (() => void) | null;
  /** How this phone's last order went (shown on the market screen too). */
  let orderNews = '';
  let orderPop: (text: string) => void = () => {};
  const openWaitInfo = (who?: number) => {
    const info = new InfoScreen(game, bank!, who);
    hud.waitSheet('查詢', info.el, '', () => { waitLive = null; });
    waitLive = () => info.render();
  };
  /** 等待中下單 (stock-screen.ts OrderPad): the market of this game, trades as orders for the end of the turn. */
  const openOrders = () => {
    if (!room) return;
    const net = room, seat = waitSeat();
    if (noStocks(game)) { hud.flash('大富翁城沒有股市', 1400); return; }
    if (!game.stocks.open()) { hud.flash('本日休市', 1000); return; }
    const screen = new StockScreen(game, seat, null, {
      list: () => net.myOrders,
      place: t => {
        const ok = 'close' in t ? net.placeOrder(seat, -1, false, 1, { close: t.close }) : net.placeOrder(seat, t.slot, t.buy, t.n, t.lev ? { lev: t.lev } : {});
        if (!ok) void hud.flash(`最多同時 ${Room.MAX_ORDERS} 筆`, 1000);
        return ok;
      },
      cancel: id => net.cancelOrder(id),
      news: () => orderNews,
    });
    hud.waitSheet('股市', screen.el, 'stocks', () => { waitLive = null; net.onOrders = () => {}; });
    waitLive = () => screen.render();
    net.onOrders = () => screen.render();
  };
  const tellOrder = (d: { slot: number; n: number; buy: boolean; price?: number; why?: string; lev?: number; close?: number; kind?: string; shares?: number; entry?: number; long?: boolean; value?: number }) => {
    const name = (game.stocks as unknown as { stocks: Stock[] }).stocks[d.slot]?.name ?? '股票';
    if (d.kind === 'position-open') orderNews = `開倉：${name}${d.long ? '做多' : '做空'}${d.lev}倍 ${(d.shares ?? 0).toLocaleString('en-US')} 股，${formatPrice(d.entry ?? 0)} 元`;
    else if (d.kind === 'position-close') orderNews = `平倉：${name}，拿回 ${(d.value ?? 0).toLocaleString('en-US')} 元`;
    else if (d.close) orderNews = `沒有平倉（${d.why ?? ''}）`;
    else orderNews = d.n ? `成交：${d.buy ? '買進' : '賣出'} ${name} ${d.n.toLocaleString('en-US')} 股，每股 ${formatPrice(d.price ?? 0)} 元` : `沒有成交：${name}（${d.why ?? ''}）`;
    hud.note(`委託${orderNews}`);
    orderPop(`委託${orderNews}`);
    waitLive?.();
  };
  const thumb = (id: number) => maps.find(m => m.id === id)?.thumbnail ?? '';
  /** 即時制 (realtimeLoop): opens a card, a tool or the market outside this player's turn menu. */
  let rtAct: ((key: 'card' | 'tool' | 'stock') => void) | null = null;
  /** 即時制 alone: the game as it is now, for 存檔 at any moment. */
  let rtSaveData: (() => SaveData) | null = null;
  toolbar.onAction = async key => {
    const turn = answerTurn;
    if (rtAct && !turn && (key === 'card' || key === 'tool' || key === 'stock')) { rtAct(key); return; }
    const needTurn = () => { if (!turn) hud.flash('請在自己的回合使用', 1000); return !!turn; };
    // 派對模式, another player's turn (the user 2026-11-07): the player looks around and places share orders meanwhile.
    if (waitSeat() >= 0 && (key === 'info' || key === 'card' || key === 'tool')) { openWaitInfo(key === 'info' ? undefined : waitSeat()); return; }
    if (waitSeat() >= 0 && key === 'stock') { openOrders(); return; }
    // 派對模式: no loading another game, no 托管 (both would change this phone's game alone).
    if (room && (key === 'load' || key === 'autopilot')) { hud.flash(key === 'load' ? '派對模式不能讀取進度' : '派對模式不能托管', 1200); return; }
    if (game.settings.trial && (key === 'save' || key === 'load')) { hud.flash(key === 'save' ? '試玩不能存檔' : '試玩中不能讀取進度\n（先按「結束試玩」）', 1400); return; }
    switch (key) {
      case 'save': {
        const data = rtSaveData ? rtSaveData() : turnSave; // 即時制: at any moment
        if (!data) { hud.flash('請在自己的回合開始時存檔', 1200); return; }
        const slot = await pickSlot(shell, 'save', mapName, bank, thumb);
        if (slot >= 0) writeSlot(slot, data).then(() => hud.flash(`已存到存檔 ${slot}`, 900), e => { void hud.flash('存檔失敗', 1200); void reportSaveFailed('手動存檔', e, saveStep()); });
        return;
      }
      case 'load': {
        const slot = await pickSlot(shell, 'load', mapName, bank, thumb);
        if (slot >= 0) void resume(slot, shell);
        return;
      }
      case 'card': case 'tool': case 'stock': case 'trade':
        if (!needTurn()) return;
        if (key === 'stock' && game.settings.mapRules?.noStocks) { hud.flash('這張地圖不能炒股', 1200); return; }
        if (key === 'trade' && game.settings.mapRules?.noBlackMarket) { hud.flash('這張地圖沒有黑市', 1200); return; }
        if (key === 'stock' && noStocks(game)) { hud.flash(ty ? '大富翁城沒有股市\n（股票進城時已換成現金）' : '大富翁城沒有股市', 1400); return; }
        // The menu is about to open: the clips of what can be used from it start loading now.
        if (key === 'card' || key === 'tool') warmFor(game.players[game.current], key);
        go.cancel(); turn!({ action: key });
        return;
      case 'autopilot': {
        const p = game.players[game.current];
        if (!p || !p.human) return;
        if (p.autopilot) { p.autopilot = false; rankRecorder(game)?.autoOff(p.id); hud.flash(`${nameOf(p.id)}取消托管\n下回合起自己操作`, 1300); hud.refresh(); return; }
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
            if (!game.settings.party) for (const c of ty?.world.cities ?? [game]) c.animation = i === 0;   // (派對模式: always by hand, issue #100)
            rankRecorder(game)?.anim(i === 0); // (排行榜's record: whether a 小遊戲 asks the player)
            try { localStorage.setItem('rich4.minigame', String(i)); } catch { /* not kept */ }
          } },
          { label: '道具動畫', opts: TOOL_ANIM_MODES, cur: () => toolAnimMode(), pick: i => setToolAnimMode(i) },
          { label: '自動買地', opts: AUTO_BUY_MODES, cur: () => (autoBuy() ? 1 : 0), pick: i => { try { localStorage.setItem(AUTO_BUY_KEY, String(i)); } catch { /* not kept */ } } },
          { label: '鏡頭跟隨', opts: CAMERA_MODES, cur: () => cameraMode(), pick: i => {
            try { localStorage.setItem(CAMERA_KEY, String(i)); } catch { /* not kept */ }
            view.calm = i === 1;
          } },
          { label: '魔法屋提示對象', opts: STREET_MODES, cur: () => magicHintMode(), pick: i => setMagicHintMode(i) },
          { label: '畫面', opts: ORIENTATIONS, cur: () => orientationMode(), pick: i => void setOrientation(i) },
          // the PC / Mac app (issue #72): full screen or a window, and a way out (the game is saved each turn)
          ...(isDesktop() ? [{ label: '視窗', opts: ['全螢幕', '視窗'], cur: () => (desktopFull() ? 0 : 1), pick: (i: number) => void setDesktopFull(i === 0).then(render) },
                { label: '結束遊戲', opts: ['結束'], cur: () => -1, pick: () => { void uiConfirm('結束遊戲？\n（自動存檔在每回合開始時）', '結束').then(ok => { if (ok) quitDesktop(); }); } }] : []),
          { label: '天氣', opts: [...WEATHER_MODES], cur: () => weatherMode(), pick: i => { setWeatherMode(i); hud.refresh(); } },
          // 歌舞伎町's living street (docs/rules/21 §8).
          ...(mapId === KB_MAP ? [{ label: '地圖動畫', opts: STREET_MODES, cur: () => mapAnimMode(), pick: (i: number) => setMapAnimMode(i) }] : []),
          // 長安: its intro again
          // 清明上河: its intro again (the same opening, its own set)
          ...(mapId === QINGMING_MAP ? [{ label: '穿越片頭', opts: ['重播'], cur: () => -1, pick: () => { replayIntro = true; } }] : []),
          ...(mapId === CHANGAN_MAP ? [{ label: '穿越片頭', opts: ['重播'], cur: () => -1, pick: () => { replayIntro = true; } },
            { label: '專屬音樂', opts: STREET_MODES, cur: () => jqMusicMode(), pick: (i: number) => {
              setJqMusicMode(i);
              audio.setMusicSet(musicSetFor(mapId, { tycoon: !!ty }), true);
              syncTracks();
            } }] : []),
          // 清明上河: its own music too (jq-music.ts qmMusicSet), the same setting
          ...(mapId === QM_MAP_ID ? [{ label: '專屬音樂', opts: STREET_MODES, cur: () => jqMusicMode(), pick: (i: number) => {
              setJqMusicMode(i);
              audio.setMusicSet(musicSetFor(mapId, { tycoon: !!ty }), true);
              syncTracks();
            } }] : []),
          // 激情歲月 (docs/rules/24 §7–§10): its street, the loudspeakers, the quotations, the intro again.
          ...(mapId === JQ_MAP ? [{ label: '地圖動畫', opts: STREET_MODES, cur: () => mapAnimMode(), pick: (i: number) => setMapAnimMode(i) },
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
          grid.innerHTML = sysRowsHtml(rows);
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
        if (v === 'surrender' && needTurn()) void uiConfirm('確定要投降嗎？', '投降').then(ok => { if (ok && turn) { go.cancel(); turn({ action: 'surrender' }); } });
        if (v === 'title') {
          // 派對模式 with a newer version out (the user 2026-11-04): leaving now, the update would keep you out of this game.
          const newer = room && (await checkUpdate()).kind !== 'none';
          const ask = newer ? '已經有新版本了：現在離開的話，更新後版本不同，就回不到這一局了。\n建議打完這局再離開。確定要離開嗎？' : room ? '離開這一局？（電腦會接手你的位置）' : '回到標題畫面？（未存檔的進度會遺失）';
          void uiConfirm(ask).then(ok => { if (ok) location.reload(); });
        }
        if (replayIntro) await (mapId === CHANGAN_MAP || mapId === QINGMING_MAP ? playCnIntro(shell, game, bank!, scale(), mapId === QINGMING_MAP ? 'qingming' : 'changan') : playJqIntro(shell, game, bank!, scale()));
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
        big.groundFor = minimap.groundFor;
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
  // 長安's 「穿越到開元盛世」 intro (screens/cn-intro.ts), the same way.
  if (mapId === CHANGAN_MAP && !loaded && !ty) { await playCnIntro(shell, game, bank!, scale()); if (me !== session) return; audio.fanfare(); }
  // 清明上河's 「穿越到汴京」 (the user 2026-11-23: 「也沒有開場穿越動畫」), the same opening with its own set.
  if (mapId === QINGMING_MAP && !loaded && !ty) { await playCnIntro(shell, game, bank!, scale(), 'qingming'); if (me !== session) return; }
  // 清明上河's jingle (jq-music.ts qm-fanfare) as a new game starts (after its opening, when it has one)
  if (mapId === QM_MAP_ID && !loaded && !ty) audio.fanfare();
  /** The original's small map effects and lines for each event (docs/rules/11). */
  const director = new MapDirector(game, view, hud);
  (window as unknown as { __rich4: Record<string, unknown> }).__rich4.director = director;
  // Hang guard: every step below beats; a stall (no step, nobody human asked) is logged with what is still
  // awaited, then the view finishes whatever it holds (camera moves, walks, effects), so the game goes on.
  const wd = new Watchdog(15000, () => ({
    day: game.daysElapsed, current: game.current, view: view.debugState(), director: director.debugState(),
  }), () => view.unstick());
  wd.start();
  // the error log (log.ts): where the game is
  setLogState(() => `map ${mapId} day ${game.daysElapsed} player ${game.current}${ty ? ' tycoon' : ''}${room ? ' party' : ''} stage ${wd.stage} idle ${Math.round(wd.idle() / 1000)}s${wd.human ? ' (human)' : ''} ${me === session ? '' : '(left) '}mem ${JSON.stringify(memReport(bank, view))}`);
  (window as unknown as { __rich4: Record<string, unknown> }).__rich4.watch = () => wd.report();
  (window as unknown as { __rich4Mem: unknown }).__rich4Mem = () => memReport(bank, view); // memory by kind (ui/mem-report.ts)
  const stopWatch = () => { wd.stop(); };
  // The last line of defence (issue #9: 「觸發事件時經常卡死…音效重複播放，界面可以點擊，但事件無法結算」): every effect,
  // screen and camera move an event shows is awaited through `shown`, which gives up on it after a generous time the
  // page was in front (a slow phone decoding pictures still has plenty; 3× while a human is the one the screen waits
  // for). Giving up logs it, finishes what the view holds, closes screens left open and stops looping sounds, and the
  // game goes on with the next event — the rules never wait on the screen, so nothing of the game is lost.
  const LONG_FX = new Set(['month-report', 'auction', 'auction-end', 'lottery-draw', 'dividends', 'finale-start', 'finale-blinds',
    'casino-result', 'tycoon-title', 'travel-onway', 'travel-depart', 'magic', 'cn-cock-fight', 'cn-exam-result', 'cn-post-ride']);
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
  // 挑戰模式 (docs/rules/26 §4): everyone's stars over the map, the task list on a tap and at the start of a new game.
  const faceOf = (c: number) => bank!.art('Data', 2, c)?.src ?? '';
  // A normal game's 挑戰模式 (docs/rules/30): the task card's pill only (no stars); a tap shows the card.
  const tracker = game.challengeTracker, rewardCards = !!tracker?.monthly && tracker.rewards;
  // The progress bar is this screen's player's: the room's seat here, else the first human.
  const myProgress = () => (room ? [...room.mine][0] ?? -1 : game.players.findIndex(p => p.human));
  const challenge = tracker && (game.challenge || rewardCards) ? new ChallengeBar(game, faceOf, myProgress) : null;
  // A normal game (and each 大富豪模式 city) measures every task of its map too, quietly: a human's achievement still
  // goes into the 圖鑑. A city shown again after a trip starts its watch from its stars now.
  const watch = challenge ?? (game.challengeTracker ? new StarWatch(game) : null);
  const openTasks = () => (rewardCards ? hud.sheetNode('任務卡', monthNotice(game, faceOf, [])) : hud.sheetNode('挑戰任務', taskList(game, faceOf)));
  // 每月任務 (docs/rules/27): a card taken or decided in the log, a new month's card on its own notice.
  const months = challenge && game.challengeTracker!.monthly ? new MonthWatch(game) : null;
  if (challenge) {
    stage.append(challenge.el);
    challenge.onOpen = () => void openTasks();
    if (!loaded && (!rewardCards || tracker!.month)) { await openTasks(); if (me !== session) return; }
  }
  /**
   * Stars just earned: a note each (the badge redrawn); a human's of this device go into the 圖鑑 (ui/collection.ts)
   * with the day and a picture of the map as the proof, a new card with its own note.
   */
  /** The player's state for a proof picture: tools and cards (pictures), the last dice, the money, the god on them. */
  const lastDice: Record<number, number[]> = {};
  const evidence = (p: number): Evidence => {
    const q = game.players[p], god = game.objects.godType(q);
    return {
      tools: q.tools.map((n, i) => ({ src: itemIconSrc(bank!, i + 1), n })).filter(t => t.n > 0 && t.src),
      cards: q.cards.map(c => itemIconSrc(bank!, c, true)).filter(Boolean),
      dice: lastDice[p],
      money: `現金 ${q.cash.toLocaleString()}・存款 ${q.bank.toLocaleString()}・總資產 ${game.wealth(q).toLocaleString()}`,
      god: god ? OBJECT_NAMES[god - 1] : undefined,
    };
  };
  const starNotes = async () => {
    const mine: Record<string, { stars: number; p: number; name: string }> = {};
    for (const x of watch?.update() ?? []) {
      const own = room ? room.mine.has(x.p) : game.players[x.p].human;
      if (game.challenge) hud.note(`${nameOf(x.p)}完成「${x.task.name}」${'★'.repeat(x.stars)}`, colorOf(x.p));
      else if (own) hud.note(`${nameOf(x.p)}達成成就「${x.task.name}」${'★'.repeat(x.stars)}`, colorOf(x.p));
      if (own && x.stars > (mine[x.task.id]?.stars ?? 0)) mine[x.task.id] = { stars: x.stars, p: x.p, name: x.task.name };
    }
    // 每月任務: who took a card (its card into the 圖鑑 like a task's).
    const mon = months?.update();
    for (const r of mon?.results ?? []) {
      if (rewardCards) hud.note(r.won.length ? `${r.won.map(nameOf).join('、')}拿下任務「${r.task.name}」，抽一張獎勵卡` : `任務「${r.task.name}」沒有人拿到`);
      else hud.note(r.won.length ? `${r.won.map(nameOf).join('、')}拿到本月任務「${r.task.name}」★★★` : `本月任務「${r.task.name}」沒有人拿到`);
      for (const p of r.won) if ((room ? room.mine.has(p) : game.players[p].human) && !mine[r.task.id]) mine[r.task.id] = { stars: 3, p, name: r.task.name };
    }
    const ids = Object.keys(mine);
    // The picture now, while the map still shows the moment; written only for a better result than the card has.
    const got: Earned[] = [];
    for (const id of ids) {
      const m = mine[id];
      const line = `${nameOf(m.p)} 完成「${m.name}」${'★'.repeat(m.stars)}・${mapName(game.settings.mapId)}・遊戲裡 ${format(game.date)}`;
      got.push({ id, stars: m.stars, proof: { real: Date.now(), game: game.date, map: game.settings.mapId, who: nameOf(m.p) }, shot: await proofShot(view.canvas, line, evidence(m.p)) });
    }
    // A better result than this device's 圖鑑 had: the scene only for ★★★ (the user 2026-11-02: less just unlocks, a
    // line in the log); the game waits for it, as for any screen.
    for (const x of got.length ? await earnCards(got) : []) {
      const t = game.challengeTracker!.tasks.find(k => k.id === x.id) ?? monthlyById.get(x.id);
      if (!t) continue;
      if (x.stars >= 3) await shown('achievement', () => achievementScene(shell, t, x.stars, x.before, nameOf(mine[x.id].p)), undefined);
      else hud.note(`圖鑑${x.before ? '更新' : '解鎖'}「${t.name}」${'★'.repeat(x.stars)}`);
    }
    // (in 挑戰模式 a won card was already shown, before its 獎勵卡: only a card nobody took is told here)
    if (mon?.drawn) await shown('month', () => hud.sheetNode(rewardCards && tracker!.perMonth !== 1 ? '新任務卡' : '本月任務', monthNotice(game, faceOf, rewardCards ? mon.results.filter(r => !r.won.length) : mon.results)), undefined, true);
  };
  // What a player lost (cards, tools) in a box, a computer's in the log / chat box (ui/losses.ts).
  const losses = new LossNotices(game, () => hud.context(shell), { idle: () => director.idle(), note: (t, c) => hud.note(t, c),
    chat: chat ? l => chat.push(l) : undefined, mapIndex: () => ty?.world.view() ?? 0 });
  let flow = ty ? ty.flow : game.run();
  let answer: Answer = undefined;
  // 派對模式: the game's questions are numbered; this phone sends its seats' answers, waits for the others'.
  // A phone back in a party game (issue #50) starts at the question its snapshot was taken at.
  let askSeq = room?.resume?.seq ?? 0, sendSeq = -1, warnedDesync = false;
  if (room) room.resume = null;
  const waiting = document.createElement('div');
  waiting.className = 'pt-waiting'; waiting.hidden = true;
  // issue #99: what the player whose answer this phone waited for just bought or sold (party-acts.ts)
  const acts = new ActsLine();
  let actsDue: { p: number; before: Held; shop: boolean } | null = null;
  // 圍觀's cheers (spectate.ts) over the map, around the player whose turn it is.
  const cheers = new CheerFx(() => {
    const p = game.players[game.current];
    const a = p && !p.bankrupt ? view.actorAt(p.id) : null;
    if (!p || !a) return null;
    const q = view.project(a.x, a.y), c = view.canvas.getBoundingClientRect();
    return { x: q.x + c.left, y: q.y + c.top - 20, name: nameOf(p.id) };
  }, t => hud.note(t));
  (window as unknown as { __rich4: Record<string, unknown> }).__rich4.cheer = (k: string) => cheers.play(k, '測試', true);
  /** 派對模式: the 「新版本已發布」 notice was shown once this game. */
  let newVersionTold = false;
  /** 圍觀: this phone's spectator bar while it only watches (派對模式). */
  let spectatorBar: SpectatorBar | null = null;
  /** 等待時送禮物: a player's gifts (派對模式). */
  let playerGifts = null as PlayerGifts | null;
  let titleBook = null as TitleBook | null;
  if (room) {
    stage.append(waiting, acts.el);
    // The richest player can't be voted out (the same game state on every phone, so the same answer everywhere); a
    // tie (the start) protects nobody.
    // 途中加入: the computers' seats still in the game (a joining player may take one).
    room.seatOpen = seat => { const q = game.players[seat]; return !!q && !q.human && !q.bankrupt; };
    // A player who joined the game going on: their computer's seat is theirs from its next turn.
    const waitSeat = [...room.mine].map(seat => game.players[seat]).find(q => q && !q.human);
    if (waitSeat) void hud.flash(`你將接手電腦 ${nameOf(waitSeat.id)}\n輪到它時就換你操作`, 3200);
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
  // 派對模式's clock (the user 2026-10-19: no stalling; 2026-11-03: the room's 等待時間, 10–60 s): each of a player's
  // decisions has that long; when it runs out that one step is taken for them (GO rolls, a question gets the safe
  // answer) and the game goes on — nobody is put on 托管 for it.
  const turnMs = () => (TURN_SECONDS[room?.rules.turnSec ?? TURN_SECONDS.length - 1] ?? 60) * 1000;
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
      clock.hidden = left > 10 || left < 0;
      clock.textContent = `還剩 ${left} 秒`;
      const auto = [...room.mine].some(seat => game.players[seat]?.autopilot && !game.isOut(game.players[seat]));
      unauto.hidden = !auto;
      unauto.textContent = [...room.mine].some(s2 => cancelAuto.has(s2)) ? '下回合恢復手動' : '托管中・取消托管';
    }, 400);
    // The row of 派對模式 buttons under the toolbar (party-chat.ts PartyBar): chat, quick phrases, reactions, players,
    // votes, 托管. 托管 asked for here answers this phone's next turn with the computer (in step on every phone, like
    // the 60 s clock); off again: 取消托管 from the next turn.
    const mine = () => [...room.mine].map(seat => game.players[seat]).filter(p => p && !game.isOut(p));
    // 圍觀 (spectate.ts): a spectator gets its own bar (the cheers, 接手, 離開圍觀) instead of the party bar until it
    // takes a seat; everyone sees the cheers (unless 觀眾特效 is off) and how many watch.
    const net0 = room;
    // 換地圖 (the user 2026-11-04): all the players agreed; the same room plays the next game on this phone too.
    const mapChoices = maps.filter(m => !m.hidden && (m.kind === 'orig' || m.kind === 'custom'));
    let partyBar: PartyBar | null = null;
    room.mapTitle = id => mapChoices.find(m => m.id === id)?.name ?? '';
    room.nextGame = (map, keep) => nextGameMsg(net0, game.players.map(p => ({ character: p.character, human: p.human, ...(p.nick ? { nick: p.nick } : {}), ...(keep ? { keep: keptMoney(p, game.fund) } : {}) })), map, (Math.random() * 2 ** 32) >>> 0);
    room.seatHuman = seat => { const q = game.players[seat]; return !!q && q.human && !game.isOut(q); };
    sideFlag.of = seat => (game.players[seat]?.human ? flagHtml(net0.seatMember(seat)) : '');
    // The others see which window this phone's player has open (party-doing.ts).
    const tool = toolbar.onAction, net = net0;
    toolbar.onAction = async key => {
      const seat = game.current, told = key in LOCAL_DOING && net.mine.has(seat);
      if (told) net.doing(seat, key);
      try { await tool(key); } finally { if (told) net.doing(seat, ''); }
    };
    const watchChip = document.createElement('button');
    watchChip.className = 'sp-count'; watchChip.hidden = true;
    stage.append(watchChip);
    const drawChip = () => { watchChip.hidden = room.watching || !room.watchCount; watchChip.textContent = `${room.watchCount} 人圍觀・特效${watchFxOn() ? '開' : '關'}`; };
    watchChip.onclick = e => { e.stopPropagation(); audio.ui('click'); setWatchFx(!watchFxOn()); drawChip(); };
    room.onWatchers = () => { drawChip(); spectatorBar?.draw(); };
    room.onCheer = (kind, name, player) => cheers?.play(kind, name, room.watching, player);
    // 小遊戲搗亂 (mini-games.ts, the user 2026-11-14): this phone's 小遊戲 goes to the others, their 搗亂 comes back
    const miniOut: MiniLink = { send: f => room.miniFrame(game.current, f), heckles: !game.settings.noHeckle, onHeckle: null };
    setMiniLink(game.settings.realtime ? null : miniOut);
    room.onHeckle = (seat, x, y, name) => { if (room.mine.has(seat)) miniOut.onHeckle?.({ x, y, name }); };
    room.onVacant = () => spectatorBar?.draw();
    const makePartyBar = () => {
    const bar = partyBar = new PartyBar(stage, room, c => bank!.art('Data', 2, c)?.src ?? '', mapChoices, {
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
    shell.insertBefore(bar.el, stage);
    // 等待時送禮物 (spectate.ts): sent during the turns of the others.
    playerGifts?.destroy();
    const gifts = playerGifts = new PlayerGifts(room, game, t => hud.note(t), () => !room.mine.has(game.current));
    stage.append(gifts.el);
    bar.onGift = () => gifts.toggle();
    orderPop = t => bar.pop(t);
    // Each human player's ping over their head on the map (party-hud.ts PingTags), with the 延遲 panel.
    // (over a beggar's 「乞丐」 sign, board-view.ts badges: its height at that zoom)
    // 稱號 (titles.ts, the user 2026-11-08): each real player's latest, under the ms (turn-based only)
    titleBook = game.settings.realtime ? null : new TitleBook(game);
    new PingTags(stage, room, view, () => bar.netShown, (seat, z) => { const q = game.players[seat]; if (!q || !game.isBeggar(q)) return 0; const fs = Math.max(11, Math.min(15, 11 * z)); return fs * 1.4 + 9; }, seat => titleBook?.of(seat) ?? null);
    shell.classList.add('party');
    };
    if (room.watching) {
      spectatorBar = new SpectatorBar(room, game, t => hud.note(t), () => { room.close(); location.reload(); });
      stage.append(spectatorBar.el);
      void hud.flash('圍觀中\n可以撒花、鼓掌，也可以接手空出來的位置', 2600);
    } else makePartyBar();
    // 接手: a spectator that took a seat plays from now on — its party bar, the seat by hand from its next turn.
    const prevSeats = room.onSeats;
    room.onRestart = s => {
      stopWatch();
      partyBar?.destroy(); partyBar = null;
      spectatorBar?.destroy(); spectatorBar = null;
      net0.onSeats = prevSeats;
      gameEnd('quit', 'map');
      if (s.seats[net0.myId] !== undefined) gameStart(`${net0.code}-${s.settings.seed}`, () => net0.link().via, { map: s.settings.mapId, humans: s.settings.players.filter(p => p.human).length, total: s.settings.players.length, title: net0.mapTitle(s.settings.mapId) });
      start(s.settings, net0);
    };
    room.onSeats = () => {
      prevSeats();
      if (!room.watching && spectatorBar) {
        spectatorBar.el.remove(); spectatorBar = null;
        makePartyBar();
        for (const seat of room.mine) { cancelAuto.add(seat); void hud.flash(`你接手了 ${nameOf(seat)}\n輪到他時就換你操作`, 2600); }
      }
      drawChip();
    };
    drawChip();
  }
  /** The rest of this phone's turn clock (null when it does not run for this question). */
  /** 即時制: closes the open question's box once the game answered it by itself (core/realtime.ts RT.move, RT.indoors). */
  let rtGone: (() => void) | null = null;
  const expires = (p: number): Promise<void> | null => {
    if (game.settings.realtime) return new Promise(res => { rtGone = res; });
    if (!room || !room.mine.has(p) || p !== game.current) return null;
    turnDeadline = Date.now() + turnMs(); // each decision its own time
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
    turnDeadline = 0; // answered: no countdown until the next decision
    return r;
  };
  const dropped = new Map<number, number>();
  const digest = () => {
    let h = game.rng.seed >>> 0;
    for (const p of game.players) for (const v of [p.cash, p.bank, p.node, p.points, p.cards.length]) h = (Math.imul(h ^ v, 0x01000193) >>> 0);
    return h;
  };
  /**
   * This phone answers one of its own questions (the GO and turn menu, the map picks, the boxes): what the turn-based
   * loop below does, and 即時制's (realtimeLoop) for its own lane.
   */
  /**
   * A question for a human on this screen, the controller of that seat in charge (pad.ts padFor: 1P–4P with a
   * controller each, the user 2026-11-08); with two controllers or more, whose turn it is shows as it opens.
   */
  /** 冬眠: their turn passes with a message only, the camera never goes to them (the user 2026-11-25: 「一局切換好幾個人看著亂糟糟的」). */
  const dozing = (id: number) => { const q = game.players[id]; return !!q && q.placed && q.sleep > 0 && !q.leaving && !game.offRoad(q); };
  const localAnswer = async (s: Ask): Promise<Answer> => {
    const humans = game.players.filter(q => q.human).map(q => q.id), k = room ? -1 : humans.indexOf(s.p);
    if (k < 0) return localAsk(s);
    padFor(k);
    if (s.t === 'turn' && humans.length > 1 && padCount() > 1) void hud.flash(`${k + 1}P ${nameOf(s.p)}\n請用 ${k + 1} 號手把`, 900).catch(() => {});
    try { return await localAsk(s); } finally { padFor(null); }
  };
  const localAsk = async (s: Ask): Promise<Answer> => {
    let answer: Answer = undefined;
    if (s.t === 'turn') {
      gameAt.days = game.daysElapsed;
      // Auto-save when a human's turn opens, before the dice (one per turn): slot 0, or 大富豪模式's own automatic slot.
      // (即時制: no automatic save — its clock and lanes are not in a save, and a turn comes every few seconds)
      turnSave = game.settings.realtime || game.settings.trial ? null : ty ? (saveWorld(ty.world) as unknown as SaveData) : saveGame(game);
      const key = `${game.daysElapsed}:${game.current}`;
      if (key !== lastAuto && turnSave) {
        lastAuto = key;
        // A failed automatic save says so plainly (it used to be a log line nobody saw), and is tried again.
        const slot = ty ? TYCOON_AUTO_SLOT : AUTO_SLOT, data = turnSave;
        // The last five turns are kept (saves.ts writeAuto); the same turn again rewrites its own copy.
        const turn = `${me}:${key}`;
        writeAuto(slot, data, turn).catch(() => writeAuto(slot, data, turn)).catch(e => { void reportSaveFailed('自動存檔', e, saveStep()); if (me === session) void hud.flash('自動存檔失敗！\n請用「存檔」手動存一次', 2600); });
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
      }), expires(s.p), () => { go.cancel(); if (!game.settings.realtime) void hud.flash(`${turnMs() / 1000} 秒沒有操作\n自動擲骰`, 1600); return autoAnswer(s); });
      answerTurn = null;
      // Another action first (card, tool, stocks…): keep the dice picked on GO for when the turn menu opens again.
      keptDice = answer && typeof answer === 'object' && 'dice' in answer ? null : { key, dice: go.picked() };
      wd.setHuman(false);
      view.setMode('locked');
      toolbar.setTurnOpen(false);
      go.hide();
      turnSave = null;
      return answer;
    }
    if (s.t === 'yesno' && s.kind && AUTO_BUY_KINDS.has(s.kind) && autoBuy()) { answer = true as Answer; return answer; } // 自動買地
    if (s.t === 'pick-city-node') {
      // 洲際飛彈 on another city: the square tapped on that city's map in the city viewer.
      wd.setHuman(true);
      answer = (ty ? await openCityViewer(hud, ty.world, bank!, s.city, { nodes: s.nodes, title: s.title }) : 0) as unknown as Answer;
      wd.setHuman(false);
      view.syncAll();
      return answer;
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
        return answer;
      }
      // 重慶 (docs/rules/33 §1): a missile may hit any level; the hint names how many targets each level has, a tap
      // shows that level (only the level looked at can be tapped).
      const perLevel = !s.onScreen ? view.pickLevels() : null;
      let levelOff = () => {};
      if (perLevel) {
        const row = document.createElement('div');
        row.className = 'pick-lv';
        row.innerHTML = perLevel.map((n, i) => `<button class="mm-lv" data-k="${i + 1}"${n ? '' : ' disabled'}>${['一層', '二層', '三層'][i]}・${n}</button>`).join('');
        const light = (k: number) => row.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.classList.toggle('on', Number(b.dataset.k) === k));
        row.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.k) { e.stopPropagation(); view.showLevel(Number(b.dataset.k)); } });
        light(view.levelShown || view.viewLevel());
        view.levelListeners.add(light);
        levelOff = () => view.levelListeners.delete(light);
        hint.append(row);
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
      levelOff();
      hint.remove();
      view.followActor(game.current);
      if (perLevel) view.showLevel(view.autoLevel());   // back on the player's own level
      return answer;
    }
    if (s.t === 'pick-player') {
      // Card targets are picked on the map in the original (04 §2.4), so only who is on the player's screen.
      const near = s.anywhere ? s.players : s.players.filter(id => view.inViewOf(s.p, id));
      if (!near.length) { await hud.flash('畫面內沒有可選擇的對象', 1500); answer = -1 as unknown as Answer; return answer; }
      wd.setHuman(true);
      answer = await timed(hud.ask({ ...s, players: near }) as Promise<Answer>, expires(s.p), () => { hud.dismiss(); return -1 as unknown as Answer; });
      wd.setHuman(false);
      return answer;
    }
    wd.setHuman(true);
    // The wheel and the slot machine only want the moment of a tap (the rules stop them by themselves for anyone
    // else): one never stopped is stopped for the player after a long while, rather than holding the game for good.
    const asked = s.t === 'wheel' || s.t === 'slot-machine' ? shown(`ask ${s.t}`, () => hud.ask(s), 0 as unknown) : hud.ask(s);
    // (a 小遊戲 is a scene of its own that dismiss does not close: it stayed over the game after the time ran out, #100)
    // (清明上河's three mini-games end by themselves within 15 s: never cut by a short 派對 turn clock)
    const untimed = s.t === ('qm-tiger' as never) || s.t === ('qm-boar' as never) || s.t === ('qm-wrestle' as never) || s.t === ('qm-shell' as never);
    answer = await timed(asked as Promise<Answer>, untimed ? null : expires(s.p), () => { hud.dismiss(); if (s.t === 'mini-game') closeQuestionScenes(); return autoAnswer(s); });
    wd.setHuman(false);
    return answer;
  };
  /**
   * 即時制 (測試版, core/realtime.ts, docs/rules/31): the clock runs on real time and every lane plays at once. What the
   * lanes do is shown without waiting (several walk at the same time); only this phone's own questions open a box, and
   * they hold only this player's lane. Returns the game's end (shown below as in the turn-based game), or null.
   */
  /** The standings' people (rt-rank.ts): face and colour of each player. */
  const rankPeople = () => game.players.map(q => ({ id: q.id, face: faceOf(q.character), color: `#${CHARACTERS[q.character].color.toString(16).padStart(6, '0')}` }));
  /** Where a player is held and the days left (the user 2026-11-08: everyone's state in the standings too). */
  const heldIcon = (q: (typeof game.players)[number]): [string, number] | null => {
    const days = (v: number, mask = 0x7f) => (v & 0x80 ? 0 : v & mask);
    if (q.hospital) return ['✚', days(q.hospital)];
    if (q.prison) return ['🔒', days(q.prison)];
    if (q.vanish) return [q.vanish & 0x40 ? '👽' : '✈', days(q.vanish, 0x3f)];
    if (q.hotel) return ['🏨', days(q.hotel)];
    if (q.sleep) return ['💤', days(q.sleep)];
    return null;
  };
  const realtimeLoop = async (): Promise<Step | null> => {
    const rt = new Realtime(game, { length: game.settings.realtime?.length ?? 0 });
    (window as unknown as { __rich4: Record<string, unknown> }).__rich4.rt = rt;
    // 派對模式: this phone's seat (a spectator has none: -1, it only watches); alone: the player
    // (the camera stays on this one player, on 托管 too: the user 2026-11-08)
    const meSeat = room ? [...room.mine][0] ?? -1 : Math.max(0, game.players.findIndex(p => p.human));
    const walks = new Map<number, Promise<void>>();
    // (a loaded game: the clock goes on from its save)
    let t0 = performance.now() - rt.now, hiddenAt = 0, asking = false, askingId = -1, end: Step | null = null, dirty = true, lastSync = 0;
    // in the background the clock stops (a phone put away must not find its game played on)
    // (派對模式: the host's clock is everyone's; a phone in the background catches up from the ticks when it is back)
    let away = false; // 暫時離開 (alone): the clock stopped till the player is back
    const onVis = () => { if (room || away) return; if (document.hidden) hiddenAt = performance.now(); else if (hiddenAt) { t0 += performance.now() - hiddenAt; hiddenAt = 0; } };
    document.addEventListener('visibilitychange', onVis);
    if (meSeat >= 0) view.followActor(meSeat);
    view.setMode('free');
    hud.note('即時制（測試版）：大家同時走，不用排隊！');
    const clock = new RtClock(stage, RT.day, game.settings.realtime?.length ?? 0);
    const cool = meSeat >= 0 ? new RtCool(stage, game.players[meSeat].character, RT.cool) : null;
    const watch = meSeat >= 0 ? new RtWatch(document.body) : null;
    /**
     * This player's news or fate card, as the turn-based game shows it (hud.board's look), over the map without holding
     * anything: 2 s, then it fades; a tap closes it sooner (the user 2026-11-08).
     */
    const card = document.createElement('div');
    card.className = 'rt-card';
    card.hidden = true;
    card.addEventListener('pointerdown', ev => ev.stopPropagation());
    let cardTimer = 0;
    const hideCard = () => { clearTimeout(cardTimer); card.classList.add('out'); cardTimer = window.setTimeout(() => { card.hidden = true; card.classList.remove('out'); }, 350); };
    card.onclick = ev => { ev.stopPropagation(); hideCard(); };
    stage.append(card);
    const showCard = (kind: 'news' | 'fate', text: string, id?: number, data?: Record<string, unknown>) => {
      // the picture as the turn-based board has it (news.ts): the news's, the fate's, a city's own event's
      const local = regionalPicture(data);
      const picId = id === undefined ? 0 : kind === 'news' ? newsPicture(id) : fatePicture(id, game.mapSlot);
      const bg = bank!.art('Panel', 66, kind === 'news' ? 0 : 1), pic = local ? { src: local.src } : picId ? bank!.art('Data', picId) : null;
      card.innerHTML = `<div class="board-card ${kind}">${bg ? `<img class="board-bg" src="${bg.src}" alt="">` : ''}${pic ? `<img class="board-pic" src="${pic.src}" alt="">` : ''}
        <div class="board-title">${kind === 'news' ? '新聞快報' : '命運'}</div><div class="board-text">${escHtml(text).replace(/\n/g, '<br>')}</div></div>`;
      clearTimeout(cardTimer);
      card.classList.remove('out');
      card.hidden = false;
      if (id !== undefined) { const v = boardVoice(kind, id, game.mapSlot); if (v !== undefined) void audio.voice(v); }
      cardTimer = window.setTimeout(hideCard, 2000);
    };
    const alert = new RtAlert(stage);
    const rank = new RtRank(stage, meSeat, rankPeople());
    // 保護中 (簡單 / 中等: hit enough till their roll, core/realtime.ts RT_HITS)
    const heldOf = (q: (typeof game.players)[number]): [string, number] | null => heldIcon(q) ?? (rt.guarded(q.id) ? ['🛡', 0] : null);
    /**
     * 卡片 / 道具 drawers (rt-quick.ts, the user 2026-11-08): the first ten cards or tools of this hand, one tap uses it —
     * the toolbar's own card / tool flow, its first choice answered with the one tapped (rtPick).
     */
    let rtPick = null as { kind: 'card' | 'tool'; value: number; at: number } | null;
    const quickUse = (kind: 'card' | 'tool', value: number) => {
      if (kind === 'tool' && value === 8 && !answerTurn) { void hud.flash('遙控骰子要在擲骰子時用\n（GO 出來的時候）', 1300); return; }
      rtPick = { kind, value, at: performance.now() }; void toolbar.onAction?.(kind);
    };
    const artSrc = (a: { archive: string; id: number; frame?: number }) => bank!.art(a.archive as never, a.id, a.frame ?? 0)?.src ?? null;
    const quickCards = meSeat < 0 ? null : new RtQuick(stage, 'left', '卡片', () => game.players[meSeat].cards.slice(0, 12).map((id, i) => ({ value: i, name: cardName(id), icon: artSrc({ archive: 'Data', id: 570 + id }) })), v => quickUse('card', v));
    const quickTools = meSeat < 0 ? null : new RtQuick(stage, 'right', '道具', () => {
      const me = game.players[meSeat];
      // every kind held, 遙控骰子 too (the user 2026-11-08: by kind; it works only while rolling, at GO)
      return TOOLS.filter(t => me.tools[t.id - 1] > 0).slice(0, 12).map(t => ({ value: t.id, name: t.name, icon: artSrc(toolIcon(t.id)), badge: me.tools[t.id - 1] > 1 ? `×${me.tools[t.id - 1]}` : undefined }));
    }, v => quickUse('tool', v));
    const drawRank = () => rank.update(game.players.map(q => ({ id: q.id, total: game.wealth(q), cash: q.cash, bank: q.bank, out: q.bankrupt, held: heldOf(q) })));
    drawRank();
    /**
     * 暫時離開 (the user 2026-11-08, alone only): the clock stops for everyone, the computers too, till a tap brings the
     * player back — for a drink, the toilet.
     */
    const awayBtn = room ? null : document.createElement('button');
    let awayCover: HTMLElement | null = null;
    const comeBack = () => {
      if (!away) return;
      away = false;
      if (hiddenAt) { t0 += performance.now() - hiddenAt; hiddenAt = 0; }
      awayCover?.remove(); awayCover = null;
    };
    if (awayBtn) {
      awayBtn.className = 'rt-away-btn';
      awayBtn.textContent = '暫停'; // (the user 2026-11-08: two characters, never wrapping)
      awayBtn.onclick = e => {
        e.stopPropagation();
        if (away) return;
        away = true;
        if (!hiddenAt) hiddenAt = performance.now();
        awayCover = document.createElement('div');
        awayCover.className = 'rt-away';
        awayCover.innerHTML = '<div><b>暫停中</b><span>時間停止，電腦也不會動</span><em>點一下回來</em></div>';
        awayCover.addEventListener('pointerdown', ev => { ev.stopPropagation(); ev.preventDefault(); comeBack(); });
        document.body.append(awayCover);
      };
      (stage.querySelector('.view-tools') ?? stage).append(awayBtn);
    }
    const msgs = new RtMsgs(stage, { me: meSeat, players: game.players.map(q => ({ id: q.id, face: faceOf(q.character), name: nameOf(q.id), color: `#${CHARACTERS[q.character].color.toString(16).padStart(6, '0')}` })) });
    /** The game now with its clock (the turns going on start anew when it is loaded). */
    const rtData = (): SaveData => { game.rtNow = rt.now; return saveGame(game); };
    const rtAutoSave = () => {
      const data = rtData(), key = `${me}:rt:${game.daysElapsed}`;
      writeAuto(AUTO_SLOT, data, key).catch(() => writeAuto(AUTO_SLOT, data, key)).catch(e => { void reportSaveFailed('自動存檔', e, saveStep()); if (me === session) void hud.flash('自動存檔失敗！\n請用「存檔」手動存一次', 2600); });
    };
    rtSaveData = room ? null : rtData;
    // only this player's own lines (the user 2026-11-08: the others' clouds popping up all the time were a mess)
    director.onlySpeaker = Math.max(0, meSeat);
    director.quick = true;
    const hudSay = hud.say.bind(hud);
    hud.say = (p: number, text: string, ms?: number) => (p === meSeat ? hudSay(p, text, ms) : Promise.resolve());
    // the camera: back on this player when they move or are asked — never while the map was just touched (looking
    // at someone else, the user 2026-11-08: it kept jumping back)
    let touchedAt = 0, wasAway = false;
    const touched = () => { touchedAt = performance.now(); };
    view.canvas.addEventListener('pointerdown', touched);
    minimap.el.addEventListener('pointerdown', touched);
    // 圍觀 (the user 2026-11-14, 「像 CS 一個人死了之後視角就在另外一個人身上」): a spectator follows one player, picked with
    // ◀ ▶ on its bar; when that one goes bankrupt the camera moves on to the next still playing.
    const living = () => game.players.filter(q => !game.isOut(q)).map(q => q.id);
    let camSeat = meSeat >= 0 ? meSeat : living()[0] ?? -1;
    const camOn = (seat: number, why?: string) => {
      camSeat = seat;
      touchedAt = 0;
      if (seat >= 0) view.followActor(seat);
      if (why) void hud.flash(why, 1400).catch(() => {});
      spectatorBar?.draw();
    };
    if (meSeat < 0 && spectatorBar) {
      spectatorBar.cam = {
        name: () => (camSeat >= 0 ? nameOf(camSeat) : '—'),
        step: d => { const l = living(); if (!l.length) return; const i = l.indexOf(camSeat); camOn(l[((i < 0 ? 0 : i + d) % l.length + l.length) % l.length]); },
      };
      camOn(camSeat);
    }
    const follow = (seat = meSeat >= 0 ? meSeat : camSeat) => { if (seat >= 0 && performance.now() - touchedAt > 4000) view.followActor(seat); };
    toolbar.el.classList.add('rt-open');
    // 派對模式 (docs/rules/31 §9): the host puts every phone's inputs into ticks (RT_TICK ms apart) and every phone plays
    // the ticks in order — the same game everywhere. Inputs: an answer to a question, a card / tool / the market opened,
    // a seat to the computer and back.
    type RtIn = { k: 'ans'; id: number; a: unknown } | { k: 'act'; p: number; kind: 'card' | 'tool' | 'stock' } | { k: 'auto'; p: number; on: boolean };
    type Tick = { at: number; ins: RtIn[]; h?: number };
    const RT_TICK = 150, queue: { from: string; x: RtIn }[] = [], answered = new Set<number>(), dropAt = new Map<number, number>();
    let seq = 0, wasHost = !!room?.host;
    const send = (x: RtIn) => { if (room) room.rtInput(x); };
    if (room) room.onRtInput = (from, x) => { if (room.host) queue.push({ from, x: x as RtIn }); };
    const applyIn = (x: RtIn) => {
      if (x.k === 'ans') rt.answer(x.id, x.a as Answer);
      else if (x.k === 'act') rt.act(x.p, x.kind);
      else if (x.k === 'auto') {
        const q = game.players[x.p];
        if (!q || !q.human) return;
        q.autopilot = x.on;
        // a seat given to the computer: its open questions are answered as the computer would
        if (x.on) for (const a of rt.asks()) if (a.q.p === x.p) rt.answer(a.id, autoAnswer(a.q as never));
      }
    };
    /** Host: the inputs it may take — an answer only from the phone of the seat asked, a card only for one's own seat. */
    const valid = (from: string, x: RtIn): boolean => {
      if (!room || !x || typeof x !== 'object') return false;
      const seat = room.started?.seats[from];
      if (x.k === 'ans') { const a = rt.asks().find(q => q.id === x.id); return !!a && a.q.p === seat; }
      if (x.k === 'act') return x.p === seat && (x.kind === 'card' || x.kind === 'tool' || x.kind === 'stock');
      if (x.k === 'auto') return x.p === seat && typeof x.on === 'boolean';
      return false;
    };
    rtAct = key => {
      if (meSeat < 0) return;
      if (key === 'card' || key === 'tool') warmFor(game.players[meSeat], key);
      const left = key === 'stock' ? 0 : rt.cardReadyAt(meSeat) - rt.now;
      if (rt.acting(meSeat)) { void hud.flash('已經打開了', 900); return; }
      if (left > 0) { void hud.flash(`${Math.ceil(left / 1000)} 秒後才能再用卡片或道具`, 1000); return; }
      if (room) { send({ k: 'act', p: meSeat, kind: key }); return; }
      if (rt.act(meSeat, key) === Infinity) void hud.flash('現在不能使用', 900);
    };
    /**
     * The screen plays the walks a little behind the rules' clock (RT_VIEW_DELAY), so each square's successor is known
     * before it ends (the user 2026-11-08: a stop at every square). `toReal`: a time of the clock on this phone's
     * clock — alone the start of the game; 派對模式 the lowest offset seen (the host's ticks arrive late, never early),
     * let to drift up slowly.
     */
    let offset = Infinity;
    const toReal = (at: number) => at + (room ? (Number.isFinite(offset) ? offset : performance.now() - rt.now) : t0);
    const stopWalk = (id: number) => {
      if (!walking.has(id)) return;
      walking.delete(id);
      void walks.get(id)?.then(() => { if (!walking.has(id)) view.stop(id); });
    };
    const refName = (ref: number) => (ref < 4000 ? game.board.lands[ref - 2001]?.name : game.board.facilities[ref - 4001]?.name) ?? '';
    const ownsRef = (ref: number) => (ref < 4000 ? game.board.lands[ref - 2001]?.owner : game.board.facilities[ref - 4001]?.owner) === meSeat + 1;
    /**
     * What happens to this player, good or bad, as a bar at the top (the user 2026-11-08: the box at the bottom goes
     * unnoticed in a fast game): who did it, what, which lots, how much.
     */
    const alertMe = (e: RtEvent) => {
      const s = e.step, me = meSeat;
      if (me < 0 || 'ask' in s) return;
      const by = (p: number | undefined) => (p !== undefined && isPlayer(p) && p !== me ? nameOf(p) : '');
      switch (s.t) {
        case 'points':
          // with the total (the user 2026-11-08: no need to look it up)
          if (s.p === me && s.amount) alert.push(`${s.amount > 0 ? '+' : '−'}${Math.abs(s.amount)} 點券（共 ${game.players[me].points.toLocaleString('zh-Hant')}）`, s.amount > 0 ? 'good' : 'bad', { big: true });
          return;
        case 'pay':
          if (s.to === me && isPlayer(s.from) && s.from !== me && s.amount) alert.push(`收到${nameOf(s.from)}的${s.reason} ${s.amount.toLocaleString('zh-Hant')} 元`, 'good');
          return;
        case 'say':
          // this player's own lines: 住院, 路障, a god's blessing or curse …
          // (a god coming on and points have their own bars)
          if (s.text && (s.p === me || (s.p === undefined && e.lane === me)) && !/^\S{1,4}附身/.test(s.text.trim()) && !/點券/.test(s.text)) alert.push(s.text.replace(/\s*\n+\s*/g, '　'), /保佑|得到|獲得|免付|恭喜/.test(s.text) ? 'good' : /作祟|罰|住院|坐牢|監獄|停止|失去|不足|請付|附身/.test(s.text) && !/[財福]神附身|天使附身|土地公附身/.test(s.text) ? 'bad' : 'info');
          return;
        case 'fx': break;
        default: return;
      }
      const d = (s.data ?? {}) as Record<string, unknown> & { card?: number; tool?: number; ref?: number; from?: number; price?: number; avg?: number; got?: number; magic?: number; targets?: number[]; who?: number[]; lots?: number[]; victims?: number[]; type?: number; amount?: number; god?: number; lines?: { p?: number; text?: string; amount?: number }[]; title?: string; head?: string; ownerA?: number; ownerB?: number; a?: number; b?: number };
      const who = by(s.p), toMe = s.target === me && !!who;
      switch (s.kind) {
        case 'card-received': if (s.p === me && d.card) alert.push(`得到 ${cardName(d.card)}`, 'good'); return;
        // (core/realtime.ts RT.move, RT.indoors: the question answered itself)
        case 'rt-shield':
          if (s.p === me) alert.push(`保護中：擲骰子之前，別人的卡片、魔法、飛彈都打不到你`, 'good');
          return;
        case 'rt-timeout':
          if (s.p === me) alert.push(d.what === 'indoors' ? `店裡停留超過 ${RT.indoors / 1000} 秒，自動離開` : d.what === 'decide' ? `${RT.move / 1000} 秒沒有決定，自動略過` : `${RT.move / 1000} 秒沒有移動，自動擲骰子`, 'info');
          return;
        case 'gift': if (s.p === me && d.tool) alert.push(`撿到禮物：得到 ${toolDef(d.tool)?.name ?? '道具'}`, 'good'); return;
        case 'leave-hospital': case 'leave-prison': case 'reappear': case 'leave-hotel':
          // out again: the camera back on this player wherever it was looking (the user 2026-11-08)
          if (s.p === me) { touchedAt = 0; view.followActor(me); }
          return;
        case 'tool-received': if (s.p === me && d.tool) alert.push(`得到 ${toolDef(d.tool)?.name ?? '道具'}`, 'good'); return;
        case 'slot-machine':
          if (s.p === me && typeof d.amount === 'number') { const bad = BAD_GODS.has(d.god ?? 0); alert.push(`${OBJECT_NAMES[(d.god ?? 1) - 1] ?? ''}拉霸：${bad ? '付出' : '得到'} ${Math.abs(d.amount).toLocaleString('zh-Hant')} 元`, bad ? 'bad' : 'good'); }
          return;
        case 'god-attach':
          if (s.p === me && d.type) alert.push(`${OBJECT_NAMES[d.type - 1]}附身 ${d.type === 15 ? 13 : 7} 天：${GOD_EFFECT[d.type] ?? ''}`, BAD_GODS.has(d.type) ? 'bad' : 'good');
          return;
        case 'earth-god':
          if (d.ref === undefined) return;
          if (s.p === me) alert.push(`土地公強佔了${refName(d.ref)}${isPlayer(d.from ?? -1) ? `（原本是${nameOf(d.from!)}的）` : ''}`, 'good');
          else if (d.from === me) alert.push(`${who}附身的土地公強佔了你的${refName(d.ref)}！`, 'bad');
          return;
        case 'angel': case 'devil': {
          if (!who) return;
          const refs = (d.lots ?? (d.ref !== undefined ? [d.ref] : [])).filter(ownsRef);
          if (!refs.length) return;
          const how = d.lots ? `用${s.kind === 'angel' ? '天使卡' : '惡魔卡'}` : `附身的${s.kind === 'angel' ? '天使' : '小惡魔'}`;
          alert.push(`${who}${how}${s.kind === 'angel' ? '幫你' : '把你'}${refs.slice(0, 3).map(refName).join('、')}${refs.length > 3 ? ` 等 ${refs.length} 處` : ''}${s.kind === 'angel' ? '加蓋一層' : '拆掉一層'}`, s.kind === 'angel' ? 'good' : 'bad');
          return;
        }
        case 'monster': case 'demolish':
          if (who && d.ref !== undefined && ownsRef(d.ref)) alert.push(`${who}${s.kind === 'monster' ? '用怪獸卡夷平了' : d.from !== undefined ? '用拆除卡拆了' : '開工程車拆了'}你在${refName(d.ref)}的房子！`, 'bad');
          return;
        case 'blast-lots': {
          // a missile or nuke taking this player's lots down with someone else (the user: 炸別人帶到你的地也要說)
          const refs = ((d as { lots?: [number, number][] }).lots ?? []).filter(([o]) => o === me).map(([, r]) => refName(r));
          if (!refs.length) return;
          const what = (d as { nuke?: boolean }).nuke ? '核子飛彈' : '飛彈';
          alert.push(`${who ? `${who}的` : '你的'}${what}炸毀了你的${refs.slice(0, 3).join('、')}${refs.length > 3 ? ` 等 ${refs.length} 處` : ''}`, 'bad');
          return;
        }
        case 'swap-land': case 'swap-house': {
          if (!who || d.a === undefined || d.b === undefined) return;
          const mineWas = d.ownerA === me + 1 ? d.a : d.ownerB === me + 1 ? d.b : undefined;
          if (mineWas === undefined) return;
          const other = mineWas === d.a ? d.b : d.a;
          alert.push(s.kind === 'swap-land' ? `${who}用換地卡把你的${refName(mineWas)}換成了${refName(other)}` : `${who}用換屋卡換了你${refName(mineWas)}的房子`, 'bad');
          return;
        }
        case 'card-result':
          if (!toMe) return;
          if (d.card === 3) alert.push(`${who}用購地卡強制收購了你的${refName(d.ref ?? 0)}（付你 ${(d.price ?? 0).toLocaleString('zh-Hant')} 元）`, 'bad');
          else if (d.card === 2) alert.push(`${who}對你用了均貧卡：你們的現金平分為 ${(d.avg ?? 0).toLocaleString('zh-Hant')} 元`, 'bad');
          else if (d.card === 13) alert.push(`${who}用搶奪卡搶走了你的${d.tool ? toolDef(d.tool)?.name ?? '道具' : cardName(d.got ?? 0)}`, 'bad');
          else if (d.card) alert.push(`${who}對你用了${cardName(d.card)}`, 'bad');
          return;
        case 'turn-around': if (toMe) alert.push(`${who}對你用了轉向卡，你掉頭了！`, 'bad'); return;
        case 'stay': if (toMe) alert.push(`${who}對你用了停留卡，原地停一天`, 'bad'); return;
        case 'sleepwalk': if (toMe) alert.push(`${who}對你用了夢遊卡！`, 'bad'); return;
        case 'frame': if (toMe) alert.push(`${who}對你用了陷害卡，你進監獄了！`, 'bad'); return;
        case 'hibernate': if (who && d.who?.includes(me)) alert.push(`${who}用了冬眠卡，你冬眠 5 天`, 'bad'); return;
        case 'card-taken': if (toMe && d.card) alert.push(`你失去${cardName(d.card)}，送給了${who}`, 'bad'); return; // (a birthday: only this player's card)
        case 'magic':
          if (who && d.targets?.includes(me) && typeof d.magic === 'number') alert.push(`${who}在魔法屋對你：${MAGIC_NAMES[d.magic] ?? ''}`, 'bad');
          return;
        case 'icbm-hit': if (d.victims?.includes(me)) alert.push(`你被${who || ''}的核子飛彈擊中了！`, 'bad'); return;
        case 'event-result': {
          // a news or fate entry: only this player's line (土地稅 for everyone: what this player paid; 外星人: their lots lost)
          const mineLines = (d.lines ?? []).filter(l => l.p === me);
          if (!mineLines.length) return;
          const head = d.title || d.head || '';
          for (const l of mineLines) alert.push(`${head ? `${head}：` : ''}${l.text ?? ''}${l.amount ? ` ${l.amount > 0 ? '+' : '−'}${Math.abs(l.amount).toLocaleString('zh-Hant')} 元` : ''}`, (l.amount ?? 0) > 0 ? 'good' : 'bad');
          return;
        }
      }
    };
    const show = (e: RtEvent) => {
      const s = e.step, mine = e.lane === meSeat;
      if ('ask' in s) return;
      alertMe(e);
      if (s.t === 'step' || s.t === 'actor-step') {
        const id = s.t === 'step' ? s.p : s.actor;
        walking.add(id);
        // (夢遊: the player walks by itself, so the camera stays where they look, the user 2026-11-08)
        if (mine) { moveSound(id, s.to); if (!game.players[meSeat].sleepwalk) follow(); }
        else if (meSeat < 0 && id === camSeat) follow(camSeat);
        // laid on the clock: every walker at its own steady pace, never a jump (the user 2026-11-08)
        walks.set(id, view.walkTimed(id, s.to, s.dir, e.ms ?? 230, toReal(e.at) + RT_VIEW_DELAY).catch(() => {}));
        if (s.t === 'step' && s.left === 0 && mine) quiet();
        return;
      }
      if (e.lane >= 0 && e.lane < game.players.length) stopWalk(e.lane);
      // anything but a step on this player's lane: the steps' sounds stop (a time bomb going off on the way, 送醫院 …
      // the ticking went on for ever, the user 2026-11-08); the next step starts them again
      if (mine) quiet();
      dirty = true;
      switch (s.t) {
        case 'airdrop': view.place(s.p, s.node); break;
        case 'teleport': view.place(s.p, s.node); break;
        case 'dice':
          lastDice[s.p] = s.values;
          hud.note(`${nameOf(s.p)}擲出 ${s.values.join(' + ')}`, colorOf(s.p));
          if (mine) void view.dice(s.p, s.values).catch(() => {});
          break;
        case 'buy': case 'build': {
          const thing = s.kind === 'land' ? game.board.lands[s.id - 1].name : game.board.facilities[s.id - 1].name;
          hud.note(s.t === 'buy' ? `${nameOf(s.p)}買下${thing}，花費 ${s.price.toLocaleString()} 元` : `${nameOf(s.p)}在${thing}蓋到 ${s.level} 級（${s.cost.toLocaleString()} 元）`, colorOf(s.p));
          if (mine) audio.sfx(s.t === 'buy' ? Sfx.buyLand : Sfx.build);
          break;
        }
        case 'pay': {
          const to = isPlayer(s.to) ? nameOf(s.to) : s.to === -1 ? '樂透獎池' : '企業', from = isPlayer(s.from) ? nameOf(s.from) : '企業';
          hud.note(`${from} → ${to}：${s.reason} ${s.amount.toLocaleString()} 元`, isPlayer(s.from) ? colorOf(s.from) : undefined);
          if (s.from === meSeat && !s.quiet && /費$/.test(s.reason)) audio.sfx(Sfx.rent);
          break;
        }
        case 'points':
          hud.note(`${nameOf(s.p)}得到 ${s.amount} 點券`, colorOf(s.p));
          // (a mini game's square too: no game, but the points it gives, the user 2026-11-08)
          if (s.amount && msgs.watching(s.p)) msgs.push(`${s.amount > 0 ? '得到' : '失去'} ${Math.abs(s.amount)} 點券`, '點券', s.p);
          break;
        case 'say':
          if (!s.text) break;
          hud.note(s.log ?? s.text, s.p !== undefined && isPlayer(s.p) ? colorOf(s.p) : undefined);
          // this player's own lines: a short box or cloud (the lane goes on after a second); the others' only in the log
          // this player's: a message until tapped away (the user 2026-11-08: a short flash was gone before it was read)
          if (e.lane >= 0 && msgs.watching(e.lane)) msgs.push(s.text, '', e.lane);
          break;
        case 'bankrupt':
          hud.note(`${nameOf(s.p)}破產了！物價指數翻倍`, colorOf(s.p));
          void hud.flash(`${nameOf(s.p)}破產了！\n物價指數翻倍`, 1500).catch(() => {});
          if (meSeat < 0 && s.p === camSeat) {   // 圍觀: on to the next still playing
            const l = living().filter(x => x !== s.p), next = l.find(x => x > s.p) ?? l[0];
            if (next !== undefined) setTimeout(() => camOn(next, `視角切到 ${nameOf(next)}`), 1600);
          }
          break;
        case 'day': {
          // 按天自動存檔 (the user 2026-11-08): each new day, alone (派對模式 keeps no saves)
          if (!room) rtAutoSave();
          const h = game.settings.mapId === JQ_MAP ? null : holidayMusic(s.date, game.mapSlot);
          audio.newDay(h?.music ?? null, h?.days);
          hud.note(`—— ${format(s.date)} ——`);
          break;
        }
        case 'fx':
          if (s.kind === 'rt-wait') break;
          if (s.kind === 'missile-lock' && s.target !== undefined) {
            // the user 2026-11-07: the locked player hears it coming — run onto a rival's lot, or stay
            const what = s.data?.tool === 13 ? '核子飛彈' : '飛彈';
            hud.note(`${nameOf(s.p!)}的${what}鎖定了${nameOf(s.target)}！`, colorOf(s.p!));
            if (s.target === meSeat) {
              msgs.push(`3 秒後落在你站的地方！`, `${what}來襲`, meSeat);
              alert.countdown(`${nameOf(s.p!)}向你發射了${what}！`, RT.missile);
              for (let k = 0; k < 6; k++) setTimeout(() => audio.sfx(Sfx.bombTick), k * 500);
            }
            break;
          }
          if (typeof s.data?.text === 'string') hud.note(s.data.text, s.p !== undefined && isPlayer(s.p) ? colorOf(s.p) : undefined);
          // the board's own effects (into a hotel, out of the hospital, a house built …) run, never waited for; the
          // full screens (a tool's clip, the slot machine) are left out in 即時制
          if (mine || (e.lane >= 0 && msgs.watching(e.lane))) {
            // what happened to this player (or one being watched), as a message (a fate or task card, news, a result, what was got) — whole:
            // who, what and how much (the user 2026-11-08) — never a long scene
            const d = (s.data ?? {}) as { amount?: number; text?: string; title?: string; head?: string; lines?: { p?: number; text?: string; amount?: number }[]; id?: number; card?: number; tool?: number; magic?: number; group?: number; targets?: number[] };
            const yuan = (n: number) => `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('zh-Hant')}元`;
            if (s.kind === 'event-result' && Array.isArray(d.lines)) {
              const rows = d.lines.map(l => `${l.p !== undefined && isPlayer(l.p) ? `${nameOf(l.p)}：` : ''}${l.text ?? ''}${l.amount ? ` ${yuan(l.amount)}` : ''}`);
              msgs.push([d.head, ...rows].filter(Boolean).join('\n'), d.title ?? '', e.lane);
            } else if ((s.kind === 'fate' || s.kind === 'news') && typeof d.text === 'string') {
              // this player's own: the card as in the turn-based game (the user 2026-11-08: a picture, not a line)
              // this player's own: the card with its picture too (the user 2026-11-08); what happened goes in the box
              if (mine) showCard(s.kind, d.text, typeof d.id === 'number' ? d.id : undefined, s.data);
              msgs.push(d.text, s.kind === 'fate' ? '命運' : '新聞', e.lane);
            } else if (s.kind === 'card-received' && typeof d.card === 'number') msgs.push(`得到${cardName(d.card)}`, '卡片', e.lane);
            else if (s.kind === 'tool-received' && typeof d.tool === 'number') msgs.push(`得到${toolDef(d.tool)?.name ?? '道具'}`, '道具', e.lane);
            else if (s.kind === 'slot-machine' && typeof d.amount === 'number') {
              // 大財神 / 窮神's slot machine, played at once in 即時制: what it came to
              const god = OBJECT_NAMES[((d as { god?: number }).god ?? 1) - 1] ?? '神明', bad = BAD_GODS.has((d as { god?: number }).god ?? 0);
              msgs.push(`${bad ? '付出' : '得到'} ${Math.abs(d.amount).toLocaleString('zh-Hant')} 元`, `${god}拉霸`, e.lane);
            }
            else if (s.kind === 'magic' && typeof d.magic === 'number') msgs.push(`對象：${MAGIC_GROUPS[d.group ?? 0] ?? ''}（${(d.targets ?? []).map(nameOf).join('、')}）\n${MAGIC_NAMES[d.magic] ?? ''}`, '魔法屋', e.lane);
            else if (typeof d.text === 'string' && !RT_MY_FX.has(s.kind)) msgs.push(d.text, '', e.lane);
          }
          // the board's own effects (into a hotel, a house going up …); nobody's long lines (the user 2026-11-08: the
          // nurse's talk held everything up)
          if (!fxScreens[s.kind] && (mine ? RT_MY_FX.has(s.kind) : RT_BOARD_FX.has(s.kind))) void director.fx(s).catch(() => {});
          // a news entry's effect on the board itself (外星人 over the lots, 颱風 …), wherever it is, the camera left alone
          if (s.kind === 'news') void director.newsOnBoard(s).catch(() => {});
          // this player's wheel: turning by itself to its result in 1.5 s (a computer's: only the result, in the log)
          if (s.kind === 'wheel' && mine) void quickWheel(hud.context(hud.area), s, RT.wheel).catch(() => {});
          if (!mine) view.syncAll(); // (who went into a building or came out shows at once)
          if (s.kind === 'robot-doll' && s.node) view.place(game.dollId, s.node);
          if (s.kind === 'robot-doll-end') view.hide(game.dollId);
          break;
        case 'gameover': end = s; break;
      }
    };
    /** One tick: the clock up to its time, then its inputs; a guest checks the host's digest now and then. */
    let warned = false;
    const playTick = (tk: Tick, quietly: boolean) => {
      for (const e of rt.advance(tk.at)) { if (!quietly || e.step.t === 'gameover') show(e); if (end) return; }
      // (testing: every phone's digest at the checked ticks, window.__rich4.rtDigests)
      if (tk.h !== undefined) ((window as unknown as { __rich4: { rtDigests?: Record<number, number> } }).__rich4.rtDigests ??= {})[seq] = digest();
      if (tk.h === -1 && room!.host) tk.h = digest(); // the host's own tick: its digest now, before the inputs
      else if (tk.h !== undefined && !room!.host && tk.h !== digest() && !warned) {
        warned = true;
        void hud.flash('和房主的遊戲不同步了\n請把這局截圖給開發者', 2600);
        void reportParty('desync', '即時制和房主的遊戲不同步', { seq, detail: `第 ${game.daysElapsed} 天` });
      }
      for (const x of tk.ins) applyIn(x);
    };
    const mine = (p: number) => p === meSeat;
    try {
      while (me === session && !end) {
        wd.beat('realtime');
        if (room) { const o = performance.now() - rt.now; offset = Number.isFinite(offset) ? Math.min(o, offset + 2) : o; }
        if (room) {
          if (room.host) {
            // a new host (the old one left): its clock goes on from the last tick
            if (!wasHost) { wasHost = true; t0 = performance.now() - rt.now; }
            const at = Math.floor(performance.now() - t0);
            if (at - rt.now >= RT_TICK) {
              const ins: RtIn[] = [];
              for (const { from, x } of queue.splice(0)) if (valid(from, x)) ins.push(x);
              // seats whose phone is gone 10 s go to the computer; asks no player answers ('auto-turn') the host does
              for (const [k, q] of game.players.entries()) {
                if (!q.human || q.bankrupt || q.autopilot) { dropAt.delete(k); continue; }
                const owned = Object.values(room.started?.seats ?? {}).includes(k);
                if (owned && room.ownerConnected(k)) { dropAt.delete(k); continue; }
                if (!dropAt.has(k)) dropAt.set(k, at);
                if (at - dropAt.get(k)! >= 10_000) { ins.push({ k: 'auto', p: k, on: true }); dropAt.delete(k); }
              }
              for (const a of rt.asks()) if (a.q.t === 'auto-turn' && !ins.some(x => x.k === 'ans' && x.id === a.id)) ins.push({ k: 'ans', id: a.id, a: 0 });
              // a question from someone else's turn (or the calendar's) to a player: answered as the computer would —
              // nothing pulls everyone in at once (the user 2026-11-08)
              for (const a of rt.asks()) if (a.lane !== a.q.p && !ins.some(x => x.k === 'ans' && x.id === a.id)) ins.push({ k: 'ans', id: a.id, a: autoAnswer(a.q as never) });
              // every 40th tick (6 s) carries the host's digest, which the guests check at the same point
              const tk: Tick = { at, ins, ...(seq % 40 === 0 ? { h: -1 } : {}) };
              playTick(tk, false);
              room.answer(seq++, tk);
            }
          } else {
            const behind = room.logLength - seq > 12;
            for (let n = 0; n < 400 && !end; n++) {
              const e = room.peek(seq);
              if (!e) break;
              playTick(e.v as Tick, behind && room.logLength - seq > 3);
              seq++;
            }
            if (behind) { view.syncAll(); dirty = true; }
          }
        } else if (!hiddenAt) for (const e of rt.advance(performance.now() - t0)) { show(e); if (end) break; }
        if (end) break;
        if (!hiddenAt) {
          // between the lanes' moves the screen is this player's: the panel, the camera
          if (meSeat >= 0) game.current = meSeat;
          // the open box's question answered by the game itself (its time was up): the box closes
          if (asking && !rt.asks().some(a => a.id === askingId)) { const gone = rtGone; rtGone = null; gone?.(); closeQuestionScenes(); }
          // this player's question (one at a time); alone, a question for a seat nobody plays here is answered as the
          // computer would (派對模式: the host does that)
          for (const q of rt.asks()) {
            // not this player's, or asked from someone else's turn (派對模式: the host answers those)
            if (!mine(q.q.p) || q.lane !== q.q.p) { if (!room) rt.answer(q.id, autoAnswer(q.q as never)); continue; }
            if (answered.has(q.id)) continue;
            const reply = (a: Answer) => { if (room) { answered.add(q.id); send({ k: 'ans', id: q.id, a }); } else rt.answer(q.id, a); };
            // a quick drawer's tap: the card / tool screen's choice made already
            if (rtPick && performance.now() - rtPick.at > 4000) rtPick = null;
            if (rtPick && q.q.t === 'choose' && (rtPick.kind === 'card' ? q.q.layout === 'cards' : q.q.layout === 'tiles' && q.q.title === '道具')) { const v = rtPick.value; rtPick = null; reply(v as Answer); continue; }
            // (testing: window.__rich4.rtAuto answers this player's questions as the computer would)
            // 大財神's slot machine at once (the user 2026-11-08: too slow): the result is a message
            if (q.q.t === 'slot-machine') { reply(0 as Answer); continue; }
            // the wheels (旅遊, 住院, 坐牢 … days) stop at once as a computer's do, their start random (the user 2026-11-08:
            // it spun on and on); what it came to is told by the lines and the bar at the top
            if (q.q.t === 'wheel') { reply(0 as Answer); continue; }
            if ((window as unknown as { __rich4: { rtAuto?: boolean } }).__rich4.rtAuto) { reply(q.q.t === 'turn' ? { dice: game.players[meSeat].dice } : autoAnswer(q.q as never)); continue; }
            if (asking) continue;
            asking = true;
            askingId = q.id;
            follow();
            void localAnswer(q.q).then(reply, () => reply(autoAnswer(q.q as never))).finally(() => {
              if (askingId !== q.id) return;
              asking = false;
              askingId = -1;
              view.setMode('free');
            });
          }
          clock.show(rt.now);
          if (meSeat >= 0) {
            // held somewhere: what and how long (the user 2026-11-08: 住院 / 出國 / 外星人 … with the time left)
            const me = game.players[meSeat], next = Math.max(0, rt.readyAt(meSeat) - rt.now);
            const held: [string, number][] = [['住院', me.hospital], ['坐牢', me.prison], [me.vanish & 0x40 ? '外星人抓走' : '出國觀光', me.vanish], ['住旅館', me.hotel], ['冬眠', me.sleep]];
            const [what, v] = held.find(([, n]) => n) ?? ['', 0];
            // back in play (out of there, awake, 夢遊 over): the camera on this player at once, whatever was looked at
            const away = !!what || !!me.sleepwalk;
            if (wasAway && !away && !me.bankrupt) { touchedAt = 0; view.followActor(meSeat); }
            wasAway = away;
            if (!what || me.bankrupt) alert.hold(null);
            else {
              const days = v & 0x80 ? 0 : v & (what.startsWith('出國') || what.startsWith('外星人') ? 0x3f : 0x7f);
              const ms = next + Math.max(0, days - 1) * RT.stay;
              alert.hold(`${what}・${days ? `還有${days}天・` : ''}${Math.max(1, Math.ceil(ms / 1000))}秒後出來`);
            }
          }
          if (cool) {
            // the wait between two moves (not a stay, not while still walking or deciding, not on 托管)
            const me = game.players[meSeat], left = rt.busy(meSeat) || game.offRoad(me) || me.sleep || me.bankrupt || !game.isHuman(me) ? 0 : rt.readyAt(meSeat) - rt.now;
            cool.show(left);
            if (left > 0) { const g = go.spot(); cool.moveTo(g.x + g.w / 2, g.y + g.h / 2); }
          }
          if (watch) {
            // the time left to move, or in a shop (the user 2026-11-08: a little stopwatch, rocking at the end)
            const lim = rt.limitOf(meSeat);
            watch.show(lim ? lim.at - rt.now : null, lim?.total, lim?.what === 'indoors' ? '離店' : lim?.what === 'decide' ? '決定' : '擲骰');
            if (lim) {
              // beside the map's buttons at the top left (暫停 …) — on the page, so over a shop's scene too (the user
              // 2026-11-08: by GO or the clock it covered something)
              // in a shop (its scene over everything): in the scene's margin — at the left on a wide screen, the top on a tall one
              const t = (stage.querySelector('.view-tools') ?? stage).getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
              if (lim.what !== 'indoors') watch.moveTo(t.right + 6, t.top + t.height / 2);
              else if (W > H) watch.moveTo(6, 48, true, 'shop');
              else watch.moveTo(W / 2 - 46, 24, false, 'shop');
            }
          }
          if (dirty) { hud.refresh(); dirty = false; }
          const now = performance.now();
          drawRank(); // (each pass: the money's pops follow the game closely; only changes touch the page)
          quickCards?.refresh(); quickTools?.refresh();
          // the market for three days at most (the user 2026-11-08: its prices held meanwhile), then it closes by itself
          { const d0 = hud.stockOpenedDay(); if (d0 !== null && game.daysElapsed - d0 >= 3) { hud.leaveStock(); alert.push('股市停留三天，自動離開', 'info'); } }
          if (now - lastSync > 500) { lastSync = now; view.syncAll(); }
        }
        await new Promise(r => setTimeout(r, 40));
      }
    } finally {
      document.removeEventListener('visibilitychange', onVis);
      quiet();
      clock.remove();
      msgs.remove();
      alert.remove();
      rank.remove();
      quickCards?.remove(); quickTools?.remove();
      awayBtn?.remove(); comeBack();
      card.remove(); clearTimeout(cardTimer);
      cool?.remove();
      watch?.remove();
      rtAct = null;
      toolbar.el.classList.remove('rt-open');
      rtSaveData = null;
      director.onlySpeaker = -1;
      director.quick = false;
      hud.say = hudSay;
      view.canvas.removeEventListener('pointerdown', touched);
      minimap.el.removeEventListener('pointerdown', touched);
    }
    return end;
  };
  if (game.settings.realtime && !ty) {
    const end = await realtimeLoop();
    if (!end || me !== session) return;
    flow = (function* () { yield end; })() as typeof flow;
  }
  /**
   * 派對模式's standings in the turn-based game too (the user 2026-11-08: like 即時制's, foldable): the same column
   * (rt-rank.ts), under the 延遲 panel when that shows; redrawn at every event, the money's pops with it.
   */
  const tbRank = (() => {
    if (!room || game.settings.realtime || ty) return null;
    const rank = new RtRank(stage, [...room.mine][0] ?? -1, rankPeople());
    const place = () => {
      const n = stage.querySelector<HTMLElement>('.net-hud');
      const top = n && !n.hidden && n.offsetHeight ? `${n.offsetTop + n.offsetHeight + 4}px` : '';
      if (rank.el.style.top !== top) rank.el.style.top = top;
    };
    const watch = new ResizeObserver(place);
    const net = stage.querySelector('.net-hud');
    if (net) watch.observe(net);
    const draw = () => { place(); rank.update(game.players.map(q => ({ id: q.id, total: game.wealth(q), cash: q.cash, bank: q.bank, out: game.isOut(q), beggar: game.isBeggar(q), held: heldIcon(q) }))); };
    draw();
    return { draw, remove: () => { watch.disconnect(); rank.remove(); } };
  })();
  for (;;) {
    // (換地圖: the next game goes on in the same room, only this game's loop ends)
    if (me !== session) { tbRank?.remove(); hud.closeWait(); stopWatch(); if (room?.gen === roomGen) room?.close(); return; }
    if (room && sendSeq >= 0) { room.answer(sendSeq, answer); sendSeq = -1; }
    // Achievements right after the event that made them, while the board still shows it (the dice, the tools …).
    if (watch) await starNotes();
    rec?.step(answer);
    const r = flow.next(answer);
    answer = undefined;
    if (actsDue) {
      const d = actsDue, after = heldOf(game, d.p);
      actsDue = null;
      const lines = after ? heldDiff(game, d.before, after, d.shop) : [];
      if (lines.length) acts.add(nameOf(d.p), `#${colorOf(d.p).toString(16).padStart(6, '0')}`, lines);
    }
    if (r.done) break;
    const s = r.value;
    // 派對模式: the game as each turn begins, for a player whose app closed and comes back (issue #50).
    if (room && !('ask' in s) && s.t === 'turn') room.snapshot(askSeq, () => JSON.stringify(saveGame(game)));
    if (tbRank && !('ask' in s) && s.t !== 'step' && s.t !== 'actor-step') tbRank.draw();
    if (titleBook && !('ask' in s) && s.t !== 'step' && s.t !== 'actor-step') for (const w of titleBook.see(s)) hud.note(`${nameOf(w.p)} 獲得稱號「${w.title.name}」`, colorOf(w.p));
    if (spectatorBar && !('ask' in s)) spectatorBar.see(s as Parameters<SpectatorBar['see']>[0]);
    if (playerGifts && !('ask' in s)) playerGifts.see(s as Parameters<PlayerGifts['see']>[0]);
    if (room && !('ask' in s)) {
      if (s.t === 'turn') { room.resendOrders(); toolbar.el.classList.toggle('wait-open', waitSeat() >= 0); playerGifts?.draw(); }
      if (s.t === 'turn' || s.t === 'day') waitLive?.();
      if (s.t === 'gameover') hud.closeWait();
      // how this phone's order went (an order filled at a turn's end; a position opened or closed meanwhile)
      if (s.t === 'fx' && s.p !== undefined && room.mine.has(s.p) && s.p !== game.current && (s.kind === 'stock-order' || s.kind === 'position-open' || s.kind === 'position-close')) tellOrder({ ...(s.data as Parameters<typeof tellOrder>[0]), kind: s.kind });
    }
    // One event a screen cannot show (say, a player still on another city's square) is skipped and logged; it must
    // never stop the game (the user lost games to that: 小財神's payers, a summoned rival).
    try {
    await shown('losses', () => losses.before(s), undefined);
    wd.beat('ask' in s ? `ask:${s.t}` : s.t === 'fx' ? `fx:${s.kind}` : s.t);
    logStep(wd.stage);
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
      if (!(dozing(s.p) && (s.t === 'auto-turn' || s.t === 'seat'))) view.followActor(s.p);
      hud.refresh();
      if (room) {
        const seq = askSeq++;
        if (me === session && s.t === 'turn' && !room.digest(seq, digest()) && !warnedDesync) { warnedDesync = true; void hud.flash('和房主的遊戲不同步了\n請把這局截圖給開發者', 2600); void reportParty('desync', '和房主的遊戲不同步', { seq, detail: `第 ${game.daysElapsed} 天・輪到 ${nameOf(s.p)}` }); }
        if (s.t === 'orders') {
          // 等待中下單: the orders placed during this turn — the host says; everyone fills them here, in step.
          let got: { v: Answer } | null = null;
          while (!got) {
            if (me !== session) break;
            if (room.host) { answer = room.takeOrders(); sendSeq = seq; break; }
            got = await Promise.race([room.wait(seq).then(v => ({ v: v as Answer })), room.untilHost().then(() => null), new Promise<null>(r => setTimeout(() => r(null), 1000))]);
          }
          if (got) answer = got.v;
          room.ordersFilled(answer);
          continue;
        }
        if (s.t === 'seat') {
          // 途中加入: whether a player who joined takes this computer's seat over — the host says (from the seats, so a
          // new host after a hand-over says the same); everyone else waits for that answer.
          let got: { v: Answer } | null = null;
          while (!got) {
            if (room.host) { answer = room.seatAnswer(s.p) as Answer; sendSeq = seq; break; }
            got = await Promise.race([room.wait(seq).then(v => ({ v: v as Answer })), room.untilHost().then(() => null), new Promise<null>(r => setTimeout(() => r(null), 1000))]);
          }
          if (got) answer = got.v;
          continue;
        }
        if (!room.mine.has(s.p)) {
          // Another phone's player decides: wait for the answer. A seat sent away (voted out) is answered by the
          // host for the computer: 托管 at its turn (then the rules play it), the safe answer otherwise.
          // A phone gone for 10 s counts as dropped: the host answers it the same way (the user 2026-10-19).
          const auto = () => (s.t === 'turn' ? { action: 'autopilot' } : s.t === 'auto-turn' ? 0 : autoAnswer(s)) as Answer;
          wd.setHuman(true);
          let got: { v: Answer } | null = null;
          // Stuck (party-report.ts): a wait far past the room's 等待時間 is reported once.
          const waitFrom = Date.now();
          let stuckSent = false;
          let tookIt = false;
          const heldBefore = heldOf(game, s.p);
          // 小遊戲搗亂: the others watch the 小遊戲 as it is played, and may tap it (mini-games.ts watchMini)
          let miniView: ReturnType<typeof watchMini> | null = null;
          if (s.t === 'mini-game' && !game.settings.realtime) {
            // (opened with the first picture: the one playing may still be walking there; a phone of 1.2.0 sends none)
            const kind = s.game === 7 ? 7 : s.game === 8 ? 8 : 6, seat = s.p;
            room.onMiniFrame = (at, f) => {
              if (at !== seat) return;
              miniView ??= watchMini(hud.context(shell), kind, nameOf(seat), game.players[seat]?.character ?? 0, game.settings.noHeckle ? null : (x, y) => room.heckle(seat, x, y));
              miniView.frame(f as MiniFrame);
            };
          }
          while (!got) {
            if (me !== session) break;
            // 接手: this phone took the seat while its question was open — answered here after all.
            if (room.mine.has(s.p)) { tookIt = true; break; }
            if (!stuckSent && Date.now() - waitFrom > 45_000) { stuckSent = true; void reportParty('stuck', `等待 ${nameOf(s.p)} 操作已超過 45 秒（${s.t}）`, { seq, detail: `第 ${game.daysElapsed} 天・${room.connected() ? '和房主連線正常' : '和房主斷線中'}・${room.ownerConnected(s.p) ? '對方在線' : '對方斷線'}` }); }
            if (room.host) {
              if (room.ownerConnected(s.p)) dropped.delete(s.p); else if (!dropped.has(s.p)) dropped.set(s.p, Date.now());
              if (room.kickedSeats.has(s.p) || Date.now() - (dropped.get(s.p) ?? Infinity) >= 10000) { answer = auto(); sendSeq = seq; break; }
            }
            waiting.textContent = room.kickedSeats.has(s.p) ? `${nameOf(s.p)} 由電腦接手…` : `${nameOf(s.p)} ${LOCAL_DOING[room.doings.get(s.p) ?? ''] ?? askDoing(s)}…${seatPing(room, s.p)}`; waiting.hidden = false;
            // (untilHost only for a guest: it is already settled on the host, and racing it there spun forever)
            got = await Promise.race([room.wait(seq).then(v => ({ v: v as Answer })), ...(room.host ? [] : [room.untilHost().then(() => null)]), new Promise<null>(r => setTimeout(() => r(null), 1000))]);
          }
          wd.setHuman(false);
          waiting.hidden = true;
          room.doings.delete(s.p);
          room.onMiniFrame = () => {};
          if (miniView) { (miniView as ReturnType<typeof watchMini>).close(); miniView = null; }
          if (!tookIt) {
            if (got) { answer = got.v; if (heldBefore) actsDue = { p: s.p, before: heldBefore, shop: s.t === 'shop' || s.t === 'black-market' }; }
            continue;
          }
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
        // This phone is asked: what it had open while waiting closes (the question and the clock come first).
        hud.closeWait();
        toolbar.el.classList.remove('wait-open');
      }
      answer = await localAnswer(s);
      continue;
    }
    switch (s.t) {
      case 'turn':
        turnDeadline = 0; // 派對模式: a new turn, a new clock
        view.unmark();
        if (dozing(s.p)) break; // the camera stays: only the message 「XX冬眠中，還剩N天」 (map-fx.ts say)
        view.followActor(s.p);
        // Anyone's turn (a computer's too): the big clips of the tools they hold start loading in idle time.
        warmFor(game.players[s.p]);
        hud.refresh();
        await starNotes();
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
        lastDice[s.p] = s.values; // for an achievement's proof (ui/collection.ts)
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
        if (game.settings.trial && !trialPassed) {
          // 試玩: someone went bankrupt — the map may be published now
          trialPassed = true;
          makerWon(game.settings.mapId);
          trialBtn.textContent = '試玩通過・回到編輯器';
          trialBtn.classList.add('passed');
          await hud.flash('試玩通過！\n有玩家破產了，這張地圖可以發布到創作樂園了\n（可以繼續玩，或按「試玩通過・回到編輯器」）', 3200);
        }
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
        if (room && !newVersionTold) void checkUpdate().then(st => {
          if (st.kind === 'none' || newVersionTold) return;
          newVersionTold = true;
          void hud.flash(`新版本 v${st.version} 已發布\n請打完這局再更新\n（中途離開，更新後就回不到這一局）`, 3600);
        });
        await starNotes();
        break;
      case 'fx':
        // 機器工人: the rules have built already; the lot shows the old house through the cinematic too, until the
        // robot's clip reaches its redraw frame (a comment on 2026-10-28: 「蓋房子之前，房子就已經蓋好了」).
        // 怪獸卡 / 惡魔卡 (issue #73) the same: the house goes only when the monster gets there.
        if (s.kind === 'robot-worker' || (s.kind === 'cinema' && /-worker$|^card-(10|11)$/.test(String(s.data?.key)))) view.freezeLots();
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
        gameEnd('finish');
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
          await starNotes();
          if (game.challenge && challenge) await hud.sheetNode('挑戰結果', starTable(game, s.winner, faceOf));
          const results = gameResults(game, s.winner);
          run = recordResult(run, results);
          // 通關次數 (the user 2026-11-08): a win alone (not 派對模式) counts for the map, kept on this device
          if (!room && results.players.find(x => x.winner)?.human) { addClear(game.settings.mapId); makerWon(game.settings.mapId); }
          // 排行榜 (ranks.ts): one player against three computers, all broke — where it stands, the 新紀錄 form
          if (!room) { keepPlayClock(null); await afterWin(shell, game, s.winner, mapName(game.settings.mapId), bank!).catch(() => {}); }
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
  tbRank?.remove();
}

setup();
