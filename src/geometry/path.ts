/**
 * Vector path model (design space, Y down) with cubic Bézier handles.
 *
 * A point is [x, y] (corner) or [x, y, inX, inY, outX, outY] with absolute
 * handle positions. `in` is the handle of the segment arriving at the point
 * (Illustrator's leftDirection), `out` the handle of the segment leaving it
 * (rightDirection). Several subpaths form a compound path (holes use the
 * even-odd / non-zero behaviour of Illustrator compound paths).
 */

import type { Point, Rect } from './rect';

export type PathPt = [number, number] | [number, number, number, number, number, number];

export interface SubPath {
  closed: boolean;
  pts: PathPt[];
}

export type PathShape = SubPath[];

/** Circle-arc handle factor for a quarter circle. */
export const KAPPA = 0.5522847498;

const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export function pt(x: number, y: number): PathPt {
  return [r3(x), r3(y)];
}

export function smooth(x: number, y: number, inX: number, inY: number, outX: number, outY: number): PathPt {
  return [r3(x), r3(y), r3(inX), r3(inY), r3(outX), r3(outY)];
}

export function polygonPath(points: readonly Point[], closed = true): SubPath {
  return { closed, pts: points.map((p) => pt(p.x, p.y)) };
}

/**
 * Append an elliptical arc (cx, cy, rx, ry) from angle a0 to a1 (radians,
 * screen space: 0 = +x, positive = clockwise because Y points down) as
 * Bézier points. The first point is included only when `includeStart`.
 * Handles of the previous last point are updated so the join is smooth.
 */
export function arcPoints(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, includeStart = true): PathPt[] {
  const total = a1 - a0;
  const segs = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2) - 1e-9));
  const step = total / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const P = (a: number): Point => ({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  const D = (a: number): Point => ({ x: -rx * Math.sin(a), y: ry * Math.cos(a) }); // derivative direction
  const out: Array<{ p: Point; in: Point; out: Point }> = [];
  for (let i = 0; i <= segs; i++) {
    const a = a0 + step * i;
    const p = P(a);
    const d = D(a);
    out.push({ p, in: { x: p.x - d.x * k, y: p.y - d.y * k }, out: { x: p.x + d.x * k, y: p.y + d.y * k } });
  }
  const pts: PathPt[] = out.map((o, i) => {
    const inH = i === 0 ? o.p : o.in;
    const outH = i === out.length - 1 ? o.p : o.out;
    return smooth(o.p.x, o.p.y, inH.x, inH.y, outH.x, outH.y);
  });
  return includeStart ? pts : pts.slice(1);
}

/** Replace a corner point's in-handle (used when an arc starts at an existing point). */
export function withOut(p: PathPt, outX: number, outY: number): PathPt {
  const inX = p.length === 6 ? p[2] : p[0];
  const inY = p.length === 6 ? p[3] : p[1];
  return smooth(p[0], p[1], inX, inY, outX, outY);
}

/** Merge consecutive duplicate points, combining in/out handles. */
export function mergeDuplicates(sp: SubPath): SubPath {
  const out: PathPt[] = [];
  for (const p of sp.pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-3 && Math.abs(last[1] - p[1]) < 1e-3) {
      const inX = last.length === 6 ? last[2] : last[0];
      const inY = last.length === 6 ? last[3] : last[1];
      const outX = p.length === 6 ? p[4] : p[0];
      const outY = p.length === 6 ? p[5] : p[1];
      out[out.length - 1] = smooth(p[0], p[1], inX, inY, outX, outY);
    } else out.push(p);
  }
  if (sp.closed && out.length > 1) {
    const f = out[0]!;
    const l = out[out.length - 1]!;
    if (Math.abs(f[0] - l[0]) < 1e-3 && Math.abs(f[1] - l[1]) < 1e-3) {
      const inX = l.length === 6 ? l[2] : l[0];
      const inY = l.length === 6 ? l[3] : l[1];
      const outX = f.length === 6 ? f[4] : f[0];
      const outY = f.length === 6 ? f[5] : f[1];
      out[0] = smooth(f[0], f[1], inX, inY, outX, outY);
      out.pop();
    }
  }
  return { closed: sp.closed, pts: out };
}

