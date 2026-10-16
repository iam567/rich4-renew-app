/**
 * Gods and map objects — docs/rules/06 §5, docs/rules/05 §4, docs/rules/01 §2.4 and §7.1.
 * Owns: the 46 object slots (gods, dog, gift, chest, Death, roadblocks, mines, time bombs), attaching gods
 * to players (luck values), what happens when a player steps on or stops at an object, and monthly moves.
 */
import { facilityOf, landOf, type BoardNode } from '../board';
import { ask, type Flow } from '../flow';
import type { Game } from '../game';
import type { Player } from '../types';
import { slotBonus, runSlotMachine, SLOT_AUTO_PULL } from './slot-machine';

export interface MapObject {
  /** 1..18, see the type table in docs/rules/01 §2.4. */
  type: number;
  /** Node it sits on, 0 = not on the map. */
  node: number;
  dir: number;
  /** Days left while attached, or steps left for a carried bomb. */
  life: number;
  /** Player id + 1 it is attached to, 0 = none. */
  owner: number;
}

/** Object type numbers (docs/rules/01 §2.4). */
export const OBJ = {
  SmallWealth: 1, BigWealth: 2, SmallFortune: 3, BigFortune: 4, SmallPoor: 5, BigPoor: 6,
  SmallBadLuck: 7, BigBadLuck: 8, Angel: 9, Devil: 10, Dog: 11, EarthGod: 12, Gift: 13, Chest: 14,
  Death: 15, Roadblock: 16, Mine: 17, TimeBomb: 18,
} as const;

/** Names by type - 1 (rich4.asm:49896). Bug decision #15: looked up by type, never by slot id. */
export const OBJECT_NAMES = [
  '小財神', '大財神', '小福神', '大福神', '小窮神', '大窮神', '小衰神', '大衰神', '天使', '小惡魔',
  '惡犬', '土地公', '禮物', '寶箱', '死神', '路障', '地雷', '定時炸彈',
];

/** Fixed slot types 0x47ed3c (01 §2.4): slots 1..14 = type, 15-16 Death, 17-26 roadblock, 27-36 mine, 37-46 bomb. */
export const SLOT_TYPES: readonly number[] = Array.from({ length: 46 }, (_, i) =>
  i < 14 ? i + 1 : i < 16 ? 15 : i < 26 ? 16 : i < 36 ? 17 : 18);

/** Luck tables ref_004749e2 / ref_00474a06 / ref_00474a2a by type - 1 (06 §5.1): +68, +70 money, +72 fate. */
export const LUCK_BAD = [-100, -200, -100, -200, 100, 200, 100, 200, -100, 100, 0, -500, 0, 0, 1000];
export const LUCK_MONEY = [100, 150, 0, 0, -60, -100, 0, 0, 60, -60, 0, 0, 0, 0, -200];
export const LUCK_FATE = [0, 0, 100, 150, 0, 0, -60, -100, 60, -60, 0, 0, 0, 0, -200];

/** Gods 送神符 sends away (04 §3.22) and whose leaving is announced (06 §5.2). */
const BAD_GODS = new Set([5, 6, 7, 8, 10, 15]);
/** Types the 请神符 may call (fcn_0040ea62, 06 §5.2). */
const INVITABLE = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15]);
/** Carried time bomb life in steps (0x26). */
export const BOMB_STEPS = 38;
/** Days an attached god stays; Death stays 13 (rich4_gods.asm:514-523). */
const GOD_DAYS = 7;
const DEATH_DAYS = 13;
/** The one Death slot id used (bug decision #9: only one Death on the field). */
const DEATH_SLOT = 15;

/** 8-way facing, same formula as Game.direction (01 §6.3); kept local to avoid a runtime import cycle. */
function direction(dx: number, dy: number): number {
  let angle = Math.round((Math.atan2(-dy, dx) / (2 * Math.PI)) * 65536);
  if (angle < 0) angle += 65536;
  const sector = (((angle >> 12) + 1) >> 1) & 7;
  return (sector + 2) & 7;
}

export class Objects {
  /** 46 slots, index = slot id - 1; slot types are fixed (0x47ed3c). */
  slots: MapObject[] = [];

  constructor(readonly g: Game) {}

