/**
 * The original's sound (docs/rules/12-audio.md): Effect.mkf sound effects, Speaking.mkf character voices and
 * the MIDI music, extracted by scripts/extract_audio.py to assets/audio (effect/NNNN.m4a, voice/NNNN.m4a,
 * music/<name>.m4a, manifest.json). A small Web Audio engine: unlocked by the first user gesture (iOS needs
 * one), files decoded on first use and cached, separate music / effect / voice volumes with the original's
 * five levels (RICH4.CFG +2 / +3), persisted in localStorage, and a mute.
 *
 * Effects behave like the original's DirectSound slots (rich4_sound_effect.asm): each effect has one buffer, so
 * playing it again restarts it; different effects overlap. Voices are one at a time (a new line stops the
 * previous one, fcn_0045441a). Music follows rich4_media_music.asm: eight background tracks that play in turn
 * (fcn_00454d91), screen themes that loop and remember the background track and its position for when the
 * screen closes (fcn_004549cf / fcn_00454bcc), and holiday music that holds for its days.
 */
import { watch } from './watchdog';
import { isAndroid, memTier } from './mem-tier';
import { ASSETS } from './assets';
import { CARD_LINES, EVENT_LINES, TOOL_LINES } from './lines';
import { CARD_VOICE, EVENT_VOICE, TOOL_VOICE, VOICE_TEXT } from './voices';

/** Background tracks in the order they rotate (0x47e773: RICH08.MID, RICH16..22.MID). */
export const BGM = ['rich08', 'rich16', 'rich17', 'rich18', 'rich19', 'rich20', 'rich21', 'rich22'] as const;
/** Screen themes by the original's index (0x47e793: MIDI01..13, MIDI14-1, MIDI14-2, MIDI15, MIDI16). */
export const THEMES = ['midi01', 'midi02', 'midi03', 'midi04', 'midi05', 'midi06', 'midi07', 'midi08', 'midi09', 'midi10',
  'midi11', 'midi12', 'midi13', 'midi14-1', 'midi14-2', 'midi15', 'midi16'] as const;
/** Which theme each screen plays (fcn_004549cf call sites, 12-audio.md §1). */
export const Theme = {
  title: 0, setup: 1, bankrupt: 2, bank: 4, auction: 5, shop: 6, lottery: 6, ending: 6, magic: 7, draw: 8, monthly: 9,
  gifts: 10, balloons: 11, penguin: 12, christmas: 13, newYear: 14, prison: 15, hospital: 16,
} as const;

/** The UI slot table 0x48231a: hover, click, YES / confirm, NO / cancel, error. */
export const Ui = { hover: 0, click: 1, yes: 2, no: 4, error: 3 } as const;
/** Map sounds of the slot table 0x48234a and the FLC sounds (docs/rules/11, 12 §2). */
export const Sfx = {
  key: 7, slider: 9, dice: 10, demolishCar: 15, bombTick: 32, roadblock: 33, mine: 34, gift: 35, chest: 36, doll: 38,
  magic: 39, special: 43, walk: 44, scooter: 45, car: 46, boat: 47, points: 48, buyLand: 49, build: 50, slot: 51,
  wheel: 52, truck: 53, godLeaves: 54, rent: 55, turn: 56, cardUse: 62, monthly: 27, monthlyLow: 28, monthlyHigh: 60,
  lotteryBuy: 31, drawStart: 57, drawEnd: 58, auctionBid: 63, auctionHammer: 29, stockBuy: 40, stockSell: 41, stockTicker: 61,
  deathSummon: 59, fireworks: 90, robot: 91, ambulance: 92, police: 94, dogFight: 93, dogBike: 85, devilDust: 95, airplane: 96,
  ufo: 84, alienMonster: 84, alienAttack: 86, gas: 87, tornado: 88, typhoon: 89, missile: 81, nuke: 83, smallBlast: 82,
  demolishCard: 97, monsterCard: 80, couponFlip: 98, cardFlip: 99, bankrupt: 100, gameOver: 101, santa: 114,
} as const;
/** Possession sounds 102..113 by god type (rich4_gods.asm jump table). */
export const GOD_SOUND: Record<number, number> = { 1: 102, 2: 103, 3: 104, 4: 105, 5: 106, 6: 107, 7: 108, 8: 109, 9: 110, 10: 112, 12: 111, 15: 113 };

