/**
 * Special places and characters — docs/rules/06 §6-§9, docs/rules/02 §10, docs/rules/01 §7.1 (NPC part).
 * Owns: hospital and prison occupancy, visits and bail, the four NPCs (thief, robber, hooligan, spy),
 * the lottery, the three mini games, the magic house, and auctions.
 */
import { addMonths } from '../date';
import { companyOf, facilityOf, landOf, type BoardNode } from '../board';
import { CHARACTERS } from '../characters';
import { ask, type Flow } from '../flow';
import { Game, tick } from '../game';
import { LAND_LIMIT_MONTHS, type Option, type Player } from '../types';
import { cardPrice, isTycoonCard } from './cards';

export interface Npc {
  node: number;
  lastNode: number;
  dir: number;
  /** Player who bailed it out (its master), -1 = nobody. */
  owner: number;
  /** 0 active on the map, 1 in prison, 2 in hospital, 3 not present (docs/rules/07 special players). */
  where: number;
  /** 1 released from prison, 2 from hospital; bit 7 = armed to return on the next pass. */
  origin: number;
  sleep: number;
  sleepwalk: number;
  stay: number;
  turtle: number;
}

/** Actors 4..7 (01 §0.3, `_rich4_special_player_names`). */
export const NPC_NAMES = ['小偷', '強盜', '流氓', '間諜'];
/** Bail prices in points (06 §9.5): a player 30, an NPC 300; a computer needs >30 / >=700 points. */
export const BAIL = { player: 30, npc: 300, aiNpcThreshold: 700 } as const;
/** Lottery ticket price, not price-indexed (06 §8). */
export const LOTTERY_PRICE = 1000;
/** Auction raise steps, not price-indexed (02 §10.4, ref_00475ba2). */
export const AUCTION_STEPS = [100, 500, 1000, 5000, 10000];
/** Card prices in points by id - 1 (04 §1 card table), used by magic 0. */
const CARD_PRICES = [200, 200, 35, 25, 20, 20, 15, 20, 160, 180, 60, 15, 25, 20, 100, 25, 20, 20, 40, 25, 25, 10, 20, 50, 30, 35, 35, 35, 40, 70];
/** Tool prices in points by id - 1 (05 §1 tool table), used by magic 8. */
const TOOL_PRICES = [15, 30, 25, 25, 80, 150, 100, 30, 30, 40, 95, 150, 250];
/** Magic house spells (06 §6.2). */
export const MAGIC_NAMES = [
  '變賣所有卡片', '抽取命運三張', '立刻坐牢三天', '原地停留一回合', '存入所有現金', '就地加蓋房屋',
  '得一張卡片', '向後轉', '變賣所有道具', '就地拆除房屋', '住院檢查三天', '拍賣當格土地',
];
export const MAGIC_GROUPS = ['資產最多', '土地最多', '房屋最多', '現金最多', '存款最多', '點券最多', '步行者', '騎機車者', '開汽車者', '有神附身者', '所有男性', '所有女性'];
/** Facility level caps by type (ref_00474940). */
const FACILITY_MAX = [1, 5, 5, 1, 5, 5, 5, 5, 5, 5]; // + 5..9 大富翁城's halls (docs/rules/19)
FACILITY_MAX[14] = 5; // 激情歲月's 宣傳站 (docs/rules/24 §2.4); 10..13 stay as they were

interface Seat { p: Player; flag: number; permanent: boolean; max: number; out: boolean }

export class Places {
  /** Thief, robber, hooligan, spy (actors 4-7). The robot doll (actor 8) belongs to the tools. */
  npcs: Npc[] = [];
  /** Lottery tickets: buyer id + 1 by number 1..36 (index = number - 1), 0 = unsold (06 §8). */
  lottery: number[] = [];

  constructor(readonly g: Game) {}

  /** New game: thief and robber in prison, hooligan and spy in hospital (01 §2.3 step 4). */
  init(): void {
    this.lottery = new Array(36).fill(0);
    this.npcs = [1, 1, 2, 2].map((where): Npc => {
      const n = this.placeNode(where);
      return { node: n?.id ?? 0, lastNode: n?.adjacent.find(Boolean) ?? 0, dir: 0, owner: -1, where, origin: 0, sleep: 0, sleepwalk: 0, stay: 0, turtle: 0 };
    });
  }

  private placeNode(where: number): BoardNode | undefined {
    const g = this.g;
    return where === 1
      ? g.board.nodes.find(n => n.ref === 8002) ?? g.board.nodes.find(n => n.event === 4)
      : g.board.nodes.find(n => n.ref === 8001) ?? g.board.nodes.find(n => n.event === 5);
  }

  // ---------------------------------------------------------------- hospital and prison (06 §9.5)

  /** Hospital tile t = 5 and prison tile t = 4: visits and bail (06 §9.5). Stopping there never confines. */
  *hospitalStop(p: Player): Flow { yield* this.bail(p, 'hospital'); }
  *prisonStop(p: Player): Flow { yield* this.bail(p, 'prison'); }

