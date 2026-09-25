/**
 * Ratio parsing for aspect ratios ("4:5", "16:9", "1.618") and proportional
 * track lists ("1:2:1", "3 2 1").
 */

export const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

/**
 * Parse an aspect ratio. Returns width / height.
 * Accepts "4:5", "4/5", "4x5", "4×5", "1.618", "phi"/"golden".
 */
export function parseAspectRatio(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (s === 'phi' || s === 'golden' || s === 'φ') return GOLDEN_RATIO;
  const pair = /^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (pair) {
    const w = parseFloat(pair[1]!);
    const h = parseFloat(pair[2]!);
    if (w > 0 && h > 0) return w / h;
    return null;
  }
  const single = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (single) {
    const v = parseFloat(single[1]!);
    return v > 0 ? v : null;
  }
  return null;
}

/**
 * Parse a proportional list like "1:2:1" or "1 2 1" or "2,1".
 * Returns null if any part is not a positive number.
 */
export function parseRatioList(input: string): number[] | null {
  const parts = input
    .trim()
    .split(/[\s:,;/]+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v) || v <= 0) return null;
    out.push(v);
  }
  return out;
}

/** Size that fits `ratio` (w/h) given one known dimension. */
export function sizeForRatio(ratio: number, known: { width?: number; height?: number }): { width: number; height: number } {
  if (known.width !== undefined) return { width: known.width, height: known.width / ratio };
  if (known.height !== undefined) return { width: known.height * ratio, height: known.height };
  throw new Error('sizeForRatio needs a width or a height');
}

/** Human label, e.g. 0.8 -> "4:5" when it matches a common ratio. */
export function describeRatio(ratio: number): string {
  const common: Array<[string, number]> = [
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
    ['9:16', 9 / 16],
    ['16:9', 16 / 9],
    ['2:3', 2 / 3],
    ['3:2', 3 / 2],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['1.91:1', 1.91],
    ['golden', GOLDEN_RATIO],
  ];
  for (const [label, v] of common) if (Math.abs(v - ratio) < 0.005) return label;
  return ratio.toFixed(3);
}
