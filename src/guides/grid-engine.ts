/**
 * Smart Grid engine — pure geometry, no Illustrator dependency.
 *
 * Input: a target area (artboard, selection bounds, clip bounds, custom rect)
 * and a GridSpec. Output: guide lines (design space, Y down) plus the column,
 * row and module rectangles so other features (backdrops, image frames,
 * composition checks) can reuse the same grid.
 */

import { GOLDEN_RATIO } from '../geometry/ratio';
import { insetRect, type Margins, type Rect } from '../geometry/rect';

export type GuideRole =
  | 'margin'
  | 'column'
  | 'row'
  | 'baseline'
  | 'thirds'
  | 'golden'
  | 'center'
  | 'diagonal'
  | 'radial'
  | 'edge'
  | 'quarter'
  | 'offset'
  | 'safe';

export interface GuideLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  role: GuideRole;
}

export interface TrackSpec {
  count: number;
  gutter: number;
  /** Proportional track sizes, e.g. [1, 2, 1]. Length must equal `count` when given. */
  ratios?: number[] | null;
}

export interface GridSpec {
  margins: Margins;
  columns?: TrackSpec | null;
  rows?: TrackSpec | null;
  baseline?: { increment: number; offset: number } | null;
  thirds?: boolean;
  golden?: boolean;
  center?: boolean;
  diagonals?: 'none' | 'corners' | 'fortyFive';
  radial?: { spokes: number } | null;
  /** Draw the margin rectangle as guides. */
  marginGuides?: boolean;
  /** Column/row guides span the whole target area (true) or only the content box (false). */
  spanArea?: boolean;
  /** Composition helpers (thirds, golden, center, diagonals, radial) use the whole area or the content box. */
  compositionOn?: 'area' | 'content';
  /** Round guide positions to whole points (px). */
  pixelSnap?: boolean;
  /** Extend straight guides beyond the area by this many points. */
  extend?: number;
}

export interface Track {
  start: number;
  size: number;
}

export interface GridResult {
  area: Rect;
  content: Rect;
  columns: Track[];
  rows: Track[];
  modules: Rect[];
  lines: GuideLine[];
  warnings: string[];
}

export class GridError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GridError';
  }
}

export const MAX_GUIDES_PER_AREA = 2000;

/**
 * Split `length` into `spec.count` tracks separated by gutters.
 * Throws GridError with a designer-readable message if it cannot fit.
 */
export function computeTracks(start: number, length: number, spec: TrackSpec, axisLabel = 'column'): Track[] {
  const count = Math.floor(spec.count);
  if (!Number.isFinite(count) || count < 1) throw new GridError(`${cap(axisLabel)} count must be at least 1.`);
  if (spec.gutter < 0) throw new GridError(`${cap(axisLabel)} gutter cannot be negative.`);
  const available = length - spec.gutter * (count - 1);
  if (available <= 0) {
    throw new GridError(
      `${count} ${axisLabel}s with ${round(spec.gutter)} pt gutters do not fit in ${round(length)} pt. Reduce the gutter, margins or ${axisLabel} count.`,
    );
  }
  let weights: number[];
  if (spec.ratios && spec.ratios.length > 0) {
    if (spec.ratios.length !== count) {
      throw new GridError(`Custom ratios list has ${spec.ratios.length} values but there are ${count} ${axisLabel}s.`);
    }
    if (spec.ratios.some((r) => !(r > 0))) throw new GridError('Custom ratios must be positive numbers.');
    weights = spec.ratios;
  } else {
    weights = new Array<number>(count).fill(1);
  }
  const total = weights.reduce((a, b) => a + b, 0);
  const tracks: Track[] = [];
  let cursor = start;
  for (let i = 0; i < count; i++) {
    const size = (available * weights[i]!) / total;
    tracks.push({ start: cursor, size });
    cursor += size + spec.gutter;
  }
  return tracks;
}