  /** Who can be bailed out here: players still inside (not already pending release), then NPCs (actor ids). */
  inmates(place: 'hospital' | 'prison'): { players: Player[]; npcs: number[] } {
    const where = place === 'prison' ? 1 : 2;
    return {
      players: this.g.locals().filter(q => q[place] !== 0 && q[place] !== 0x80),
      npcs: this.npcs.map((n, i) => (n.where === where ? this.g.npcBase + i : -1)).filter(a => a >= 0),
    };
  }

  private *bail(p: Player, place: 'hospital' | 'prison'): Flow {
    const g = this.g;
    const { players, npcs } = this.inmates(place);
    if (!players.length && !npcs.length) return;
    if (g.isHuman(p)) {
      const options: Option[] = [
        ...players.map(q => ({ label: g.name(q.id), value: q.id, disabled: p.points < BAIL.player, detail: `還剩${(q[place] & 0x7f) + 1}天 保釋${BAIL.player}點` })),
        ...npcs.map(a => ({ label: NPC_NAMES[a - g.npcBase], value: a, disabled: p.points < BAIL.npc, detail: `保釋${BAIL.npc}點` })),
      ];
      const title = place === 'prison' ? '探監' : '探病';
      // screen 'bail': the hospital corridor / prison cells (ui/screens/bail.ts); the title tells which.
      const pick = Number(yield ask({ t: 'choose', p: p.id, title, text: '要保釋誰？', options, cancellable: true, screen: 'bail' }));
      if (!(pick >= 0)) return;
      if (pick < g.npcBase) {
        const q = players.find(x => x.id === pick);
        if (!q) return;
        if (p.points < BAIL.player) { yield* g.say(p.id, '點數不足'); return; }
        // The bailed player's hostility towards the visitor falls by max(days left, 1) × 100 × F.
        g.addHostility(q.id, p.id, -Math.max(q[place] & 0x7f, 1) * 100 * g.priceIndex);
        yield* this.bailPlayer(p, q, place);
      } else {
        if (!npcs.includes(pick)) return;
        if (p.points < BAIL.npc) { yield* g.say(p.id, '點數不足'); return; }
        yield* this.bailNpc(p, pick);
      }
      return;
    }
    // Computer (06 §9.5, 07 §3.3 (11)): a coin, then candidates by personality, a random one, then the points rule.
    if (!(g.rng.rand() & 1)) return;
    const personality = CHARACTERS[p.character].personality;
    let candidates: number[];
    if (personality === 0) candidates = players.map(q => q.id);
    else if (personality === 1) candidates = [...players.map(q => q.id), ...(g.rng.rand() % 3 === 0 ? npcs : [])];
    else if (personality === 2) candidates = [...npcs];
    else return;
    if (!candidates.length) return;
    const pick = candidates[g.rng.below(candidates.length)];
    if (pick < g.npcBase) {
      if (p.points > BAIL.player) yield* this.bailPlayer(p, g.players[pick], place, true);
    } else if (p.points >= BAIL.aiNpcThreshold) yield* this.bailNpc(p, pick, true);
  }

  /**
   * A computer's bail announces itself: message box 「保釋%s」 1500 ms with the bailed one's name (ui_prison.asm
   * :1068-1076, ui_hospital.asm:1680-1688); a human's choice was made on the bail screen, which said its own lines.
   */
  private *bailPlayer(p: Player, q: Player, place: 'hospital' | 'prison', ai = false): Flow {
    if (ai) yield* this.g.say(undefined, `保釋${this.g.name(q.id)}`);
    p.points -= BAIL.player;
    q[place] = 0x80; // released at the start of q's next turn
    yield { t: 'points', p: p.id, amount: -BAIL.player };
  }

  private *bailNpc(p: Player, actor: number, ai = false): Flow {
    if (ai) yield* this.g.say(undefined, `保釋${NPC_NAMES[actor - this.g.npcBase]}`);
    p.points -= BAIL.npc;
    yield { t: 'points', p: p.id, amount: -BAIL.npc };
    yield* this.releaseNpc(actor, p.id);
  }

  /** release_from_prison/hospital for an NPC: out at once, working for its new master. */
  *releaseNpc(actor: number, master: number): Flow {
    const n = this.npcs[actor - this.g.npcBase];
    if (!n || (n.where !== 1 && n.where !== 2)) return;
    const at = this.placeNode(n.where);
    n.origin = n.where;
    n.where = 0;
    n.owner = master;
    if (at) {
      n.node = at.id;
      const ways = at.adjacent.filter(Boolean);
      n.lastNode = ways.length ? ways[this.g.rng.below(ways.length)] : 0;
      const from = this.g.node(n.lastNode || at.id);
      n.dir = Game.direction(at.x - from.x, at.y - from.y);
    }
    n.sleep = 0; n.sleepwalk = 0; n.stay = 0; n.turtle = 0;
    // _rich4_release_player_from_prison/hospital for an NPC only moves it out: no message, no clip.
    yield { t: 'fx', kind: 'npc-released', p: master, node: n.node, data: { actor } };
  }

