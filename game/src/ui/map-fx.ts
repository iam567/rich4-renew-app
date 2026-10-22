/**
 * What the original shows on the map for each rules event (docs/rules/11): the clips, flights, flashes and the
 * characters' lines, played through the board view's `Effects`. The controller (main.ts) hands every event to
 * the matching method; a method resolves when the original would let the game go on.
 */
import { Game, SPEED } from '../core/game';
import { worldSize } from '../core/board';
import { cardScene, toolScene } from './screens/card-fx';
import { resultBox } from './screens/event-result';
import { playEventFx } from './event-fx';
import { preloadClips, QUOTE_LEAD } from './effects';
import { warmFireworks } from './fireworks';
import type { EventResult } from '../core/modules/events';
import { cardDef, cardName } from '../core/modules/cards';
import { CHARACTERS, playerName } from '../core/characters';
import { jqRules, quotesMode } from './jiqing'; // 激情歲月's quotations (docs/rules/24 §7)
import { eventOccasion, pickQuote } from './jq-quotes';
import { TOOLS } from '../core/modules/tools';
import type { GameEvent, Player } from '../core/types';
import type { BoardView } from './board-view';
import type { Hud } from './hud';
import { CARD_LINES, EVENT_LINES, TOOL_LINES } from './lines';
import { CARD_VOICE, EVENT_VOICE, TOOL_VOICE } from './voices';
import { audio, characterVoice, GOD_SOUND, Sfx, Theme } from './audio';
import { cardBox } from './screens/card-result';
import { cardFace, cardLineIndex, isWaivedNotice, LastLine, parseStuck, payReaction, stuckLament, swapReaction, type SwapBefore } from './reactions';

type Fx = Extract<GameEvent, { t: 'fx' }>;
type Pt = { x: number; y: number };

/** Expression faces of map#(27 + character): frame face + 1. */
const Face = { normal: 0, frown: 1, cry: 2, laugh: 3 } as const;

/** Possession clips Data#540..551 and the god's words (rich4_gods.asm jump table ref_0040ea9b, 11 §3.2). */
const GOD_CLIP: Record<number, { res: number; text: string }> = {
  1: { res: 540, text: '呦喝！∼發財發財！\n\n我雖然還小，沒什麼神力\n\n但是我可以讓你損失減半。' },
  2: { res: 541, text: '呵呵∼恭喜發財。\n\n我保佑你財源滾滾\n\n誰也不能罰你的錢。' },
  3: { res: 542, text: 'Ｙｅａｈ!!不要看我小喔\n\n我可以讓你投資事半功倍！' },
  4: { res: 543, text: '呵呵呵∼天官賜福好運到\n\n我保佑你福星高照\n\n投資加倍順利、買地不用錢。' },
  5: { res: 544, text: '噎噎噎∼賠錢！賠錢！' },
  6: { res: 545, text: '喔∼錢掉了。' },
  7: { res: 546, text: '有我小小衰神，害你一事無成。' },
  8: { res: 547, text: '哈哈哈！真是好衰啊！' },
  9: { res: 548, text: '哈雷路亞∼\n\n我將使您落腳的土地更加繁榮。' },
  10: { res: 549, text: '哈∼哈∼與我同生共死。\n\n我要沿路破壞你所經過的土地。' },
  12: { res: 550, text: '呵∼呵，有土斯有財\n\n我就是土地公公。\n\n有我在，你想要多少土地就有多少。' },
  15: { res: 551, text: '嘿嘿嘿嘿﹒﹒你慘了！\n\n被我盯上，你完蛋了。' },
};
const BAD_GODS = new Set([5, 6, 7, 8, 15]);

/** Face of the card user's line `card_strings[c][0][id − 1]` (11 §5.1); cards not listed use 0. */
const CARD_FACE: Record<number, number> = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 3, 7: 3, 8: 3, 9: 3, 13: 3, 14: 3, 15: 3, 16: 3, 17: 3, 29: 3, 30: 3 };
/**
 * Cards whose user line comes with their own map event (target known there): 3 only once the purchase goes
 * through, 4 / 5 only for a swap in the user's favour (docs/rules/15 §2).
 */
const CARD_OWN_EVENT = new Set([3, 4, 5, 6, 9, 10, 11, 12, 14, 15, 22, 23, 30]);
/** fx kind → card id for the target cards (user line, then the target's line card_strings[t][2][id − 1]). */
const TARGET_CARD: Record<string, number> = { 'turn-around': 6, stay: 14, sleepwalk: 16, turtle: 30 };

