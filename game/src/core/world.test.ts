import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type Board, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { cardName } from './modules/cards';
import type { Flow } from './flow';
import { loadWorld, saveWorld, type WorldSaveData } from './save';
import type { Answer, Step } from './types';
import { applyOverlay, fare, LAND_INDEX, PLACES_PER_HOUSE, resortRate, TITLES, TYCOON_MAPS, TYCOON_SQUARES, World, type TycoonOverlay, type TycoonSettings } from './world';

// 大富豪模式 (docs/rules/17): five remake cities, twelve players, one calendar and one market.
const KEYS: Record<number, string> = { 100: 'tokyo', 101: 'osaka', 102: 'sapporo', 103: 'kyushu', 104: 'okinawa' };
const file = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/remake/${KEYS[id]}.json`, import.meta.url));
const have = TYCOON_MAPS.every(id => existsSync(file(id)));
const raw = (id: number) => JSON.parse(readFileSync(file(id), 'utf8')) as RawMap & { tycoon?: TycoonOverlay };
const boards = (): Board[] => TYCOON_MAPS.map(id => { const r = raw(id); return applyOverlay(parseBoard(r), r.tycoon, id); });

function settings(seed: number, human = -1): TycoonSettings {
  return {
    mode: 'tycoon', maps: [...TYCOON_MAPS], players: Array.from({ length: 12 }, (_, i) => ({ character: i, human: i === human })),
    fundIndex: 1, traffic: 1, landLimitIndex: 0, startDate: pack(2026, 10, 16), seed,
  };
}

/** Plays until `stop` (checked after every step) and returns the steps seen; computers never ask. */
function play(w: World, flow: Flow, stop: (s: Step) => boolean, answer?: (s: Step) => Answer): Step[] {
  const seen: Step[] = [];
  let a: Answer;
  for (let r = flow.next(); !r.done; r = flow.next(a)) {
    const s = r.value;
    a = undefined;
    if ('ask' in s) {
      if (!answer) throw new Error(`computer players never ask: ${s.t}`);
      a = answer(s);
    }
    seen.push(s);
    if (stop(s) || w.over) break;
  }
  return seen;
}
/** The world's state; `settings.mapId` only names the city on screen for the save list. */
const fingerprint = (w: World) => { const s = saveWorld(w); s.savedAt = 0; s.settings.mapId = 0; return JSON.stringify(s); };

describe.skipIf(!have)('大富豪模式 world', () => {
  it('puts the travel squares where the user chose them (only in the world: the normal maps are unchanged)', () => {
    const bs = boards();
    TYCOON_MAPS.forEach((id, i) => {
      for (const sq of TYCOON_SQUARES[id]) {
        const n = bs[i].nodes[sq.node - 1];
        expect(n.event, `${KEYS[id]} #${sq.node}`).toBe(sq.via === 'station' ? 17 : 18);
        expect(Math.hypot(n.x - sq.x, n.y - sq.y)).toBeLessThanOrEqual(8);
      }
      const plain = parseBoard(raw(id));
      expect(plain.nodes.some(n => n.event === 17 || n.event === 18)).toBe(false);
    });
    // 新幹線 only in 東京, 大阪, 九州; every city has an airport.
    expect(bs.map(b => b.nodes.filter(n => n.event === 17).length)).toEqual([1, 1, 0, 1, 0]);
    expect(bs.map(b => b.nodes.filter(n => n.event === 18).length)).toEqual([1, 1, 1, 1, 1]);
  });

  it('starts everyone in a random city, evenly, with one set of starting tools', () => {
    const w = new World(settings(3), boards());
    const per = w.cities.map((_, i) => w.players.filter(p => p.map === i).length).sort();
    expect(per).toEqual([2, 2, 2, 3, 3]);
    const fresh = new World(settings(3), boards());
    expect(fresh.players.map(p => p.map)).toEqual(w.players.map(p => p.map));
    // Each city deals the starting tools (01 §2.3); the world keeps one deal, not five.
    for (const p of w.players) expect(p.tools.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6);
    expect(new World(settings(4), boards()).players.map(p => p.map)).not.toEqual(w.players.map(p => p.map));
  });

  it('is reproducible from the seed', () => {
    const run = (seed: number) => { const w = new World(settings(seed), boards()); play(w, w.run(), () => w.daysElapsed >= 60); return fingerprint(w); };
    expect(run(11)).toBe(run(11));
    expect(run(11)).not.toBe(run(12));
  });

  it('plays the same whether a city is watched or not (headless = shown)', () => {
    for (const watch of [0, 2, 4]) {
      const a = new World(settings(21), boards()), b = new World(settings(21), boards());
      b.watch = watch;
      play(a, a.run(), () => a.daysElapsed >= 90);
      const shown = play(b, b.run(), () => b.daysElapsed >= 90);
      // The watched city's steps reached the screen, the others only as ticker lines.
      expect(shown.some(s => !('ask' in s) && s.t === 'step')).toBe(true);
      expect(shown.some(s => !('ask' in s) && s.t === 'ticker')).toBe(true);
      expect(fingerprint(b)).toBe(fingerprint(a));
    }
  });

  it('travels: 新幹線 東京/大阪/九州, dearer planes, one turn 在路上, arrival on the same kind of square', () => {
    const w = new World(settings(5, 0), boards());
    const me = w.players[0];
    const tokyo = 0, okinawa = 4;
    const rail = w.destinations(tokyo, 'station', me).map(o => o.mapId);
    expect(rail).toEqual([101, 103]);
    expect(w.destinations(okinawa, 'station', me)).toEqual([]);
    expect(w.destinations(2, 'station', me)).toEqual([]);
    expect(w.destinations(okinawa, 'airport', me).map(o => o.mapId)).toEqual([100, 101, 102, 103]);
    for (const a of [100, 101, 103]) for (const b of [100, 101, 103]) if (a !== b) expect(fare(a, b, 'airport')).toBeGreaterThan(fare(a, b, 'station'));
    // Put the human on 東京's station square and let them step there: the dialog asks, the answer goes to 大阪.
    me.map = tokyo; w.landed[0] = true;
    const station = w.travelNodes(tokyo, 'station')[0];
    me.whoPlays = 1; me.node = station.id; me.lastNode = station.adjacent.find(Boolean)!;
    w.mask(tokyo);
    const g = w.cities[tokyo];
    g.current = 0;
    const before = me.cash + me.bank;
    let asked: Step | null = null;
    const flow = w.travelSquare(g, me, 0);
    let r = flow.next();
    while (!r.done) { const s = r.value; if ('ask' in s) { asked = s; r = flow.next(1); } else r = flow.next(); }
    expect(r.value).toBe(true);
    expect(asked && 'ask' in asked && asked.t).toBe('travel');
    expect(me.trip).toEqual({ to: 1, via: 'station' });
    expect(me.map).toBe(-1);
    expect(before - me.cash - me.bank).toBe(fare(100, 101, 'station') * w.priceIndex);
    expect(w.view()).toBe(1);
    // The next turn is 在路上: no dice; it ends on 大阪's station square.
    w.current = 0;
    const steps = play(w, w.run(), s => !('ask' in s) && s.t === 'teleport' && s.p === 0, () => -1);
    expect(steps.some(s => !('ask' in s) && s.t === 'dice' && s.p === 0)).toBe(false);
    expect(me.trip).toBeUndefined();
    expect(me.map).toBe(1);
    expect(me.node).toBe(w.travelNodes(1, 'station')[0].id);
    expect(w.visited[0]).toContain(1);
  });

  it('computers weigh the cities: own lots draw them, poor ones stay, crowded cities and a recent trip keep them away', () => {
    const w = new World(settings(8), boards());
    const p = w.players[3];
    p.map = 0; p.trip = undefined;
    const opts = () => w.destinations(0, 'airport', p);
    p.cash = 0; p.bank = Math.min(...opts().map(o => o.price)) * 2;
    expect(w.aiTravel(p, 0, opts(), 0)).toBe(-1);
    p.bank = 2_000_000;
    // Twenty lots of its own in 札幌, nothing for it in 東京: it flies to 札幌 and says why.
    for (const l of w.cities[2].board.lands.slice(0, 20)) l.owner = p.id + 1;
    for (const l of w.cities[0].board.lands) { l.owner = 1 + ((p.id + 1) % 12); l.level = 0; }
    const trip = w.aiTrip(p, 0, opts(), 0);
    expect(trip?.map).toBe(2);
    expect(trip?.reason).toMatch(/塊地|高價/);
    // Six players in 札幌 (counting those on their way): not a computer's destination any more.
    let n = w.population(2);
    for (const q of w.players) if (n < World.CROWD && q !== p && q.map !== 2) { q.map = 2; n++; }
    expect(w.population(2)).toBeGreaterThanOrEqual(World.CROWD);
    expect(w.aiTravel(p, 0, opts(), 0)).not.toBe(2);
    // Right after a trip it stays a while.
    w.lastTrip[p.id] = w.daysElapsed;
    expect(w.aiTravel(p, 0, opts(), 0)).toBe(-1);
  });

  it('with more than six players in a city, every computer stopping on its travel square leaves (and pays)', () => {
    const w = new World(settings(12), boards());
    for (const q of w.players.slice(0, 7)) { q.map = 0; q.trip = undefined; }
    for (const q of w.players.slice(7)) { q.map = 1 + (q.id % 4); q.trip = undefined; }
    expect(w.population(0)).toBe(7);
    const g = w.cities[0], sq = w.travelNodes(0, 'airport')[0];
    w.mask(0);
    for (const q of w.players.slice(0, 7)) {
      if (w.population(0) <= World.CROWD) break;
      q.whoPlays = 2; q.node = sq.id; q.lastNode = sq.adjacent.find(Boolean)!;
      w.lastTrip[q.id] = w.daysElapsed;          // even right after a trip
      const before = q.cash + q.bank;
      w.drain(0, w.travelSquare(g, q, 0));       // stopping on it
      expect(q.trip, `player ${q.id}`).toBeDefined();
      expect(w.population(q.trip!.to)).toBeLessThanOrEqual(World.CROWD);
      expect(q.cash + q.bank).toBeLessThan(before);
    }
    expect(w.population(0)).toBe(World.CROWD);
    expect(w.log.some(l => l.text.includes('人太多了'))).toBe(true);
  });

  it('passing a travel square does nothing; only stopping on it offers the trip', () => {
    const w = new World(settings(14, 0), boards());
    const me = w.players[0], g = w.cities[0];
    me.map = 0; w.landed[0] = true; me.whoPlays = 1;
    const sq = w.travelNodes(0, 'airport')[0], prev = g.node(sq.adjacent.find(Boolean)!);
    me.node = prev.id; me.lastNode = prev.adjacent.find(a => a && a !== sq.id)!;
    w.mask(0);
    // Two steps: over the airport and on; no question comes.
    me.turtle = 0; me.dice = 1; me.traffic = 0;
    g.tools.remoteDice = 2;
    const flow = (g as unknown as { depart(p: unknown): Flow }).depart(me);
    let r = flow.next(), asked = false, passed = false;
    while (!r.done) {
      const s = r.value;
      if ('ask' in s) { if (s.t === 'travel') asked = true; r = flow.next(-1); continue; }
      if (s.t === 'step' && s.to === sq.id && s.left > 0) passed = true;
      r = flow.next();
    }
    if (passed) expect(asked).toBe(false);
    expect(me.trip).toBeUndefined();
  });

  it('computers travel at a sensible rate over a long game, every city gets visitors, nobody ping-pongs', () => {
    const w = new World(settings(77), boards());
    const flow = w.run();
    const trips: { p: number; day: number; to: number }[] = [];
    let stops = 0;
    for (let r = flow.next(); !r.done && w.daysElapsed < 365; r = flow.next()) {
      const s = r.value;
      if ('ask' in s) throw new Error('computers never ask');
      // Own trips only (遣返 / 召集 / 獨裁 send people away against their will, whenever).
      if (s.t === 'ticker' && s.kind === 'travel' && s.p !== undefined && !/（被|獨裁卡/.test(s.text)) trips.push({ p: s.p, day: s.day, to: w.players[s.p].trip?.to ?? -1 });
      if (s.t === 'ticker' && s.kind === 'arrive') stops++;
      for (const i of w.cities.keys()) expect(w.population(i)).toBeLessThanOrEqual(12);
    }
    // Not never, not at every chance: a few trips per player and year.
    expect(trips.length).toBeGreaterThanOrEqual(3);
    expect(trips.length).toBeLessThan(12 * 365 / World.TRIP_REST);
    for (const i of w.cities.keys()) expect(w.visited.some(v => v.includes(i))).toBe(true);
    const byPlayer = new Map<number, number[]>();
    for (const t of trips) byPlayer.set(t.p, [...(byPlayer.get(t.p) ?? []), t.day]);
    for (const days of byPlayer.values()) for (let k = 1; k < days.length; k++) expect(days[k] - days[k - 1]).toBeGreaterThanOrEqual(World.TRIP_REST);
    expect(stops).toBeGreaterThan(0);
  }, 60_000);

  it('starts no city with more than three players', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new World(settings(seed), boards());
      for (const i of w.cities.keys()) expect(w.population(i)).toBeLessThanOrEqual(3);
    }
  });

  it('a full hospital / prison sends the next one to another city, who plays on there', () => {
    const w = new World(settings(9), boards());
    const g = w.cities[0];
    // Start the game so everyone has landed, then fill 東京's prison: the NPCs there plus players up to eight.
    play(w, w.run(), () => w.daysElapsed >= 1);
    const npcsIn = g.places.npcs.filter(n => n.where === 1).length;
    const inmates = w.players.filter(p => !p.bankrupt).slice(0, PLACES_PER_HOUSE - npcsIn);
    for (const p of inmates) { p.map = 0; p.trip = undefined; p.hospital = 0; p.prison = 9; p.node = g.prisonNode().id; }
    expect(w.occupancy(0, 'prison')).toBe(PLACES_PER_HOUSE);
    const ninth = w.players.find(p => !p.bankrupt && !inmates.includes(p))!;
    ninth.map = 0; ninth.trip = undefined; ninth.prison = 0; ninth.hospital = 0; ninth.hotel = 0; ninth.vanish = 0;
    w.mask(0);
    w.drain(0, g.sendTo(ninth, 'prison', 3));
    expect(ninth.map).not.toBe(0);
    expect(ninth.prison).toBe(3);
    const city = w.cities[ninth.map!];
    expect(ninth.node).toBe(city.prisonNode().id);
    expect(w.log.some(l => l.kind === 'overflow' && l.text.includes('客滿'))).toBe(true);
    // Out of prison, the ninth plays on in that city (unless a trip takes them on later).
    const at = ninth.map;
    const flow = w.run();
    let moved = false;
    for (let r = flow.next(); !r.done && w.daysElapsed < 12 && !moved; r = flow.next()) {
      if (!ninth.prison && ninth.node !== city.prisonNode().id) moved = true;
    }
    expect(ninth.bankrupt || moved).toBe(true);
    if (moved) expect(ninth.map === at || ninth.trip !== undefined || ninth.map === -1 || w.visited[ninth.id].includes(at!)).toBe(true);
  });

  it('saves and loads mid-game: the loaded world plays on exactly like the original', () => {
    const w = new World(settings(31), boards());
    w.watch = 1;
    const flow = w.run();
    play(w, flow, () => w.daysElapsed >= 40);
    // Save at the next turn start of someone in the watched city (the turn menu of a human), as the screen does.
    play(w, flow, s => !('ask' in s) && s.t === 'turn');
    const saved = JSON.parse(JSON.stringify(saveWorld(w))) as WorldSaveData;
    expect(saved.kind).toBe('tycoon');
    expect(saved.cities).toHaveLength(5);
    const loaded = loadWorld(saved);
    loaded.watch = 1;
    play(w, flow, () => w.daysElapsed >= 70);
    play(loaded, loaded.run(), () => loaded.daysElapsed >= 70);
    expect(fingerprint(loaded)).toBe(fingerprint(w));
  });

  it('a whole computer-only world (12 players) runs to its end without breaking rules', () => {
    for (const seed of [1, 2]) {
      const w = new World(settings(seed), boards());
      const flow = w.run();
      const kinds = new Set<string>();
      for (let r = flow.next(); !r.done && w.daysElapsed < 900; r = flow.next()) {
        if ('ask' in r.value) throw new Error('computers never ask');
        if (r.value.t === 'ticker') kinds.add(r.value.kind);
        for (const p of w.players) { expect(p.cash).toBeGreaterThanOrEqual(0); expect(p.bank).toBeGreaterThanOrEqual(0); }
      }
      expect(w.over !== null || w.daysElapsed >= 730, `seed ${seed}: day ${w.daysElapsed}`).toBe(true);
      const left = w.players.filter(p => !p.bankrupt);
      if (w.over) expect(left).toHaveLength(1);
      expect(w.fallen.length).toBe(12 - left.length);
      for (const c of w.cities) for (const l of c.board.lands) expect(l.owner).toBeLessThanOrEqual(12);
      expect([...kinds]).toEqual(expect.arrayContaining(['travel', 'arrive', 'buy', 'bankrupt']));
      expect(w.history.length).toBeGreaterThan(3);
    }
  }, 60_000);

  it('均富卡 shares the cash of all living players of the world, wherever they are', () => {
    const w = new World(settings(51), boards());
    play(w, w.run(), () => w.daysElapsed >= 2);
    const p = w.players.find(q => !q.bankrupt && q.whoPlays && q.map! >= 0)!;
    const g = w.cities[p.map!];
    const living = w.players.filter(q => q.whoPlays !== 0);
    expect(new Set(living.map(q => q.map)).size).toBeGreaterThan(1);
    living.forEach((q, i) => { q.cash = 1000 * (i + 1); });
    const avg = Math.trunc(living.reduce((a, q) => a + q.cash, 0) / living.length);
    p.cards = [1];
    w.mask(p.map!);
    w.drain(p.map!, (g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> }).play(p, 1, false));
    for (const q of living) expect(q.cash).toBe(avg);
  });

  it('"all players" effects reach the whole world: a birthday collects from all 11, 小財神 makes all 11 pay', () => {
    const w = new World(settings(52), boards());
    play(w, w.run(), () => w.daysElapsed >= 2);
    for (const q of w.players) { q.bankrupt = false; q.whoPlays = 2; q.cards = [13]; q.cash = 100000; q.trip = undefined; }
    const p = w.players[0], g = w.cities[p.map!];
    expect(w.players.filter(q => q.map !== p.map).length).toBeGreaterThan(6);
    w.mask(p.map!);
    const ev = g.events as unknown as { birthday(p: unknown): Flow<[number, number][]> };
    const flow = ev.birthday(p);
    let r = flow.next();
    while (!r.done) r = flow.next();
    expect(r.value.map(x => x[0]).sort((a, b) => a - b)).toEqual(w.players.slice(1).map(q => q.id));
    // 小財神 (god type 1): every other living player pays into the holder's cash, wherever they are.
    const slot = g.objects.slots.findIndex(o => o.type === 1) + 1;
    const before = w.players.map(q => q.cash);
    w.drain(p.map!, g.objects.attach(p, slot));
    const paid = w.players.slice(1).filter((q, i) => q.cash < before[i + 1]);
    expect(paid).toHaveLength(11);
  });

  it('regional land prices: 東京 ×1.5 … 沖繩 ×1.0, tolls and plots too; the normal maps unchanged', () => {
    const bs = boards();
    TYCOON_MAPS.forEach((id, i) => {
      const plain = parseBoard(raw(id)), k = LAND_INDEX[id];
      const r = (v: number) => (k === 1 ? v : Math.max(10, Math.round((v * k) / 10) * 10));
      expect(bs[i].lands[0].price).toBe(r(plain.lands[0].price));
      expect(bs[i].lands[0].tolls).toEqual(plain.lands[0].tolls.map(r));
      expect(bs[i].facilities[0].price).toBe(r(plain.facilities[0].price));
    });
    expect(Object.values(LAND_INDEX).every(k => k >= 1 && k <= 1.5)).toBe(true);
    expect(LAND_INDEX[100]).toBeGreaterThan(LAND_INDEX[101]);
    const dearest = (i: number) => Math.max(...bs[i].lands.map(l => l.price));
    expect(dearest(0)).toBeGreaterThan(dearest(1));
  });

  it('沖繩 is a resort: hotels there earn ×1.5 (×1.8 in summer), computers build hotels there', () => {
    expect(resortRate(104, pack(2026, 1, 10))).toBe(1.5);
    expect(resortRate(104, pack(2026, 7, 10))).toBe(1.8);
    expect(resortRate(100, pack(2026, 7, 10))).toBe(1);
    const w = new World(settings(61), boards());
    const g = w.cities[4], owner = w.players[1], guest = w.players[2];
    for (const q of [owner, guest]) { q.map = 4; q.whoPlays = 2; q.trip = undefined; q.hotel = 0; q.prison = 0; q.hospital = 0; q.vanish = 0; q.sleep = 0; q.sleepwalk = 0; q.cash = 1e7; }
    w.landed[1] = w.landed[2] = true; w.mask(4);
    const f = g.board.facilities[0];
    // The computer owner builds on its empty plot: a hotel.
    f.owner = owner.id + 1; f.level = 0; f.type = 0;
    const ln = g.board.nodes.find(n => n.ref === f.id + 4000)!;
    owner.node = ln.id; g.current = owner.id;
    w.drain(4, (g as unknown as { landOnFacility(p: unknown, f: unknown): Flow }).landOnFacility(owner, f));
    expect(f.type).toBe(1);
    // A guest pays the night fee × 1.5 (October) × the nights the wheel gives.
    guest.node = ln.id; g.current = guest.id;
    const lines: string[] = [];
    const flow = (g as unknown as { landOnFacility(p: unknown, f: unknown): Flow }).landOnFacility(guest, f);
    for (let r = flow.next(); !r.done; r = flow.next()) { const s = r.value; if (!('ask' in s) && s.t === 'say') lines.push(s.text); }
    const m = lines.join('\n').match(/休息(\d+)天\s*費用(\d+)元/);
    expect(m).not.toBeNull();
    expect(Number(m![2])).toBe(Math.round(f.fees[f.level] * w.priceIndex * 1.5) * Number(m![1]));
  });

  it('飛行卡 / 電車卡: only in a tycoon pool, sold on the card shelf, never from a card square', () => {
    const w = new World(settings(71), boards());
    const g = w.cities[0];
    expect(g.cards.remaining.length).toBeGreaterThanOrEqual(32);
    expect(cardName(31)).toBe('飛行卡');
    expect(cardName(32)).toBe('電車卡');
    const normal = new Game({ mapId: 100, players: [0, 1].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 16), seed: 1 }, parseBoard(raw(100)));
    expect(normal.cards.remaining).toHaveLength(30);
    const drawn = new Set<number>(), shelved = new Set<number>();
    for (let k = 0; k < 400; k++) { drawn.add(g.cards.drawId()); for (const id of g.tools.cardShelf()) shelved.add(id); }
    expect(drawn.has(31) || drawn.has(32)).toBe(false);
    expect(shelved.has(31) && shelved.has(32)).toBe(true);
  });

  it('using 飛行卡 flies for free (one turn 在路上); 電車卡 only from a city with a station', () => {
    const w = new World(settings(72, 0), boards());
    const me = w.players[0];
    me.map = 2; w.landed[0] = true; me.whoPlays = 1; me.trip = undefined;   // 札幌: no station
    const g = w.cities[2];
    me.node = g.board.nodes.find(n => n.event === 0 && n.ref === 0)!.id;
    w.mask(2);
    me.cards = [32, 31];
    const play = (id: number, answer: number) => {
      const f = (g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> }).play(me, id, true);
      let r = f.next(), asked = false;
      while (!r.done) { const s = r.value; if ('ask' in s) { asked = s.t === 'travel'; r = f.next(answer); } else r = f.next(); }
      return { ok: r.value, asked };
    };
    const before = me.cash + me.bank;
    expect(play(32, 0).ok).toBe(false);          // 札幌 has no 新幹線
    expect(me.cards).toEqual([32, 31]);
    const r = play(31, 0);                       // fly to 東京
    expect(r).toEqual({ ok: true, asked: true });
    expect(me.trip).toEqual({ to: 0, via: 'airport' });
    expect(me.cards).toEqual([32]);
    expect(me.cash + me.bank).toBe(before);      // the card is the ticket
  });

  it('遣返卡 sends a rival in the city to another city; 免罪卡 saves them', () => {
    const w = new World(settings(81, 0), boards());
    const me = w.players[0], q = w.players[1], g = w.cities[0];
    for (const x of [me, q]) { x.map = 0; x.trip = undefined; x.whoPlays = x.human ? 1 : 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; }
    me.node = q.node = g.board.nodes.find(n => n.event === 0 && n.ref === 0)!.id;
    w.mask(0);
    w.drain(0, w.deport(g, q, me));
    expect(q.trip?.via).toBe('airport');
    expect(q.trip?.to).not.toBe(0);
    expect(w.log.some(l => l.text.includes('遣返'))).toBe(true);
    // With 免罪卡 the card's harm is cancelled (the same rule as 陷害卡).
    const r = w.players[2];
    r.map = 0; r.trip = undefined; r.whoPlays = 2; w.landed[2] = true; r.node = me.node; r.prison = r.hospital = r.hotel = r.vanish = 0; r.cards = [21];
    w.mask(0);
    me.cards = [33];
    (g.cards as unknown as { aiArg0: number }).aiArg0 = r.id;
    w.drain(0, (g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> }).play(me, 33, false));
    expect(r.trip).toBeUndefined();
    expect(r.cards).toEqual([]);
  });

  it('召集卡 brings a random rival from another city to this city\'s airport after one turn 在路上; never someone in hospital, prison, 消失 or 在路上', () => {
    const w = new World(settings(82, 0), boards());
    const me = w.players[0], g = w.cities[0], q = w.players[5];
    const put = (x: typeof me, city: number) => { x.map = city; x.trip = undefined; x.whoPlays = x.human ? 1 : 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; x.node = w.cities[city].board.nodes.find(n => n.event === 0 && n.ref === 0)!.id; };
    for (const x of w.players) put(x, x.id === 0 ? 0 : 2);
    for (const x of w.players.slice(1)) if (x !== q) x.hospital = 3;     // only q can be summoned
    w.players[6].prison = 2; w.players[7].vanish = 2; w.players[8].trip = { to: 1, via: 'airport' }; w.players[8].map = -1;
    w.mask(0);
    expect(w.summonable(g, me).map(x => x.id)).toEqual([q.id]);
    me.cards = [35];
    const cards = g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> };
    w.drain(0, cards.play(me, 35, true));
    expect(me.cards).toEqual([]);
    expect(q.trip).toEqual({ to: 0, via: 'airport' });
    w.drain(0, (w as unknown as { arrive(p: unknown): Flow }).arrive(q));
    expect(q.map).toBe(0);
    expect(g.board.nodes.find(n => n.id === q.node)?.event).toBe(18);   // 東京's airport
    // Nobody left to summon: the card is kept.
    q.hospital = 2; me.cards = [35];
    w.mask(0);
    w.drain(0, cards.play(me, 35, true));
    expect(me.cards).toEqual([35]);
  });

  it('召集卡: a 免罪卡 in the rival\'s hand turns it down once (used up); the 召集卡 is spent all the same', () => {
    const w = new World(settings(82, 0), boards());
    const me = w.players[0], g = w.cities[0], q = w.players[5];
    const put = (x: typeof me, city: number) => { x.map = city; x.trip = undefined; x.whoPlays = x.human ? 1 : 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; x.node = w.cities[city].board.nodes.find(n => n.event === 0 && n.ref === 0)!.id; };
    for (const x of w.players) put(x, x.id === 0 ? 0 : 2);
    for (const x of w.players.slice(1)) if (x !== q) x.hospital = 3;     // only q can be summoned
    w.mask(0);
    const cards = g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> };
    q.cards = [21, 21]; me.cards = [35];
    w.drain(0, cards.play(me, 35, true));
    expect(me.cards).toEqual([]);
    expect(q.cards).toEqual([21]);
    expect(q.trip).toBeUndefined();
    expect(q.map).toBe(2);
    expect(w.log.some(l => /使用免罪卡，拒絕了/.test(l.text))).toBe(true);
    // The second time it holds one more: turned down again; then none left, and off it goes.
    me.cards = [35];
    w.drain(0, cards.play(me, 35, true));
    expect(q.cards).toEqual([]);
    expect(q.trip).toBeUndefined();
    me.cards = [35];
    w.drain(0, cards.play(me, 35, true));
    expect(q.trip).toEqual({ to: 0, via: 'airport' });
  });

  it('通緝卡 jails any rival anywhere for 5 days in their city; 免罪卡 saves; one copy per city at a time', () => {
    const w = new World(settings(84, 0), boards());
    const me = w.players[0], q = w.players[4], r = w.players[5], g = w.cities[0];
    const put = (x: typeof me, city: number) => { x.map = city; x.trip = undefined; x.whoPlays = x.human ? 1 : 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; x.node = w.cities[city].board.nodes.find(n => n.event === 0 && n.ref === 0)!.id; };
    for (const x of w.players) put(x, x.id === 0 ? 0 : 3);
    w.players[6].hospital = 2; w.players[7].trip = { to: 1, via: 'airport' }; w.players[7].map = -1;
    w.mask(0);
    const opts = w.wantedOptions(me);
    expect(opts).toHaveLength(11);
    expect(opts.filter(o => o.disabled).map(o => o.value).sort()).toEqual([6, 7]);
    const cards = g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> };
    const use = (target: number) => { const f = cards.play(me, 36, true); let x = f.next(); while (!x.done) x = f.next('ask' in x.value ? target : undefined); return x.value; };
    expect(use(6)).toBe(false);                      // in hospital: not a target
    me.cards = [36];
    expect(use(q.id)).toBe(true);
    expect(q.prison).toBe(5);
    expect(q.map).toBe(3);
    expect(w.cities[3].board.nodes.find(n => n.id === q.node)).toBe(w.cities[3].prisonNode());
    r.cards = [21]; me.cards = [36];
    expect(use(r.id)).toBe(true);
    expect(r.prison).toBe(0);
    expect(r.cards).toEqual([]);
    // One per city: bought in 大阪's shop, 大阪 cannot sell another until that copy is used (here by someone else).
    w.syncWanted();
    expect(w.cities.map(c => c.cards.wanted)).toEqual([1, 1, 1, 1, 1]);
    const osaka = w.cities[1];
    me.cards = []; osaka.cards.receive(me, 36); w.wantedTaken(osaka, me);
    expect(w.cities.map(c => c.cards.wanted)).toEqual([1, 0, 1, 1, 1]);
    for (let k = 0; k < 300; k++) expect(osaka.tools.cardShelf()).not.toContain(36);
    const saved = loadWorld(JSON.parse(JSON.stringify(saveWorld(w))) as WorldSaveData);
    expect(saved.wantedFrom[0]).toEqual([1]);
    me.cards = []; q.cards = [36]; q.prison = 0;     // handed on (搶奪 / 生日), then used by q
    w.wantedUsed(q);
    expect(w.cities.map(c => c.cards.wanted)).toEqual([1, 1, 1, 1, 1]);
  });

  it('獨裁卡 sends everyone else on the city\'s squares away, spread with the city cap; hospital and prison stay', () => {
    const w = new World(settings(83, 0), boards());
    const me = w.players[0], g = w.cities[2];
    const here = w.players.slice(0, 7);
    for (const x of here) { x.map = 2; x.trip = undefined; x.whoPlays = x.human ? 1 : 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; x.node = g.board.nodes[10].id; }
    here[6].hospital = 3;
    w.mask(2);
    me.cards = [34];
    const flow = (g.cards as unknown as { play(p: unknown, id: number, human: boolean): Flow<boolean> }).play(me, 34, true);
    let r = flow.next(); while (!r.done) r = flow.next();
    expect(r.value).toBe(true);
    expect(here.slice(1, 6).every(x => x.trip && x.trip.to !== 2)).toBe(true);
    expect(here[6].trip).toBeUndefined();
    for (let i = 0; i < 5; i++) if (i !== 2) expect(w.population(i)).toBeLessThanOrEqual(World.CROWD);
    expect(me.cards).toEqual([]);
    // They start from their destination's airport after the turn 在路上.
    const v = here[1], to = v.trip!.to;
    w.drain(to, (w as unknown as { arrive(p: unknown): Flow }).arrive(v));
    expect(w.cities[to].board.nodes.find(n => n.id === v.node)?.event).toBe(18);
  });

  it('selling or dropping a whole hand (魔法屋, 命運 32, 死神) keeps the tycoon cards and tools; bankruptcy clears them', () => {
    const w = new World(settings(91), boards());
    const p = w.players[0], g = w.cities[p.map!];
    const reset = () => { p.cards = [3, 31, 12, 33, 36]; p.tools = new Array(16).fill(0); p.tools[0] = 2; p.tools[8] = 1; p.tools[13] = 1; p.tools[14] = 1; p.tools[15] = 1; p.points = 0; p.luckFate = 0; p.traffic = 0; p.whoPlays = 2; };
    const kept = () => { expect(p.cards).toEqual([31, 33, 36]); expect(p.tools.slice(0, 13).every(n => n === 0)).toBe(true); expect(p.tools.slice(13)).toEqual([1, 1, 1]); };
    w.mask(p.map!);
    // 命運 32: every original card and tool sold at full price for points; the travel cards and lab tools stay.
    reset();
    w.drain(p.map!, (g.events as unknown as { applyFate(p: unknown, t: number): Flow }).applyFate(p, 32));
    kept();
    expect(p.points).toBe(35 + 15 + 2 * 15 + 30);
    // 魔法屋 變賣所有卡片 (spell 0) and 變賣所有道具 (spell 8).
    reset();
    const places = g.places as unknown as { castMagic(v: unknown, e: number, t: unknown[]): Flow };
    w.drain(p.map!, places.castMagic(w.players[1], 0, [p]));
    w.drain(p.map!, places.castMagic(w.players[1], 8, [p]));
    kept();
    // 死神: everything thrown away, but not the tycoon items.
    reset();
    w.drain(p.map!, g.tools.dropAll(p));
    w.drain(p.map!, g.cards.dropAll(p));
    kept();
    // Bankruptcy liquidates everything.
    reset();
    w.drain(p.map!, g.tools.dropAll(p, true));
    w.drain(p.map!, g.cards.dropAll(p, true));
    expect(p.cards).toEqual([]);
    expect(p.tools.every(n => n === 0)).toBe(true);
  });

  it('黑市 per city: unsold lots after 6 months at 50× the (indexed) land price; of the tycoon items only 飛行卡 / 電車卡', () => {
    const w = new World(settings(92), boards());
    const g = w.cities[0], bm = g.blackMarket;
    for (const l of g.board.lands) l.owner = 0;
    bm.unsold = g.board.lands.map(() => 4);
    w.drain(0, bm.monthly());
    expect(bm.listings.some(l => l.kind === 'land')).toBe(false); // 5 months: not yet (a normal game lists after 3)
    w.drain(0, bm.monthly());
    const lot = bm.listings.find(l => l.kind === 'land')!;
    expect(lot).toBeDefined();
    expect(lot.base).toBe(g.board.lands[lot.id - 1].price * 50);
    // Many months of listings in all five cities: cards 1-32 only, tools 1-13 only.
    const cards = new Set<number>(), tools = new Set<number>();
    for (let m = 0; m < 400; m++) {
      for (const [i, c] of w.cities.entries()) {
        (c as unknown as { daysElapsed: number }).daysElapsed = m * 31 + i;
        c.blackMarket.listings = [];
        w.drain(i, c.blackMarket.monthly());
        for (const l of c.blackMarket.listings) (l.kind === 'card' ? cards : l.kind === 'tool' ? tools : new Set()).add(l.id);
      }
    }
    expect(Math.max(...cards)).toBe(32);
    expect(cards.has(31) && cards.has(32)).toBe(true);
    expect(Math.max(...tools)).toBeLessThanOrEqual(13);
  });

  it('city labs: 「限定」 tools replace slots (沖繩 all three, 九州 洲際飛彈, 大阪/札幌 超級工人); 東京 and normal games unchanged', () => {
    const w = new World(settings(93), boards());
    expect(w.cities.map(c => c.tools.labOptions())).toEqual([[9, 10, 11, 12, 13], [14, 10, 11, 12, 13], [14, 10, 11, 12, 13], [9, 10, 11, 12, 15], [14, 10, 16, 12, 15]]);
    expect(w.cities[4].tools.labToolId(3)).toBe(16);
    const normal = new Game({ mapId: 104, players: [0, 1].map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 16), seed: 1 }, parseBoard(raw(104)));
    expect([1, 2, 3, 4, 5].map(i => normal.tools.labToolId(i))).toEqual([9, 10, 11, 12, 13]);
    expect(normal.tools.receive(normal.players[0], 14)).toBe(false);
  });

  it('超級工人 builds two levels; 洲際飛彈 nukes a lot in another city; 時空機 crosses at once to a random square of another city (its god along) and ends the turn', () => {
    const w = new World(settings(94, 0), boards());
    const me = w.players[0], q = w.players[3], g = w.cities[0];
    const put = (x: typeof me, city: number) => { x.map = city; x.trip = undefined; x.whoPlays = x.human ? 1 : 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; x.node = w.cities[city].board.nodes.find(n => n.event === 0 && n.ref === 0)!.id; };
    for (const x of w.players) put(x, x.id === 0 ? 0 : 2);
    w.mask(0);
    // 超級工人 on an own lot of level 1 → 3.
    const lot = g.board.lands.find(l => !l.chain)!;
    lot.owner = 1; lot.level = 1; me.tools[13] = 1;
    w.drain(0, g.tools.use(me, 14, lot.id + 2000));
    expect(lot.level).toBe(3);
    expect(me.tools[13]).toBe(0);
    // 洲際飛彈 on 大阪 from 東京: the rival's building there is destroyed (nuclear: the lot is lost), news in the log.
    const far = w.cities[1].board.lands.find(l => !l.chain)!;
    far.owner = q.id + 1; far.level = 4; me.tools[14] = 1;
    w.drain(0, g.tools.use(me, 15, 1 * 10000 + far.id + 2000));
    expect(far.level).toBe(0);
    expect(far.owner).toBe(0);
    expect(me.tools[14]).toBe(0);
    expect(w.log.some(l => l.kind === 'icbm' && l.map === 1)).toBe(true);
    expect(w.icbmTargets(me, 1).every(o => typeof o.value === 'number')).toBe(true);
    // 時空機 from the turn menu: a random square of 九州 at once, no dice, no 在路上; the 土地公 attached goes along.
    me.tools[15] = 1;
    w.mask(0);
    Object.assign(g.objects.slots[11], { node: 0, owner: me.id + 1, life: 4 }); me.god = 12;
    const luck = me.luckBad;
    const f = g.playerTurn(me);
    const asked: string[] = [];
    let r = f.next();
    while (!r.done) {
      const s = r.value;
      if ('ask' in s) {
        asked.push(s.t);
        if (s.t === 'turn') r = f.next(asked.length === 1 ? { action: 'tool' } : { dice: 1 });
        else if (s.t === 'choose' && s.title === '道具') r = f.next(16);
        else if (s.t === 'pick-map') r = f.next(s.spots.findIndex(x => x.at === 'actor' && x.id === me.id));   // oneself
        else if (s.t === 'choose') r = f.next(3);
        else r = f.next(undefined);
      } else r = f.next();
    }
    expect(asked).toEqual(['turn', 'choose', 'pick-map', 'choose']);
    expect(me.map).toBe(3);
    expect(me.trip).toBeUndefined();
    expect(w.cities[3].board.nodes.find(n => n.id === me.node)?.adjacent.some(Boolean)).toBe(true);   // a road square there
    expect(me.tools[15]).toBe(0);
    expect(me.god).toBe(12);
    expect(w.cities[3].objects.slots[11]).toMatchObject({ owner: me.id + 1, life: 4, node: 0 });
    expect(g.objects.slots[11].owner).toBe(0);
    expect(me.luckBad).toBe(luck);
    expect(w.cities[3].objects.godType(me)).toBe(12);
  });

  it('a bankruptcy auction is bid on by every living player of the world, after the turn', () => {
    const w = new World(settings(95), boards());
    const g = w.cities[1], loser = w.players[2];
    for (const x of w.players) { x.map = x.id % 2 ? 1 : 3; x.trip = undefined; x.whoPlays = 2; x.bankrupt = false; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = x.sleep = x.sleepwalk = 0; x.cash = x.map === 1 ? 0 : 5e7; }
    loser.map = 1;
    for (const l of g.board.lands.slice(0, 6)) { l.owner = loser.id + 1; l.level = 1; }
    w.mask(1);
    w.drain(1, w.bankrupt(loser, g));
    const pending = (w as unknown as { pendingAuctions: { refs: number[] }[] }).pendingAuctions;
    expect(pending).toHaveLength(1);
    expect(pending[0].refs).toHaveLength(3);
    const steps: Step[] = [];
    const flow = (w as unknown as { auctions(): Flow }).auctions();
    for (let r = flow.next(); !r.done; r = flow.next()) steps.push(r.value);
    const ends = steps.filter(s => s.t === 'fx' && s.kind === 'auction-end').map(s => (s as { p?: number }).p);
    expect(ends).toHaveLength(3);
    // Everyone in 大阪 is broke: the lots go to bidders in 九州.
    for (const b of ends) expect(w.players[b!].map).toBe(3);
    expect(steps.some(s => s.t === 'fx' && s.kind === 'auction' && (s.data as { worldwide?: boolean }).worldwide)).toBe(true);
  });

  it('城市霸主: more than half of a city\'s regular lots; out of its hospital / prison the same day, only there', () => {
    const w = new World(settings(96), boards());
    const p = w.players[3], g = w.cities[0], lands = g.board.lands;
    for (const x of w.players) { x.trip = undefined; x.whoPlays = 2; w.landed[x.id] = true; x.prison = x.hospital = x.hotel = x.vanish = 0; }
    // Large plots do not count: all of them plus exactly half the lots is not enough.
    for (const f of g.board.facilities) f.owner = p.id + 1;
    lands.forEach((l, i) => { l.owner = i < Math.floor(lands.length / 2) ? p.id + 1 : 0; });
    expect(w.overlordOf(0)).toBe(-1);
    lands[lands.length - 1].owner = p.id + 1;         // one more than half
    expect(w.overlordOf(0)).toBe(p.id);
    expect(w.overlordTitles(p)).toEqual(['東京霸主']);
    // The ticker announces it.
    const flow = (w as unknown as { checkOverlords(): Flow }).checkOverlords();
    for (let r = flow.next(); !r.done; r = flow.next());
    expect(w.log.some(l => l.kind === 'overlord' && l.text.includes('東京霸主'))).toBe(true);
    // In 東京: prison and hospital are left the same day.
    p.map = 0; p.node = g.board.nodes.find(n => n.event === 0 && n.ref === 0)!.id;
    const at = p.node;
    w.mask(0);
    w.drain(0, g.sendTo(p, 'prison', 5));
    w.drain(0, g.sendTo(p, 'hospital', 3));
    expect([p.prison, p.hospital, p.node]).toEqual([0, 0, at]);
    expect(w.log.some(l => l.text.includes('有檢察官罩著'))).toBe(true);
    expect(w.log.some(l => l.text.includes('特護病房'))).toBe(true);
    // Elsewhere, and when a full prison sends them on into 東京, the stay counts.
    const osaka = w.cities[1];
    p.map = 1; p.node = osaka.board.nodes.find(n => n.event === 0 && n.ref === 0)!.id;
    w.mask(1);
    w.drain(1, osaka.sendTo(p, 'prison', 2));
    expect(p.prison).toBe(2);
    p.prison = 0;
    (w as unknown as { occupancy(i: number): number }).occupancy = (i: number) => (i === 0 ? 0 : 8);
    w.drain(1, osaka.sendTo(p, 'prison', 4));
    expect([p.map, p.prison]).toEqual([0, 4]);
  });

  it('gives the human a rising title for each rival that falls', () => {
    const w = new World(settings(41, 0), boards());
    const g = w.cities[0];
    const titles: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const q = w.players[k];
      q.whoPlays = 2; q.map = 0;
      for (const s of w.drain(0, g.bankrupt(q))) void s;
      titles.push(w.fallen[k - 1].title);
    }
    expect(titles).toEqual(TITLES.slice(0, 3));
    expect(w.rivalsLeft()).toBe(8);
    // The human's bankruptcy ends the world.
    w.players[0].whoPlays = 1;
    w.drain(0, g.bankrupt(w.players[0]));
    expect(w.over).toEqual({ winner: -1, code: 1 });
  });
});
