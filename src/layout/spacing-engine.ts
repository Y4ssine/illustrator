/**
 * Design spacing system — pure functions.
 *
 *   [ A ][23][ B ][41][ C ]   --normalize(32)-->   [ A ][32][ B ][32][ C ]
 *
 * Items are ordered along an axis by their leading edge; gaps are measured
 * edge-to-edge (negative = overlap). Planning returns per-item moves; the
 * command layer turns them into host translate ops.
 */

import { center, extent, start, unionRects, type Axis, type Rect } from '../geometry/rect';

export interface SpacingItem {
  id: string;
  rect: Rect;
}

export type SpacingSystem = { kind: 'multiple'; base: number } | { kind: 'scale'; values: number[] };

export const SPACING_SYSTEMS: Record<string, SpacingSystem> = {
  '4': { kind: 'multiple', base: 4 },
  '8': { kind: 'multiple', base: 8 },
  '10': { kind: 'multiple', base: 10 },
  '12': { kind: 'multiple', base: 12 },
  tokens: { kind: 'scale', values: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128] },
};

export interface SpacingAnalysis {
  axis: Axis;
  order: string[];
  gaps: number[];
  min: number | null;
  max: number | null;
  mean: number | null;
  overlaps: number;
  outer: Rect | null;
  /** Suggested uniform gap from the spacing system (null if < 2 items). */
  suggested: number | null;
  /** True when all gaps are equal within 0.05 pt. */
  uniform: boolean;
}

export type SpacingOperation =
  | { kind: 'normalize' }
  | { kind: 'distribute' }
  | { kind: 'matchSmallest' }
  | { kind: 'matchLargest' }
  | { kind: 'matchFirst' }
  | { kind: 'exact'; value: number };

/** Which item stays put. 'end' keeps the last item fixed — natural for RTL (Arabic) layouts. */
export type SpacingAnchor = 'start' | 'end' | 'center';

export interface Move {
  id: string;
  dx: number;
  dy: number;
}

export interface SpacingPlan {
  axis: Axis;
  targetGap: number | null;
  moves: Move[];
  before: number[];
  after: number[];
  message: string;
}

export function suggestGap(value: number, system: SpacingSystem): number {
  const v = Math.max(0, value);
  if (system.kind === 'multiple') {
    if (!(system.base > 0)) return v;
    return Math.max(0, Math.round(v / system.base) * system.base);
  }
  let best = system.values[0] ?? v;
  for (const s of system.values) if (Math.abs(s - v) < Math.abs(best - v)) best = s;
  return best;
}

/** Pick the axis along which items are spread the most (by centre positions). */
export function detectAxis(items: readonly SpacingItem[]): Axis {
  if (items.length < 2) return 'x';
  const cs = items.map((i) => center(i.rect));
  const rx = Math.max(...cs.map((c) => c.x)) - Math.min(...cs.map((c) => c.x));
  const ry = Math.max(...cs.map((c) => c.y)) - Math.min(...cs.map((c) => c.y));
  return rx >= ry ? 'x' : 'y';
}

export function sortAlong(items: readonly SpacingItem[], axis: Axis): SpacingItem[] {
  const other: Axis = axis === 'x' ? 'y' : 'x';
  return [...items].sort((a, b) => start(a.rect, axis) - start(b.rect, axis) || start(a.rect, other) - start(b.rect, other));
}

export function measureGaps(sorted: readonly SpacingItem[], axis: Axis): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!.rect;
    const cur = sorted[i]!.rect;
    gaps.push(start(cur, axis) - (start(prev, axis) + extent(prev, axis)));
  }
  return gaps;
}

export function analyzeSpacing(items: readonly SpacingItem[], axisIn: Axis | 'auto', system: SpacingSystem): SpacingAnalysis {
  const axis = axisIn === 'auto' ? detectAxis(items) : axisIn;
  const sorted = sortAlong(items, axis);
  const gaps = measureGaps(sorted, axis);
  const min = gaps.length ? Math.min(...gaps) : null;
  const max = gaps.length ? Math.max(...gaps) : null;
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
  return {
    axis,
    order: sorted.map((i) => i.id),
    gaps,
    min,
    max,
    mean,
    overlaps: gaps.filter((g) => g < -0.01).length,
    outer: unionRects(items.map((i) => i.rect)),
    suggested: mean === null ? null : suggestGap(mean, system),
    uniform: gaps.length > 0 && max! - min! <= 0.05,
  };
}