/** News with a clip on the map (rich4_news.asm, 11 §5.3): id → [clip, redraw frame]. */
const NEWS_CLIP: Record<number, [number, number]> = { 4: [531, 24], 5: [539, 32], 15: [527, 5], 20: [534, 8], 21: [535, 8] };
/** Their sounds (rich4_news.asm `fcn_0045144f(…, sound)`). */
const NEWS_SOUND: Record<number, number> = { 4: Sfx.alienAttack, 5: Sfx.alienMonster, 15: Sfx.gas, 20: Sfx.typhoon, 21: Sfx.tornado };
/** Objects placed by tools land with their sound (tool_luzhang/dilei/dingshizhadan.asm): 16 roadblock, 17 mine, 18 bomb. */
const PLACE_SOUND: Record<number, number> = { 16: Sfx.roadblock, 17: Sfx.mine, 18: Sfx.dice };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** The middle of some spots (their bounding box's centre). */
const middle = (pts: Pt[]): Pt => {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
};
/** Event results about everyone at once (the market, the bank): the camera stays; nobody is visited. */
const GLOBAL_FX = new Set(['bank-stop', 'stock-up', 'stock-down', 'stock-halt', 'stock-resume', 'company-up', 'company-down']);

/**
 * Clips an fx plays, asked for as soon as the fx comes in: the user's line (and any clip still running) comes
 * first, so the frames are decoded by the time they play instead of loading in the middle of it.
 */
const FX_CLIPS: Record<string, number[]> = {
  'robot-worker': [553], 'free-upgrade': [553], missile: [528], nuke: [530], monster: [557], demolish: [529],
  'to-hospital': [524], 'to-prison': [538], abroad: [558], alien: [533], reappear: [558, 533], mine: [525], 'bomb-explode': [525], dog: [532],
};

export class MapDirector {
  /** Where the robot doll stepped from (its knock-away direction). */
  private dollFrom = 0;
  /** A clip still running after the controller went on (the rules apply its damage meanwhile). */
  private pending: Promise<void> = Promise.resolve();
  /** Engine lines replaced by the original's own (said once, then dropped). */
  private drop: string[] = [];
  /** The last line said: the original never says the same line twice in a row (rich4.asm:23542). */
  private last = new LastLine();
  private angelTop = false;
  /** A news or fate board was shown and its result box has not come yet. */
  private eventOpen = false;

  constructor(private game: Game, private view: BoardView, private hud: Hud) {
    // Idle time after the map is up: the fireworks' glow dots (any lot reaching level 5, the robot worker's last
    // floor, the angel) are painted once, so the first show starts at once (fireworks.ts; no clip to decode).
    setTimeout(warmFireworks, 2500);
  }

  private get pi() { return this.game.priceIndex; }
  private player(p?: number): Player | undefined { return p !== undefined && this.game.isPlayerId(p) ? this.game.players[p] : undefined; }
  private rand2() { return Math.random() < 0.5; }

  /** The watchdog's dump. */
  debugState() { return { eventOpen: this.eventOpen, drop: this.drop.length }; }

  /** Waits for a detached clip before anything else is shown. */
  idle(): Promise<void> { return this.pending; }

  private pos(id: number): Pt {
    const a = this.view.actorAt(id);
    if (a && (a.x || a.y)) return { x: a.x, y: a.y };
    const p = this.player(id);
    const n = p?.node ? this.game.node(p.node) : null;
    return n ? { x: n.x, y: n.y } : { x: worldSize(this.game.board) / 2, y: worldSize(this.game.board) / 2 };
  }

  /**
   * Where player `id` is for the camera (docs/rules/11 §7.1): where they are drawn, or — out of sight in the
   * hospital, the prison or a hotel — their square; null when they are not on this map (abroad, another city, out).
   */
  private where(id: number): Pt | null {
    const p = this.player(id), g = this.game;
    if (!p || !p.placed || (!p.whoPlays && !p.bankrupt) || p.vanish || !g.here(p)) return null;
    const a = this.view.actorAt(id);
    if (a?.visible && (a.x || a.y)) return { x: a.x, y: a.y };
    const n = p.node ? g.node(p.node) : null;
    return n ? { x: n.x, y: n.y } : null;
  }

  /** The spots of lots / facilities (refs), those that exist. */
  private spots(refs: number[]): Pt[] {
    return refs.map(r => this.view.lotPos(r)).filter((x): x is Pt => !!x);
  }

  /** The camera on the lots `refs` (ringed until `view.unmark()`), framed or visited (BoardView.showSpots). */
  private async showLots(refs: number[]) {
    const v = this.view;
    for (const r of refs) v.marks.add(r);
    await v.showSpots(this.spots(refs));
  }

  // ---------------------------------------------------------------- lines

  /**
   * `_rich4_player_say(p, face, text)`: the camera goes to the speaker (unless `stay`), the cloud with the
   * expression face shows for 1000 ms (a tap ends it). Nobody speaks while abroad, sleepwalking or hibernating.
   */
  async line(id: number | undefined, face: number, text: string | null | undefined, stay = false, force = false, spot?: Pt, voice?: number, occasion?: string) {
    const p = this.player(id);
    if (!p || !text || !p.whoPlays && !p.bankrupt) return;
    if (!force && (p.vanish || p.sleepwalk || p.sleep)) return;
    const v = voice ?? characterVoice(p.character, text);
    if (!this.last.take(p.character, text, v)) return;
    const at = spot ?? this.pos(p.id);
    if (!stay) await this.view.panTo(at.x, at.y);
    // 激情歲月 (docs/rules/24 §7): a quotation first in the same cloud, the line 0.6 s later (× the game speed).
    const quote = occasion && jqRules(this.game) && quotesMode() === 0 ? pickQuote(p.character, occasion) : undefined;
    const lead = quote ? Math.round(QUOTE_LEAD * Math.max(0.5, this.hud.scale())) : 0;
    if (quote) this.hud.note(`${playerName(p)}：毛主席教導我們：${quote}`);
    // The line's voice ('#NNNN'): the cloud stays while it is spoken, at least 1000 ms (fcn_004544f6(1000)); a
    // tap ends both.
    if (lead) setTimeout(() => void audio.voice(v), lead); else void audio.voice(v);
    const ms = lead + Math.max(1000, v !== undefined ? audio.length('voice', v) * 1000 + 80 : 0);
    await this.view.fx.cloud(() => spot ?? this.pos(p.id), p.character, face, text, ms, end => this.view.fx.onTap(() => { audio.stopVoice(); end(); }), quote, lead);
    if (!stay) this.view.refollow();
  }

  private ev(id: number | undefined, slot: number, face: number, stay = false, force = false) {
    const p = this.player(id);
    return p ? this.line(id, face, EVENT_LINES[p.character]?.[slot], stay, force, undefined, EVENT_VOICE[p.character]?.[slot], eventOccasion(slot)) : Promise.resolve();
  }
  private tool(id: number | undefined, slot: number, face: number) {
    const p = this.player(id);
    return p ? this.line(id, face, TOOL_LINES[p.character]?.[slot], false, false, undefined, TOOL_VOICE[p.character]?.[slot], 'tool') : Promise.resolve();
  }
  private card(id: number | undefined, k: number, face: number) {
    const p = this.player(id);
    return p ? this.line(id, face, CARD_LINES[p.character]?.[k], false, false, undefined, CARD_VOICE[p.character]?.[k], 'card') : Promise.resolve();
  }
  /** A card line by role (0 user, 1 on oneself, 2 the one it hit) with the original's face (reactions.ts). */
  private cardRole(id: number | undefined, card: number, role: 0 | 1 | 2) {
    return this.card(id, cardLineIndex(card, role), cardFace(card, role));
  }

  /** The remake's result box for a card (screens/card-result.ts), with the map effect for red / black cards. */
  private async cardResult(s: Fx) {
    const box = cardBox(this.game, s);
    if (!box) return;
    this.hud.note(box.head);
    const v = this.view, about = s.target !== undefined && this.player(s.target) ? s.target : s.p;
    const stock = s.kind === 'stock-up' || s.kind === 'stock-down';
    const holders = stock ? ((s.data?.holders as [number, number][]) ?? []).map(h => h[0]).filter(id => v.actorAt(id)?.visible) : [];
    await Promise.all([
      resultBox(this.hud.context(this.hud.area), box, () => {
        if (about === undefined || stock) return null;
        const p = this.pos(about), q = v.project(p.x, p.y), c = v.canvas.getBoundingClientRect(), area = this.hud.area.getBoundingClientRect();
        return q.y + c.top - area.top;
      }),
      stock ? playEventFx(v, s.kind, { players: holders, actor: s.p }) : Promise.resolve(),
    ]);
  }

  /** `fcn_0044f230`: a gift / card worth v points. */
  private gotItem(id: number, v: number) {
    if (v > 100) return this.ev(id, 0, Face.normal);
    if (v > 50) return this.ev(id, this.rand2() ? 0 : 1, Face.normal);
    if (v > 0) return this.ev(id, 2, Face.normal);
  }
  /** `fcn_0044f2c2`: hospital / prison / abroad for n days. */
  private badDays(id: number, days: number, force = false) {
    return this.ev(id, days > 6 ? 3 : days > 3 ? (this.rand2() ? 3 : 4) : 5, Face.cry, false, force);
  }

  // ---------------------------------------------------------------- clips

  /**
   * A 440×440 clip centred on a spot (`fcn_0041d476` then `fcn_0045144f(flc, 0, 40, flags)`). `bake` = the
   * flags' redraw frame (1-based): the lots keep their old look until then. `detach`: resolve at that frame and
   * let the rest play while the rules go on (for events announced before the rules change the board).
   */
  private async clipAt(res: number, at: Pt | (() => Pt), o: { bake?: number; detach?: boolean; hold?: number; caption?: string; at?: Record<number, () => void>; origin?: [number, number]; offset?: [number, number]; pan?: boolean; sound?: number; stay?: boolean } = {}) {
    const p = typeof at === 'function' ? at() : at;
    if (o.pan !== false) await this.view.panTo(p.x, p.y);
    const bake = o.bake ?? 0;
    if (bake && !o.detach) this.view.freezeLots();
    let reached!: () => void;
    const atBake = new Promise<void>(r => { reached = r; });
    const frames: Record<number, () => void> = { ...o.at };
    // `fcn_0045144f(…, sound)`: the clip's sound starts once its first frame is drawn.
    if (o.sound !== undefined) { const first = frames[0], id = o.sound; frames[0] = () => { audio.sfx(id); first?.(); }; }
    const prev = frames[Math.max(0, bake - 1)];
    frames[Math.max(0, bake - 1)] = () => { prev?.(); this.view.thawLots(); reached(); };
    const done = this.view.fx.clip(res, at, { at: frames, hold: o.hold, caption: o.caption, skippable: !!o.caption, origin: o.origin, offset: o.offset });
    if (o.detach) {
      this.pending = done.then(() => this.view.refollow());
      await Promise.race([atBake, done]);
      return;
    }
    await done;
    this.view.thawLots();
    if (!o.stay) this.view.refollow();
  }

  /**
   * Fireworks when a house reaches level 5 (`fcn_0040b0cd`: the clip Data#523, 66 × 42 ms, centred on the lot).
   * Drawn in code (fireworks.ts) for the same time, with the clip's sound from its first frame; the camera goes
   * to the lot first and back to the player after, as for the clip.
   */
  private async fireworks(at: Pt) {
    await this.view.panTo(at.x, at.y);
    await this.view.fx.fireworks(at, () => { audio.sfx(Sfx.fireworks); this.view.thawLots(); });
    this.view.thawLots();
    this.view.refollow();
  }

  // ---------------------------------------------------------------- events

  /** The doll's last step (its knock-away direction). */
  actorStep(s: Extract<GameEvent, { t: 'actor-step' }>) { if (s.actor === this.game.dollId) this.dollFrom = s.from; }

  /** Game start: the parachute Data#(559 + character) over the landing node (`fcn_00418c55`). */
  async airdrop(s: Extract<GameEvent, { t: 'airdrop' }>) {
    const p = this.player(s.p), n = this.game.node(s.node);
    if (!p) return;
    this.view.hide(p.id);
    await this.clipAt(559 + p.character, { x: n.x, y: n.y });
  }

  /** Buying a lot: a third lot of the same street (`fcn_0044f627(name, 0)`). */
  async buy(s: Extract<GameEvent, { t: 'buy' }>) {
    await this.idle();
    if (s.kind !== 'land') return;
    const l = this.game.board.lands[s.id - 1];
    if (this.game.board.lands.filter(x => x.name === l.name && x.owner === s.p + 1).length >= 3) await this.ev(s.p, 16, Face.normal);
  }

  /**
   * Building on one's own land: level 5 → line 15 and fireworks; else 1 in 3 for a street of three. A large plot's
   * facility reaching level 5 tops out the same way (02 §4.2 「到 5 级播放封顶动画」: every facility, 研究所 too).
   */
  async build(s: Extract<GameEvent, { t: 'build' }>) {
    await this.idle();
    if (s.kind === 'facility') {
      const f = this.game.board.facilities[s.id - 1];
      if (f && s.level >= 5) { await this.ev(s.p, 15, Face.normal); await this.fireworks({ x: f.x, y: f.y }); }
      return;
    }
    if (s.kind !== 'land') return;
    const l = this.game.board.lands[s.id - 1];
    if (s.level >= 5) {
      await this.ev(s.p, 15, Face.normal);
      await this.fireworks({ x: l.x, y: l.y });
    } else if (this.game.board.lands.filter(x => x.name === l.name && x.owner === s.p + 1).length >= 3 && Math.random() < 1 / 3) {
      await this.ev(s.p, 17, Face.normal);
    }
  }

  /**
   * Paying (rent: core_actions:491-966): the payer's line (18 at a hated owner for big sums, else 9/10/11),
   * then the owner's (6/7/8, nothing under 2000 × price index). Called after the message box.
   */
  async pay(s: Extract<GameEvent, { t: 'pay' }>) {
    await this.idle();
    // News and fate money moves without a word; their result box plays the original's line afterwards.
    if (s.quiet) return;
    const from = this.player(s.from), to = this.player(s.to), pi = this.pi, a = s.amount;
    // Tolls and the fees of another player's hotel, mall or gas station: payer and owner; a company's fee: the
    // payer only when it is the player on the square (docs/rules/15 §3).
    const kind = payReaction({ reason: s.reason, quiet: s.quiet, fromPlayer: !!from, toPlayer: !!to, toCompany: s.to >= 100, fromCurrent: s.from === this.game.current });
    if (kind === 'toll' && from && to) {
      const hated = from.hostility.indexOf(Math.max(...from.hostility));
      if (hated === to.id && a >= 5000 * pi && this.rand2()) await this.ev(from.id, 18, Face.frown);
      else await this.ev(from.id, a >= 9000 * pi ? 9 : a >= 5000 * pi ? (this.rand2() ? 9 : 10) : 11, Face.cry);
    } else if (kind === 'paid' && from && a > 0) {
      await this.ev(from.id, a >= 9000 * pi ? 9 : a >= 5000 * pi ? (this.rand2() ? 9 : 10) : 11, Face.cry);
    }
    if (to && (kind === 'toll' || !from) && a >= 2000 * pi) {
      await this.ev(to.id, a >= 9000 * pi ? 6 : a >= 5000 * pi ? (this.rand2() ? 6 : 7) : 8, Face.laugh);
    }
  }

  /**
   * Points. A points square (+50/+30/+10, core_actions:2388-2499): the ticket Data#537 flips over the head, the
   * message box says how many, then the line (slot 0/1, 2, none). Other points changes have no map effect.
   */
  async points(s: Extract<GameEvent, { t: 'points' }>): Promise<boolean> {
    await this.idle();
    const p = this.player(s.p);
    if (!p) return false;
    if (this.chest === p.id) { this.chest = -1; return true; }
    const n = this.game.node(p.node);
    const tile = n && n.event >= 10 && n.event <= 12 && s.amount === [50, 30, 10][n.event - 10];
    if (!tile) return false;
    await this.flipOverHead(537, p.id);
    await this.hud.flash(`得點券${String(s.amount).replace(/\d/g, d => '０１２３４５６７８９'[Number(d)])}點`, 1000);
    if (s.amount === 50) await this.ev(p.id, this.rand2() ? 0 : 1, Face.normal);
    else if (s.amount === 30) await this.ev(p.id, 2, Face.normal);
    return true;
  }
  private chest = -1;

  /** The 28×40 flips over the head (Data#536 card '?', #537 points ticket): screen (204|208, 180), view centre (220, 260). */
  private flipOverHead(res: number, id: number) {
    const at = this.pos(id);
    return this.view.fx.clip(res, at, { origin: [0, 0], offset: [res === 537 ? -16 : -12, -80], grow: 1.5, at: { 0: () => audio.sfx(res === 537 ? Sfx.couponFlip : Sfx.cardFlip) } });
  }

  /** A player's line from the rules. Returns true when shown here (the original's cloud on the map). */
  async say(s: Extract<GameEvent, { t: 'say' }>): Promise<boolean> {
    await this.idle();
    const i = this.drop.findIndex(t => s.text === t || s.text.startsWith(t));
    if (i >= 0) { this.drop.splice(i, 1); return true; }
    // A fee waived by the owner's state (_rich4_check_pay_toll_to_owner): the box 1500 ms, then the payer's
    // event[13] (face 3).
    if (s.p === undefined && isWaivedNotice(s.text)) {
      await this.hud.flash(s.text, 1500);
      await this.ev(this.game.current, 13, Face.laugh);
      return true;
    }
    const p = this.player(s.p);
    if (!p) return false;
    // A turn spent in prison or hospital (fcn_0040c912): on rand() & 1 the prisoner's / patient's event[19] /
    // [20] (face 2), then 「%s坐牢中\n\n還剩%d天！」 for 1500 ms.
    const stuck = parseStuck(s.text);
    if (stuck) {
      // The camera on them where they sit it out (docs/rules/11 §7.1): the hospital or the prison (shown there in
      // the gown / prison clothes while the notice is up), a hotel's square, a sleeper on the road.
      const v = this.view, at = this.where(p.id), inside = stuck.what === '住院中' || stuck.what === '坐牢中';
      if (at) {
        if (p.node) v.markNodes.add(p.node);
        if (inside && !v.actorAt(p.id)?.visible) { v.setPose(p.id, stuck.what === '住院中' ? 19 : 20); v.show(p.id); }
        await v.panTo(at.x, at.y);
      }
      const slot = stuckLament(stuck.what, this.rand2());
      if (slot !== null) await this.ev(p.id, slot, Face.cry, !!at);
      await this.hud.flash(`${stuck.name}${stuck.what}\n\n還剩${stuck.days}天！`, 1500);
      if (at) {
        v.unmark();
        if (inside && this.game.offRoad(p)) { v.show(p.id, false); v.setPose(p.id, null); }
      }
      return true;
    }
    // The card announcement already shows "使用X" (09 §7.2).
    if (/^使用.+卡$|^使用.+符$/.test(s.text)) return true;
    // Inside a news or fate entry the result box names who goes to hospital or prison.
    if (this.eventOpen && /住院\d+天|坐牢\d+天/.test(s.text)) return true;
    // Messages that are the original's message box, not a character's line: the god luck check
    // (fcn_0044b896 → fcn_00440cac(text, 1500), fortune.asm loc_0044ce35 …).
    if (/顯靈|住院\d+天|坐牢\d+天|保佑\n|作祟\n/.test(s.text)) { await this.hud.flash(s.text, 1500); return true; }
    if (p.vanish || p.sleepwalk || p.sleep || !this.view.actorAt(p.id)) return false;
    await this.line(p.id, Face.normal, s.text, false, false, undefined, characterVoice(p.character, s.text));
    return true;
  }

  async bankrupt(s: Extract<GameEvent, { t: 'bankrupt' }>) {
    await this.idle();
    // fcn_004549cf(2): MIDI03 while the bankruptcy shows (player_bankrupt.asm:216), Data#555 with Effect#100.
    audio.theme(Theme.bankrupt);
    await this.clipAt(555, this.pos(s.p), { sound: Sfx.bankrupt });
    await this.ev(s.p, 25, Face.cry);
    audio.restore();
  }

  async gameover(winner: number) { if (winner >= 0) await this.ev(winner, 24, Face.laugh); }

  /**
   * A player put somewhere else at once (傳送機, 拉客仔, a taxi, sent to the hospital …): the camera glides to the
   * square they land on, ringed (docs/rules/11 §7.1); the controller then goes back to the current player.
   */
  async teleported(id: number, node: number) {
    const n = this.game.node(node), at = this.where(id) ?? (n ? { x: n.x, y: n.y } : null);
    if (!at) return;
    this.view.markNodes.add(node);
    await this.view.panTo(at.x, at.y);
  }

  /** Before a screen of an fx about a place: the camera there (docs/rules/11 §7.1); `after` takes it back. */
  async locate(s: Fx) {
    await this.idle();
    // 歌舞伎町 (21 §4.1): the shop the 黑幫 smashes.
    if (s.kind === 'kb-smash' && typeof s.data?.ref === 'number') await this.showLots([s.data.ref]);
    // 歌舞伎町 (21 §2.2): the shop's owner, wherever they are, now 處理事務中.
    if (s.kind === 'kb-busy' && !s.data?.sitting && s.p !== undefined && s.p !== this.game.current) {
      const at = this.where(s.p), q = this.player(s.p);
      if (at && q) { this.view.markNodes.add(q.node); await this.view.panTo(at.x, at.y); }
    }
  }

  /**
   * 魔法屋 (06 §5): the spell falls on its targets next, wherever they are. A spell that shows on the map (stay,
   * a floor more, turned round, a floor less, their lot auctioned) takes the camera to each target first, their lot
   * ringed; the spell's own steps follow (sent to the hospital / prison and fate move the camera themselves).
   */
  private async magicTargets(s: Fx) {
    const e = Number(s.data?.magic), v = this.view, g = this.game;
    if (![3, 5, 7, 9, 11].includes(e)) return;
    const ids = (Array.isArray(s.data?.targets) ? (s.data.targets as number[]) : []).filter(id => this.where(id));
    if (!ids.length || (ids.length === 1 && ids[0] === s.p)) return;
    v.unmark();
    const pts: Pt[] = [];
    for (const id of [...ids].sort((a, b) => a - b)) {
      const q = this.player(id)!, n = g.node(q.node), lot = n && e !== 3 && e !== 7 ? v.lotPos(n.ref) : null;
      if (lot && (e === 5 || e === 9 || e === 11)) v.marks.add(n!.ref);
      else if (q.node) v.markNodes.add(q.node);
      pts.push(this.where(id)!);
    }
    const refs = [...v.marks], nodes = [...v.markNodes];
    await v.showSpots(pts);
    await sleep(500 * v.pace);
    // The rings stay while the spell's steps play (the next turn clears them at the latest).
    setTimeout(() => { for (const r of refs) v.marks.delete(r); for (const n of nodes) v.markNodes.delete(n); }, 2500 * v.pace);
  }

  /** Called after a registered screen showed an fx (card announcement, news, fate). */
  async after(s: Fx) {
    await this.idle();
    if (s.kind === 'kb-smash' || (s.kind === 'kb-busy' && !s.data?.sitting)) { await sleep(500 * this.view.pace); this.view.unmark(); this.view.refollow(); return; }
    if (s.kind === 'magic') { await this.magicTargets(s); return; }
    if (s.kind === 'card') {
      const id = Number(s.data?.card);
      if (id && !CARD_OWN_EVENT.has(id)) await this.card(s.p, id - 1, CARD_FACE[id] ?? 0);
      return;
    }
    if (s.kind === 'news' || s.kind === 'fate') this.eventOpen = true;
    if (s.kind === 'news') {
      const id = Number(s.data?.id), node = s.node ? this.game.node(s.node) : null;
      const ref = node?.ref ?? 0, at = this.view.lotPos(ref) ?? (node ? { x: node.x, y: node.y } : null);
      if (!at) return;
      const clip = NEWS_CLIP[id];
      if (clip) {
        // The whole clip plays with the camera on it (it used to hand back at its redraw frame, so the camera
        // left for the player after a moment); the rules lower the building right after. The owner's cry
        // (event[3 | 4] after 300 ms) comes after the result box, so the camera stays on the spot until then.
        await this.clipAt(clip[0], at, { bake: clip[1], sound: NEWS_SOUND[id], stay: true });
      } else if (id === 6 || id === 14 || id === 18 || id === 19) {
        // The whole street (land prices, the earthquake) is framed, or visited when it is longer than the screen.
        await this.showLots(this.street(ref));
        await this.view.flashLots(this.street(ref));
      }
      // The camera stays on the spot for the result box (event-result), which goes back to the player.
    }
  }

  private lotOwner(ref: number): number {
    const b = this.game.board;
    const l = ref > 2000 && ref < 4000 ? b.lands[ref - 2001] : ref > 4000 && ref < 6000 ? b.facilities[ref - 4001] : undefined;
    return l?.owner ? l.owner - 1 : -1;
  }
  private street(ref: number): number[] {
    const b = this.game.board;
    if (ref > 2000 && ref < 4000) { const name = b.lands[ref - 2001].name; return b.lands.filter(l => l.name === name).map(l => l.id + 2000); }
    return [ref];
  }

  /** Map effects of `fx` events. Returns true when it took the time the original takes (no extra pause). */
  async fx(s: Fx): Promise<boolean> {
    const pre = s.kind === 'god-attach' ? [GOD_CLIP[Number(s.data?.type)]?.res].filter((r): r is number => !!r)
      : FX_CLIPS[s.kind] ?? [];
    if (pre?.length) void preloadClips(this.view.bank, pre);
    await this.idle();
    const v = this.view, p = this.player(s.p);
    switch (s.kind) {
      // ---- robot doll (05 §3.1, 11 §2.1)
      case 'robot-doll': await this.tool(s.p, 0, Face.normal); return false;
      case 'doll-clear': if (s.node) v.knockAway(s.node, this.dollFrom); return true;
      case 'robot-doll-end': {
        // The doll's turn waits until nothing is flying any more (fcn_0040fad6).
        const t0 = performance.now();
        while (v.fx.busy && performance.now() - t0 < 4000) await sleep(50);
        return false;
      }

      // ---- placing, stepping on objects
      case 'place-object': {
        const type = Number(s.data?.type), node = s.node ? this.game.node(s.node) : null;
        if (!p || !node) return false;
        v.hiddenObjects.add(node.id);
        await this.tool(p.id, type - 15, Face.normal);
        const o = (this.game.objects.slots as { type: number; node: number; dir: number }[]).find(x => x.node === node.id && x.type === type);
        await v.fx.glide({ res: 395 + type, dir: o?.dir ?? 0, from: this.pos(p.id), to: { x: node.x, y: node.y }, wait: 100 });
        audio.sfx(PLACE_SOUND[type] ?? -1);
        v.hiddenObjects.delete(node.id);
        return true;
      }
      case 'roadblock':
        if (!p) return false;
        this.drop.push('前有路障，停止前進！');
        await this.tool(p.id, 14, Face.frown);
        return true;
      case 'mine': case 'bomb-explode': {
        if (!p) { if (s.node) { const n = this.game.node(s.node); await this.clipAt(525, { x: n.x, y: n.y }, { bake: 3, sound: Sfx.smallBlast }); } return true; }
        v.setPose(p.id, 18);
        await this.clipAt(525, this.pos(p.id), { bake: 3, sound: Sfx.smallBlast });
        if (s.kind === 'mine') await this.tool(p.id, 15, Face.frown);
        return true;
      }
      case 'bomb-pickup': await this.tool(s.p, 16, Face.cry); return true;
      case 'dog': {
        if (!p) { if (s.node) { const n = this.game.node(s.node); await this.clipAt(532, { x: n.x, y: n.y }, { bake: 3, sound: Sfx.dogFight }); } return true; }
        if (s.data?.riding) { await this.clipAt(552, this.pos(p.id), { bake: 1, sound: Sfx.dogBike }); return true; }
        v.setPose(p.id, 18);
        await this.clipAt(532, this.pos(p.id), { bake: 3, sound: Sfx.dogFight });
        return true;
      }
      case 'gift': {
        if (!p) return false;
        const t = Number(s.data?.tool);
        audio.sfx(Sfx.gift);
        // 「得到%s！」 with the tool flipping in (the original shows the message box only).
        await toolScene(this.hud.context(this.hud.area), t, p.id, 'get');
        await this.gotItem(p.id, TOOLS[t - 1]?.price ?? 0);
        return true;
      }
      case 'toll-street': {
        // Linked lots of the street flash before the toll (fcn_00451985: 16 × 30 ms + 400 ms).
        const refs = Array.isArray(s.data?.refs) ? (s.data.refs as number[]) : [];
        if (refs.length > 1) await v.flashLots(refs);
        return true;
      }
      case 'tool-received': {
        // The shop owner's gift (rich4_shop.asm:1898-1971): 「歡迎董事長光臨　送您%s！」 1500 ms, then the line.
        if (!p) return false;
        const t = Number(s.data?.tool);
        audio.sfx(Sfx.gift);
        await toolScene(this.hud.context(this.hud.area), t, p.id, s.data?.chairman ? 'chairman' : 'get');
        await this.gotItem(p.id, TOOLS[t - 1]?.price ?? 0);
        return true;
      }
      case 'mini-game': {
        // A mini game nobody plays (a computer, autopilot, 動畫過程 off; small_games.asm loc_00415457): the message
        // box 「得點券%d點」 for 2000 ms, then line 0 or 1 by rand() & 1.
        if (!p || typeof s.data?.points !== 'number') return false;
        await this.hud.flash(`得點券${s.data.points}點`, 2000);
        await this.ev(p.id, this.rand2() ? 0 : 1, Face.normal);
        return true;
      }
      case 'chest':
        if (!p) return false;
        this.chest = p.id;
        this.drop.push('得到５００點券！');
        audio.sfx(Sfx.chest);
        await this.hud.flash('得到５００點券！', 1500);
        await this.ev(p.id, 0, Face.normal);
        return true;
      case 'card-received': {
        if (!p) return false;
        const id = Number(s.data?.card), n = this.game.node(p.node), chairman = !!s.data?.chairman;
        // The card square flips a '?' over the head first (core_actions:2501-2546).
        if (!chairman && n?.event === 13) await this.flipOverHead(536, p.id);
        // 「得到%s！」 / the shop owner's 「歡迎董事長光臨　送您%s！」 with the card itself flipping in (the original shows
        // the message box only).
        await cardScene(this.hud.context(this.hud.area), id, p.id, chairman ? 'chairman' : 'get');
        await this.gotItem(p.id, cardDef(id)?.price ?? 0);
        return true;
      }

      // ---- gods (rich4_gods.asm, 11 §3)
      case 'god-attach': {
        if (!p) return false;
        const type = Number(s.data?.type), clip = GOD_CLIP[type];
        this.drop.push(`${'小財神,大財神,小福神,大福神,小窮神,大窮神,小衰神,大衰神,天使,惡魔,惡犬,土地公,禮物,寶箱,死神'.split(',')[type - 1]}附身`);
        if (BAD_GODS.has(type)) await this.ev(p.id, 22, Face.cry, true);
        if (clip) await this.clipAt(clip.res, this.pos(p.id), { hold: 2400, caption: clip.text, sound: GOD_SOUND[type] });
        return true;
      }
      // The wealth gods' lines after the slot machine: [8] over 700 (小財神), [6] / [7] from 5000 × F (大財神, fcn_0044f354).
      case 'god-line': await this.ev(s.p, Number(s.data?.line), Face.laugh); return true;
      case 'god-detach': {
        if (!p) return false;
        const type = Number(s.data?.type), att = v.attachedAt(p.id);
        if (att) {
          await v.panTo(att.at.x, att.at.y);
          audio.sfx(Sfx.godLeaves);
          await v.fx.rise({ res: 395 + type, frame: att.frame, at: att.at, screenOffset: att.offset });
        }
        if (BAD_GODS.has(type)) { this.drop.push('離開了'); await this.ev(p.id, 23, Face.cry); }
        v.refollow();
        return true;
      }
      case 'god-fly': {
        if (!p || !s.node) return false;
        const n = this.game.node(s.node), o = (this.game.objects.slots as { type: number; node: number; dir: number }[]).find(x => x.node === s.node);
        await this.card(p.id, 22, Face.normal);
        v.hiddenObjects.add(n.id);
        await v.fx.glide({ res: 395 + Number(s.data?.type), dir: o?.dir ?? 0, from: { x: n.x, y: n.y }, to: () => this.pos(p.id) });
        v.hiddenObjects.delete(n.id);
        return true;
      }
      case 'send-god': await this.card(s.p, 21, Face.normal); return true;
      case 'angel-top': this.angelTop = true; return true;
      case 'angel': {
        if (!p) return false;
        const ref = Number(s.data?.ref), at = v.lotPos(ref);
        if (s.node) {
          // The angel god on one's own landing (fcn_0040f381): message box, the floor, fireworks at level 5.
          await this.hud.flash('天使顯靈\n\n加蓋一層房屋！', 1500);
          audio.sfx(Sfx.build); // the new floor (gods.asm:1295)
          if (Number(s.data?.level) >= 5 && at) await this.fireworks(at);
          return true;
        }
        // 天使卡: line, the street flashes (old look), then the new floors; fireworks when one reached 5.
        await this.card(p.id, 8, Face.laugh);
        if (at && !this.game.isHuman(p)) await v.fx.glide({ res: 415, frame: 0, from: this.pos(p.id), to: at, wait: 100 });
        v.freezeLots();
        await this.showLots(this.street(ref));
        await v.flashLots(this.street(ref));
        v.thawLots();
        if (this.angelTop && at) await this.fireworks(at);
        this.angelTop = false;
        await this.cardResult(s);
        v.unmark();
        return true;
      }
      case 'devil': {
        if (!p) return false;
        const ref = Number(s.data?.ref), at = v.lotPos(ref);
        if (s.node) {
          // The devil god: message box, then the dust Data#526 on the building (flags 0x30001).
          await this.hud.flash('小惡魔顯靈\n\n拆毀一層房屋！', 1500);
          if (at) {
            v.freezeLots();
            await v.fx.clip(526, at, { at: { 0: () => audio.sfx(Sfx.devilDust), 2: () => v.thawLots() } });
            v.thawLots();
          }
          return true;
        }
        await this.card(p.id, 9, Face.normal);
        if (at && !this.game.isHuman(p)) await v.fx.glide({ res: 415, frame: 0, from: this.pos(p.id), to: at, wait: 100 });
        v.freezeLots();
        await this.showLots(this.street(ref));
        await v.flashLots(this.street(ref));
        v.thawLots();
        await this.cardResult(s);
        v.unmark();
        return true;
      }
      case 'blessing': {
        // A fortune god's free floor (core_actions:477): box, then line 15 + fireworks at level 5, else 0/1.
        if (!p) return false;
        const ref = Number(s.data?.ref), at = v.lotPos(ref), name = this.game.objects.godType(p) === 4 ? '大福神' : '小福神';
        await this.hud.flash(`${name}顯靈\n\n加蓋一層房屋！`, 1500);
        audio.sfx(Sfx.build);
        if (Number(s.data?.level) >= 5) {
          await this.ev(p.id, 15, Face.normal);
          if (at) await this.fireworks(at);
        } else await this.ev(p.id, this.rand2() ? 0 : 1, Face.normal);
        return true;
      }
      case 'earth-god':
        if (!p) return false;
        await this.hud.flash('土地公顯靈\n\n強佔土地！', 1500);
        await this.ev(p.id, 0, Face.normal);
        return true;
      case 'monster': case 'demolish': {
        if (!p) return false;
        const ref = Number(s.data?.ref), at = v.lotPos(ref), owner = this.lotOwner(ref);
        if (s.kind === 'demolish' && s.node) return this.demolishByCar(p, ref);
        const monster = s.kind === 'monster';
        if (at && !this.game.isHuman(p)) {
          v.freezeLots();
          await this.card(p.id, monster ? 10 : 11, Face.normal);
          await v.fx.glide({ res: 415, frame: 0, from: this.pos(p.id), to: at, wait: 100 });
        } else {
          v.freezeLots();
          await this.card(p.id, monster ? 10 : 11, Face.normal);
        }
        if (at) await this.clipAt(monster ? 557 : 529, at, { bake: monster ? 16 : 38, sound: monster ? Sfx.monsterCard : Sfx.demolishCard });
        v.thawLots();
        await sleep(500);
        if (owner >= 0 && owner !== p.id) await this.card(owner, monster ? 70 : 71, Face.frown);
        await this.cardResult(s);
        return true;
      }
      case 'demolish-object': {
        if (!p || !s.node) return false;
        await this.card(p.id, 11, Face.normal);
        const n = this.game.node(s.node);
        if (!this.game.isHuman(p)) await v.fx.glide({ res: 415, frame: 0, from: this.pos(p.id), to: { x: n.x, y: n.y }, wait: 100 });
        return true;
      }

      // ---- tools (11 §2)
      case 'missile': case 'nuke': {
        if (!p) return false;
        const at = { x: Number(s.data?.x), y: Number(s.data?.y) }, nuke = s.kind === 'nuke';
        await this.tool(p.id, nuke ? 12 : 6, Face.normal);
        // Announced before the blast is applied: the hits show from frame 9.
        await this.clipAt(nuke ? 530 : 528, at, { bake: 9, detach: true, sound: nuke ? Sfx.nuke : Sfx.missile });
        if (nuke) void this.whiteFlash();
        return true;
      }
      case 'robot-worker': {
        if (!p) return false;
        const ref = Number(s.data?.ref), at = v.lotPos(ref);
        if (!at) return false;
        v.freezeLots();
        await this.tool(p.id, 8, Face.normal);
        await this.clipAt(553, at, { bake: 44, sound: Sfx.robot });
        if (s.data?.done) await this.fireworks(at);
        return true;
      }
      case 'construction': await this.tool(s.p, 11, Face.normal); return false;
      case 'scooter': await this.tool(s.p, 4, Face.normal); return false;
      case 'car': await this.tool(s.p, 5, Face.normal); return false;
      // The time machine also gives back a day of holiday music (tool_shiguangji.asm:40-56).
      case 'time-machine': audio.undoDay(); await this.tool(s.p, 9, Face.normal); return false;
      case 'remote-dice': if (p && this.game.isHuman(p)) await this.tool(s.p, 7, Face.normal); return false;

      // ---- card targets
      case 'turn-around': case 'stay': case 'sleepwalk': case 'turtle': {
        const id = TARGET_CARD[s.kind];
        if (s.kind === 'turn-around') { audio.sfx(Sfx.turn); v.syncAll(); } // _rich4_change_player_direction (rich4.asm:6425): turns at once
        if (s.target === undefined || !p) return false;
        const self = s.target === p.id;
        if (s.kind === 'sleepwalk') {
          // The user's line came with the card (after()); a revenge sleepwalk has no line of its own.
          // rich4_card_mengyouka.asm says event[21] (face 1) before the sleepwalk days are set, so it is heard.
          if (!s.data?.revenge) await this.ev(s.target, 21, Face.frown, false, true);
          return true;
        }
        // zhuanxiangka.c / tingliuka / wuguika.asm: the user's card[0] (face 3), then card[1] on oneself or the
        // target's card[2] (face 2).
        await this.cardRole(p.id, id, 0);
        await this.cardRole(s.target, id, self ? 1 : 2);
        return true;
      }
      case 'hibernate': await this.card(s.p, 14, Face.laugh); await this.cardResult(s); return true;

      // ---- lines and results of the other cards (docs/rules/15 §2)
      case 'card-line': await this.cardRole(s.p, Number(s.data?.card), Number(s.data?.role) as 0 | 1 | 2); return true;
      case 'card-result': {
        const card = Number(s.data?.card);
        // 查稅卡: the box (「抽取%s\n\n%d元稅金！」 in the original) comes before the payer's line.
        if (card === 26) { await this.cardResult(s); await this.cardRole(s.target, card, 2); return true; }
        if (s.target !== undefined && s.target !== s.p) await this.cardRole(s.target, card, 2);
        await this.cardResult(s);
        return true;
      }
      case 'swap-land': case 'swap-house': {
        if (!p) return false;
        const a = Number(s.data?.a), b = Number(s.data?.b), card = s.kind === 'swap-land' ? 4 : 5;
        const r = swapReaction(p.id, s.data as unknown as SwapBefore);
        if (r.user) await this.cardRole(p.id, card, 0);
        // A computer's card flies to the other lot (huandika.asm: animate_object(0, user → B, 100)).
        const bAt = v.lotPos(b);
        if (bAt && !this.game.isHuman(p)) await v.fx.glide({ res: 415, frame: 0, from: this.pos(p.id), to: bAt, wait: 100 });
        // Both lots framed (or visited when far apart) and ringed while they flash.
        await this.showLots([a, b]);
        await v.flashLots([a, b]);
        await sleep(500);
        if (r.victim >= 0) await this.cardRole(r.victim, card, 2);
        v.unmark();
        v.refollow();
        await this.cardResult({ ...s, data: { ...s.data, card } });
        return true;
      }
      case 'stock-up': case 'stock-down':
        if (s.data?.card) await this.cardResult(s);
        return true;
      // A misfortune's line outside the result box (fate 32, a god's escape from fate 33..36).
      case 'lament': await this.ev(s.p, Number(s.data?.slot), Number(s.data?.face)); return true;
      // A card that cannot be used: the error sound, back to the cards (ui_use_card.asm:851).
      case 'card-failed': audio.ui('error'); return false;

      // ---- hospital, prison, abroad (11 §6)
      case 'to-hospital': case 'to-prison': {
        if (!p) return false;
        const days = Number(s.data?.days), hospital = s.kind === 'to-hospital';
        await this.badDays(p.id, days);
        if (!s.data?.fresh) return true;
        const here = this.pos(p.id);
        // The ambulance band Data#524 at screen (0, 210) / the police car Data#538 over the view.
        if (hospital) await this.clipAt(524, here, { origin: [220, 50], bake: 30, at: { 29: () => v.hide(p.id) }, sound: Sfx.ambulance });
        else await this.clipAt(538, here, { bake: 18, at: { 17: () => v.hide(p.id) }, sound: Sfx.police });
        const n = hospital ? this.game.hospitalNode() : this.game.prisonNode();
        if (n) {
          await v.panTo(n.x, n.y);
          await this.line(p.id, Face.cry, EVENT_LINES[p.character]?.[hospital ? 20 : 19], true, true, { x: n.x, y: n.y }, undefined, hospital ? 'hospital' : 'prison');
          v.refollow();
        }
        return true;
      }
      case 'leave-hospital': if (p) v.setPose(p.id, 19); return false;
      case 'leave-prison': if (p) v.setPose(p.id, 20); return false;
      case 'abroad': case 'alien': {
        if (!p) return false;
        const alien = s.kind === 'alien';
        const days = Number(s.data?.days) || 3;
        // The line comes while still on the road (the original sets the days after it).
        await this.badDays(p.id, days, true);
        v.show(p.id);
        await this.clipAt(alien ? 533 : 558, this.pos(p.id), { bake: alien ? 28 : 20, at: { [alien ? 27 : 19]: () => v.hide(p.id) }, sound: alien ? Sfx.ufo : Sfx.airplane });
        return true;
      }
      case 'reappear': {
        if (!p) return false;
        const alien = !!s.data?.alien;
        v.hide(p.id);
        await this.clipAt(alien ? 533 : 558, this.pos(p.id), { bake: alien ? 28 : 20, at: { [alien ? 27 : 19]: () => v.show(p.id) }, sound: alien ? Sfx.ufo : Sfx.airplane });
        return true;
      }

      // ---- hotel stay (core_actions:1564-1640, player_utils.asm fcn_0040d5a5 / fcn_0040d6be)
      case 'enter-hotel': {
        // The guest's bad-days line (fcn_0044f2c2), then they turn to the hotel and walk in (who_plays 0x20).
        if (!p) return false;
        await this.badDays(p.id, Number(s.data?.days) || 1);
        const f = this.game.board.facilities.find(x => x.id === Number(s.data?.facility));
        const n = this.game.node(p.node);
        // 歌舞伎町: a child taken to the amusement park (docs/rules/21 §3) leaves the square, not into the 情人酒店.
        if (s.data?.park) v.hide(p.id);
        else if (f && n) {
          await this.walkOff(p, { x: n.x, y: n.y }, { x: f.x, y: f.y });
          v.hide(p.id);
        }
        return true;
      }
      case 'leave-hotel': {
        // Out again at the start of the turn: from the building, facing the road, back onto the node (who_plays 0x10).
        if (!p) return false;
        const f = this.game.board.facilities.find(x => x.id === p.facility);
        const n = this.game.node(p.node);
        if (this.game.rules?.stayLabel?.(this.game, p)) v.show(p.id); // back from the amusement park (歌舞伎町 §3)
        else if (f && n) await this.walkOff(p, { x: f.x, y: f.y }, { x: n.x, y: n.y });
        return true;
      }

      // ---- what a news or fate entry did (the remake's result box and effect)
      case 'event-result': await this.result(s); return true;

      // ---- fate cards (rich4_fortune.asm)
      case 'vehicle-lost':
        // Scooter stolen (fcn_0044ca46): event[3 | 4]; car wrecked (fcn_0044cb53): event[3]; face 2.
        await this.ev(s.p, s.data?.car || this.rand2() ? 3 : 4, Face.cry);
        return true;
      case 'stock-sell-all':
        // Fate 9 sells everything (fcn_0044c91f): event[5], face 2. A bankrupt's shares go silently.
        if (!s.data?.toPool) await this.ev(s.p, 5, Face.cry);
        return true;
      case 'card-taken':
        // Birthday (fcn_0044c3b7): the cards move without a word; after the last one event[0 | 1], face 0.
        if (s.data?.last) await this.ev(s.p, this.rand2() ? 0 : 1, Face.normal);
        return true;
      // Fate 8 (shares confiscated) shows only its board; stock trades are the market screen's own or the
      // computer's message box (a 'say'); the daily price update only redraws (fcn_004291d6).
      case 'stock-confiscated': case 'stock-trade': case 'stocks-updated': case 'stock-subscribe':
        return true;

      // ---- construction company's free floor (core_actions:1810-1861, 2014-2043)
      case 'free-upgrade': {
        if (!p) return false;
        const ref = Number(s.data?.ref), at = v.lotPos(ref);
        if (!at) return false;
        // The rules already raised it: the old look stays until the clip's frame 44 (flags 0x2c0001, Effect#0x5b).
        v.freezeLots();
        await this.clipAt(553, at, { bake: 44, sound: Sfx.robot });
        if (s.data?.top) {
          if (s.data?.own) await this.ev(p.id, 15, Face.normal);
          await this.fireworks(at);
        }
        return true;
      }

      // ---- bombs, vehicles, labs: silent in the original
      case 'bomb-pass': case 'bomb-removed':
        // The ticking stops with the carrier (core_actions:2776 fcn_004542e9(tick)); the new carrier's steps start it again.
        audio.stop(Sfx.bombTick);
        return true;
      // The construction vehicle runs out (the sprite changes back), 下車 (fcn_00447c00), a lab order
      // (fcn_0044101d), an NPC bailed out or walking back in: only a redraw.
      case 'construction-end': case 'get-off': case 'lab-order': case 'npc-released': case 'npc-return':
        return true;

      // ---- NPCs at work (core_actions:3020-4035): message boxes only, nobody speaks
      case 'npc-pickup': {
        const master = this.player(s.p);
        if (!master) return false;
        const obj = Number(s.data?.obj), tool = Number(s.data?.tool);
        const what = ({ 13: '禮物', 14: '寶箱', 16: '路障', 17: '地雷', 18: '定時炸彈' } as Record<number, string>)[obj] ?? TOOLS[tool - 1]?.name ?? '';
        if (obj === 14) audio.sfx(Sfx.chest);
        await this.box(`小偷偷得${what}\n\n給${this.game.name(master.id)}！`, 1500);
        if (obj === 13 && tool) {
          // The gift's tool goes to the master: Effect#35, the camera on the master, 「得到%s！」, their line.
          audio.sfx(Sfx.gift);
          await this.atPlayer(master.id, async () => {
            await this.box(`得到${TOOLS[tool - 1]?.name ?? '道具'}！`, 1500);
            await this.gotItem(master.id, TOOLS[tool - 1]?.price ?? 0);
          });
        } else if (obj === 14) {
          await this.atPlayer(master.id, () => this.box('得到５００點券！', 1500));
        }
        return true;
      }
      case 'npc-steal':
        if (!p) return false;
        await this.box(`偷取${this.game.name(p.id)}\n\n${Number(s.data?.points)}點點券！`, 1000);
        return true;
      case 'npc-rob-card':
        if (!p) return false;
        await this.box(`奪取${this.game.name(p.id)}${cardName(Number(s.data?.card))}！`, 1000);
        return true;
      case 'npc-rob-bank': {
        const master = this.player(s.p);
        if (!master) return false;
        await this.box(`強盜搶奪銀行\n\n得款${Number(s.data?.total)}元\n\n給${this.game.name(master.id)}！`, 2000);
        return true;
      }
    }
    return false;
  }

  /**
   * After a news or fate entry: the camera on the spot or the player concerned, the effect for the kind of event
   * (event-fx.ts; the original's clips already played) together with the result box, then the original's line —
   * money received fcn_0044f354 (6/7/8), paid fcn_0044f42d (9/10/11), waived fcn_0044f567 (12/13/14), or the
   * lot owner's event[3 | 4] after fate 0 / 1 (fortune.asm fcn_0044be16: lot flash, 300 ms, line) and news 5,
   * 15, 19, 21 (the clip or flash, 300 ms, line).
   */
  private async result(s: Fx) {
    this.eventOpen = false;
    const r = s.data as unknown as EventResult, v = this.view, g = this.game;
    if (!r || !Array.isArray(r.lines)) return;
    // Where it happened (docs/rules/11 §7.1): the lots it hit, else its square, else the hospital / prison of a
    // release or a longer stay, else the players it names (where they are, the hospital or prison included).
    const node = s.node ? g.node(s.node) : null;
    const refs = (r.refs ?? []).filter(ref => v.lotPos(ref));
    const lots = this.spots(refs);
    let spot: Pt | null = node ? v.lotPos(node.ref) ?? { x: node.x, y: node.y } : lots.length ? middle(lots) : null;
    let place: number | null = null;
    if (!spot && (r.fx === 'release' || r.fx === 'extend')) {
      const n = r.src === 'news' && (r.id === 0 || r.id === 1) ? g.prisonNode() : g.hospitalNode();
      if (n) { spot = { x: n.x, y: n.y }; place = n.id; }
    }
    const named = GLOBAL_FX.has(r.fx) ? [] : r.focus ?? r.lines.map(l => l.p).filter((id): id is number => id !== undefined);
    const people = [...new Set(named)].filter(id => this.where(id));
    const shown = people.filter(id => this.player(id)?.whoPlays && v.actorAt(id)?.visible);
    const pts = lots.length ? lots : spot ? [spot] : people.map(id => this.where(id)!);
    const at = pts.length ? (pts.length === 1 ? pts[0] : spot ?? middle(pts)) : null;
    const flash = r.fx === 'demolish' || r.fx === 'expropriate';
    if (flash) v.freezeLots();
    v.unmark();
    for (const ref of refs) v.marks.add(ref);
    if (place) v.markNodes.add(place);
    // Players named but out of sight (in the hospital, the prison): their squares are ringed.
    if (!lots.length && !spot) for (const id of people) if (!v.actorAt(id)?.visible) { const q = this.player(id); if (q?.node) v.markNodes.add(q.node); }
    await v.showSpots(pts);
    if (flash) { await v.flashLots(r.refs ?? []); v.thawLots(); }
    for (const l of r.lines) {
      const who = l.p !== undefined ? g.name(l.p) : '';
      this.hud.note(`${who}${l.text}${l.amount ? ` ${l.amount > 0 ? '+' : ''}${l.amount.toLocaleString()} 元` : ''}`, l.p !== undefined ? this.colorOf(l.p) : undefined);
    }
    await Promise.all([
      resultBox(this.hud.context(this.hud.area), r, () => {
        const p = at ?? (shown.length ? this.pos(shown[0]) : null);
        if (!p) return null;
        const q = v.project(p.x, p.y), c = v.canvas.getBoundingClientRect(), area = this.hud.area.getBoundingClientRect();
        return q.y + c.top - area.top;
      }),
      playEventFx(v, r.fx, { spot, refs: r.refs, players: shown, actor: s.p }),
    ]);
    const pi = this.pi, a = r.amount ?? 0;
    const speaker = r.line === 'gain' || r.line === 'cry' ? r.lines[0]?.p ?? s.p : s.p;
    if (r.line === 'gain' && a >= 2000 * pi) await this.ev(speaker, a >= 9000 * pi ? 6 : a >= 5000 * pi ? (this.rand2() ? 6 : 7) : 8, Face.laugh);
    else if (r.line === 'loss' && a > 0) await this.ev(speaker, a >= 9000 * pi ? 9 : a >= 5000 * pi ? (this.rand2() ? 9 : 10) : 11, Face.cry);
    else if (r.line === 'free' && a > 0) await this.ev(speaker, a >= 9000 * pi ? 12 : a >= 5000 * pi ? (this.rand2() ? 12 : 13) : 14, Face.laugh);
    else if (r.line === 'cry') { await sleep(300); await this.ev(speaker, this.rand2() ? 3 : 4, Face.cry); }
    v.unmark();
    v.refollow();
  }

  private colorOf(id: number): number | undefined {
    const p = this.player(id);
    return p ? CHARACTERS[p.character]?.color : undefined;
  }

  /** A message box that also goes into the side notes. */
  private box(text: string, ms: number) {
    this.hud.note(text.replace(/\n+/g, ' '));
    return this.hud.flash(text, ms);
  }

  /** `fcn_0041d476(player x, y, 0)`: the camera on a player while `fn` runs, then back to the actor. */
  private async atPlayer(id: number, fn: () => Promise<unknown>) {
    const at = this.pos(id);
    await this.view.panTo(at.x, at.y);
    await fn();
    this.view.refollow();
  }

  /** The hotel guest's extra step between the road node and the building, at their own speed. */
  private async walkOff(p: Player, from: Pt, to: Pt) {
    const v = this.view, sound = [Sfx.walk, Sfx.scooter, Sfx.car, Sfx.truck][p.traffic & 3];
    v.followActor(p.id);
    audio.loop(sound);
    await v.walkTo(p.id, to, Game.direction(to.x - from.x, to.y - from.y), SPEED[p.traffic & 3], from);
    audio.stop(sound);
  }

  /**
   * The engineering car flattens a building (08 §2.2, player_utils.asm:757-990): it turns to the lot, plays its
   * demolish action (B+12) one frame per tick while the dust Data#526 rises on the building after a 6-tick pause;
   * the rules flatten the building at counter 3, so this resolves there and the rest plays on.
   */
  private async demolishByCar(p: Player, ref: number): Promise<boolean> {
    const v = this.view, at = v.lotPos(ref);
    if (!at) return false;
    const me = this.pos(p.id);
    const pose = v.demolishPose(p.id, Game.direction(at.x - me.x, at.y - me.y));
    const t = v.tickMs;
    let flatten!: () => void;
    const reached = new Promise<void>(r => { flatten = r; });
    // Counter 2 sounds slot 22 (Effect#15, player_utils.asm:919), counter 3 flattens the building.
    const dust = sleep(6 * t).then(() => v.fx.clip(526, at, { delay: t, at: { 1: () => audio.sfx(Sfx.demolishCar), 2: flatten } }));
    this.pending = Promise.all([pose, dust]).then(() => { v.stop(p.id); });
    await Promise.race([reached, this.pending]);
    return true;
  }

  /** Nuclear missile flags bit31: the view brightens by 0x486198[frame] over frames 4..24. */
  private whiteFlash(): Promise<void> {
    const add = [0, 0, 0, 4, 12, 24, 28, 30, 28, 24, 20, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    const d = 114;
    return this.view.fx.hold(add.length * d, (put, t) => {
      const k = add[Math.floor(t / d)] ?? 0;
      if (!k) return;
      put(2e9, 0, () => {
        const ctx = (this.view.canvas.getContext('2d'))!;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,255,255,${k / 31})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      });
    });
  }
}