export function ellipsePath(cx: number, cy: number, rx: number, ry: number): SubPath {
  return mergeDuplicates({ closed: true, pts: arcPoints(cx, cy, rx, ry, -Math.PI / 2, (3 * Math.PI) / 2) });
}

export function roundedRectPath(r: Rect, radius: number | [number, number, number, number]): SubPath {
  const [tl, tr, br, bl] = (Array.isArray(radius) ? radius : [radius, radius, radius, radius]).map((v) => Math.max(0, Math.min(v, r.w / 2, r.h / 2))) as [number, number, number, number];
  const L = r.x;
  const T = r.y;
  const R = r.x + r.w;
  const B = r.y + r.h;
  const pts: PathPt[] = [];
  const corner = (cx: number, cy: number, rad: number, a0: number): void => {
    pts.push(...arcPoints(cx, cy, rad, rad, a0, a0 + Math.PI / 2));
  };
  // top-left arc from 180° to 270°, etc. (clockwise on screen)
  if (tl > 0) corner(L + tl, T + tl, tl, Math.PI);
  else pts.push(pt(L, T));
  if (tr > 0) corner(R - tr, T + tr, tr, -Math.PI / 2);
  else pts.push(pt(R, T));
  if (br > 0) corner(R - br, B - br, br, 0);
  else pts.push(pt(R, B));
  if (bl > 0) corner(L + bl, B - bl, bl, Math.PI / 2);
  else pts.push(pt(L, B));
  return mergeDuplicates({ closed: true, pts });
}

export function transformShape(shape: PathShape, f: (p: Point) => Point): PathShape {
  return shape.map((sp) => ({
    closed: sp.closed,
    pts: sp.pts.map((p) => {
      const a = f({ x: p[0], y: p[1] });
      if (p.length === 2) return pt(a.x, a.y);
      const i = f({ x: p[2], y: p[3] });
      const o = f({ x: p[4], y: p[5] });
      return smooth(a.x, a.y, i.x, i.y, o.x, o.y);
    }),
  }));
}

export function rotatePoint(p: Point, c: Point, rad: number): Point {
  const s = Math.sin(rad);
  const k = Math.cos(rad);
  return { x: c.x + (p.x - c.x) * k - (p.y - c.y) * s, y: c.y + (p.x - c.x) * s + (p.y - c.y) * k };
}

/** Bounds of all anchors and handles (a safe superset of the curve bounds). */
export function shapeBounds(shape: PathShape): Rect {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const sp of shape) {
    for (const p of sp.pts) {
      for (let i = 0; i < p.length; i += 2) {
        l = Math.min(l, p[i]!);
        r = Math.max(r, p[i]!);
        t = Math.min(t, p[i + 1]!);
        b = Math.max(b, p[i + 1]!);
      }
    }
  }
  return { x: l, y: t, w: r - l, h: b - t };
}

/** Convex hull (monotone chain), counter-clockwise in screen space. */
export function convexHull(points: readonly Point[]): Point[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Point[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Smooth closed curve through points (Catmull-Rom → Bézier). */
export function smoothClosed(points: readonly Point[], tension = 1): SubPath {
  const n = points.length;
  const pts: PathPt[] = points.map((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const dx = ((next.x - prev.x) / 6) * tension;
    const dy = ((next.y - prev.y) / 6) * tension;
    return smooth(p.x, p.y, p.x - dx, p.y - dy, p.x + dx, p.y + dy);
  });
  return { closed: true, pts };
}

/** Number of anchor points (budget checks: "avoid hundreds of anchors"). */
export function anchorCount(shape: PathShape): number {
  return shape.reduce((n, sp) => n + sp.pts.length, 0);
}