  /**
   * An NPC goes to prison or hospital (bankrupt master, mine, dog, missile, second pass). NPCs have no day count
   * (07 §2.4): they stay until bailed out again.
   */
  npcTo(actor: number, place: 'hospital' | 'prison'): void {
    const n = this.npcs[actor - this.g.npcBase];
    if (!n || n.where === 3) return;
    n.where = place === 'prison' ? 1 : 2;
    const at = this.placeNode(n.where);
    if (at) { n.node = at.id; n.lastNode = at.adjacent.find(Boolean) ?? 0; }
    n.owner = -1;
    n.origin = 0;
  }

  // ---------------------------------------------------------------- lottery (06 §8)

  /** Lottery tile t = 9 (06 §8): one ticket per stop, 1000 from cash into the pool. */
  *lotteryStop(p: Player): Flow {
    const g = this.g;
    const unsold = this.lottery.map((b, i) => (b ? 0 : i + 1)).filter(Boolean);
    if (!unsold.length) return;
    let number: number;
    if (g.isHuman(p)) {
      if (p.cash < LOTTERY_PRICE) { yield* g.say(p.id, '您的現金不足！'); return; }
      const taken = this.lottery.map((b, i) => (b ? i + 1 : 0)).filter(Boolean);
      number = Number(yield ask({ t: 'lottery', p: p.id, taken, pool: g.lotteryPool, price: LOTTERY_PRICE }));
      if (!(number >= 1 && number <= 36) || this.lottery[number - 1]) return;
    } else {
      if (p.cash <= LOTTERY_PRICE) return;
      number = unsold[g.rng.below(unsold.length)];
    }
    this.lottery[number - 1] = p.id + 1;
    yield* g.transfer(p.id, -1, LOTTERY_PRICE, 0, '樂透');
    yield { t: 'fx', kind: 'lottery-ticket', p: p.id, data: { number } };
  }

  /** The draw on day 15 (06 §8). */
  *lotteryDraw(): Flow {
    const g = this.g;
    const sold = this.lottery.map((b, i) => (b ? i + 1 : 0)).filter(Boolean);
    if (!sold.length) return;
    const counts = g.players.map(() => 0);
    for (const b of this.lottery) if (b) counts[b - 1] += 1;
    const number = counts.some(c => c >= 11) ? sold[g.rng.below(sold.length)] : g.rng.below(36) + 1;
    const winner = this.lottery[number - 1] - 1;
    // The draw stage (09 §7.8): the tickets by number (buyer id + 1) as they stood before the draw.
    yield { t: 'fx', kind: 'lottery-draw', data: { number, winner, prize: winner >= 0 ? g.lotteryPool : 0, pool: g.lotteryPool, tickets: [...this.lottery] } };
    if (winner < 0) { yield* g.say(undefined, `本期樂透號碼${String(number).padStart(2, '0')}，無人中獎`); return; }
    const prize = g.lotteryPool;
    g.lotteryPool = 0;
    this.lottery.fill(0);
    g.gain(g.players[winner], prize, 1);
    yield* g.say(winner, `${g.name(winner)}中了樂透，獨得${prize}元！`);
  }

  // ---------------------------------------------------------------- mini games (06 §7)

  /**
   * Mini game tiles t = 6, 7, 8 (06 §7, 13-mini-games.md; `_rich4_ui_game_*`, small_games.asm:4223-4427). Only
   * who_plays == 1 (a human, not on autopilot) with 動畫過程 on plays the game; the screen answers its score.
   * Everyone else gets rand() % 20 + 50 with the message 「得點券%d點」 and a line (loc_00415457), shown by the
   * 'mini-game' fx. The caller adds the result to the points as a u16 (core_actions:2367-2383).
   */
  *miniGame(p: Player, kind: number): Flow {
    const g = this.g;
    let amount: number;
    if (g.isHuman(p) && g.animation) {
      amount = Number(yield ask({ t: 'mini-game', p: p.id, game: kind }));
      if (!(amount > 0)) amount = 0;
      amount = Math.trunc(amount) & 0xffff;
    } else {
      amount = g.rng.below(20) + 50;
      yield { t: 'fx', kind: 'mini-game', p: p.id, data: { game: kind, points: amount } };
    }
    p.points = (p.points + amount) & 0xffff;
    g.stats?.miniGame(p.id, amount); // statistics only (core/stats.ts)
    yield { t: 'points', p: p.id, amount };
  }

  // ---------------------------------------------------------------- magic house (06 §6)

