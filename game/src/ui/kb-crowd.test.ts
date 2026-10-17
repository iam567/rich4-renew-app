import { describe, expect, it } from 'vitest';
import { angleDiff, BIKE, buildTracks, Crowd, nearestView, roundCorners, viewAngle, walkerFacing } from './kb-crowd';

/** The board's projection (ui/board-view.ts basis()): a map vector on screen in view rotation `rot`. */
const S = 1.2175, K = Math.SQRT1_2;
function screenDeg(rot: number, dx: number, dy: number): number {
  const th = (-22.5 + 45 * rot) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th);
  return Math.atan2(K * S * (s * dx + c * dy), S * (c * dx - s * dy)) * 180 / Math.PI;
}
const AXES: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

describe('歌舞伎町 walkers face the way they walk (docs/rules/21 §8.1)', () => {
  it('the sheets\' rows are the blockout views 1, 3, 5, 7: right-down, up-right, left-up, down-left on screen', () => {
    expect(Math.round(viewAngle(1))).toBe(16);
    expect(Math.round(viewAngle(3))).toBe(-60);
    expect(Math.round(viewAngle(5))).toBe(-164);
    expect(Math.round(viewAngle(7))).toBe(120);
  });

  it('walking down-left on screen shows row 3 (the front, turned left), never row 0 (turned right: the old moonwalk)', () => {
    for (const kind of [0, 1, 3, 5]) {
      expect(walkerFacing(kind, 120)).toMatchObject({ row: 3, flip: false });
      expect(walkerFacing(kind, 16)).toMatchObject({ row: 0, flip: false });
      expect(walkerFacing(kind, 60)).toMatchObject({ row: 3, flip: true });
    }
  });

  it('the kimono\'s row 0 faces left-down and the tourist\'s row 3 (a back view) is never used', () => {
    expect(walkerFacing(4, 164)).toMatchObject({ row: 0, flip: false });
    expect(walkerFacing(4, 16)).toMatchObject({ row: 0, flip: true });
    for (let d = -180; d < 180; d += 3) expect(walkerFacing(2, d).row).not.toBe(3);
  });

  it('every kind, every board rotation: along the roads exactly the right facing, any other way within 31° (the tourist, without its steep front view, 75°: still a front view walking down)', () => {
    for (let kind = 0; kind < 6; kind++) {
      for (let rot = 0; rot < 8; rot++) {
        for (const [dx, dy] of [...AXES, ...DIAG]) {
          const deg = screenDeg(rot, dx, dy), f = walkerFacing(kind, deg);
          // The tourist lacks the steep front view: its nearest is 44° off; everyone else is exact.
          expect(f.err).toBeLessThan(kind === 2 ? 45 : 0.5);
        }
      }
      for (let d = -180; d < 180; d += 1) expect(walkerFacing(kind, d).err).toBeLessThan(kind === 2 ? 75 : 31);
    }
  });

  it('8-view sprites (vehicles, the train, the bicycle) pick the exact view along the roads in every rotation', () => {
    for (let rot = 0; rot < 8; rot++) {
      for (const [dx, dy] of [...AXES, ...DIAG]) {
        const deg = screenDeg(rot, dx, dy), k = nearestView(deg);
        expect(angleDiff(viewAngle(k), deg)).toBeLessThan(0.5);
      }
    }
  });
});

describe('歌舞伎町 crowd: tracks and manners', () => {
  // A crossroads at (500, 500): four sidewalk pairs as the map builder writes them (23 px off the centre lines,
  // trimmed 40 px short of the junction), and a plaza loop.
  const J = 500, W = 23, T = 40;
  const paths: [number, number][][] = [
    [[100, J - W], [J - T, J - W]], [[100, J + W], [J - T, J + W]],
    [[J + T, J - W], [900, J - W]], [[J + T, J + W], [900, J + W]],
    [[J - W, 100], [J - W, J - T]], [[J + W, 100], [J + W, J - T]],
    [[J - W, J + T], [J - W, 900]], [[J + W, J + T], [J + W, 900]],
    [[1000, 1000], [1100, 1000], [1100, 1080], [1000, 1080], [1000, 1000]],
  ];
  const tracks = buildTracks(paths);

  it('every open sidewalk end goes on round the corner or straight over the crossing, never back on the other side', () => {
    const open = tracks.filter(t => !t.closed);
    expect(open.length).toBe(16);
    // A sidewalk ending at the junction links on; one ending at the map's edge (x 100 / 900) has nowhere to go.
    const atJunction = open.filter(t => { const e = t.pts[t.pts.length - 1]; return Math.abs(e[0] - J) < 60 && Math.abs(e[1] - J) < 60; });
    expect(atJunction.length).toBe(8);
    for (const t of atJunction) {
      expect(t.links.length).toBeGreaterThanOrEqual(2);
      for (const l of t.links) expect(l.to).not.toBe(t.rev);
    }
  });

  it('a loop\'s corners are rounded (no turn sharper than ~25° between two points)', () => {
    const pts = roundCorners([[0, 0], [100, 0], [100, 80], [0, 80], [0, 0]], true);
    for (let i = 1; i < pts.length - 1; i++) {
      const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
      expect(Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))).toBeLessThan(0.45);
    }
  });

  it('walkers never turn on the spot: the heading changes at most ~7 rad/s; they stay near the sidewalks', () => {
    const c = new Crowd(tracks, 40, 1234, () => null, 3);
    expect(c.walkers.length).toBe(43);
    expect(c.walkers.filter(w => w.kind === BIKE).length).toBe(3);
    expect(c.walkers.some(w => w.lead)).toBe(true);
    const prev = c.walkers.map(w => w.h);
    for (let i = 0; i < 1800; i++) {
      c.step(1 / 60, i / 60);
      c.walkers.forEach((w, j) => {
        if (w.lead === null) {
          const d = Math.abs(Math.atan2(Math.sin(w.h - prev[j]), Math.cos(w.h - prev[j])));
          expect(d).toBeLessThanOrEqual(7 / 60 + 1e-6);
        }
        prev[j] = w.h;
        // On the map near the paths (lanes and dodging are a few px).
        expect(w.x).toBeGreaterThan(60); expect(w.x).toBeLessThan(1150);
      });
    }
  });

  it('the same seed makes the same crowd', () => {
    const a = new Crowd(tracks, 20, 7), b = new Crowd(tracks, 20, 7);
    for (let i = 0; i < 300; i++) { a.step(1 / 30, i / 30); b.step(1 / 30, i / 30); }
    expect(a.walkers.map(w => [w.x.toFixed(3), w.y.toFixed(3), w.kind])).toEqual(b.walkers.map(w => [w.x.toFixed(3), w.y.toFixed(3), w.kind]));
  });
});
