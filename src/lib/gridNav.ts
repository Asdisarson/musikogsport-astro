// Arrow-key movement over a grid of option buttons where some are disabled (sold-out sizes). Pure.
// Left/Right step by one, skipping disabled buttons; Up/Down step by a row (`cols`), continuing down the same
// column past disabled ones, and when the column runs out, take the nearest enabled button of the first row in
// that direction that has one. With nothing to move to, the index stays put.

const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };

export function gridStep(index: number, key: string, cols: number, disabled: boolean[]): number {
  const dir = STEPS[key];
  const n = disabled.length;
  if (!dir || index < 0 || index >= n) return index;
  const enabled = (i: number) => i >= 0 && i < n && !disabled[i];

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    for (let i = index + dir; i >= 0 && i < n; i += dir) if (enabled(i)) return i;
    return index;
  }

  const width = Math.max(1, Math.floor(cols) || 1);
  for (let i = index + dir * width; i >= 0 && i < n; i += dir * width) if (enabled(i)) return i;

  const col = index % width;
  const rows = Math.ceil(n / width);
  for (let r = Math.floor(index / width) + dir; r >= 0 && r < rows; r += dir) {
    let best = -1;
    for (let i = r * width; i < Math.min(n, (r + 1) * width); i++) {
      if (enabled(i) && (best < 0 || Math.abs((i % width) - col) < Math.abs((best % width) - col))) best = i;
    }
    if (best >= 0) return best;
  }
  return index;
}
