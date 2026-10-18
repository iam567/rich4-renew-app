import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../board';
import { pack } from '../date';
import type { Flow } from '../flow';
import { Game } from '../game';
import type { Answer, Ask, GameEvent, GameSettings, PickSpot } from '../types';
import { CARDS, HAND_LIMIT, REMAKE_SUPPLY } from './cards';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

/** Characters 約翰喬 (personality 2), 阿土伯 (1), 孫小美 (0), 金貝貝 (2). */
function makeGame(seed = 1, humans = [false, false, false, false]): Game {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map((character, i) => ({ character, human: humans[i] })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed,
  };
  const g = new Game(settings, board);
  const start = g.board.nodes.find(n => n.adjacent.filter(Boolean).length === 2 && !n.ref)!;
  for (const p of g.players) {
    p.placed = true;
    p.whoPlays = p.human ? 1 : 2;
    p.node = start.id;
    p.lastNode = start.adjacent.find(Boolean)!;
    p.cash = 50000; p.bank = 50000;
  }
  return g;
}

/** Runs a flow to the end, answering questions; returns the value, events and questions asked. */
function drive<T>(flow: Flow<T>, answer: (a: Ask) => Answer = () => undefined) {
  const events: GameEvent[] = [], asks: Ask[] = [];
  let r = flow.next();
  while (!r.done) {
    const s = r.value;
    if ('ask' in s) { asks.push(s); r = flow.next(answer(s)); } else { events.push(s); r = flow.next(); }
  }
  return { value: r.value, events, asks };
}

/** A pick-map answer: the index of the spot for that target, or null for another question. */
const spot = (a: Ask, at: PickSpot['at'], id: number): Answer | null => {
  if (a.t !== 'pick-map') return null;
  const i = a.spots.findIndex(s => s.at === at && s.id === id);
  if (i < 0) throw new Error(`no ${at} ${id} among ${JSON.stringify(a.spots)}`);
  return i;
};

/** Answer script for a human: the first matching handler wins, otherwise cancel. */
const script = (...steps: ((a: Ask) => Answer | null)[]) => {
  let i = 0;
  return (a: Ask): Answer => {
    while (i < steps.length) { const v = steps[i++](a); if (v !== null) return v; }
    return a.t === 'pick-node' ? 0 : a.t === 'yesno' ? false : -1;
  };
};

describe('card table', () => {
  it('has 30 cards and 100 copies', () => {
    expect(CARDS).toHaveLength(30);
    expect(CARDS.reduce((s, c) => s + c.supply, 0)).toBe(100);
    expect(CARDS.reduce((s, c) => s + (REMAKE_SUPPLY[c.id] ?? c.supply), 0)).toBe(102); // the remake's copies (04 §1)
    expect(CARDS.filter(c => c.passive).map(c => c.id)).toEqual([18, 19, 20, 21]);
  });
});