  /** Magic house t = 16 (06 §6). */
  *magicHouse(p: Player): Flow {
    const g = this.g;
    let group = 0, targets: Player[] = [];
    while (!targets.length) { group = g.rng.below(12); targets = this.magicGroup(group); }
    let e: number;
    if (g.isHuman(p)) {
      const options = MAGIC_NAMES.map((label, value): Option => ({ label, value }));
      const names = targets.map(q => g.name(q.id)).join('、');
      // screen 'magic': the magic circle (ui/screens/magic.ts) finds the group by its name in the text.
      e = Number(yield ask({ t: 'choose', p: p.id, title: '魔法屋', text: `對象：${MAGIC_GROUPS[group]}（${names}）`, options, cancellable: false, screen: 'magic' }));
      if (!(e >= 0 && e < 12)) e = 6;
    } else if (targets.includes(p)) e = 6;
    else { e = g.rng.below(11); if (e === 6) e = 7; }
    yield { t: 'fx', kind: 'magic', p: p.id, data: { group, magic: e, targets: targets.map(q => q.id) } };
    yield* this.castMagic(p, e, targets);
  }

  /** Target group g of the magic house (06 §6.1 table), living players only. */
  magicGroup(group: number): Player[] {
    const g = this.g;
    const living = g.locals();
    if (group <= 5) {
      const value = (q: Player): number => {
        const me = q.id + 1;
        switch (group) {
          case 0: return g.wealth(q);
          case 1: return g.board.lands.filter(l => l.owner === me).length + g.board.facilities.filter(f => f.owner === me).length;
          case 2: return g.board.lands.filter(l => l.owner === me && (l.level > 0 || l.chain)).length + g.board.facilities.filter(f => f.owner === me && f.level > 0).length;
          case 3: return q.cash;
          case 4: return q.bank;
          default: return q.points;
        }
      };
      // Maximum starting from 0; ties all qualify; nobody qualifies when the best is 0 (推测).
      let best = 0;
      for (const q of living) best = Math.max(best, value(q));
      return best > 0 ? living.filter(q => value(q) === best) : [];
    }
    return living.filter(q => {
      switch (group) {
        case 6: return (q.traffic & 3) === 0;
        case 7: return (q.traffic & 3) === 1;
        case 8: return (q.traffic & 3) === 2;
        case 9: return q.god !== 0 || !!g.rules?.possessed?.(q); // 歌舞伎町: 黑幫 counts as a god (docs/rules/21 §4.1)
        case 10: return !CHARACTERS[q.character].female;
        default: return CHARACTERS[q.character].female;
      }
    });
  }

  /** fcn_00431caa: spell e on each target in id order, current actor temporarily the target (06 §6.1 step 3). */
  *castMagic(visitor: Player, e: number, targets: Player[]): Flow {
    const g = this.g;
    const saved = g.current;
    try {
      for (const q of [...targets].sort((a, b) => a.id - b.id)) {
        if (g.over) return;
        if (!q.whoPlays) continue;
        g.current = q.id;
        yield* this.spell(visitor, q, e);
      }
    } finally {
      g.current = saved;
    }
  }