/** DirectSound volume by level (0x47e758: −10000, −2000, −1000, −500, 0 hundredths of a dB). */
const SFX_GAIN = [0, 0.1, 10 ** (-10 / 20), 10 ** (-5 / 20), 1];
/** MIDI volume by level (fcn_004545ba: 0, 0.6, 0.8, 0.9, 1 × the device volume). */
const MUSIC_GAIN = [0, 0.6, 0.8, 0.9, 1];
const KEY = 'rich4.audio';

export interface AudioSettings { music: number; sfx: number; voice: number; mute: boolean }
/**
 * A map's own music (激情歲月, docs/rules/24 §16): background tracks that rotate in place of BGM, and screen themes
 * that replace the original's (by THEMES index; `once` plays it through instead of looping). Files by URL, lengths in
 * seconds. No set (null): the original's music, as on every other map and mode.
 */
export interface MusicSet {
  tracks: { name: string; url: string; len: number }[];
  themes?: Partial<Record<number, { name: string; url: string; len: number; once?: boolean }>>;
  /** A short piece played once over the background track (then it resumes): the 穿越 intro's end. */
  fanfare?: { name: string; url: string; len: number };
}
interface Manifest { effect: Record<string, [number, number]>; voice: Record<string, [number, number]>; music: Record<string, number> }
type Kind = 'effect' | 'voice' | 'music';
interface Playing { src: AudioBufferSourceNode; gain: GainNode }
type MusicState = { kind: 'bgm'; index: number } | { kind: 'theme'; index: number } | { kind: 'fanfare'; index: -1 } | null;

/** Text → voice for the screens: whitespace, the two kinds of wave dash and dots do not matter. */
const norm = (s: string) => s.replace(/\s+/g, '').replace(/[∼~〜]/g, '～').replace(/[．.。…]+/g, '…').replace(/[！!]/g, '！').replace(/[？?]/g, '？');
const BY_TEXT = new Map<string, number>();
const PATTERNS: [RegExp, number][] = [];
for (const [id, text] of VOICE_TEXT) {
  const n = norm(text);
  if (!BY_TEXT.has(n)) BY_TEXT.set(n, id);
  if (/%[ds]/.test(text)) {
    const re = n.split(/%[ds]/).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+?');
    PATTERNS.push([new RegExp(`^${re}$`), id]);
  }
}
/** The voice of a line the original speaks, if any (exact text, or a '%d' / '%s' line filled in). */
export function voiceOf(text: string): number | undefined {
  const n = norm(text);
  const id = BY_TEXT.get(n);
  if (id !== undefined) return id;
  for (const [re, v] of PATTERNS) if (re.test(n)) return v;
  return undefined;
}

/** The voice of one of a character's lines (lines.ts) by its text, e.g. a rules 'say' event. */
export function characterVoice(character: number, text: string): number | undefined {
  const n = norm(text);
  for (const [L, V] of [[EVENT_LINES, EVENT_VOICE], [TOOL_LINES, TOOL_VOICE], [CARD_LINES, CARD_VOICE]] as const) {
    const row = L[character] ?? [];
    for (let i = 0; i < row.length; i++) if (row[i] && norm(row[i]!) === n && (V[character]?.[i] ?? -1) >= 0) return V[character][i];
  }
  return undefined;
}

/**
 * Voice of a news or fate board (the board's string is '#NNNN…'): news n → 149 + n; fate t → 185 + t, the
 * prison entries 33..36 by map (218 + 4·map + t − 33) like the fate pictures (rich4_news.asm, csrc/fortune.c).
 */
export function boardVoice(kind: 'news' | 'fate', id: number, mapId: number): number | undefined {
  if (id < 0) return undefined;
  if (kind === 'news') return id < 36 ? 149 + id : undefined;
  return id < 33 ? 185 + id : id < 37 ? 218 + 4 * (mapId & 3) + id - 33 : undefined;
}