  /** New game: fixed slot types, then the starting objects on random free nodes (01 §2.4). */
  init(): void {
    this.slots = SLOT_TYPES.map(type => ({ type, node: 0, dir: 0, life: 0, owner: 0 }));
    for (const type of [1, 3, 5, 7, 9, 11, 13, 14]) this.put(type, this.g.randomFreeNode().id);
  }

  /** Object on a node, if any (attached gods and carried bombs are not on the map). */
  at(node: number): MapObject | undefined {
    return node ? this.slots.find(o => o.node === node) : undefined;
  }

  /** Slot id (1-based) of the object on a node, 0 = none. */
  idAt(node: number): number {
    return node ? this.slots.findIndex(o => o.node === node) + 1 : 0;
  }

  /** Type (1..15) of the god attached to a player, 0 = none. */
  godType(p: Player): number {
    // 大富豪模式: a god belongs to the city its holder is in (docs/rules/17 §7).
    if (p.god && this.g.world && !this.g.here(p)) return this.g.world.hooks.cityOf(p)?.objects.godType(p) ?? 0;
    return p.god ? this.slots[p.god - 1]?.type ?? 0 : 0;
  }

  /** Display name of a player's god (bug decision #15: by type). */
  godName(p: Player): string {
    const t = this.godType(p);
    return t ? OBJECT_NAMES[t - 1] : '';
  }

  // ---------------------------------------------------------------- placing and removing

  /** _rich4_place_object: first free slot of the type; facing = towards the node's first exit. Returns the slot id or 0. */
  private put(type: number, node: number): number {
    if (this.g.rules?.godAllowed && !this.g.rules.godAllowed(type)) return 0; // 大富翁城 (docs/rules/19 §5.6)
    const i = this.slots.findIndex(o => o.type === type && o.node === 0 && o.owner === 0);
    if (i < 0) return 0;
    const o = this.slots[i], n = this.g.node(node), exit = n.adjacent.find(Boolean);
    const to = exit ? this.g.node(exit) : n;
    Object.assign(o, { node, dir: direction(to.x - n.x, to.y - n.y), life: 0, owner: 0 });
    return i + 1;
  }

  /** Place a roadblock, mine or time bomb from a tool (05 §4). Returns false when no slot is free. */
  place(type: number, node: number): boolean {
    if (!node || this.at(node)) return false;
    return this.put(type, node) !== 0;
  }

  /**
   * _rich4_remove_object (05 §4.3, 06 §5.2): roadblocks, mines and bombs go back to the shop's supply; an attached
   * god takes its luck values with it; slots 1..12 put the other god of their pair on a distant free node.
   */
  remove(id: number): void {
    const o = this.slots[id - 1];
    if (!o || (!o.node && !o.owner)) return;
    const holder = o.owner ? this.g.players[o.owner - 1] : undefined;
    const origin = o.node || holder?.node || 0;
    if (o.type >= 16) {
      const stock = this.g.tools.shopStock, tool = o.type - 14; // roadblock 2, mine 3, bomb 4
      stock[tool - 1] = (stock[tool - 1] ?? 0) + 1;
      if (holder && holder.bomb === id) holder.bomb = 0;
    } else if (holder && holder.god === id) {
      if (!this.g.rules?.godsCasinoOnly) {
        holder.luckBad -= LUCK_BAD[o.type - 1];
        holder.luckMoney -= LUCK_MONEY[o.type - 1];
        holder.luckFate -= LUCK_FATE[o.type - 1];
      }
      holder.god = 0;
    }
    Object.assign(o, { node: 0, life: 0, owner: 0 });
    if (id <= 12) {
      const pair = id % 2 ? id + 1 : id - 1, other = this.slots[pair - 1];
      if (!other.node && !other.owner) {
        const near = origin ? this.g.node(origin) : undefined;
        this.put(other.type, this.g.randomFreeNode(near).id);
      }
    }
  }

  /** Remove whatever object is on a node (robot doll, roadblock pick-up …). */
  removeAt(node: number): void {
    const id = this.idAt(node);
    if (id) this.remove(id);
  }

  /** Remove a player's attached god and carried bomb (bankruptcy, 02 §9.3). */
  detachAll(p: Player): void {
    if (p.god) this.remove(p.god);
    if (p.bomb) this.remove(p.bomb);
    p.god = 0;
    p.bomb = 0;
  }