export function computeGrid(area: Rect, spec: GridSpec): GridResult {
  if (!(area.w > 0 && area.h > 0)) throw new GridError('The target area has no size.');
  const warnings: string[] = [];
  const content = insetRect(area, spec.margins);
  if (content.w <= 0 || content.h <= 0) {
    throw new GridError('Margins are larger than the target area. Reduce the margins.');
  }
  const ext = Math.max(0, spec.extend ?? 0);
  const spanArea = spec.spanArea ?? true;
  const comp = (spec.compositionOn ?? 'area') === 'area' ? area : content;

  const vSpan = spanArea ? [area.y - ext, area.y + area.h + ext] : [content.y - ext, content.y + content.h + ext];
  const hSpan = spanArea ? [area.x - ext, area.x + area.w + ext] : [content.x - ext, content.x + content.w + ext];

  const lines: GuideLine[] = [];
  const vline = (x: number, role: GuideRole, span = vSpan): void => {
    lines.push({ x1: x, y1: span[0]!, x2: x, y2: span[1]!, role });
  };
  const hline = (y: number, role: GuideRole, span = hSpan): void => {
    lines.push({ x1: span[0]!, y1: y, x2: span[1]!, y2: y, role });
  };

  if (spec.marginGuides ?? true) {
    const fullV = [area.y - ext, area.y + area.h + ext];
    const fullH = [area.x - ext, area.x + area.w + ext];
    if (spec.margins.left > 0) vline(content.x, 'margin', fullV);
    if (spec.margins.right > 0) vline(content.x + content.w, 'margin', fullV);
    if (spec.margins.top > 0) hline(content.y, 'margin', fullH);
    if (spec.margins.bottom > 0) hline(content.y + content.h, 'margin', fullH);
  }

  const columns = spec.columns ? computeTracks(content.x, content.w, spec.columns, 'column') : [];
  const rows = spec.rows ? computeTracks(content.y, content.h, spec.rows, 'row') : [];

  for (const c of columns) {
    vline(c.start, 'column');
    vline(c.start + c.size, 'column');
  }
  for (const r of rows) {
    hline(r.start, 'row');
    hline(r.start + r.size, 'row');
  }

  if (spec.baseline) {
    const { increment, offset } = spec.baseline;
    if (!(increment > 0)) throw new GridError('Baseline increment must be greater than 0.');
    const count = Math.floor((content.h - offset) / increment) + 1;
    if (count > MAX_GUIDES_PER_AREA) {
      throw new GridError(`A ${round(increment)} pt baseline would create ${count} guides. Use a larger increment.`);
    }
    const bSpan = [content.x - ext, content.x + content.w + ext];
    for (let i = 0; i < count; i++) {
      const y = content.y + offset + i * increment;
      if (y <= content.y + content.h + 1e-6) hline(y, 'baseline', bSpan);
    }
  }

  const compV = [comp.y - ext, comp.y + comp.h + ext];
  const compH = [comp.x - ext, comp.x + comp.w + ext];
  if (spec.thirds) {
    for (const f of [1 / 3, 2 / 3]) {
      vline(comp.x + comp.w * f, 'thirds', compV);
      hline(comp.y + comp.h * f, 'thirds', compH);
    }
  }
  if (spec.golden) {
    const a = 1 / (GOLDEN_RATIO * GOLDEN_RATIO); // ≈ 0.382
    const b = 1 / GOLDEN_RATIO; // ≈ 0.618
    for (const f of [a, b]) {
      vline(comp.x + comp.w * f, 'golden', compV);
      hline(comp.y + comp.h * f, 'golden', compH);
    }
  }
  if (spec.center) {
    vline(comp.x + comp.w / 2, 'center', compV);
    hline(comp.y + comp.h / 2, 'center', compH);
  }
  const diag = spec.diagonals ?? 'none';
  if (diag === 'corners') {
    lines.push({ x1: comp.x, y1: comp.y, x2: comp.x + comp.w, y2: comp.y + comp.h, role: 'diagonal' });
    lines.push({ x1: comp.x + comp.w, y1: comp.y, x2: comp.x, y2: comp.y + comp.h, role: 'diagonal' });
  } else if (diag === 'fortyFive') {
    // 45° lines from each corner, clipped to the rectangle (the "diagonal method").
    const s = Math.min(comp.w, comp.h);
    const l = comp.x;
    const t = comp.y;
    const r = comp.x + comp.w;
    const b = comp.y + comp.h;
    lines.push({ x1: l, y1: t, x2: l + s, y2: t + s, role: 'diagonal' });
    lines.push({ x1: r, y1: t, x2: r - s, y2: t + s, role: 'diagonal' });
    lines.push({ x1: l, y1: b, x2: l + s, y2: b - s, role: 'diagonal' });
    lines.push({ x1: r, y1: b, x2: r - s, y2: b - s, role: 'diagonal' });
  }
  if (spec.radial && spec.radial.spokes > 0) {
    const n = Math.floor(spec.radial.spokes);
    if (n > 360) throw new GridError('Radial grids are limited to 360 spokes.');
    const cx = comp.x + comp.w / 2;
    const cy = comp.y + comp.h / 2;
    for (let i = 0; i < n; i++) {
      const ang = (i * 2 * Math.PI) / n - Math.PI / 2;
      const end = rayToRectEdge(cx, cy, Math.cos(ang), Math.sin(ang), comp);
      lines.push({ x1: cx, y1: cy, x2: end.x, y2: end.y, role: 'radial' });
    }
  }

  let out = dedupeLines(lines);
  if (spec.pixelSnap) {
    const snapped = out.map(snapLine);
    const changed = snapped.some((l, i) => l.x1 !== out[i]!.x1 || l.y1 !== out[i]!.y1);
    if (changed) warnings.push('Guides were rounded to whole pixels; some columns may differ by up to 1 px.');
    out = dedupeLines(snapped);
  }
  if (out.length > MAX_GUIDES_PER_AREA) {
    throw new GridError(`This grid would create ${out.length} guides for one area. Simplify the settings.`);
  }
  for (const c of columns) if (c.size < 8) warnings.push('Some columns are narrower than 8 pt.');

  const modules: Rect[] = [];
  const colTracks = columns.length > 0 ? columns : [{ start: content.x, size: content.w }];
  const rowTracks = rows.length > 0 ? rows : [{ start: content.y, size: content.h }];
  if (columns.length > 0 || rows.length > 0) {
    for (const r of rowTracks) for (const c of colTracks) modules.push({ x: c.start, y: r.start, w: c.size, h: r.size });
  }

  return { area, content, columns, rows, modules, lines: out, warnings: [...new Set(warnings)] };
}