export function planSpacing(
  items: readonly SpacingItem[],
  operation: SpacingOperation,
  opts: { axis: Axis | 'auto'; anchor: SpacingAnchor; system: SpacingSystem },
): SpacingPlan {
  const analysis = analyzeSpacing(items, opts.axis, opts.system);
  const axis = analysis.axis;
  const sorted = sortAlong(items, axis);
  const before = analysis.gaps;
  if (sorted.length < 2) {
    return { axis, targetGap: null, moves: [], before, after: before, message: 'Select at least two objects.' };
  }

  if (operation.kind === 'distribute') {
    if (sorted.length < 3) {
      return { axis, targetGap: null, moves: [], before, after: before, message: 'Distribute needs at least three objects (the outer two stay in place).' };
    }
    const first = sorted[0]!.rect;
    const last = sorted[sorted.length - 1]!.rect;
    const outerStart = start(first, axis);
    const outerEnd = start(last, axis) + extent(last, axis);
    const sizes = sorted.reduce((s, it) => s + extent(it.rect, axis), 0);
    const gap = (outerEnd - outerStart - sizes) / (sorted.length - 1);
    return layout(sorted, axis, gap, 'start', before, `Distributed evenly: ${fmt(gap)} pt gaps.`);
  }

  let target: number;
  switch (operation.kind) {
    case 'normalize':
      target = analysis.suggested ?? 0;
      break;
    case 'matchSmallest':
      target = Math.max(0, analysis.min ?? 0);
      break;
    case 'matchLargest':
      target = analysis.max ?? 0;
      break;
    case 'matchFirst':
      target = before[0] ?? 0;
      break;
    case 'exact':
      if (!Number.isFinite(operation.value)) throw new Error('Gap must be a number.');
      target = operation.value;
      break;
  }
  return layout(sorted, axis, target, opts.anchor, before, `Gaps set to ${fmt(target)} pt.`);
}

function layout(sorted: readonly SpacingItem[], axis: Axis, gap: number, anchor: SpacingAnchor, before: number[], message: string): SpacingPlan {
  const n = sorted.length;
  const newStarts: number[] = new Array<number>(n);
  if (anchor === 'end') {
    const last = sorted[n - 1]!.rect;
    newStarts[n - 1] = start(last, axis);
    for (let i = n - 2; i >= 0; i--) {
      newStarts[i] = newStarts[i + 1]! - gap - extent(sorted[i]!.rect, axis);
    }
  } else {
    newStarts[0] = start(sorted[0]!.rect, axis);
    for (let i = 1; i < n; i++) {
      newStarts[i] = newStarts[i - 1]! + extent(sorted[i - 1]!.rect, axis) + gap;
    }
    if (anchor === 'center') {
      const oldMid = (start(sorted[0]!.rect, axis) + start(sorted[n - 1]!.rect, axis) + extent(sorted[n - 1]!.rect, axis)) / 2;
      const newMid = (newStarts[0]! + newStarts[n - 1]! + extent(sorted[n - 1]!.rect, axis)) / 2;
      const shift = oldMid - newMid;
      for (let i = 0; i < n; i++) newStarts[i] = newStarts[i]! + shift;
    }
  }
  const moves: Move[] = [];
  for (let i = 0; i < n; i++) {
    const d = newStarts[i]! - start(sorted[i]!.rect, axis);
    if (Math.abs(d) > 1e-4) moves.push({ id: sorted[i]!.id, dx: axis === 'x' ? d : 0, dy: axis === 'y' ? d : 0 });
  }
  const after = new Array<number>(Math.max(0, n - 1)).fill(gap);
  return {
    axis,
    targetGap: gap,
    moves,
    before,
    after,
    message: moves.length === 0 ? 'Spacing already matches — nothing moved.' : message,
  };
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}