  private *spell(visitor: Player, q: Player, e: number): Flow {
    const g = this.g;
    const idle = !g.offRoad(q);
    const node = g.node(q.node);
    const ref = node && (landOf(g.board, node) || facilityOf(g.board, node)) ? node.ref : 0;
    switch (e) {
      case 0: { // all cards at full price into points; the cards go back to the pool
        let sum = 0;
        for (const id of q.cards) {
          if (isTycoonCard(id)) continue; // 大富豪模式's own cards stay in the hand (17 §3.7)
          sum += CARD_PRICES[id - 1] ?? cardPrice(id);
          if (g.cards.remaining.length >= id) g.cards.remaining[id - 1] += 1;
        }
        q.cards = q.cards.filter(isTycoonCard);
        q.points = (q.points + sum) & 0xffff;
        yield { t: 'points', p: q.id, amount: sum };
        break;
      }
      case 1:
        for (let i = 0; i < 3 && q.whoPlays && !g.over; i++) yield* g.events.fate(q);
        break;
      case 2: case 10: { // no god check; pardon / frame cards only
        g.addHostility(q.id, visitor.id, 90 * g.priceIndex); // also ends their alliance
        // 大富豪模式: the magic house works on this city only — a 嫁禍卡 cannot pass it to another city (17 §4).
        const who = yield* g.cards.pardonOrFrame(q, true);
        if (who < 0) break;
        yield* g.sendTo(g.players[who], e === 2 ? 'prison' : 'hospital', 3);
        break;
      }
      case 3:
        q.stay = (q.stay + 1) & 0x7f;
        yield { t: 'fx', kind: 'stay', p: q.id };
        break;
      case 4:
        q.bank += q.cash;
        q.cash = 0;
        yield { t: 'bank', p: q.id };
        break;
      case 5: { // fcn_0040b110 without an owner check
        if (!idle || !ref) break;
        if (ref > 4000) {
          const f = g.board.facilities[ref - 4001];
          if (f.level === 0) {
            // 歌舞伎町, 大富翁城: a human picks from the map's own facilities; otherwise the map's default.
            const only = g.isHuman(q) && g.rules?.pickFacilityType ? yield* g.rules.pickFacilityType(g, q, f) : g.rules?.facilityType?.(f);
            if (only !== undefined) f.type = only;
            else if (g.isHuman(q)) f.type = Math.max(0, Math.min(4, Number(yield ask({ t: 'facility-type', p: q.id, price: 0 })) || 0));
            else f.type = f.owner === q.id + 1 ? g.rng.below(4) + 1 : 0;
            f.level = 1;
          } else if (f.level < FACILITY_MAX[f.type]) f.level += 1;
          else break;
          yield { t: 'build', p: q.id, kind: 'facility', id: f.id, level: f.level, cost: 0 };
        } else {
          if (g.freeUpgrade(ref) < 0) break;
          const l = g.board.lands[ref - 2001];
          yield { t: 'build', p: q.id, kind: 'land', id: l.id, level: l.level, cost: 0 };
        }
        break;
      }
      case 6: {
        const id = yield* g.cards.receiveRandom(q);
        if (id) yield { t: 'fx', kind: 'card-received', p: q.id, data: { card: id } };
        break;
      }
      case 7:
        if (idle) { this.turnAround(q); yield { t: 'fx', kind: 'turn-around', p: q.id }; }
        break;
      case 8: { // the vehicle becomes a tool, then every tool is sold at full price
        const v = q.traffic & 3;
        if (v === 1 || v === 2) q.tools[v + 3] += 1;
        let sum = 0;
        q.tools.forEach((n, i) => {
          if (!n) return;
          sum += n * (TOOL_PRICES[i] ?? 0);
          if (i < 8 && g.tools.shopStock.length > i) g.tools.shopStock[i] += n; // back to the shop (推测)
        });
        q.tools = q.tools.map((n, i) => (i < 13 ? 0 : n)); // 大富豪模式's lab tools (14-16) stay (17 §3.7)
        q.traffic = 0; q.dice = 1;
        q.points = (q.points + sum) & 0xffff;
        yield { t: 'points', p: q.id, amount: sum };
        break;
      }
      case 9:
        if (!idle || !ref) break;
        g.damageProperty(ref, 0);
        yield { t: 'board' };
        break;
      case 11:
        // Proceeds go to the target standing there; an unsold lot keeps its owner.
        if (idle && ref) yield* this.auction(q.id, ref);
        break;
    }
  }

  /** _rich4_change_player_direction (01 §6.4). */
  turnAround(q: { dir: number; node: number; lastNode: number }): void {
    q.dir = (q.dir + 4) & 7;
    const n = this.g.node(q.node);
    const ahead = n.adjacent.filter((a, j) => a && a !== q.lastNode && !(n.oneWay & (8 >> j)));
    q.lastNode = ahead.length ? ahead[this.g.rng.below(ahead.length)] : 0;
  }

  // ---------------------------------------------------------------- auctions (02 §10)

  /** Reserve price (02 §10.2): trunc(price × (1 + 0.5 × level)) × F. */
  reservePrice(ref: number): number {
    const g = this.g;
    const r = ref > 4000 ? g.board.facilities[ref - 4001] : g.board.lands[ref - 2001];
    return Math.trunc(r.price * (1 + 0.5 * r.level)) * g.priceIndex;
  }

  /** Computer's mental ceiling fcn_00439f0d (02 §10.5). */
  aiCeiling(p: Player, ref: number, start: number): number {
    const g = this.g, F = g.priceIndex;
    const r = (g.rng.rand() / 32767) * 0.3 + 0.5;
    let value: number, cap: number;
    if (ref > 4000) {
      const f = g.board.facilities[ref - 4001];
      const all = g.board.facilities, free = all.filter(x => x.owner === 0).length;
      const scarcity = 6 - (4 * free) / all.length;
      value = Math.trunc(((f.level >> 1) + 1) * start * F * scarcity * r);
      cap = Math.trunc(f.price * F * (g.rng.rand() / 65536 + 3));
    } else {
      const l = g.board.lands[ref - 2001];
      const all = g.board.lands, free = all.filter(x => x.owner === 0).length;
      const same = all.filter(x => x.owner === p.id + 1 && x.name === l.name).length;
      const scarcity = 6 - (4 * free) / all.length;
      value = Math.trunc(((l.level >> 1) + 1 + same) * start * F * scarcity * r);
      cap = Math.trunc(l.price * F * (g.rng.rand() / 65536 + 3));
    }
    return Math.min(value, cap, p.cash);
  }

