import { describe, expect, it } from 'vitest';
import { nearestTo, navScore, pickInDirection, readingOrder, type Rect } from './pad-nav';

const box = (x: number, y: number, w = 40, h = 30): Rect => ({ x, y, w, h });

/** A 3×3 grid of 40×30 cells, 10 px apart: index = row * 3 + col. */
const grid = Array.from({ length: 9 }, (_, i) => box(100 + (i % 3) * 50, 100 + Math.floor(i / 3) * 40));

describe('spatial focus picker', () => {
  it('moves to the neighbouring cell of a grid in each direction', () => {
    const mid = grid[4];
    expect(pickInDirection(mid, 'left', grid, 4)).toBe(3);
    expect(pickInDirection(mid, 'right', grid, 4)).toBe(5);
    expect(pickInDirection(mid, 'up', grid, 4)).toBe(1);
    expect(pickInDirection(mid, 'down', grid, 4)).toBe(7);
  });

  it('finds nothing past the edge', () => {
    expect(pickInDirection(grid[0], 'left', grid, 0)).toBe(-1);
    expect(pickInDirection(grid[0], 'up', grid, 0)).toBe(-1);
    expect(pickInDirection(grid[8], 'right', grid, 8)).toBe(-1);
    expect(pickInDirection(grid[8], 'down', grid, 8)).toBe(-1);
  });

  it('prefers the box in the same row over a nearer one in another row', () => {
    const from = box(0, 0, 40, 30);
    const sameRowFar = box(130, 5, 40, 30);
    const otherRowNear = box(60, 60, 40, 30);
    expect(pickInDirection(from, 'right', [otherRowNear, sameRowFar])).toBe(1);
  });

  it('does not take a wide box that only grazes the row over the next key in it', () => {
    // a keypad's MAX key; ENTER beside it, the amount slider above both, barely overlapping their row
    const max = box(781, 231, 100, 55), enter = box(895, 245, 95, 45), slider = box(783, 188, 217, 49);
    expect(pickInDirection(max, 'right', [slider, enter])).toBe(1);
  });

  it('goes left to the list rather than up to a button barely left of the focus', () => {
    // the shop: EXIT at the right, the switch-shop button above it, the shelf's rows far to the left
    const exit = box(822, 324, 115, 61), tab = box(804, 13, 121, 121);
    const rows = [box(106, 102, 267, 38), box(106, 168, 267, 38), box(106, 236, 267, 38)];
    expect(pickInDirection(exit, 'left', [tab, ...rows])).toBe(3);
    // nothing else that way: the off-side button is still reachable
    expect(pickInDirection(rows[0], 'up', [tab, ...rows], 1)).toBe(0);
  });

  it('goes up from the top row of a grid to the tabs above it, not to a box barely higher off to the side', () => {
    // the new-game sheet: the map grid's top-right map, the map-kind chips above-left, a seat chip to the right
    const map = box(490, 130, 130, 105), kind = box(290, 95, 100, 25), seat = box(665, 145, 57, 28);
    expect(pickInDirection(map, 'up', [seat, kind])).toBe(1);
  });

  it('does not count a box straight beside the focus as below it', () => {
    const from = box(0, 0, 40, 30);
    expect(navScore(from, box(60, 0, 40, 30), 'down')).toBeNull();
    expect(navScore(from, box(60, 2, 40, 30), 'right')).not.toBeNull();
  });

  it('goes from a wide button to the cell under its middle, not the first one', () => {
    const wide = box(0, 0, 300, 40);
    const row = [box(0, 80, 60, 40), box(120, 80, 60, 40), box(240, 80, 60, 40)];
    expect(pickInDirection(wide, 'down', row)).toBe(1);
  });

  it('reaches up from a lone button to a toolbar spread across the top', () => {
    const toolbar = Array.from({ length: 11 }, (_, i) => box(i * 50, 0, 44, 40));
    const go = box(380, 300, 72, 67);
    // GO sits under the 8th–9th cells: the one overlapping its column wins
    const i = pickInDirection(go, 'up', toolbar);
    expect(i === 7 || i === 8).toBe(true);
    expect(toolbar[i].x + toolbar[i].w > go.x && toolbar[i].x < go.x + go.w).toBe(true);
  });

  it('breaks ties by the centre lining up, then by list order', () => {
    const from = box(0, 100, 40, 40);
    const a = box(100, 80, 40, 40), b = box(100, 102, 40, 40);
    expect(pickInDirection(from, 'right', [a, b])).toBe(1);
    expect(pickInDirection(from, 'right', [b, { ...b }])).toBe(0);
  });

  it('keeps the focus near where it was when a screen is drawn again', () => {
    expect(nearestTo(box(152, 141), grid)).toBe(4);
    expect(nearestTo(box(1000, 1000), grid, 100)).toBe(-1);
  });

  it('orders boxes by rows, then left to right', () => {
    const shuffled = [grid[5], grid[0], grid[8], grid[1], grid[3]];
    expect(readingOrder(shuffled).map(i => shuffled[i])).toEqual([grid[0], grid[1], grid[3], grid[5], grid[8]]);
    // slightly uneven heights in one row still count as one row
    const row = [box(100, 4, 40, 30), box(0, 0, 40, 40)];
    expect(readingOrder(row)).toEqual([1, 0]);
  });
});
