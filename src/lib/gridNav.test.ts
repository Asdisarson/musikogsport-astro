import { describe, expect, it } from 'vitest';
import { gridStep } from './gridNav';

// A 2-column size grid: 36/37, 38 (sold out)/39, 40/41.
const sizes = [false, false, true, false, false, false];

describe('gridStep', () => {
  it('moves Down by a row, skipping a sold-out size by continuing down the same column', () => {
    expect(gridStep(1, 'ArrowDown', 2, sizes)).toBe(3); // 37 -> 39
    expect(gridStep(0, 'ArrowDown', 2, sizes)).toBe(4); // 36 -> (38 sold out) -> 40
  });

  it('moves Up the same way', () => {
    expect(gridStep(4, 'ArrowUp', 2, sizes)).toBe(0); // 40 -> (38 sold out) -> 36
    expect(gridStep(3, 'ArrowUp', 2, sizes)).toBe(1); // 39 -> 37
  });

  it('moves Left/Right by one, skipping sold-out sizes', () => {
    expect(gridStep(1, 'ArrowRight', 2, sizes)).toBe(3); // 37 -> (38 sold out) -> 39
    expect(gridStep(3, 'ArrowLeft', 2, sizes)).toBe(1); // 39 -> (38 sold out) -> 37
    expect(gridStep(4, 'ArrowRight', 2, sizes)).toBe(5);
  });

  it('stays put at an edge', () => {
    expect(gridStep(0, 'ArrowLeft', 2, sizes)).toBe(0);
    expect(gridStep(5, 'ArrowRight', 2, sizes)).toBe(5);
    expect(gridStep(0, 'ArrowUp', 2, sizes)).toBe(0);
    expect(gridStep(5, 'ArrowDown', 2, sizes)).toBe(5);
  });

  it('falls back to the nearest enabled size in the next row when the column runs out', () => {
    // 36/37, 38/39 (sold out): Down from 36 -> 38 (same column is fine)
    expect(gridStep(0, 'ArrowDown', 2, [false, false, false, true])).toBe(2);
    // Down from 37 -> 39 sold out, nothing below -> nearest in that row: 38
    expect(gridStep(1, 'ArrowDown', 2, [false, false, false, true])).toBe(2);
    // a short last row: 36/37, 38 -> Down from 37 lands on 38
    expect(gridStep(1, 'ArrowDown', 2, [false, false, false])).toBe(2);
  });

  it('skips a fully sold-out row', () => {
    // 36/37, 38/39 sold out, 40/41: Down from 37 -> 41
    expect(gridStep(1, 'ArrowDown', 2, [false, false, true, true, false, false])).toBe(5);
  });

  it('stays put when nothing in that direction can be chosen', () => {
    expect(gridStep(0, 'ArrowDown', 2, [false, false, true, true])).toBe(0);
    expect(gridStep(0, 'ArrowRight', 2, [false, true, true])).toBe(0);
  });

  it('ignores other keys and works on a single-column (flex) list', () => {
    expect(gridStep(1, 'Enter', 2, sizes)).toBe(1);
    expect(gridStep(1, 'ArrowDown', 1, [false, false, true, false])).toBe(3);
  });
});