describe.skipIf(!haveMaps)('cards', () => {
  it('a full hand drops its cheapest card (first on ties), even for a cheaper newcomer', () => {
    const g = makeGame(), p = g.players[0], c = g.cards;
    p.cards = [3, 4, 20, 7, 12, 3, 4, 20, 3, 4, 20, 3, 4, 20, 29];
    expect(p.cards).toHaveLength(HAND_LIMIT);
    const before = [...c.remaining];
    c.receive(p, 22); // 送神符 (10 points) is cheaper than all, still enters
    expect(p.cards).toEqual([3, 4, 20, 12, 3, 4, 20, 3, 4, 20, 3, 4, 20, 29, 22]);
    expect(c.remaining[7 - 1]).toBe(before[7 - 1] + 1);
    expect(c.remaining[22 - 1]).toBe(before[22 - 1] - 1);
  });

  it('consume removes the first copy; dropHalf drops original slots 0, 2, 4', () => {
    const g = makeGame(), p = g.players[0], c = g.cards;
    p.cards = [5, 6, 5, 7];
    expect(c.consume(p, 5)).toBe(true);
    expect(p.cards).toEqual([6, 5, 7]);
    expect(c.consume(p, 1)).toBe(false);
    p.cards = [1, 2, 3, 4, 5];
    expect(c.dropHalf(p)).toBe(true);
    expect(p.cards).toEqual([2, 4, 5]);
  });

  it('draws weighted by the pool and draws nothing from an empty pool', () => {
    const g = makeGame(7), c = g.cards;
    c.remaining = new Array(30).fill(0);
    const seed = g.rng.seed;
    expect(c.drawId()).toBe(0);
    expect(g.rng.seed).toBe(seed); // no rand() when empty
    c.remaining[4] = 3;
    for (let i = 0; i < 20; i++) expect(c.drawId()).toBe(5);
    c.remaining[4] = 0; c.remaining[0] = 1; c.remaining[1] = 3;
    let ones = 0;
    for (let i = 0; i < 4000; i++) if (c.drawId() === 1) ones++;
    expect(ones / 4000).toBeGreaterThan(0.21);
    expect(ones / 4000).toBeLessThan(0.29);
    const p = g.players[0];
    const id = drive(c.receiveRandom(p)).value;
    expect(p.cards).toEqual([id]);
  });

  it('均富卡 averages cash of everyone in play, the remainder is lost', () => {
    const g = makeGame(1, [true, false, false, false]), p = g.players[0];
    [100, 200, 301, 0].forEach((cash, i) => (g.players[i].cash = cash));
    p.cards = [1];
    drive(g.cards.humanUse(p), script(a => (a.t === 'choose' ? 0 : null)));
    expect(g.players.map(q => q.cash)).toEqual([150, 150, 150, 150]);
    expect(g.players[2].hostility[0]).toBe(1);
    expect(g.players[1].hostility[0]).toBe(0);
    expect(p.cards).toEqual([]);
  });

  it('a cancelled target keeps the card and reopens the panel', () => {
    const g = makeGame(1, [true, false, false, false]), p = g.players[0];
    p.cards = [2];
    const r = drive(g.cards.humanUse(p), script(a => (a.t === 'choose' ? 0 : null), a => (a.t === 'pick-map' ? -1 : null)));
    expect(p.cards).toEqual([2]);
    expect(r.asks.map(a => a.t)).toEqual(['choose', 'pick-map', 'choose']);
  });

  it('換地卡 swaps the owners of two opponents\' lots; buildings stay', () => {
    const g = makeGame(1, [true, false, false, false]), p = g.players[0];
    const landNodes = g.board.nodes.filter(n => n.ref > 2000 && n.ref < 4000);
    const a = landNodes[0], b = landNodes.find(n => n.ref !== a.ref)!;
    const la = g.board.lands[a.ref - 2001], lb = g.board.lands[b.ref - 2001];
    la.owner = 2; la.level = 3; lb.owner = 3; lb.level = 1;
    p.node = a.id;
    p.cards = [4];
    drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'plot', b.ref)));
    expect([la.owner, la.level, lb.owner, lb.level]).toEqual([3, 3, 2, 1]);
    expect(p.cards).toEqual([]);
  });

  it('天使卡 raises a whole street, building ownerless houses on empty lots', () => {
    const g = makeGame(1, [true, false, false, false]), p = g.players[0];
    const node = g.board.nodes.find(n => n.ref > 2000 && n.ref < 4000)!;
    const street = g.board.lands.filter(l => l.name === g.board.lands[node.ref - 2001].name);
    for (const l of street) { l.owner = 0; l.level = 0; l.chain = false; }
    street[0].level = 5;
    p.cards = [9];
    drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'plot', node.ref)));
    expect(street.map(l => l.level)).toEqual(street.map((_, i) => (i === 0 ? 5 : 1)));
    expect(street.every(l => l.owner === 0)).toBe(true);
  });

  it('停留卡 writes 0x80 on oneself and 1 on another player', () => {
    const g = makeGame(1, [true, false, false, false]), p = g.players[0];
    p.cards = [14, 14];
    drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 0)));
    drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 2)));
    expect(p.stay).toBe(0x80);
    expect(g.players[2].stay).toBe(1);
  });

  describe('陷害卡 chain: pardon > frame > revenge', () => {
    const frame = (setup: (g: Game) => void) => {
      const g = makeGame(3, [true, false, false, false]), p = g.players[0];
      p.cards = [17];
      setup(g);
      drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 1)));
      return g;
    };
    it('pardon cancels and keeps the revenge card', () => {
      const g = frame(g => (g.players[1].cards = [21, 18]));
      expect(g.players[1].prison).toBe(0);
      expect(g.players[1].cards).toEqual([18]);
      expect(g.players[0].prison).toBe(0);
      expect(g.players[1].hostility[0]).toBe(150);
    });
    it('frame passes it on and revenge does not fire', () => {
      const g = frame(g => { g.players[1].cards = [19, 18]; g.players[1].hostility[2] = 1000; });
      expect(g.players[2].prison).toBe(5);
      expect(g.players[1].prison).toBe(0);
      expect(g.players[1].cards).toEqual([18]);
    });
    it('framing the user gives 4 days', () => {
      const g = frame(g => (g.players[1].cards = [19]));
      expect(g.players[0].prison).toBe(4);
    });
    it('revenge sends the user to prison too', () => {
      const g = frame(g => (g.players[1].cards = [18]));
      expect(g.players[1].prison).toBe(5);
      expect(g.players[0].prison).toBe(5);
      expect(g.players[1].cards).toEqual([]);
    });
  });

  it('夢遊卡 framed back onto the user: 4 turns and the scooter goes back to the tools', () => {
    const g = makeGame(3, [true, false, false, false]), p = g.players[0];
    p.traffic = 1; p.dice = 2;
    const scooters = p.tools[4];
    g.players[1].cards = [19];
    p.cards = [16];
    drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 1)));
    expect(p.sleepwalk).toBe(4);
    expect([p.traffic, p.dice, p.sleepTraffic, p.sleepDice]).toEqual([0, 1, 1, 2]);
    expect(p.tools[4]).toBe(scooters + 1);
  });

  it('查稅卡 frames only above 2000 and recomputes the tax on the new payer', () => {
    const g = makeGame(3, [true, false, false, false]), p = g.players[0];
    const t = g.players[1], other = g.players[2];
    t.cards = [19]; t.cash = 5000;
    p.cards = [26, 26];
    const play = () => drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 1)));
    const bank0 = p.bank;
    play();
    expect(t.cash).toBe(4000);
    expect(p.bank).toBe(bank0 + 1000);
    expect(t.cards).toEqual([19]);
    t.cash = 50000; t.hostility[2] = 1000; other.cash = 30000;
    play();
    expect(t.cards).toEqual([]);
    expect(t.cash).toBe(50000);
    expect(other.cash).toBe(24000);
  });

  describe('tollPassive', () => {
    it('leaves fees under 2000 × F that the payer can afford alone', () => {
      const g = makeGame(), p = g.players[1];
      p.cards = [20, 19];
      const seed = g.rng.seed;
      expect(drive(g.cards.tollPassive(p, 0, 1999)).value).toEqual({ payer: 1, amount: 1999 });
      expect(p.cards).toEqual([20, 19]);
      expect(g.rng.seed).toBe(seed);
    });
    it('a computer uses the free card on a fee above its cash', () => {
      const g = makeGame(), p = g.players[1];
      p.cards = [20]; p.cash = 1000;
      expect(drive(g.cards.tollPassive(p, 0, 3000)).value).toEqual({ payer: 1, amount: 0 });
      expect(p.cards).toEqual([]);
    });
    it('a small fee above cash + deposit still qualifies; the frame card moves it to the most hostile', () => {
      const g = makeGame(), p = g.players[1];
      p.cards = [19]; p.cash = 100; p.bank = 0; p.hostility[3] = 5;
      expect(drive(g.cards.tollPassive(p, 0, 500)).value).toEqual({ payer: 3, amount: 500 });
    });
    it('a human is asked about the free card', () => {
      const g = makeGame(1, [false, true, false, false]), p = g.players[1];
      p.cards = [20];
      const r = drive(g.cards.tollPassive(p, 0, 5000), a => (a.t === 'yesno' ? false : undefined));
      expect(r.asks).toHaveLength(1);
      expect(r.value).toEqual({ payer: 1, amount: 5000 });
      expect(p.cards).toEqual([20]);
    });
    it('pardonOrFrame: pardon first, then frame, else the player', () => {
      const g = makeGame(), p = g.players[1];
      p.cards = [19, 21];
      expect(drive(g.cards.pardonOrFrame(p)).value).toBe(-1);
      p.hostility[2] = 3;
      expect(drive(g.cards.pardonOrFrame(p)).value).toBe(2);
      expect(drive(g.cards.pardonOrFrame(p)).value).toBe(1);
    });
  });

  describe('computer choices', () => {
    it('personality threshold: f7 − personality ≥ 2 is never used and draws no rand()', () => {
      const g = makeGame(), p = g.players[2]; // 孫小美, personality 0
      g.players[1].cash = 999999;
      const seed = g.rng.seed;
      expect(g.cards.aiWants(p, 17)).toBe(false);
      expect(g.cards.aiWants(p, 1)).toBe(false);
      expect(g.rng.seed).toBe(seed);
    });

    it('均富卡 when poor among the rich', () => {
      const g = makeGame(), p = g.players[0]; // personality 2
      p.cash = 100;
      expect(g.cards.aiWants(p, 1)).toBe(true);
      p.cash = 40000;
      expect(g.cards.aiWants(p, 1)).toBe(false);
    });

    it('陷害卡 goes to the most hostile visible player without a revenge card', () => {
      const g = makeGame(), p = g.players[0];
      p.hostility[1] = 10;
      expect(g.cards.aiWants(p, 17)).toBe(true);
      expect(g.cards.aiArg0).toBe(1);
      g.players[1].cards = [18];
      expect(g.cards.aiWants(p, 17)).toBe(true);
      expect([2, 3]).toContain(g.cards.aiArg0);
    });

    it('more than 8 cards: a random start costs exactly one rand()', () => {
      const g = makeGame(), p = g.players[0];
      p.cards = new Array(9).fill(5); // 換屋卡: never used by the computer
      const probe = makeGame();
      probe.rng.rand();
      drive(g.cards.aiUse(p));
      expect(g.rng.seed).toBe(probe.rng.seed);
      expect(p.cards).toHaveLength(9);
    });

    it('is deterministic from the seed', () => {
      const run = () => {
        const g = makeGame(99), p = g.players[0];
        p.hostility[3] = 40;
        p.cards = [5, 6, 15, 17, 16, 26, 2, 14, 29, 13, 3];
        g.players[3].cards = [21];
        const out: string[] = [];
        for (let i = 0; i < 6; i++) out.push(JSON.stringify(drive(g.cards.aiUse(p)).events));
        return { out, cards: [...p.cards], state: g.players.map(q => [q.cash, q.prison, q.sleep, q.sleepwalk, q.stay]) };
      };
      const a = run(), b = run();
      expect(a).toEqual(b);
      expect(a.cards.length).toBeLessThan(11);
    });
  });

  describe('targets the human can pick (04 §2.4)', () => {
    /** A game with an empty map: no objects, no owners, nobody else near the start. */
    const clean = () => {
      const g = makeGame(5, [true, false, false, false]);
      for (const o of g.objects.slots) Object.assign(o, { node: 0, owner: 0, life: 0 });
      for (const q of g.players) { q.god = 0; q.bomb = 0; }
      return g;
    };
    const roadNodes = (g: Game) => g.board.nodes.filter(n => !n.ref && n.adjacent.filter(Boolean).length === 2);
    const spotsOf = (g: Game, card: number) => {
      const p = g.players[0];
      p.cards = [card];
      const r = drive(g.cards.humanUse(p), script(a => (a.t === 'choose' ? 0 : null)));
      const pick = r.asks.find(a => a.t === 'pick-map');
      return pick && pick.t === 'pick-map' ? pick : undefined;
    };

    it('拆除卡 removes a time bomb carried by a player: the carrier is freed, the bomb goes back to the shop', () => {
      const g = clean(), p = g.players[0], q = g.players[1];
      const slot = g.objects.slots.findIndex(o => o.type === 18) + 1;
      Object.assign(g.objects.slots[slot - 1], { owner: 2, node: 0, life: 20 });
      q.bomb = slot;
      const stock = g.tools.shopStock[3];
      p.cards = [12];
      const r = drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 1)));
      expect(q.bomb).toBe(0);
      expect(g.objects.slots[slot - 1]).toMatchObject({ owner: 0, node: 0 });
      expect(g.tools.shopStock[3]).toBe(stock + 1);
      expect(p.cards).toEqual([]);
      expect(q.hostility[0]).toBe(0);
      expect(r.events.some(e => e.t === 'fx' && e.kind === 'bomb-removed' && e.p === 1)).toBe(true);
    });

    it('拆除卡 offers built lots of others, road objects 16-18 and carried bombs (also one\'s own), nothing else', () => {
      const g = clean(), p = g.players[0];
      const lands = g.board.nodes.filter(n => n.ref > 2000 && n.ref < 4000).map(n => n.ref);
      const [mine, theirs, empty, unowned] = [...new Set(lands)];
      const L = (ref: number) => g.board.lands[ref - 2001];
      Object.assign(L(mine), { owner: 1, level: 2 });
      Object.assign(L(theirs), { owner: 3, level: 1 });
      Object.assign(L(empty), { owner: 3, level: 0 });
      Object.assign(L(unowned), { owner: 0, level: 1 });
      const [n1, n2, n3] = roadNodes(g);
      g.objects.place(16, n1.id); // roadblock
      g.objects.place(17, n2.id); // mine
      Object.assign(g.objects.slots[0], { node: n3.id }); // a god: not removable
      const bomb = g.objects.slots.findIndex(o => o.type === 18) + 1;
      Object.assign(g.objects.slots[bomb - 1], { owner: 1, life: 10 });
      p.bomb = bomb;
      const pick = spotsOf(g, 12)!;
      const got = pick.spots.map(s => `${s.at}:${s.id}`);
      expect(got).toContain(`plot:${theirs}`);
      expect(got).toContain(`plot:${unowned}`);
      expect(got).not.toContain(`plot:${mine}`);
      expect(got).not.toContain(`plot:${empty}`);
      expect(got).toContain(`node:${n1.id}`);
      expect(got).toContain(`node:${n2.id}`);
      expect(got).not.toContain(`node:${n3.id}`);
      expect(got).toContain('actor:0');
      expect(pick.onScreen).toBe(true);
    });

    it('拆除卡: a carrier off the road (in prison) is not on the map, so not offered', () => {
      const g = clean(), q = g.players[1];
      const bomb = g.objects.slots.findIndex(o => o.type === 18) + 1;
      Object.assign(g.objects.slots[bomb - 1], { owner: 2, life: 10 });
      q.bomb = bomb; q.prison = 3;
      expect(spotsOf(g, 12)).toBeUndefined(); // nothing to pick: the card is kept
      expect(g.players[0].cards).toEqual([12]);
    });

    it('the computer\'s 拆除卡 still removes the road object named by its argument', () => {
      const g = clean(), p = g.players[1];
      const n = roadNodes(g)[0];
      g.objects.place(17, n.id);
      p.cards = [12];
      g.cards.aiArg0 = 0x10000 + n.id;
      // aiUse runs the AI judge first; play the chosen card the way aiUse does.
      const play = (g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> }).play.bind(g.cards);
      expect(drive(play(p, 12, false)).value).toBe(true);
      expect(g.objects.at(n.id)).toBeUndefined();
      expect(p.cards).toEqual([]);
    });

    it('轉向 / 停留 / 烏龜 offer players and NPCs on the map, oneself included; 夢遊 / 陷害 not oneself', () => {
      const g = clean(), npc = g.places.npcs[0];
      Object.assign(npc, { where: 0, node: roadNodes(g)[0].id });
      g.places.npcs[1].where = 1; // in prison: not on the map
      g.players[3].hospital = 2; // off the road
      for (const card of [6, 14, 30]) {
        expect(spotsOf(g, card)!.spots.map(s => `${s.at}:${s.id}`)).toEqual(['actor:0', 'actor:1', 'actor:2', 'actor:4']);
      }
      for (const card of [16, 17]) {
        expect(spotsOf(g, card)!.spots.map(s => `${s.at}:${s.id}`)).toEqual(['actor:1', 'actor:2', 'actor:4']);
      }
    });

    it('均貧 / 搶奪 / 查稅 / 同盟 offer only the other players (no NPCs, not oneself)', () => {
      const g = clean(), npc = g.places.npcs[0];
      Object.assign(npc, { where: 0, node: roadNodes(g)[0].id });
      g.players[2].cards = [3];
      for (const card of [2, 13, 26, 29]) {
        expect(spotsOf(g, card)!.spots.map(s => `${s.at}:${s.id}`)).toEqual(['actor:1', 'actor:2', 'actor:3']);
      }
    });

    it('轉向卡 can turn an NPC around', () => {
      const g = clean(), p = g.players[0], npc = g.places.npcs[0];
      const n = roadNodes(g)[0];
      Object.assign(npc, { where: 0, node: n.id, lastNode: n.adjacent.find(Boolean)!, dir: 0 });
      const before = npc.lastNode;
      p.cards = [6];
      drive(g.cards.humanUse(p), script(x => (x.t === 'choose' ? 0 : null), x => spot(x, 'actor', 4)));
      expect(p.cards).toEqual([]);
      expect(npc.lastNode).not.toBe(before);
    });

    it('換地卡 / 換屋卡 offer each other plot of the same kind once, never the one underfoot', () => {
      const g = clean(), p = g.players[0];
      const n = g.board.nodes.find(x => x.ref > 2000 && x.ref < 4000)!;
      p.node = n.id;
      for (const card of [4, 5]) {
        const refs = spotsOf(g, card)!.spots.map(s => { expect(s.at).toBe('plot'); return s.id; });
        expect(new Set(refs).size).toBe(refs.length);
        expect(refs).not.toContain(n.ref);
        expect(refs.every(r => r > 2000 && r < 4000)).toBe(true);
      }
    });

    it('天使 / 惡魔 / 漲價 / 查封 offer every plot; 怪獸 only built plots that are not one\'s own', () => {
      const g = clean();
      const all = [...new Set(g.board.nodes.map(n => n.ref).filter(r => (r > 2000 && r < 4000) || (r > 4000 && r < 6000)))].sort((a, b) => a - b);
      for (const card of [9, 10, 27, 28]) expect(spotsOf(g, card)!.spots.map(s => s.id)).toEqual(all);
      const [a, b] = all;
      Object.assign(g.board.lands[a - 2001], { owner: 1, level: 3 });
      Object.assign(g.board.lands[b - 2001], { owner: 0, level: 2 });
      expect(spotsOf(g, 11)!.spots.map(s => s.id)).toEqual([b]);
    });


    it('請神符 is not picked: the nearest free god on the screen (440 × 440 around the player)', () => {
      const g = clean(), p = g.players[0], at = g.node(p.node);
      const far = g.board.nodes.find(n => n.adjacent.some(Boolean) && Math.abs(n.x - at.x) > 300)!;
      Object.assign(g.objects.slots[2], { node: far.id }); // 小福神, off the screen
      p.cards = [23];
      drive(g.cards.humanUse(p), script(a => (a.t === 'choose' ? 0 : null)));
      expect(p.cards).toEqual([23]);
      expect(p.god).toBe(0);
      const near = g.board.nodes.find(n => n.id !== p.node && n.adjacent.some(Boolean) && Math.hypot(n.x - at.x, n.y - at.y) < 200)!;
      Object.assign(g.objects.slots[2], { node: near.id });
      drive(g.cards.humanUse(p), script(a => (a.t === 'choose' ? 0 : null)));
      expect(p.cards).not.toContain(23); // (the fortune god then hands out a card)
      expect(p.god).toBe(3);
    });
  });
});