  // ---------------------------------------------------------------- attaching

  /**
   * _rich4_attach_god (06 §5.1-§5.2): an old god leaves first, then the new one attaches for 7 days (Death 13),
   * adds its luck values and gives its one-off effect.
   */
  *attach(p: Player, id: number): Flow {
    const o = this.slots[id - 1];
    if (!o || p.id >= this.g.npcBase || !p.whoPlays) return;
    const rules = this.g.rules;
    if (rules?.godAllowed && !rules.godAllowed(o.type)) return; // 大富翁城 (docs/rules/19 §5.6)
    if (p.god) yield* this.detachGod(p);
    const type = o.type;
    Object.assign(o, { node: 0, owner: p.id + 1, life: rules?.godDays?.(type) ?? (type === OBJ.Death ? DEATH_DAYS : GOD_DAYS) });
    p.god = id;
    if (!rules?.godsCasinoOnly) {
      p.luckBad += LUCK_BAD[type - 1];
      p.luckMoney += LUCK_MONEY[type - 1];
      p.luckFate += LUCK_FATE[type - 1];
    }
    yield { t: 'fx', kind: 'god-attach', p: p.id, data: { type } };
    yield { t: 'board' };
    yield* this.say(p, `${OBJECT_NAMES[type - 1]}附身${rules?.godNote?.(type) ?? ''}`);
    if (!rules?.godsCasinoOnly) yield* this.attachEffect(p, type);
  }

  /** One-off effects on attaching (jump table ref_0040ea9b, rich4_gods.asm:540-1194). */
  private *attachEffect(p: Player, type: number): Flow {
    const g = this.g;
    const opponents = () => g.players.filter(q => q.id !== p.id && q.whoPlays !== 0);
    switch (type) {
      case OBJ.SmallWealth: {
        // Animation, slot machine, every opponent pays into your cash, then over 700 your line [8] (gods.asm:555-631).
        const amount = yield* this.slotMachine(p, type);
        for (const q of opponents()) {
          if (!q.whoPlays || g.over) continue;
          yield* g.transfer(q.id, p.id, amount, 1, OBJECT_NAMES[0]);
        }
        if (amount > 700 && !g.over) yield { t: 'fx', kind: 'god-line', p: p.id, data: { line: 8 } };
        break;
      }
      case OBJ.BigWealth: {
        // fcn_0041d3f4(p, amount, 1), then from 5000 × F the gain line fcn_0044f354: [6] from 9000 × F, else
        // [6 + rand() & 1] (gods.asm:640-692, player_say_on_events.asm:152-200).
        const amount = yield* this.slotMachine(p, type);
        g.gain(p, amount, 1);
        if (amount >= 5000 * g.priceIndex) {
          const line = amount >= 9000 * g.priceIndex ? 6 : 6 + (g.rng.rand() & 1);
          yield { t: 'fx', kind: 'god-line', p: p.id, data: { line } };
        }
        break;
      }
      case OBJ.SmallFortune: case OBJ.BigFortune:
        for (let i = type === OBJ.BigFortune ? 2 : 1; i > 0; i--) {
          const card = yield* g.cards.receiveRandom(p);
          if (card) yield { t: 'fx', kind: 'card-received', p: p.id, data: { card } };
        }
        break;
      case OBJ.SmallPoor: {
        // You pay every opponent the amount, into their bank (gods.asm:821-889).
        const amount = yield* this.slotMachine(p, type);
        for (const q of opponents()) {
          if (!p.whoPlays || g.over) break;
          yield* g.transfer(p.id, q.id, amount, 0, OBJECT_NAMES[4]);
        }
        break;
      }
      case OBJ.BigPoor: {
        // You pay the amount to the system: the lottery pool (gods.asm:890-942).
        const amount = yield* this.slotMachine(p, type);
        yield* g.transfer(p.id, -1, amount, 0, OBJECT_NAMES[5]);
        break;
      }
      case OBJ.SmallBadLuck:
        if (p.cards.length) g.cards.dropRandom(p);
        break;
      case OBJ.BigBadLuck:
        this.dropHalfCards(p);
        break;
      case OBJ.Death:
        // Everything is sold, but the points are thrown away (rich4_gods.asm:1180-1195).
        yield* g.tools.dropAll(p);
        yield* g.cards.dropAll(p);
        break;
    }
  }