/** Remove coincident straight guides; earlier roles win (margins before columns...). */
export function dedupeLines(lines: readonly GuideLine[], tolerance = 0.01): GuideLine[] {
  const out: GuideLine[] = [];
  for (const l of lines) {
    const dup = out.some(
      (o) =>
        (near(o.x1, l.x1, tolerance) && near(o.y1, l.y1, tolerance) && near(o.x2, l.x2, tolerance) && near(o.y2, l.y2, tolerance)) ||
        (near(o.x1, l.x2, tolerance) && near(o.y1, l.y2, tolerance) && near(o.x2, l.x1, tolerance) && near(o.y2, l.y1, tolerance)) ||
        coversSameAxisLine(o, l, tolerance),
    );
    if (!dup) out.push(l);
  }
  return out;
}

/** Two vertical (or horizontal) guides at the same position where one fully spans the other. */
function coversSameAxisLine(a: GuideLine, b: GuideLine, tol: number): boolean {
  const aV = near(a.x1, a.x2, tol);
  const bV = near(b.x1, b.x2, tol);
  if (aV && bV && near(a.x1, b.x1, tol)) {
    const [a0, a1] = [Math.min(a.y1, a.y2), Math.max(a.y1, a.y2)];
    const [b0, b1] = [Math.min(b.y1, b.y2), Math.max(b.y1, b.y2)];
    return a0 <= b0 + tol && a1 >= b1 - tol;
  }
  const aH = near(a.y1, a.y2, tol);
  const bH = near(b.y1, b.y2, tol);
  if (aH && bH && near(a.y1, b.y1, tol)) {
    const [a0, a1] = [Math.min(a.x1, a.x2), Math.max(a.x1, a.x2)];
    const [b0, b1] = [Math.min(b.x1, b.x2), Math.max(b.x1, b.x2)];
    return a0 <= b0 + tol && a1 >= b1 - tol;
  }
  return false;
}

function snapLine(l: GuideLine): GuideLine {
  const vertical = l.x1 === l.x2;
  const horizontal = l.y1 === l.y2;
  if (vertical) return { ...l, x1: Math.round(l.x1), x2: Math.round(l.x2) };
  if (horizontal) return { ...l, y1: Math.round(l.y1), y2: Math.round(l.y2) };
  return l;
}

function rayToRectEdge(cx: number, cy: number, dx: number, dy: number, r: Rect): { x: number; y: number } {
  const ts: number[] = [];
  if (Math.abs(dx) > 1e-9) {
    ts.push((r.x - cx) / dx, (r.x + r.w - cx) / dx);
  }
  if (Math.abs(dy) > 1e-9) {
    ts.push((r.y - cy) / dy, (r.y + r.h - cy) / dy);
  }
  const t = Math.min(...ts.filter((v) => v > 1e-9));
  return { x: cx + dx * t, y: cy + dy * t };
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
