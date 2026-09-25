/**
 * Core geometry model.
 *
 * All core engines work in "design space": points (1 pt = 1 px in RGB/web
 * documents), origin at the document origin, **Y grows downward** — the way
 * designers read Illustrator's rulers since CS5.
 *
 * Illustrator's scripting DOM still reports a legacy **Y-up** space
 * (`geometricBounds` = [left, top, right, bottom] with top > bottom). The flip
 * happens exactly once, inside the ExtendScript host adapter
 * (src/illustrator/jsx/01-util.jsx), so nothing in core ever sees Y-up values.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type Axis = 'x' | 'y';

export const EPSILON = 1e-6;

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function right(r: Rect): number {
  return r.x + r.w;
}

export function bottom(r: Rect): number {
  return r.y + r.h;
}

export function center(r: Rect): Point {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function isValidRect(r: Rect): boolean {
  return (
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.w) &&
    Number.isFinite(r.h) &&
    r.w >= 0 &&
    r.h >= 0
  );
}

/** Smallest rect containing every input rect. Returns null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const it of rects) {
    l = Math.min(l, it.x);
    t = Math.min(t, it.y);
    r = Math.max(r, it.x + it.w);
    b = Math.max(b, it.y + it.h);
  }
  return { x: l, y: t, w: r - l, h: b - t };
}

export function intersectRects(a: Rect, b: Rect): Rect | null {
  const l = Math.max(a.x, b.x);
  const t = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.w, b.x + b.w);
  const btm = Math.min(a.y + a.h, b.y + b.h);
  if (r < l - EPSILON || btm < t - EPSILON) return null;
  return { x: l, y: t, w: Math.max(0, r - l), h: Math.max(0, btm - t) };
}

export function insetRect(r: Rect, m: Margins): Rect {
  return {
    x: r.x + m.left,
    y: r.y + m.top,
    w: r.w - m.left - m.right,
    h: r.h - m.top - m.bottom,
  };
}

export function outsetRect(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, w: r.w + amount * 2, h: r.h + amount * 2 };
}

export function translateRect(r: Rect, dx: number, dy: number): Rect {
  return { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
}

export function uniformMargins(v: number): Margins {
  return { top: v, right: v, bottom: v, left: v };
}

export function containsRect(outer: Rect, inner: Rect, tolerance = EPSILON): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.w <= outer.x + outer.w + tolerance &&
    inner.y + inner.h <= outer.y + outer.h + tolerance
  );
}

export function rectsEqual(a: Rect, b: Rect, tolerance = 0.01): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.w - b.w) <= tolerance &&
    Math.abs(a.h - b.h) <= tolerance
  );
}

/** Start coordinate of a rect along an axis. */
export function start(r: Rect, axis: Axis): number {
  return axis === 'x' ? r.x : r.y;
}

/** Size of a rect along an axis. */
export function extent(r: Rect, axis: Axis): number {
  return axis === 'x' ? r.w : r.h;
}

export function end(r: Rect, axis: Axis): number {
  return start(r, axis) + extent(r, axis);
}

/**
 * Edge-to-edge distances between two rects.
 * `gapX`/`gapY` are negative when the rects overlap on that axis.
 */
export function pairDistance(a: Rect, b: Rect): {
  gapX: number;
  gapY: number;
  edge: number;
  centerDX: number;
  centerDY: number;
  center: number;
} {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const ca = center(a);
  const cb = center(b);
  const centerDX = cb.x - ca.x;
  const centerDY = cb.y - ca.y;
  // Shortest distance between the two boxes (0 when they touch or overlap).
  const edge = Math.hypot(Math.max(0, gapX), Math.max(0, gapY));
  return { gapX, gapY, edge, centerDX, centerDY, center: Math.hypot(centerDX, centerDY) };
}

/** Round to a fixed number of decimals, avoiding "-0". */
export function roundTo(v: number, decimals = 3): number {
  const f = 10 ** decimals;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

export function roundRect(r: Rect, decimals = 3): Rect {
  return { x: roundTo(r.x, decimals), y: roundTo(r.y, decimals), w: roundTo(r.w, decimals), h: roundTo(r.h, decimals) };
}

/**
 * Convert Illustrator DOM bounds ([left, top, right, bottom], Y-up) to a
 * design-space rect. Kept here (and mirrored in the ExtendScript adapter) so
 * the conversion is unit-tested.
 */
export function fromIllustratorBounds(b: readonly [number, number, number, number]): Rect {
  const [l, t, r, btm] = b;
  // `0 - t` rather than `-t` so a top of 0 does not become -0.
  return { x: l, y: 0 - t, w: r - l, h: t - btm };
}

export function toIllustratorBounds(r: Rect): [number, number, number, number] {
  return [r.x, 0 - r.y, r.x + r.w, 0 - (r.y + r.h)];
}