  /**
   * The slot machine fcn_00440706(type − 1) (06 §5.7, slot-machine.ts): shown for everybody. A human not on
   * autopilot and not sleepwalking pulls the lever with a tap (the answer is the frame of the pull); anyone else's
   * lever is pulled at frame 39. The amount is not × F.
   */
  private *slotMachine(p: Player, type: number): Flow<number> {
    const g = this.g, big = type === OBJ.BigWealth || type === OBJ.BigPoor;
    // The original asks the current player (_rich4_current_player +21 == 1 and +55 == 0), not the god's holder.
    const cur = g.current < g.npcBase ? g.players[g.current] : undefined;
    const human = !!cur && g.isHuman(cur) && !cur.sleepwalk;
    const pull = human ? Number(yield ask({ t: 'slot-machine', p: cur.id, god: type, big })) : SLOT_AUTO_PULL;
    const run = runSlotMachine(() => g.rng.rand(), big, pull > 0 ? pull : SLOT_AUTO_PULL);
    const mult = slotBonus(big ? run.digits : run.digits.slice(1)), amount = run.amount * mult;
    yield {
      t: 'fx', kind: 'slot-machine', p: p.id,
      data: { god: type, big, human, amount, base: run.amount, mult, digits: run.digits, pull: run.pull, reels: run.reels, leverUp: run.leverUp, stopped: run.stopped, result: run.result, end: run.end },
    };
    return amount;
  }

  /** _rich4_player_drop_half_the_card: with n ≥ 2 cards, the original slots 0, 2, 4 … are dropped back to the pool. */
  private dropHalfCards(p: Player) {
    const n = p.cards.length;
    if (n < 2) return;
    const drop = Math.floor(n / 2), pool = this.g.cards.remaining;
    const kept: number[] = [];
    p.cards.forEach((c, i) => {
      if (i % 2 === 0 && i / 2 < drop) pool[c - 1] = (pool[c - 1] ?? 0) + 1;
      else kept.push(c);
    });
    p.cards = kept;
  }

  /**
   * _rich4_detach_god (06 §5.2): luck values come off and the god leaves (its pair appears elsewhere).
   * A bad god's leaving is announced, unless the player is in a hotel, abroad, in prison or in hospital.
   */
  *detachGod(p: Player): Flow {
    if (!p.god) return;
    const type = this.godType(p), quiet = this.g.offRoad(p);
    this.remove(p.god);
    p.god = 0;
    if (quiet) return;
    yield { t: 'fx', kind: 'god-detach', p: p.id, data: { type } };
    if (BAD_GODS.has(type)) yield* this.say(p, `${OBJECT_NAMES[type - 1]}離開了`);
    yield { t: 'board' };
  }

  /** Death from a surrender (06 §5.3, _rich4_call_god_of_death_entry). Only one Death is kept (bug decision #9). */
  *callDeath(target: Player): Flow {
    const death = this.slots[DEATH_SLOT - 1];
    if (death.owner) {
      const holder = this.g.players[death.owner - 1];
      if (holder === target) { death.life = DEATH_DAYS; return; }
      yield* this.detachGod(holder);
    }
    yield* this.attach(target, DEATH_SLOT);
  }

  // ---------------------------------------------------------------- turn, month, payments, luck

  /** Turn start: an attached god's days run down and it leaves at 0 (01 §3.2 step 11). */
  *turnStart(p: Player): Flow {
    if (!p.god) return;
    const o = this.slots[p.god - 1];
    o.life -= 1;
    if (o.life <= 0) yield* this.detachGod(p);
  }

  /** Month start: gift and treasure chest move to distant random nodes (01 §4.2 step 13). */
  *monthly(): Flow {
    for (const id of [OBJ.Gift, OBJ.Chest]) {
      const o = this.slots[id - 1], origin = o.node;
      Object.assign(o, { node: 0, life: 0, owner: 0 });
      this.put(o.type, this.g.randomFreeNode(origin ? this.g.node(origin) : undefined).id);
    }
    yield { t: 'board' };
  }

