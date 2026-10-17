import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from './board';
import { pack } from './date';
import { Game } from './game';
import { OBJ } from './modules/objects';
import type { Step } from './types';

// The remake's hotel rules (docs/rules/02 §4.3, 06 §5.5; REMAKE_HOTEL): 免費卡 / 嫁禍卡 on a 旅館 stay (framed, the
// other player stays), 土地公 takes the hotel at the check-out when still on the guest.
const file = fileURLToPath(new URL('../../../editor/site/assets/remake/tokyo.json', import.meta.url));
const have = existsSync(file);

function setup(chars = [0, 4, 9, 11]) {
  const g = new Game({ mapId: 100, players: chars.map(character => ({ character, human: false })), fundIndex: 1, traffic: 0, landLimitIndex: 0,
    daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 18), seed: 7 }, parseBoard(JSON.parse(readFileSync(file, 'utf8')) as RawMap));
  for (const q of g.players) { q.placed = true; q.whoPlays = 2; q.cash = 500000; q.cards = []; }
  const f = g.board.facilities[0], node = g.board.nodes.find(n => n.ref === f.id + 4000)!;
  f.owner = 1; f.type = 1; f.level = 5;
  return { g, f, node, owner: g.players[0], guest: g.players[1] };
}
const run = (flow: Generator<Step, unknown, unknown>) => { const out: Step[] = []; let r = flow.next(); while (!r.done) { out.push(r.value as Step); r = flow.next(); } return out; };
function attachEarthGod(g: Game, p: Game['players'][number]) {
  const pair = g.objects.slots[(OBJ.EarthGod % 2 ? OBJ.EarthGod + 1 : OBJ.EarthGod - 1) - 1];
  if (pair.node) g.objects.removeAt(pair.node);
  run(g.objects.attach(p, OBJ.EarthGod) as Generator<Step, unknown, unknown>);
}
/** Day starts for p until the stay ends (turnStart counts it down and checks out). */
function stayOut(g: Game, p: Game['players'][number]) {
  const out: Step[] = [];
  for (let k = 0; k < 6 && (p.hotel || out.length === 0); k++) out.push(...run((g as unknown as { turnStart(q: unknown): Generator<Step, unknown, unknown> }).turnStart(p)));
  return out;
}

describe.skipIf(!have)('hotel stays (remake rules)', () => {
  it('土地公 on the guest takes the 旅館 at the check-out, not on the day of the stop', () => {
    const { g, f, node, guest } = setup();
    attachEarthGod(g, guest);
    guest.node = node.id;
    run((g as unknown as { land(q: unknown): Generator<Step, unknown, unknown> }).land(guest));
    expect(guest.hotel).toBeGreaterThan(0);
    expect(f.owner).toBe(1);
    const out = stayOut(g, guest);
    expect(out.some(s => s.t === 'fx' && s.kind === 'earth-god')).toBe(true);
    expect(f.owner).toBe(guest.id + 1);
  });

  it('土地公 gone during the stay: no takeover', () => {
    const { g, f, node, guest } = setup();
    attachEarthGod(g, guest);
    guest.node = node.id;
    run((g as unknown as { land(q: unknown): Generator<Step, unknown, unknown> }).land(guest));
    g.objects.detachAll(guest);
    stayOut(g, guest);
    expect(f.owner).toBe(1);
  });

  it('嫁禍卡 on a 旅館 stay: the framed player is taken to the hotel and stays, paying; the guest goes on free', () => {
    const { g, f, node, guest } = setup();
    guest.cards = [19]; guest.cash = 100; guest.hostility[2] = 1e9;   // a fee above its cash: frames the most hated
    guest.node = node.id;
    const out = run((g as unknown as { land(q: unknown): Generator<Step, unknown, unknown> }).land(guest));
    const framed = g.players[2];
    expect(guest.hotel).toBe(0);
    expect([framed.node, framed.facility, framed.hotel > 0]).toEqual([node.id, f.id, true]);
    expect(out.some(s => s.t === 'pay' && s.from === framed.id && s.to === 0)).toBe(true);
  });

  it('免費卡 on a 旅館 stay: nothing paid, the guest still stays', () => {
    const { g, node, guest } = setup();
    guest.cards = [20]; guest.cash = 100;
    guest.node = node.id;
    const out = run((g as unknown as { land(q: unknown): Generator<Step, unknown, unknown> }).land(guest));
    expect(guest.cards).not.toContain(20);
    expect(out.some(s => s.t === 'pay' && s.from === guest.id)).toBe(false);
    expect(guest.hotel).toBeGreaterThan(0);
  });
});