class AudioEngine {
  private ctx: AudioContext | null = null;
  private out: Record<Kind, GainNode> | null = null;
  private master: GainNode | null = null;
  private manifest: Manifest | null = null;
  private loading: Promise<void> | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** The buffers decoded so far, by the same key (their sizes for the music budget and the memory report). */
  private decoded = new Map<string, AudioBuffer>();
  private effects = new Map<number, Playing>();
  private loops = new Set<number>();
  private voiceNow: { id: number; playing: Playing | null; end: () => void } | null = null;
  private musicNow: { state: MusicState; playing: Playing | null; started: number; offset: number } = { state: null, playing: null, started: 0, offset: 0 };
  /** Background tracks pushed by screen themes: index and position (0x48cb70 / 0x48cb50). */
  private stack: { index: number; at: number }[] = [];
  /** Holiday music days: high nibble the total, low nibble the days left (0x46cb06). */
  holiday = 0;
  settings: AudioSettings = { music: 4, sfx: 4, voice: 4, mute: false };
  /** Every play request (kind, id, time), for tests and debugging (window.__rich4Audio). */
  readonly log: { t: number; kind: string; id: number | string; loop?: boolean }[] = [];

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AudioSettings> | null;
      if (s) this.settings = { ...this.settings, ...s };
    } catch { /* defaults */ }
    if (typeof window !== 'undefined') {
      (window as unknown as { __rich4Audio: unknown }).__rich4Audio = this;
      const unlock = () => this.unlock();
      for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) window.addEventListener(ev, unlock, { capture: true, passive: true });
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) { this.hiddenAt = Date.now(); this.selfSuspend = true; void this.ctx.suspend().catch(() => {}); return; }
        this.wake();
        // iOS WKWebView: after the app was in the background (a message, a call, the home screen) the context often
        // reports 'running' but plays nothing, and resume() can't fix it. So coming back from the background always
        // builds a fresh context (the app's web view needs no touch to start audio — mediaTypesRequiringUserAction
        // ForPlayback = []), a moment after AppDelegate re-activates the audio session.
        if (this.hiddenAt) { this.hiddenAt = 0; setTimeout(() => { if (!document.hidden) this.rebuild(); }, 400); }
      });
      // iOS: coming back from another app (a message, a call) can leave the context 'interrupted' or silently
      // dead; try at once, and again on the next touch (unlock), rebuilding the context if it won't run.
      window.addEventListener('pageshow', () => this.wake());
      window.addEventListener('focus', () => this.wake());
    }
  }

  // ------------------------------------------------------------ setup

  /**
   * Creates the context on first use and resumes it inside a user gesture (iOS WKWebView and Safari start it
   * suspended until a touch; browsers that allow autoplay run it at once).
   */
  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    // iOS 17+: play as a game/music player, not as page sound that the silent switch mutes (Audio Session API).
    try { const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession; if (s) s.type = 'playback'; } catch { /* older WebKit */ }
    const ctx = new AC();
    this.ctx = ctx;
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.master = master;
    const mk = () => { const g = ctx.createGain(); g.connect(master); return g; };
    this.out = { effect: mk(), voice: mk(), music: mk() };
    this.applyVolumes();
    this.watch(ctx);
    void this.load().then(() => this.preload());
    return ctx;
  }

  /**
   * iOS interruptions that don't hide the page (Siri, an alarm, a call banner): the context goes 'interrupted'
   * (or 'suspended') and may never come back by itself, or comes back 'running' but silent. So: try to resume a
   * few times while it is interrupted (the next touch also does, via unlock), and once it runs again build a
   * fresh context like coming back from the background (the music goes on where it was, looping effects restart).
   */
  private watch(ctx: AudioContext) {
    if (typeof ctx.addEventListener !== 'function') return;
    ctx.addEventListener('statechange', () => {
      if (this.ctx !== ctx) return;
      const state = ctx.state as string;
      if (state === 'running') {
        if (!this.interrupted) return;
        this.interrupted = false;
        this.stopRetry();
        setTimeout(() => { if (this.ctx === ctx && ctx.state === 'running' && !document.hidden) this.rebuild(); }, 300);
        return;
      }
      if (state === 'closed' || document.hidden || this.selfSuspend) return;
      this.interrupted = true;
      this.unlocked = false;   // the next touch runs the full unlock (resume, silent tick, music restart)
      this.retry(ctx);
    });
  }
  private interrupted = false;
  private rebuiltAt = 0;
  /** The context was suspended by us (page hidden): not an interruption. */
  private selfSuspend = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private retry(ctx: AudioContext, n = 0) {
    this.stopRetry();
    if (n >= 6) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.ctx !== ctx || !this.interrupted) return;
      if (!document.hidden) void ctx.resume().catch(() => {});
      this.retry(ctx, n + 1);
    }, 500 + 500 * n);
  }
  private stopRetry() { if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; } }

  /** Back in front: resume, and make the next touch run the full unlock (silent tick, music restart, rebuild). */
  private wake() {
    if (!this.ctx || document.hidden) return;
    this.unlocked = false;
    this.selfSuspend = false;
    void this.ctx.resume().catch(() => {});
  }

  /**
   * A context iOS won't bring back (still not running after resume() inside a touch): close it and start a
   * fresh one. Decoded buffers carry over; the music restarts where it was and looping effects start again.
   */
  private rebuild() {
    const old = this.ctx;
    if (!old) return;
    const m = this.musicNow, at = m.state ? this.position() : 0;
    m.playing = null;
    this.effects.clear();
    this.ctx = null; this.out = null; this.master = null;
    this.interrupted = false; this.selfSuspend = false; this.stopRetry();
    this.rebuiltAt = Date.now();
    try { void old.close().catch(() => {}); } catch { /* gone */ }
    this.generation++;
    this.unlocked = false;   // the next touch plays the silent tick on the new context too
    const ctx = this.ensure();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    if (m.state) this.startMusic(m.state, at);
    for (const id of [...this.loops]) this.sfx(id, true);
  }
  /** Bumped when the context is replaced: makers of live nodes (weather, street sounds) rebuild theirs. */
  generation = 0;
  private hiddenAt = 0;

  unlock() {
    // After an interruption a touch builds the fresh context inside the gesture (Safari needs one to start it).
    if (this.ctx && this.interrupted && !document.hidden && Date.now() - this.rebuiltAt > 1500) this.rebuild();
    const first = !this.ctx;
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      const tried = ctx;
      void ctx.resume().catch(() => {}).then(() => {
        // Give WebKit a moment; a context that is still suspended/interrupted after a resume in a touch is stuck.
        setTimeout(() => { if (this.ctx === tried && tried.state !== 'running' && !document.hidden) this.rebuild(); }, 350);
      });
    }
    if (first || !this.unlocked) {
      this.unlocked = true;
      // A silent tick starts output on iOS.
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start();
      const m = this.musicNow;
      if (m.state && !m.playing) this.startMusic(m.state, m.offset);
    }
  }
  private unlocked = false;

  private load(): Promise<void> {
    this.loading ??= fetch(`${ASSETS}/audio/manifest.json`).then(r => (r.ok ? r.json() : null)).then(m => { this.manifest = m; }).catch(() => { this.manifest = null; });
    return this.loading;
  }

  /** The always-loaded slot tables of the original (0x48231a UI, 0x48234a map) are decoded up front. */
  private preload() {
    for (const id of [0, 1, 2, 3, 4, 7, 9, 10, 32, 33, 34, 35, 36, 38, 43, 44, 45, 46, 47, 48, 49, 50, 53, 54, 55, 56, 15, 62]) void this.buffer('effect', id);
  }

  private url(kind: Kind, id: number | string) {
    if (kind === 'music' && this.setUrls.has(String(id))) return this.setUrls.get(String(id))!;
    return `${ASSETS}/audio/${kind}/${typeof id === 'number' ? String(id).padStart(4, '0') : id}.m4a`;
  }

  private has(kind: Kind, id: number | string): boolean {
    const m = this.manifest;
    if (kind === 'music' && this.setUrls.has(String(id))) return true;
    if (!m) return true; // not loaded yet: try
    return kind === 'music' ? String(id) in m.music : String(id) in m[kind];
  }

  private buffer(kind: Kind, id: number | string): Promise<AudioBuffer | null> {
    const key = `${kind}/${id}`;
    let b = this.buffers.get(key);
    // Music in use moves to the end (the least recently used is dropped first, see trimMusic).
    if (b && kind === 'music') { this.buffers.delete(key); this.buffers.set(key, b); }
    if (!b) {
      const ctx = this.ctx;
      b = !ctx ? Promise.resolve(null) : fetch(this.url(kind, id))
        // Capacitor's iOS asset handler answers local audio files with status 0 (the body is there): accept it.
        .then(r => (r.ok || r.status === 0 ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(data => new Promise<AudioBuffer>((ok, no) => ctx.decodeAudioData(data, ok, no)))
        .then(buf => { if (this.buffers.has(key)) this.decoded.set(key, buf); return buf; })
        .catch(() => null);
      if (ctx) this.buffers.set(key, b);
      // Voices are many and short-lived: keep at most the last few.
      if (kind === 'voice') {
        const voices = [...this.buffers.keys()].filter(k => k.startsWith('voice/'));
        if (voices.length > 24) this.drop(voices[0]);
      }
    }
    return b;
  }

  private drop(key: string) { this.buffers.delete(key); this.decoded.delete(key); }

  /**
   * Decoded music is big (a 3-minute track is ~70 MB of samples at 48 kHz: all 25 tracks would be ~760 MB, and a long
   * game used to keep every one it had played; issue #13, Android closing the app late in a game). On Android, beyond
   * the device's budget (ui/mem-tier.ts `musicBytes`) the least recently played go, never the one playing (`now`) nor the
   * background tracks a screen will resume; they are decoded again when next played.
   */
  private trimMusic(now: string) {
    // Android only (iOS and the desktop keep every decoded track, as before: the owner 2026-10-26).
    const budget = isAndroid() ? memTier().musicBytes : Infinity;
    if (budget === Infinity) return;
    const need = new Set([`music/${now}`, ...this.stack.map(s => `music/${musicName(this.mset, { kind: 'bgm', index: s.index })}`)]);
    const size = (b: AudioBuffer) => b.length * b.numberOfChannels * 4;
    let used = 0;
    for (const [k, b] of this.decoded) if (k.startsWith('music/')) used += size(b);
    for (const k of [...this.buffers.keys()]) {
      if (used <= budget) break;
      const b = this.decoded.get(k);
      if (!k.startsWith('music/') || need.has(k) || !b) continue;
      used -= size(b);
      this.drop(k);
    }
  }

  /** Decoded audio held: count and bytes, music apart (for the memory report, ui/mem-report.ts). */
  memStats(): { buffers: number; bytes: number; music: number; musicBytes: number } {
    let bytes = 0, music = 0, musicBytes = 0;
    for (const [k, b] of this.decoded) {
      const n = b.length * b.numberOfChannels * 4;
      bytes += n;
      if (k.startsWith('music/')) { music++; musicBytes += n; }
    }
    return { buffers: this.decoded.size, bytes, music, musicBytes };
  }

  /** Seconds of an effect / voice from the manifest (0 when unknown). */
  length(kind: 'effect' | 'voice', id: number): number {
    const e = this.manifest?.[kind]?.[String(id)];
    return e ? e[1] / e[0] : 0;
  }

  // ------------------------------------------------------------ volumes

  private applyVolumes() {
    if (!this.out || !this.master || !this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.mute ? 0 : 1, t, 0.02);
    this.out.effect.gain.setTargetAtTime(SFX_GAIN[s.sfx] ?? 1, t, 0.02);
    this.out.voice.gain.setTargetAtTime(SFX_GAIN[s.voice] ?? 1, t, 0.02);
    this.out.music.gain.setTargetAtTime(MUSIC_GAIN[s.music] ?? 1, t, 0.02);
  }

  /** Changes a volume (0..4) or the mute; kept in localStorage. Music level 0 stops the music (cfg +2 = 0). */
  set(change: Partial<AudioSettings>) {
    const wasOff = this.settings.music === 0;
    this.settings = { ...this.settings, ...change };
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* not kept */ }
    this.applyVolumes();
    if (this.settings.music === 0 && !wasOff) this.halt(0.2);
    else if (wasOff && this.settings.music > 0 && this.musicNow.state) this.startMusic(this.musicNow.state, 0);
    if (this.settings.voice === 0) this.stopVoice();
  }

  // ------------------------------------------------------------ effects

  private note(kind: string, id: number | string, loop?: boolean) {
    this.log.push({ t: Math.round(performance.now()), kind, id, ...(loop ? { loop } : {}) });
    if (this.log.length > 4000) this.log.splice(0, 1000);
  }

  /**
   * Plays an Effect.mkf sound (`_rich4_play_sound_effect`): restarts it if it is already playing; `loop` keeps
   * it going until stop(id) (the engine and the ticking bomb, flags 1). Nothing plays at effect level 0.
   */
  sfx(id: number, loop = false) {
    if (id < 0) return;
    this.note('sfx', id, loop);
    if (loop) this.loops.add(id);
    if (!this.ensure() || this.settings.sfx === 0 || !this.has('effect', id)) return;
    const asked = performance.now();
    void this.buffer('effect', id).then(buf => {
      if (!buf || !this.ctx || !this.out) return;
      if (loop && !this.loops.has(id)) return;
      // A short sound that could not be decoded in time is dropped rather than played late.
      if (!loop && performance.now() - asked > 800) return;
      this.stopEffect(id, false);
      const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      src.buffer = buf;
      src.loop = loop;
      if (loop) { src.loopStart = 0; src.loopEnd = this.length('effect', id) || buf.duration; }
      src.connect(gain).connect(this.out.effect);
      src.start();
      const p = { src, gain };
      this.effects.set(id, p);
      src.onended = () => { if (this.effects.get(id) === p) this.effects.delete(id); };
    });
  }

  /**
   * The effect bus for sounds made on the fly (the remake's weather, ui/weather-fx.ts): they follow the effect
   * volume and the mute like the original's effects. Null without Web Audio.
   */
  ambience(): { ctx: AudioContext; out: AudioNode } | null {
    const ctx = this.ensure();
    return ctx && this.out ? { ctx, out: this.out.effect } : null;
  }

  /** A UI sound of the slot table 0x48231a. */
  ui(kind: keyof typeof Ui) { this.sfx(Ui[kind]); }

  /** Starts a looping effect (no-op when it already loops). */
  loop(id: number) { if (!this.loops.has(id)) this.sfx(id, true); }

  /** Stops an effect (`fcn_004542e9`), looping or not. */
  stop(id: number) {
    if (this.loops.delete(id)) this.note('stop', id);
    this.stopEffect(id, true);
  }

  isLooping(id: number) { return this.loops.has(id); }

  /** Stops every looping effect (the hang guard's rescue: a wheel's or an engine's loop must not go on for good). */
  stopLoops() { for (const id of [...this.loops]) this.stop(id); }

  private stopEffect(id: number, fade: boolean) {
    const p = this.effects.get(id);
    if (!p) return;
    this.effects.delete(id);
    this.end(p, fade ? 0.03 : 0);
  }

  private end(p: Playing, fade: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    try {
      if (fade > 0) {
        p.gain.gain.setValueAtTime(p.gain.gain.value, t);
        p.gain.gain.linearRampToValueAtTime(0, t + fade);
        p.src.stop(t + fade + 0.01);
      } else p.src.stop();
    } catch { /* already stopped */ }
  }

  // ------------------------------------------------------------ voices

  /**
   * Plays voice NNNN of Speaking.mkf (fcn_0045441a): stops the line before. Resolves when it has finished (or
   * at once when there is none); `stopVoice` (a tap) ends it early.
   */
  voice(id: number | undefined): Promise<void> {
    this.stopVoice();
    if (id === undefined || id < 0) return Promise.resolve();
    this.note('voice', id);
    if (!this.ensure() || this.settings.voice === 0 || this.settings.mute || !this.has('voice', id)) return Promise.resolve();
    return watch(`voice ${id}`, new Promise<void>(resolve => {
      // The line always ends: a context that is suspended or interrupted (iOS) never fires `onended`, so the wait
      // also ends after the line's length (from the manifest; else when the picture of it says) and a second.
      let over = false;
      const end = () => { if (over) return; over = true; clearTimeout(guard); if (this.voiceNow === me) this.voiceNow = null; resolve(); };
      const me = { id, playing: null as Playing | null, end };
      this.voiceNow = me;
      const asked = performance.now();
      let guard = setTimeout(end, (this.length('voice', id) || 3) * 1000 + 2500);
      void this.buffer('voice', id).then(buf => {
        if (this.voiceNow !== me || over) return;
        if (!buf || !this.ctx || !this.out || performance.now() - asked > 1500 || this.ctx.state !== 'running') { end(); return; }
        const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
        src.buffer = buf;
        src.connect(gain).connect(this.out.voice);
        src.onended = () => { if (this.voiceNow === me) end(); };
        me.playing = { src, gain };
        src.start();
        clearTimeout(guard);
        guard = setTimeout(end, buf.duration * 1000 + 1000);
      }, end);
    }));
  }

  /** The voice of a line by its text (screens), if the original has one. */
  say(text: string | null | undefined): Promise<void> {
    const id = text ? voiceOf(text) : undefined;
    return id === undefined ? Promise.resolve() : this.voice(id);
  }

  /** Ends the current line (a click during `fcn_004544f6`). */
  stopVoice() {
    const v = this.voiceNow;
    if (!v) return;
    this.voiceNow = null;
    if (v.playing) this.end(v.playing, 0.03);
    v.end();
  }

  get speaking() { return !!this.voiceNow; }

  // ------------------------------------------------------------ music

  /** Which music is meant to play (also while music is off), for the system panel. */
  get music(): MusicState { return this.musicNow.state; }

  private position(): number {
    const m = this.musicNow;
    if (!this.ctx || !m.playing) return m.offset;
    const dur = m.playing.src.buffer?.duration ?? 0;
    const at = m.offset + this.ctx.currentTime - m.started;
    return m.state?.kind === 'theme' && dur ? at % dur : at;
  }

  private nameOf(s: NonNullable<MusicState>) { return musicName(this.mset, s); }

  // ------------------------------------------------------------ a map's own music (激情歲月)

  private mset: MusicSet | null = null;
  private setUrls = new Map<string, string>();

  /** How many background tracks rotate now (the original's eight, or the map's own). */
  get bgmCount(): number { return bgmCount(this.mset); }
  /** Whether a map's own music is in use. */
  get ownMusic(): boolean { return !!this.mset; }

  /**
   * Uses a map's own music, or the original's again (null). `now`: switch what plays at once (the setting changed in
   * a game); otherwise the next background(…) call starts it (a game being loaded).
   */
  setMusicSet(set: MusicSet | null, now = false) {
    if (set === this.mset) return;
    this.useSet(set);
    this.lastBgm = this.bgmCount - 1;
    this.stack = [];
    if (now && !this.holiday) { const s = this.musicNow.state; if (!s || s.kind !== 'theme') this.background(1); }
  }

  private useSet(set: MusicSet | null) {
    this.mset = set;
    this.setUrls.clear();
    for (const t of [...(set?.tracks ?? []), ...Object.values(set?.themes ?? {}), ...(set?.fanfare ? [set.fanfare] : [])]) if (t) this.setUrls.set(t.name, t.url);
  }

  /**
   * The same pieces in other files (激情歲月's 音質 大喇叭 / 清晰): what plays goes on from the same place in the other
   * version, the rotation and the remembered tracks stay. A set with another number of tracks (or none) is a
   * different set: setMusicSet(…, true).
   */
  swapMusicFiles(set: MusicSet | null) {
    if (!set || !this.mset || set.tracks.length !== this.mset.tracks.length) { this.setMusicSet(set, true); return; }
    const m = this.musicNow, s = m.state;
    const at = s ? this.position() : 0;
    this.useSet(set);
    // (a fresh state object: a file of the old version still being decoded no longer starts)
    if (s && s.kind !== 'theme') this.startMusic({ ...s }, at);
  }

  /** The map's fanfare once over the background track, which then resumes where it was (no fanfare: nothing). */
  fanfare() {
    if (!this.mset?.fanfare || this.holiday) return;
    const cur = this.musicNow.state;
    if (cur?.kind === 'bgm') this.stack.push({ index: cur.index, at: this.position() });
    this.note('music', this.mset.fanfare.name);
    this.startMusic({ kind: 'fanfare', index: -1 }, 0);
  }

  /** Stops what plays now, fading out over `fade` seconds. */
  private halt(fade = 0.35) {
    const m = this.musicNow;
    if (m.playing) { m.playing.src.onended = null; this.end(m.playing, fade); }
    m.playing = null;
  }

  /** Starts a state from `offset` seconds, crossfading from what plays. */
  private startMusic(state: NonNullable<MusicState>, offset: number) {
    this.halt();
    const m = this.musicNow;
    m.state = state; m.offset = offset;
    if (!this.ensure() || !this.out || this.settings.music === 0) return;
    const name = this.nameOf(state);
    if (!this.has('music', name)) return;
    void this.buffer('music', name).then(buf => {
      this.trimMusic(this.nameOf(m.state ?? state));
      if (!buf || !this.ctx || !this.out || m.state !== state || m.playing) return;
      const src = this.ctx.createBufferSource(), gain = this.ctx.createGain();
      src.buffer = buf;
      // Themes loop from the start (MCI "play mid from 0 notify" again, fcn_00454d2c); the cut is the
      // sequence's last event (manifest seconds).
      const len = this.manifest?.music?.[name] ?? musicLen(this.mset, name) ?? buf.duration;
      const once = state.kind === 'fanfare' || (state.kind === 'theme' && !!this.mset?.themes?.[state.index]?.once);
      if (state.kind === 'theme' && !once) { src.loop = true; src.loopStart = 0; src.loopEnd = Math.min(len, buf.duration); }
      const t = this.ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(1, t + 0.25);
      src.connect(gain).connect(this.out.music);
      const at = Math.max(0, Math.min(offset, len - 0.05));
      if (state.kind === 'bgm' || once) src.start(t, at, Math.max(0.05, len - at));
      else src.start(t, at);
      m.playing = { src, gain };
      m.started = t; m.offset = at;
      // A background track that ends moves on to the next one (fcn_00454d2c → fcn_00454d91(0)).
      src.onended = () => {
        if (m.playing?.src !== src) return;
        if (state.kind === 'bgm') { m.playing = null; this.background(0); }
        else if (state.kind === 'fanfare') { m.playing = null; this.restore(); }
      };
    });
  }

  /**
   * Background music `fcn_00454d91(n)`: track n (1..8), or the next one in turn for 0. Ignored while holiday
   * music holds (the original's callers check 0x46cb06 first).
   */
  background(n: number) {
    const cur = this.musicNow.state;
    const last = cur?.kind === 'bgm' ? cur.index : this.lastBgm;
    const count = this.bgmCount;
    const index = n > 0 ? (n - 1) % count : (last + 1) % count;
    this.lastBgm = index;
    this.note('music', musicName(this.mset, { kind: 'bgm', index }));
    this.startMusic({ kind: 'bgm', index }, 0);
  }
  /** 0x47e771: the last background track (the next one in turn follows it). */
  private lastBgm = 7;

  /**
   * A screen's theme `fcn_004549cf(i)`: remembers the background track and where it was (unless `keep`, the
   * 0x8000 flag), then loops theme i. Holiday music is not interrupted.
   */
  theme(i: number, keep = false) {
    if (this.holiday) return;
    const cur = this.musicNow.state;
    if (cur?.kind === 'bgm' && !keep) this.stack.push({ index: cur.index, at: this.position() });
    this.note('music', musicName(this.mset, { kind: 'theme', index: i }));
    this.startMusic({ kind: 'theme', index: i }, 0);
  }

  /** Back from a screen `fcn_00454bcc`: the remembered background track resumes where it was. */
  restore() {
    if (this.holiday) return;
    const top = this.stack.pop();
    if (!top) { if (this.musicNow.state?.kind !== 'bgm') this.background(0); return; }
    this.note('music', musicName(this.mset, { kind: 'bgm', index: top.index }));
    this.lastBgm = top.index;
    this.startMusic({ kind: 'bgm', index: top.index }, top.at);
  }

  /** `fcn_00454acb` / `fcn_00454edc`: stop; `clear` also forgets the remembered tracks. */
  stopMusic(clear = false) {
    this.note('music', 'stop');
    this.halt();
    this.musicNow.state = null;
    if (clear) this.stack = [];
  }

  /**
   * A day passes (fcn_0041cf67 step 1): holiday music counts down and gives way to the next background track.
   * Then `holidayMusic` (fcn_00452444): a holiday with music starts it for 1 day, or 3 when the next table
   * entry has music too (the lunar new year).
   */
  newDay(music: number | null, days = 1) {
    if (this.holiday & 0xf) {
      this.holiday -= 1;
      if (!(this.holiday & 0xf)) { this.holiday = 0; this.stopMusic(); this.background(0); }
    }
    if (music !== null && !this.holiday) {
      this.stopMusic(true);
      this.note('music', THEMES[music]);
      this.startMusic({ kind: 'theme', index: music }, 0);
      this.holiday = days === 3 ? 0x33 : 0x11;
    }
  }

  /** The time machine undoes one day of holiday music (05 §5: counter +1, back to normal past its start). */
  undoDay() {
    if (!this.holiday) return;
    this.holiday += 1;
    if ((this.holiday & 0xf) > this.holiday >> 4) { this.holiday = 0; this.stopMusic(); this.background(0); }
  }
}

export const audio = new AudioEngine();

/** The file a music state plays: the map's own (a set) or the original's. */
export function musicName(set: MusicSet | null, s: NonNullable<MusicState>): string {
  if (s.kind === 'fanfare') return set?.fanfare?.name ?? '';
  if (s.kind === 'bgm') return set?.tracks.length ? set.tracks[s.index % set.tracks.length].name : BGM[s.index & 7];
  return set?.themes?.[s.index]?.name ?? THEMES[s.index];
}
export const bgmCount = (set: MusicSet | null): number => set?.tracks.length || BGM.length;
const musicLen = (set: MusicSet | null, name: string): number | undefined =>
  [...(set?.tracks ?? []), ...Object.values(set?.themes ?? {}), ...(set?.fanfare ? [set.fanfare] : [])].find(t => t?.name === name)?.len || undefined;