  /** Death or treasure chest pays instead (02 §3.7): first other living player with god type 14 or 15. */
  deathPayer(payer: Player): number | null {
    const d = this.g.players.find(q => q.id !== payer.id && q.whoPlays !== 0 && (this.godType(q) === 14 || this.godType(q) === 15));
    return d ? d.id : null;
  }

  /**
   * God luck check fcn_0044b896 (06 §2.1): kind 0 money (sub 0 gain / 1 loss), kind 1 misfortune.
   * Gain: 2 doubled, 1 void. Loss and misfortune: 1 spared, 2 doubled. 0 = as is.
   */
  *luck(p: Player, kind: number, sub: number): Flow<number> {
    const v = kind === 0 ? p.luckMoney : p.luckFate;
    const gain = kind === 0 && sub === 0;
    const good = gain ? 2 : 1, bad = gain ? 1 : 2;
    let r = 0;
    if (v > 100) r = good;
    else if (v > 50) r = this.g.rng.rand() & 1 ? good : 0;
    else if (v < 0) r = bad;
    if (r) {
      const name = this.godName(p) || '神明';
      const what = kind === 0
        ? sub === 0 ? (r === 2 ? '獎金加倍' : '獎金作廢') : (r === 1 ? '免付罰金' : '罰金加倍')
        : r === 1 ? '逃過此劫' : '倒楣加倍';
      yield* this.say(p, `${name}${r === good ? '保佑' : '作祟'}\n\n${what}！`);
    }
    return r;
  }

  // ---------------------------------------------------------------- cards

  /** 送神符 (docs/rules/04 §3.22): send away an attached bad god from a player. Returns true when one left. */
  *sendAwayGod(p: Player): Flow<boolean> {
    let done = false;
    if (p.bomb) {
      this.remove(p.bomb);
      p.bomb = 0;
      yield { t: 'fx', kind: 'bomb-removed', p: p.id };
      done = true;
    }
    if (BAD_GODS.has(this.godType(p))) {
      yield* this.detachGod(p);
      done = true;
    }
    return done;
  }

  /** 请神符 target (04 §3.23): node of the nearest unattached god on the map that can be called, 0 = none. */
  nearestInvitable(p: Player): number {
    const at = this.g.node(p.node);
    let best = 0, dist = 10000;
    for (const o of this.slots) {
      if (!o.node || o.owner || !INVITABLE.has(o.type)) continue;
      const n = this.g.node(o.node), d = Math.hypot(n.x - at.x, n.y - at.y);
      if (d < dist) { dist = d; best = o.node; }
    }
    return best;
  }

  /** 请神符 (docs/rules/04 §3.23): call a god from the map to attach to a player. Returns true on success. */
  *inviteGod(p: Player, node: number): Flow<boolean> {
    const id = this.idAt(node), o = id ? this.slots[id - 1] : undefined;
    if (!o || o.owner || !INVITABLE.has(o.type)) return false;
    yield { t: 'fx', kind: 'god-fly', p: p.id, node, data: { type: o.type } };
    yield* this.attach(p, id);
    return true;
  }

  // ---------------------------------------------------------------- moving and stopping