  /**
   * Auction of a land (ref 2001..) or facility (ref 4001..); seller -1 = the system, proceeds into the lottery pool
   * (02 §10). Bug decision #16: the seller and absent players never bid, even after a raise clears the marks.
   * Returns the buyer's id, or -1 when nothing sold (the property is left as it was).
   */
  *auction(seller: number, ref: number, worldwide = false): Flow<number> {
    const g = this.g;
    const isFacility = ref > 4000 && ref < 6000;
    if (!isFacility && !(ref > 2000 && ref < 4000)) return -1;
    const prop = isFacility ? g.board.facilities[ref - 4001] : g.board.lands[ref - 2001];
    if (!prop) return -1;
    const start = this.reservePrice(ref);
    // 大富豪模式's bankruptcy auctions (17 §9): every living player of the world bids; the room shows the city's lot.
    yield { t: 'fx', kind: 'auction', p: seller >= 0 ? seller : undefined, data: { ref, start, ...(g.world ? { city: g.world.index, worldwide } : {}) } };
    // Seats (02 §10.3): later marks overwrite earlier ones.
    const seats: Seat[] = [];
    for (const p of g.players) {
      if (!p.whoPlays || (!worldwide && !g.here(p))) continue; // 大富豪模式: who is in this city bids, everyone at a bankruptcy (17 §9)
      let flag = 0;
      if (p.cash <= start) flag = 8;
      if (p.hotel) flag = 1;
      if (p.vanish) flag = 2;
      if (p.prison) flag = 3;
      if (p.hospital) flag = 4;
      if (p.sleep) flag = 5;
      if (p.sleepwalk) flag = 6;
      if (p.id === seller) flag = 7;
      const permanent = flag >= 1 && flag <= 7;
      const max = flag === 0 && !g.isHuman(p) ? this.aiCeiling(p, ref, start) : 0;
      seats.push({ p, flag, permanent, max, out: false });
    }
    const name = prop.name;
    // 'auction-end' closes the auction room (ui/screens/auction.ts); presentation only.
    if (!seats.length) { yield { t: 'fx', kind: 'auction-end', data: { buyer: -1, price: 0 } }; yield* g.say(undefined, '無人出價，宣佈流標'); return -1; }
    yield* g.say(undefined, `${name}\n\n底價${start}元 請意者出價`);
    let price = start, high: Seat | null = null, i = 0;
    for (;;) {
      const live = seats.filter(s => !s.out);
      const n = live.length, k = live.filter(s => s.flag).length;
      if (n === 0 || n === k) { high = null; break; }
      if ((n === 1 || n - k === 1) && high) break;
      const s = seats[i];
      i = (i + 1) % seats.length;
      if (s.out || s.flag) continue;
      if (price > s.p.cash) { s.out = true; yield { t: 'fx', kind: 'auction-quit', p: s.p.id }; continue; }
      let step: number;
      if (g.isHuman(s.p)) {
        const options: Option[] = [
          ...AUCTION_STEPS.map(v => ({ label: `+${v}`, value: v, disabled: price + v > s.p.cash })),
          { label: 'PASS', value: 0 }, { label: '放棄', value: -1 },
        ];
        step = Number(yield ask({ t: 'choose', p: s.p.id, title: `拍賣 ${name}`, text: `目前出價${price}元`, options, cancellable: false, screen: 'auction' }));
        if (step > 0 && (!AUCTION_STEPS.includes(step) || price + step > s.p.cash)) step = 0;
      } else step = this.aiStep(s, price);
      if (step < 0) { s.out = true; yield { t: 'fx', kind: 'auction-quit', p: s.p.id }; continue; }
      if (step === 0) { s.flag = 9; yield { t: 'fx', kind: 'auction-pass', p: s.p.id }; continue; }
      price += step;
      high = s;
      for (const x of seats) if (!x.permanent) x.flag = 0;
      yield { t: 'fx', kind: 'auction-bid', p: s.p.id, data: { price } };
    }
    if (!high) { yield { t: 'fx', kind: 'auction-end', data: { buyer: -1, price: 0 } }; yield* g.say(undefined, '無人出價，宣佈流標'); return -1; }
    const buyer = high.p;
    yield { t: 'fx', kind: 'auction-end', p: buyer.id, data: { buyer: buyer.id, price } };
    if (prop.owner !== buyer.id + 1) {
      const months = LAND_LIMIT_MONTHS[g.settings.landLimitIndex];
      if (prop.owner === 0 && months) prop.expire = addMonths(g.date, months);
      prop.owner = buyer.id + 1;
    }
    yield* g.say(buyer.id, `${g.name(buyer.id)}以${price}元得標`);
    yield { t: 'board' };
    // The original moves the money silently (rich4_ui_auction.asm:3244-3255, after 「…得標」): no payment box. Without the
    // quiet flag the screen showed 「X付給樂透獎池 拍賣 N 元」 after every public auction, three in a row at a bankruptcy.
    yield* g.transfer(buyer.id, seller, price, 0, '拍賣', true);
    return buyer.id;
  }

