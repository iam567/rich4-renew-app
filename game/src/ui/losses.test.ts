/** Loss notices (docs/rules/15 §4.1): what counts as lost, what is one's own doing, and who is told. */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBoard, type RawMap } from '../core/board';
import { pack } from '../core/date';
import { Game } from '../core/game';
import type { GameSettings, Step } from '../core/types';
import { LossNotices, type Loss } from './losses';
import type { ScreenContext } from './screens/registry';

const mapFile = (id: number) => fileURLToPath(new URL(`../../../editor/site/assets/map-${id}.json`, import.meta.url));
const haveMaps = existsSync(mapFile(1));

function setup() {
  const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
  const settings: GameSettings = {
    mapId: 1, players: [0, 4, 9, 11].map((character, i) => ({ character, human: i === 0 })),
    fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 5,
  };
  const g = new Game(settings, board);
  for (const p of g.players) { p.placed = true; p.whoPlays = p.human ? 1 : 2; p.cards = [3, 3, 7, 12]; p.tools = p.tools.map(() => 0); p.tools[1] = 2; }
  const seen: Loss[] = [];
  const w = new LossNotices(g, () => ({}) as ScreenContext, { show: l => { seen.push(l); } });
  const step = (s: unknown) => w.before(s as Step);
  return { g, seen, step };
}

describe.skipIf(!haveMaps)('loss notices', () => {
  it('小衰神 takes a card: the human is told what and why, after the step that showed it', async () => {
    const { g, seen, step } = setup();
    await step({ t: 'turn', p: 0 });
    await step({ t: 'fx', kind: 'god-attach', p: 0, data: { type: 7 } });
    g.players[0].cards.splice(1, 1);
    await step({ t: 'board' });
    expect(seen).toEqual([]);
    await step({ t: 'say', p: 0, text: '小衰神附身' });
    expect(seen).toEqual([{ p: 0, cards: [[3, 1]], tools: [], cause: '小衰神附身' }]);
  });

  it('a card or tool used from the human\'s own turn menu is not a loss', async () => {
    const { g, seen, step } = setup();
    await step({ t: 'turn', p: 0 });
    await step({ ask: true, t: 'turn', p: 0, maxDice: 1 });
    await step({ ask: true, t: 'choose', p: 0, title: '使用卡片', options: [] });
    await step({ t: 'fx', kind: 'card', p: 0, data: { card: 12 } });
    g.players[0].cards.pop();
    g.players[0].tools[1] -= 1;
    await step({ t: 'board' });
    await step({ ask: true, t: 'turn', p: 0, maxDice: 1 });
    await step({ t: 'dice', p: 0, values: [3] });
    await step({ t: 'step', p: 0, from: 1, to: 2, dir: 0, left: 2 });
    expect(seen).toEqual([]);
  });

  it('a sale at the shop is not a loss; the robber afterwards is', async () => {
    const { g, seen, step } = setup();
    await step({ ask: true, t: 'shop', p: 0, cards: [], tools: [], points: 0 });
    g.players[0].cards.shift();
    await step({ t: 'fx', kind: 'shop', p: 0 });
    await step({ t: 'turn', p: 1 });
    g.players[0].cards.shift();
    await step({ t: 'fx', kind: 'npc-rob-card', p: 0, target: 1, data: { actor: 5, card: 3 } });
    await step({ t: 'board' });
    expect(seen.map(l => [l.p, l.cards, l.cause])).toEqual([[0, [[3, 1]], '被強盜搶走']]);
  });

  it('a computer\'s silent change is not reported, a theft by an event is', async () => {
    const { g, seen, step } = setup();
    await step({ t: 'turn', p: 1 });
    g.players[1].cards.pop(); // e.g. sold at the shop: the computer's shop is silent
    await step({ t: 'board' });
    await step({ t: 'fx', kind: 'card-result', p: 0, target: 1, data: { card: 13, got: 2 } });
    g.players[1].cards.pop();
    await step({ t: 'board' });
    await step({ t: 'turn', p: 2 });
    expect(seen.map(l => [l.p, l.cards, l.cause])).toEqual([[1, [[7, 1]], `被${g.name(0)}的搶奪卡搶走`]]);
  });

  it('getting on a scooter is not a loss, losing the ridden one is', async () => {
    const { g, seen, step } = setup();
    const p = g.players[0];
    p.tools[4] = 1;
    await step({ t: 'turn', p: 1 });
    p.tools[4] = 0; p.traffic = 1; // got on: still held
    await step({ t: 'board' });
    await step({ t: 'fx', kind: 'vehicle-lost', p: 0, data: { car: false } });
    p.traffic = 0;
    await step({ ask: true, t: 'yesno', p: 0, text: '' });
    expect(seen).toEqual([{ p: 0, cards: [], tools: [[5, 1]], cause: '命運' }]);
  });

  it('watching a whole computer game changes nothing in it, and names a cause for every line', async () => {
    const run = async (watch: boolean) => {
      const board = parseBoard(JSON.parse(readFileSync(mapFile(1), 'utf8')) as RawMap);
      const g = new Game({
        mapId: 1, players: [0, 4, 9, 11].map(character => ({ character, human: false })),
        fundIndex: 1, traffic: 0, landLimitIndex: 0, daysLimitIndex: 0, victoryIndex: 0, startDate: pack(2026, 10, 14), seed: 99,
      }, board);
      const seen: Loss[] = [];
      const w = new LossNotices(g, () => ({}) as ScreenContext, { show: l => { seen.push(l); } });
      const flow = g.run(), log: string[] = [];
      for (let r = flow.next(); !r.done && g.daysElapsed < 240; r = flow.next()) {
        if (watch) await w.before(r.value);
        log.push(JSON.stringify(r.value));
      }
      return { log, seen, state: JSON.stringify(g.players) };
    };
    const a = await run(true), b = await run(false);
    expect(a.log).toEqual(b.log);
    expect(a.state).toBe(b.state);
    for (const l of a.seen) expect(l.cause).not.toBe('');
  }, 30_000);
});