  /** Per-step handling (01 §7.1 steps 3-4): carried bomb, then the object on the node. Returns steps left. */
  *step(p: Player, left: number): Flow<number> {
    const g = this.g, node = p.node;
    // 3. The carried time bomb counts down every step and passes to the first other occupant.
    if (p.bomb) {
      const bomb = this.slots[p.bomb - 1];
      bomb.life -= 1;
      if (bomb.life <= 0) {
        this.remove(p.bomb);
        p.bomb = 0;
        const n = g.node(node);
        if (n.ref) g.damageProperty(n.ref, 0);
        g.tools.destroyVehicle(p);
        yield { t: 'fx', kind: 'bomb-explode', p: p.id, node };
        yield { t: 'board' };
        yield* g.sendTo(p, 'hospital', 5);
        return 0;
      }
      const other = g.occupants(node).find(q => q.id !== p.id);
      if (other && other.whoPlays !== 0 && !other.bomb) {
        bomb.owner = other.id + 1;
        other.bomb = p.bomb;
        p.bomb = 0;
        yield { t: 'fx', kind: 'bomb-pass', p: p.id, target: other.id };
      }
    }
    // 4. The object on the node (jump table ref_0041b3e5).
    const id = this.idAt(node);
    if (!id) return left;
    const type = this.slots[id - 1].type;
    if (type === OBJ.Roadblock) {
      this.remove(id);
      yield { t: 'fx', kind: 'roadblock', p: p.id, node };
      yield { t: 'board' };
      yield* this.say(p, '前有路障，停止前進！');
      return 0;
    }
    if (left !== 0) return left;
    switch (type) {
      case OBJ.Dog: {
        this.remove(id);
        const riding = (p.traffic & 3) !== 0;
        yield { t: 'fx', kind: 'dog', p: p.id, node, data: { riding } };
        yield { t: 'board' };
        if (riding) return 0;
        g.tools.destroyVehicle(p);
        yield* g.sendTo(p, 'hospital', 3);
        return 0;
      }
      case OBJ.Gift: {
        const tool = yield* g.tools.receiveRandom(p);
        if (tool) {
          this.remove(id);
          yield { t: 'fx', kind: 'gift', p: p.id, node, data: { tool } };
          yield { t: 'board' };
        }
        return 0;
      }
      case OBJ.Chest:
        this.remove(id);
        p.points = (p.points + 500) & 0xffff;
        yield { t: 'fx', kind: 'chest', p: p.id, node };
        yield { t: 'board' };
        yield { t: 'points', p: p.id, amount: 500 };
        yield* this.say(p, '得到５００點券！');
        return 0;
      case OBJ.Death:
        return 0;
      case OBJ.Mine:
        this.remove(id);
        g.tools.destroyVehicle(p);
        yield { t: 'fx', kind: 'mine', p: p.id, node };
        yield { t: 'board' };
        yield* g.sendTo(p, 'hospital', 3);
        return 0;
      case OBJ.TimeBomb:
        if (p.bomb) return 0;
        Object.assign(this.slots[id - 1], { node: 0, owner: p.id + 1, life: BOMB_STEPS });
        p.bomb = id;
        yield { t: 'fx', kind: 'bomb-pickup', p: p.id, node };
        yield { t: 'board' };
        return 0;
      default: // gods 1..10, 12
        yield* this.attach(p, id);
        return 0;
    }
  }

  /** After stopping on property (06 §5.5, fcn_0040f381): angel, devil, earth god act on the lot. */
  *landEffect(p: Player): Flow {
    const g = this.g;
    if (!p.whoPlays || g.offRoad(p)) return;
    const god = this.godType(p);
    if (god !== OBJ.Angel && god !== OBJ.Devil && god !== OBJ.EarthGod) return;
    const n: BoardNode = g.node(p.node);
    const land = landOf(g.board, n), fac = facilityOf(g.board, n);
    if (!land && !fac) return;
    const name = OBJECT_NAMES[god - 1];
    if (god === OBJ.Angel) {
      if (fac && fac.level === 0) { yield* this.say(p, `${name}顯靈\n\n空地無法加蓋！`); return; }
      const level = g.freeUpgrade(n.ref);
      if (level < 0) return;
      yield { t: 'fx', kind: 'angel', p: p.id, node: n.id, data: { ref: n.ref, level: level & 0x7f, top: (level & 0x80) !== 0 } };
      yield { t: 'board' };
      return;
    }
    if (god === OBJ.Devil) {
      const built = land ? land.level > 0 || land.chain : fac!.level > 0;
      if (!built) return;
      const owner = land ? land.owner : fac!.owner;
      if (owner) g.addHostility(owner - 1, p.id, 30 * g.priceIndex);
      g.damageProperty(n.ref, 0);
      yield { t: 'fx', kind: 'devil', p: p.id, node: n.id, data: { ref: n.ref } };
      yield { t: 'board' };
      return;
    }
    // Earth god: takes the lot with its buildings. Bug decision #2: the hostility is the real value, not a mangled double.
    const lot = land ?? fac!;
    if (lot.owner === p.id + 1) return;
    if (lot.owner) g.addHostility(lot.owner - 1, p.id, Math.trunc((lot.price * g.priceIndex * (lot.level + 2)) / 5));
    lot.owner = p.id + 1;
    yield { t: 'fx', kind: 'earth-god', p: p.id, node: n.id, data: { ref: n.ref } };
    yield { t: 'board' };
  }

  private *say(p: Player, text: string): Flow {
    yield* this.g.say(p.id, text);
  }
}