  /** A computer's raise (02 §10.5, :1474-1560): the largest step within its ceiling, corrected by cash + 500. */
  private aiStep(s: Seat, price: number): number {
    let step = AUCTION_STEPS.slice().reverse().find(v => price + v <= s.max) ?? 0;
    if (!step) return 0;
    const room = s.p.cash + 500 - price;
    if (price + step > s.p.cash + 500) step = AUCTION_STEPS.slice().reverse().find(v => v <= room) ?? 0;
    // A raise above cash is refused by the order button (:539-545); treated as a pass (推测).
    return step && price + step <= s.p.cash ? step : 0;
  }

  // ---------------------------------------------------------------- NPCs (01 §3.6, §7.1; 06; 02 §8.8)

  /** Is NPC actor npcBase..npcBase+3 (4..7) on the map this round? */
  npcActive(actor: number): boolean { return this.npcs[actor - this.g.npcBase]?.where === 0; }

  /** One NPC turn: moves 2..10 steps and does its job (01 §3.6, §7.1). */
  *npcTurn(actor: number): Flow {
    const g = this.g, n = this.npcs[actor - g.npcBase];
    if (!n || n.where !== 0) return;
    if (n.owner < 0 || !g.players[n.owner]?.whoPlays) { this.npcTo(actor, actor - g.npcBase <= 1 ? 'prison' : 'hospital'); return; }
    // Day counters (cards on NPCs): 0x80 has expired; N acts for N more NPC turns (推测: the NPC tick point is not documented).
    for (const k of ['sleep', 'sleepwalk', 'stay', 'turtle'] as const) if (n[k] === 0x80) n[k] = 0;
    const sleeping = n.sleep !== 0, staying = n.stay !== 0, turtle = n.turtle !== 0;
    n.sleep = tick(n.sleep); n.stay = tick(n.stay); n.turtle = tick(n.turtle); n.sleepwalk = tick(n.sleepwalk);
    if (sleeping) { yield* g.say(undefined, `${NPC_NAMES[actor - g.npcBase]}冬眠中`); return; }
    if (staying) return; // 0x82: ends after 2 ticks, no event
    let left = turtle ? 1 : g.rng.below(9) + 2;
    while (left > 0 && n.where === 0) {
      const next = g.nextNode(n.node, n.lastNode);
      const from = g.node(n.node), to = g.node(next);
      n.lastNode = n.node; n.node = next;
      n.dir = Game.direction(to.x - from.x, to.y - from.y);
      left -= 1;
      yield { t: 'actor-step', actor, from: from.id, to: to.id, dir: n.dir };
      left = yield* this.npcStepDone(actor, left);
      if (g.over) return;
    }
  }

  /** NPC part of _rich4_player_move_one_step_done (01 §7.1, 05 §3, 06 §5.6). Returns the steps left. */
  *npcStepDone(actor: number, left: number): Flow<number> {
    const g = this.g, n = this.npcs[actor - g.npcBase], kind = actor - g.npcBase;
    const node = g.node(n.node), master = g.players[n.owner];
    if (!master) return left;
    // Map objects on the node.
    const obj = g.objects.at(node.id);
    if (obj) {
      if (kind === 0) {
        if (!n.sleepwalk) {
          // The thief picks things up for its master, passing or stopping.
          // Each pickup: 「小偷偷得%s\n\n給%s！」 1500 ms with the object's name (core_actions:3020-3330); the gift
          // then 「得到%s！」 at the master, the chest 「得到５００點券！」 (`obj` is the object type).
          if (obj.type === 13) {
            g.objects.removeAt(node.id);
            const got = yield* g.tools.receiveRandom(master);
            yield { t: 'fx', kind: 'npc-pickup', p: master.id, node: node.id, data: { actor, obj: 13, tool: got } };
          } else if (obj.type === 14) {
            g.objects.removeAt(node.id);
            yield { t: 'fx', kind: 'npc-pickup', p: master.id, node: node.id, data: { actor, obj: 14 } };
            master.points = (master.points + 500) & 0xffff;
            yield { t: 'points', p: master.id, amount: 500 };
          } else if (obj.type >= 16 && obj.type <= 18) {
            g.objects.removeAt(node.id);
            g.tools.receive(master, obj.type - 14); // roadblock 2, mine 3, time bomb 4
            yield { t: 'fx', kind: 'npc-pickup', p: master.id, node: node.id, data: { actor, obj: obj.type, tool: obj.type - 14 } };
          }
        }
      } else if (obj.type === 16) {
        g.objects.removeAt(node.id);
        left = 0;
        yield { t: 'fx', kind: 'roadblock', node: node.id, data: { actor } };
      } else if (obj.type === 17 && left === 0) {
        g.objects.removeAt(node.id);
        yield { t: 'fx', kind: 'mine', node: node.id, data: { actor } };
        this.npcTo(actor, 'hospital');
        yield { t: 'board' };
        return 0;
      }
      if (obj.type === 11 && left === 0 && n.where === 0) {
        // 01 §7.1: the dog still sends an NPC to hospital (loc_0041b8a7).
        g.objects.removeAt(node.id);
        yield { t: 'fx', kind: 'dog', node: node.id, data: { actor } };
        this.npcTo(actor, 'hospital');
        yield { t: 'board' };
        return 0;
      }
    }
    // The NPC's own job, only on the map and not sleepwalking.
    if (n.where === 0 && !n.sleepwalk) {
      const victim = g.occupants(node.id).find(q => q.whoPlays !== 0 && q.id !== master.id);
      if (kind === 0 && victim) {
        // core_actions:3600-3640: half the points, rounded down, are taken (「偷取%s\n\n%d點點券！」 1000 ms).
        const taken = victim.points >> 1;
        if (taken) {
          victim.points -= taken;
          master.points = (master.points + taken) & 0xffff;
          yield { t: 'fx', kind: 'npc-steal', p: victim.id, target: master.id, data: { actor, points: taken } };
        }
      } else if (kind === 1) {
        if (victim) {
          const card = g.cards.dropRandom(victim);
          if (card) {
            g.cards.receive(master, card);
            yield { t: 'fx', kind: 'npc-rob-card', p: victim.id, target: master.id, data: { actor, card } };
          }
        }
        if (node.event === 14) {
          // 02 §8.8: 20% of every other living player's deposit into the master's cash, moved silently, then one
          // message box 「強盜搶奪銀行\n\n得款%d元\n\n給%s！」 2000 ms with the total (core_actions:3700-3760).
          let total = 0;
          for (const q of g.players) {
            if (!q.whoPlays || q.id === master.id || !master.whoPlays) continue;
            const amount = Math.trunc(q.bank * 0.2);
            if (amount > 0) total += yield* g.transfer(q.id, master.id, amount, 5, '搶劫', true);
            if (g.over) return 0;
          }
          yield { t: 'fx', kind: 'npc-rob-bank', p: master.id, node: node.id, data: { actor, total } };
        }
      } else if ((kind === 2 || kind === 3) && left === 0) {
        yield* this.npcCollect(actor, node, master);
        if (g.over) return 0;
      }
    }
    // Released NPCs go back on their second pass over the prison (E 4) or hospital (E 5) tile.
    const origin = n.origin & 3;
    if (n.where === 0 && origin && node.event === (origin === 1 ? 4 : 5)) {
      if (n.origin & 0x80) {
        this.npcTo(actor, origin === 1 ? 'prison' : 'hospital');
        yield { t: 'fx', kind: 'npc-return', node: n.node, data: { actor } };
        return 0;
      }
      n.origin |= 0x80;
    }
    return left;
  }

  /**
   * Hooligan and spy stopping (core_actions:3770-4035): on someone else's lot the hooligan extorts the street's
   * worth — the prices of every lot of that name the owner holds × F (a facility: its price × F) — with
   * 「勒索%s\n\n%d元保護費！」; the spy takes the lot's last toll (a facility's last fee) with 「取走過路費\n\n%d元！」,
   * and on a company tile with another controller this month's surplus with 「取走盈餘\n\n%d元！」. Each box 1500 ms,
   * then the money moves without a box of its own (fcn_0041d2c6). (The original also moves a negative surplus;
   * here only a positive one is taken.)
   */
  private *npcCollect(actor: number, node: BoardNode, master: Player): Flow {
    const g = this.g, land = landOf(g.board, node), fac = facilityOf(g.board, node), company = companyOf(g.board, node);
    const me = master.id + 1, kind = actor - g.npcBase;
    if (land || fac) {
      const owner = land ? land.owner : fac!.owner;
      const payer = g.players[owner - 1];
      if (!owner || owner === me || !payer?.whoPlays) return;
      if (kind === 2) {
        const worth = land ? g.board.lands.filter(l => l.owner === owner && l.name === land.name).reduce((a, l) => a + l.price, 0) : fac!.price;
        const amount = worth * g.priceIndex;
        if (amount <= 0) return;
        yield* g.say(undefined, `勒索${g.name(payer.id)}\n\n${amount}元保護費！`);
        yield* g.transfer(payer.id, master.id, amount, 0, '保護費', true);
      } else {
        const amount = land ? land.lastToll : fac!.lastFee;
        if (amount <= 0) return;
        yield* g.say(undefined, `取走過路費\n\n${amount}元！`);
        yield* g.transfer(payer.id, master.id, amount, 0, '過路費', true);
      }
      return;
    }
    if (company && kind === 3 && company.controller && company.controller !== me && company.fundA > 0) {
      const amount = company.fundA;
      yield* g.say(undefined, `取走盈餘\n\n${amount}元！`);
      yield* g.transfer(100 + g.board.companies.indexOf(company) + 1, master.id, amount, 0, '盈餘', true);
    }
  }

  /** A bankrupt master's NPCs go back: thief and robber to prison, hooligan and spy to hospital (02 §9.3). */
  returnNpcsOf(p: Player): void {
    this.npcs.forEach((n, i) => {
      if (n.owner === p.id && n.where !== 3) this.npcTo(this.g.npcBase + i, i < 2 ? 'prison' : 'hospital');
    });
  }
}
