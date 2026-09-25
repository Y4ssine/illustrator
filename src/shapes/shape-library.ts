/**
 * Ready-made parametric shapes. Every generator returns clean Bézier paths
 * (few anchors, true arcs) fitted to a box, so the result is a normal,
 * editable Illustrator path — not an expanded effect.
 */

import { arcPoints, convexHull, ellipsePath, mergeDuplicates, pt, polygonPath, roundedRectPath, smooth, smoothClosed, type PathPt, type PathShape, type SubPath } from '../geometry/path';
import type { Point, Rect } from '../geometry/rect';
import { createRng } from '../utils/random';

export type ShapeCategory = 'Basic' | 'Frames & arches' | 'Badges & stars' | 'Labels & callouts' | 'Decor & dividers' | 'Organic';

export interface ShapeParam {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  unit?: '%' | '°' | '';
}

export interface ShapePart {
  shape: PathShape;
  /** Lightness shift for folds/back pieces (e.g. -0.12 = darker). */
  shade: number;
  name: string;
}

export interface ShapeDef {
  id: string;
  name: string;
  category: ShapeCategory;
  /** Width / height of the default box. */
  aspect: number;
  params: ShapeParam[];
  /** One compound path (holes allowed). */
  build(box: Rect, p: Record<string, number>): PathShape;
  /** Optional: separate pieces drawn back to front (e.g. ribbon tails behind the band). */
  parts?(box: Rect, p: Record<string, number>): ShapePart[];
}

const P = (key: string, label: string, min: number, max: number, value: number, unit: ShapeParam['unit'] = '', step = 1): ShapeParam => ({ key, label, min, max, value, unit, step });

function starPoints(cx: number, cy: number, R: number, r: number, n: number, rotationDeg: number, ry = 1): Point[] {
  const out: Point[] = [];
  const rot = (rotationDeg * Math.PI) / 180 - Math.PI / 2;
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = rot + (i * Math.PI) / n;
    out.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) * ry });
  }
  return out;
}

function regularPolygon(cx: number, cy: number, R: number, n: number, rotationDeg: number): Point[] {
  const out: Point[] = [];
  const rot = (rotationDeg * Math.PI) / 180 - Math.PI / 2;
  for (let i = 0; i < n; i++) out.push({ x: cx + R * Math.cos(rot + (i * 2 * Math.PI) / n), y: cy + R * Math.sin(rot + (i * 2 * Math.PI) / n) });
  return out;
}

/** Round arch: rectangle whose top is a semi-ellipse. */
function archPath(b: Rect, springPct: number): SubPath {
  const rx = b.w / 2;
  const ry = Math.min(b.h, (b.w / 2) * (springPct / 100));
  const cy = b.y + ry;
  const pts: PathPt[] = [pt(b.x, b.y + b.h), ...arcPoints(b.x + rx, cy, rx, ry, Math.PI, 2 * Math.PI), pt(b.x + b.w, b.y + b.h)];
  return mergeDuplicates({ closed: true, pts });
}

/** Pointed (two-centred) arch — the classic Islamic/Gothic arch. */
function pointedArchPath(b: Rect, sharpness: number): SubPath {
  // Each side is a circular arc of radius R centred on the springline, on the
  // opposite side of the centre line. R = w/2 gives a round arch; R = w an
  // equilateral pointed arch.
  const half = b.w / 2;
  const R = b.w * (0.5 + (sharpness / 100) * 0.5);
  const archH = Math.sqrt(Math.max(0, R * R - (R - half) ** 2));
  const springY = b.y + Math.min(b.h, archH);
  const cL = { x: b.x + R, y: springY };
  const cR = { x: b.x + b.w - R, y: springY };
  const aApexL = Math.atan2(-archH, half - R) + 2 * Math.PI; // in (π, 3π/2]
  const aApexR = Math.atan2(-archH, R - half); // in [-π/2, 0)
  const pts: PathPt[] = [
    pt(b.x, b.y + b.h),
    ...arcPoints(cL.x, cL.y, R, R, Math.PI, aApexL),
    ...arcPoints(cR.x, cR.y, R, R, aApexR, 0),
    pt(b.x + b.w, b.y + b.h),
  ];
  return mergeDuplicates({ closed: true, pts });
}

/** Ogee / onion arch using four Bézier curves. */
function ogeePath(b: Rect, bulge: number): SubPath {
  const cx = b.x + b.w / 2;
  const top = b.y;
  const spring = b.y + b.h * 0.42;
  const k = bulge / 100;
  const L = b.x;
  const R = b.x + b.w;
  const mid = top + (spring - top) * 0.55;
  const wx = b.w * 0.5 * (0.35 + 0.4 * k);
  return mergeDuplicates({
    closed: true,
    pts: [
      pt(L, b.y + b.h),
      smooth(L, spring, L, spring, L, spring - (spring - top) * 0.35),
      smooth(cx - wx, mid, cx - wx - b.w * 0.08, mid + (spring - top) * 0.18, cx - wx + b.w * 0.06, mid - (spring - top) * 0.2),
      smooth(cx, top, cx - b.w * 0.02, top + (spring - top) * 0.2, cx + b.w * 0.02, top + (spring - top) * 0.2),
      smooth(cx + wx, mid, cx + wx - b.w * 0.06, mid - (spring - top) * 0.2, cx + wx + b.w * 0.08, mid + (spring - top) * 0.18),
      smooth(R, spring, R, spring - (spring - top) * 0.35, R, spring),
      pt(R, b.y + b.h),
    ],
  });
}

function scallopedCircle(cx: number, cy: number, R: number, n: number, depthPct: number): SubPath {
  const bumpR = R * Math.sin(Math.PI / n) * (0.6 + depthPct / 100);
  const baseR = R - bumpR * 0.6;
  const pts: PathPt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n - Math.PI / 2;
    const bx = cx + baseR * Math.cos(a);
    const by = cy + baseR * Math.sin(a);
    pts.push(...arcPoints(bx, by, bumpR, bumpR, a - Math.PI / 2, a + Math.PI / 2, true));
  }
  return mergeDuplicates({ closed: true, pts });
}

function speechBubble(b: Rect, radius: number, tailPos: number, tailW: number, tailH: number): SubPath {
  const L = b.x;
  const T = b.y;
  const R = b.x + b.w;
  const B = b.y + b.h - tailH;
  const r = Math.max(0.01, Math.min(radius, b.w / 2, (B - T) / 2));
  const tx = Math.min(R - r - tailW / 2, Math.max(L + r + tailW / 2, L + b.w * (tailPos / 100)));
  // Clockwise: top-left, top-right, bottom-right, tail (bottom edge runs right → left), bottom-left.
  const pts: PathPt[] = [
    ...arcPoints(L + r, T + r, r, r, Math.PI, 1.5 * Math.PI),
    ...arcPoints(R - r, T + r, r, r, -Math.PI / 2, 0),
    ...arcPoints(R - r, B - r, r, r, 0, Math.PI / 2),
    pt(tx + tailW / 2, B),
    pt(tx - tailW * 0.15, B + tailH),
    pt(tx - tailW / 2, B),
    ...arcPoints(L + r, B - r, r, r, Math.PI / 2, Math.PI),
  ];
  return mergeDuplicates({ closed: true, pts });
}

function ticketPath(b: Rect, notchPct: number, radius: number): SubPath {
  const n = Math.min(b.h, b.w) * (notchPct / 100);
  const cy = b.y + b.h / 2;
  const r = Math.min(radius, b.h / 4, b.w / 4);
  const L = b.x;
  const R = b.x + b.w;
  const T = b.y;
  const B = b.y + b.h;
  const pts: PathPt[] = [
    ...arcPoints(L + r, T + r, r, r, Math.PI, 1.5 * Math.PI),
    ...arcPoints(R - r, T + r, r, r, -Math.PI / 2, 0),
    // right notch (concave): arc centred on the right edge, going inward
    ...arcPoints(R, cy, n, n, -Math.PI / 2, -1.5 * Math.PI),
    ...arcPoints(R - r, B - r, r, r, 0, Math.PI / 2),
    ...arcPoints(L + r, B - r, r, r, Math.PI / 2, Math.PI),
    ...arcPoints(L, cy, n, n, Math.PI / 2, -Math.PI / 2),
  ];
  return mergeDuplicates({ closed: true, pts });
}

function ribbonShape(b: Rect, tailPct: number, notchPct: number): PathShape {
  const tail = b.w * (tailPct / 100);
  const bandH = b.h * 0.7;
  const drop = b.h - bandH;
  const notch = tail * (notchPct / 100);
  const main = polygonPath([
    { x: b.x + tail * 0.6, y: b.y },
    { x: b.x + b.w - tail * 0.6, y: b.y },
    { x: b.x + b.w - tail * 0.6, y: b.y + bandH },
    { x: b.x + tail * 0.6, y: b.y + bandH },
  ]);
  const leftTail = polygonPath([
    { x: b.x, y: b.y + drop },
    { x: b.x + tail, y: b.y + drop },
    { x: b.x + tail, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
    { x: b.x + notch, y: b.y + drop + (b.h - drop) / 2 },
  ]);
  const rightTail = polygonPath([
    { x: b.x + b.w - tail, y: b.y + drop },
    { x: b.x + b.w, y: b.y + drop },
    { x: b.x + b.w - notch, y: b.y + drop + (b.h - drop) / 2 },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x + b.w - tail, y: b.y + b.h },
  ]);
  return [leftTail, rightTail, main];
}

function waveBand(b: Rect, waves: number, amplitudePct: number): SubPath {
  const n = Math.max(1, Math.round(waves));
  const amp = (b.h / 2) * (amplitudePct / 100);
  const top = b.y + amp;
  const seg = b.w / (n * 2);
  const pts: PathPt[] = [];
  for (let i = 0; i <= n * 2; i++) {
    const x = b.x + i * seg;
    const y = top + (i % 2 === 0 ? -amp : amp);
    const hx = seg * 0.5;
    pts.push(smooth(x, y, x - hx, y, x + hx, y));
  }
  pts.push(pt(b.x + b.w, b.y + b.h), pt(b.x, b.y + b.h));
  return { closed: true, pts };
}

function blob(b: Rect, points: number, wobblePct: number, seed: number): SubPath {
  const rng = createRng(seed);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const n = Math.max(4, Math.round(points));
  const pts: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * 2 * Math.PI) / n - Math.PI / 2;
    const f = 1 - (wobblePct / 100) * rng.next() * 0.6;
    pts.push({ x: cx + (b.w / 2) * f * Math.cos(a), y: cy + (b.h / 2) * f * Math.sin(a) });
  }
  return smoothClosed(pts, 1.15);
}

function squircle(b: Rect, smoothPct: number): SubPath {
  const k = 0.5523 + (0.909 - 0.5523) * (smoothPct / 100);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const hx = b.w / 2;
  const hy = b.h / 2;
  return {
    closed: true,
    pts: [
      smooth(cx, cy - hy, cx - hx * k, cy - hy, cx + hx * k, cy - hy),
      smooth(cx + hx, cy, cx + hx, cy - hy * k, cx + hx, cy + hy * k),
      smooth(cx, cy + hy, cx + hx * k, cy + hy, cx - hx * k, cy + hy),
      smooth(cx - hx, cy, cx - hx, cy + hy * k, cx - hx, cy - hy * k),
    ],
  };
}

function reverse(sp: SubPath): SubPath {
  const pts = [...sp.pts].reverse().map((p) => (p.length === 6 ? smooth(p[0], p[1], p[4], p[5], p[2], p[3]) : p));
  return { closed: sp.closed, pts };
}

function diamondBand(b: Rect, count: number, gapPct: number): PathShape {
  const n = Math.max(1, Math.round(count));
  const cell = b.w / n;
  const gap = cell * (gapPct / 100);
  const out: PathShape = [];
  for (let i = 0; i < n; i++) {
    const x0 = b.x + i * cell + gap / 2;
    const w = cell - gap;
    out.push(
      polygonPath([
        { x: x0 + w / 2, y: b.y },
        { x: x0 + w, y: b.y + b.h / 2 },
        { x: x0 + w / 2, y: b.y + b.h },
        { x: x0, y: b.y + b.h / 2 },
      ]),
    );
  }
  return out;
}

function crenellation(b: Rect, teeth: number, depthPct: number): SubPath {
  // Stepped triangular crenellation along the top (common in Najdi mud-brick facades).
  const n = Math.max(1, Math.round(teeth));
  const d = b.h * (depthPct / 100);
  const w = b.w / n;
  const pts: Point[] = [{ x: b.x, y: b.y + b.h }, { x: b.x, y: b.y + d }];
  for (let i = 0; i < n; i++) {
    const x0 = b.x + i * w;
    pts.push({ x: x0 + w * 0.2, y: b.y + d }, { x: x0 + w * 0.5, y: b.y }, { x: x0 + w * 0.8, y: b.y + d });
  }
  pts.push({ x: b.x + b.w, y: b.y + d }, { x: b.x + b.w, y: b.y + b.h });
  return mergeDuplicates(polygonPath(pts));
}

export const SHAPES: readonly ShapeDef[] = [
  { id: 'roundedRect', name: 'Rounded card', category: 'Basic', aspect: 4 / 3, params: [P('radius', 'Corner', 0, 50, 12, '%')], build: (b, p) => [roundedRectPath(b, (Math.min(b.w, b.h) * p['radius']!) / 100)] },
  { id: 'squircle', name: 'Squircle', category: 'Basic', aspect: 1, params: [P('smooth', 'Smoothing', 0, 100, 70, '%')], build: (b, p) => [squircle(b, p['smooth']!)] },
  { id: 'pill', name: 'Pill', category: 'Basic', aspect: 3, params: [], build: (b) => [roundedRectPath(b, Math.min(b.w, b.h) / 2)] },
  { id: 'ellipse', name: 'Circle / ellipse', category: 'Basic', aspect: 1, params: [], build: (b) => [ellipsePath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2)] },
  {
    id: 'ring',
    name: 'Ring',
    category: 'Basic',
    aspect: 1,
    params: [P('thickness', 'Thickness', 2, 49, 14, '%')],
    build: (b, p) => {
      const t = (Math.min(b.w, b.h) * p['thickness']!) / 100;
      return [ellipsePath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2), reverse(ellipsePath(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 - t, b.h / 2 - t))];
    },
  },
  { id: 'polygon', name: 'Polygon', category: 'Basic', aspect: 1, params: [P('sides', 'Sides', 3, 12, 6), P('rotation', 'Rotate', 0, 360, 0, '°')], build: (b, p) => [polygonPath(regularPolygon(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) / 2, p['sides']!, p['rotation']!))] },
  { id: 'diamond', name: 'Diamond', category: 'Basic', aspect: 1, params: [], build: (b) => [polygonPath([{ x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 }])] },

  { id: 'arch', name: 'Round arch', category: 'Frames & arches', aspect: 0.62, params: [P('spring', 'Arch height', 20, 100, 100, '%')], build: (b, p) => [archPath(b, p['spring']!)] },
  { id: 'pointedArch', name: 'Pointed arch', category: 'Frames & arches', aspect: 0.6, params: [P('sharpness', 'Sharpness', 0, 100, 55, '%')], build: (b, p) => [pointedArchPath(b, p['sharpness']!)] },
  { id: 'ogee', name: 'Ogee / onion arch', category: 'Frames & arches', aspect: 0.62, params: [P('bulge', 'Bulge', 0, 100, 60, '%')], build: (b, p) => [ogeePath(b, p['bulge']!)] },
  {
    id: 'archFrame',
    name: 'Arch frame',
    category: 'Frames & arches',
    aspect: 0.62,
    params: [P('border', 'Border', 1, 30, 6, '%'), P('spring', 'Arch height', 20, 100, 100, '%')],
    build: (b, p) => {
      const t = (Math.min(b.w, b.h) * p['border']!) / 100;
      return [archPath(b, p['spring']!), reverse(archPath({ x: b.x + t, y: b.y + t, w: b.w - 2 * t, h: b.h - 2 * t }, p['spring']!))];
    },
  },
  {
    id: 'frame',
    name: 'Frame',
    category: 'Frames & arches',
    aspect: 4 / 5,
    params: [P('border', 'Border', 1, 30, 5, '%'), P('radius', 'Corner', 0, 50, 6, '%')],
    build: (b, p) => {
      const t = (Math.min(b.w, b.h) * p['border']!) / 100;
      const r = (Math.min(b.w, b.h) * p['radius']!) / 100;
      return [roundedRectPath(b, r), reverse(roundedRectPath({ x: b.x + t, y: b.y + t, w: b.w - 2 * t, h: b.h - 2 * t }, Math.max(0, r - t)))];
    },
  },
  { id: 'crenellation', name: 'Crenellated facade', category: 'Frames & arches', aspect: 3, params: [P('teeth', 'Teeth', 2, 24, 8), P('depth', 'Depth', 5, 80, 35, '%')], build: (b, p) => [crenellation(b, p['teeth']!, p['depth']!)] },

  { id: 'star8', name: '8-point star', category: 'Badges & stars', aspect: 1, params: [P('rotation', 'Rotate', 0, 45, 0, '°')], build: (b, p) => [polygonPath(starPoints(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) / 2, (Math.min(b.w, b.h) / 2) * 0.7654, 8, p['rotation']!))] },
  { id: 'star', name: 'Star', category: 'Badges & stars', aspect: 1, params: [P('points', 'Points', 3, 24, 5), P('inner', 'Inner', 10, 95, 45, '%')], build: (b, p) => [polygonPath(starPoints(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) / 2, ((Math.min(b.w, b.h) / 2) * p['inner']!) / 100, p['points']!, 0))] },
  { id: 'burst', name: 'Sunburst badge', category: 'Badges & stars', aspect: 1, params: [P('points', 'Points', 12, 48, 24), P('inner', 'Depth', 70, 97, 88, '%')], build: (b, p) => [polygonPath(starPoints(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) / 2, ((Math.min(b.w, b.h) / 2) * p['inner']!) / 100, p['points']!, 0))] },
  { id: 'scallop', name: 'Scalloped badge', category: 'Badges & stars', aspect: 1, params: [P('bumps', 'Bumps', 8, 36, 16), P('depth', 'Depth', 0, 100, 30, '%')], build: (b, p) => [scallopedCircle(b.x + b.w / 2, b.y + b.h / 2, Math.min(b.w, b.h) / 2, p['bumps']!, p['depth']!)] },
  {
    id: 'sealRing',
    name: 'Seal (disc + ring)',
    category: 'Badges & stars',
    aspect: 1,
    params: [P('gap', 'Gap', 2, 20, 6, '%')],
    build: (b, p) => {
      const R = Math.min(b.w, b.h) / 2;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const g = (R * p['gap']!) / 100;
      return [ellipsePath(cx, cy, R, R), reverse(ellipsePath(cx, cy, R - g, R - g)), ellipsePath(cx, cy, R - 2 * g, R - 2 * g)];
    },
  },

  {
    id: 'ribbon',
    name: 'Ribbon banner',
    category: 'Labels & callouts',
    aspect: 4,
    params: [P('tail', 'Tail', 5, 30, 14, '%'), P('notch', 'Notch', 0, 90, 45, '%')],
    build: (b, p) => ribbonShape(b, p['tail']!, p['notch']!).slice(2),
    parts: (b, p) => {
      const [l, r, band] = ribbonShape(b, p['tail']!, p['notch']!) as [SubPath, SubPath, SubPath];
      return [
        { shape: [l], shade: -0.14, name: 'Tail left' },
        { shape: [r], shade: -0.14, name: 'Tail right' },
        { shape: [band], shade: 0, name: 'Band' },
      ];
    },
  },
  { id: 'tag', name: 'Label tag', category: 'Labels & callouts', aspect: 2.6, params: [P('point', 'Point', 5, 45, 22, '%')], build: (b, p) => [polygonPath([{ x: b.x + (b.w * p['point']!) / 100, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x + (b.w * p['point']!) / 100, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 }])] },
  { id: 'ticket', name: 'Ticket / coupon', category: 'Labels & callouts', aspect: 2.2, params: [P('notch', 'Notch', 4, 30, 12, '%'), P('radius', 'Corner', 0, 30, 8, '')], build: (b, p) => [ticketPath(b, p['notch']!, p['radius']!)] },
  { id: 'bubble', name: 'Speech bubble', category: 'Labels & callouts', aspect: 1.6, params: [P('radius', 'Corner', 0, 50, 18, ''), P('tailPos', 'Tail position', 10, 90, 30, '%')], build: (b, p) => [speechBubble(b, p['radius']!, p['tailPos']!, Math.min(b.w, b.h) * 0.18, b.h * 0.16)] },
  { id: 'arrow', name: 'Block arrow', category: 'Labels & callouts', aspect: 2.4, params: [P('head', 'Head', 15, 60, 35, '%'), P('shaft', 'Shaft', 20, 90, 45, '%')], build: (b, p) => {
      const hw = (b.w * p['head']!) / 100;
      const sh = (b.h * p['shaft']!) / 100;
      const cy = b.y + b.h / 2;
      return [polygonPath([{ x: b.x, y: cy - sh / 2 }, { x: b.x + b.w - hw, y: cy - sh / 2 }, { x: b.x + b.w - hw, y: b.y }, { x: b.x + b.w, y: cy }, { x: b.x + b.w - hw, y: b.y + b.h }, { x: b.x + b.w - hw, y: cy + sh / 2 }, { x: b.x, y: cy + sh / 2 }])];
    } },
  { id: 'chevron', name: 'Chevron step', category: 'Labels & callouts', aspect: 2.8, params: [P('point', 'Point', 5, 45, 18, '%')], build: (b, p) => {
      const d = (b.w * p['point']!) / 100;
      return [polygonPath([{ x: b.x, y: b.y }, { x: b.x + b.w - d, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 }, { x: b.x + b.w - d, y: b.y + b.h }, { x: b.x, y: b.y + b.h }, { x: b.x + d, y: b.y + b.h / 2 }])];
    } },

  { id: 'wave', name: 'Wave divider', category: 'Decor & dividers', aspect: 6, params: [P('waves', 'Waves', 1, 12, 3), P('amplitude', 'Amplitude', 5, 100, 40, '%')], build: (b, p) => [waveBand(b, p['waves']!, p['amplitude']!)] },
  { id: 'diamondBand', name: 'Diamond band (Sadu-inspired)', category: 'Decor & dividers', aspect: 8, params: [P('count', 'Count', 2, 40, 10), P('gap', 'Gap', 0, 60, 18, '%')], build: (b, p) => diamondBand(b, p['count']!, p['gap']!) },
  { id: 'rays', name: 'Light rays / sunburst', category: 'Decor & dividers', aspect: 1, params: [P('rays', 'Rays', 6, 48, 18), P('width', 'Ray width', 10, 90, 45, '%')], build: (b, p) => {
      const n = Math.round(p['rays']!);
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const R = Math.hypot(b.w, b.h) / 2;
      const half = ((Math.PI / n) * p['width']!) / 100;
      const out: PathShape = [];
      for (let i = 0; i < n; i++) {
        const a = (i * 2 * Math.PI) / n - Math.PI / 2;
        out.push(polygonPath([{ x: cx, y: cy }, { x: cx + R * Math.cos(a - half), y: cy + R * Math.sin(a - half) }, { x: cx + R * Math.cos(a + half), y: cy + R * Math.sin(a + half) }]));
      }
      return out;
    } },

  { id: 'blob', name: 'Organic blob', category: 'Organic', aspect: 1.2, params: [P('points', 'Lobes', 4, 12, 7), P('wobble', 'Wobble', 0, 100, 45, '%'), P('seed', 'Seed', 1, 999, 7)], build: (b, p) => [blob(b, p['points']!, p['wobble']!, p['seed']!)] },
  { id: 'hull', name: 'Pebble', category: 'Organic', aspect: 1.3, params: [P('seed', 'Seed', 1, 999, 3)], build: (b, p) => {
      const rng = createRng(p['seed']!);
      const pts = Array.from({ length: 9 }, () => ({ x: b.x + rng.range(0, b.w), y: b.y + rng.range(0, b.h) }));
      const hull = convexHull([...pts, { x: b.x + b.w / 2, y: b.y }, { x: b.x + b.w, y: b.y + b.h / 2 }, { x: b.x + b.w / 2, y: b.y + b.h }, { x: b.x, y: b.y + b.h / 2 }]);
      return [smoothClosed(hull, 1)];
    } },
];

export function findShape(id: string): ShapeDef | undefined {
  return SHAPES.find((s) => s.id === id);
}

export function defaultParams(def: ShapeDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.value]));
}

export const SHAPE_CATEGORIES: readonly ShapeCategory[] = ['Basic', 'Frames & arches', 'Badges & stars', 'Labels & callouts', 'Decor & dividers', 'Organic'];

/** SVG path data for panel thumbnails. */
export function toSvgPath(shape: PathShape): string {
  return shape
    .map((sp) => {
      if (sp.pts.length === 0) return '';
      const f = (n: number): string => String(Math.round(n * 100) / 100);
      let d = `M${f(sp.pts[0]![0])} ${f(sp.pts[0]![1])}`;
      const seg = (a: PathPt, b: PathPt): string => {
        const ox = a.length === 6 ? a[4] : a[0];
        const oy = a.length === 6 ? a[5] : a[1];
        const ix = b.length === 6 ? b[2] : b[0];
        const iy = b.length === 6 ? b[3] : b[1];
        const straight = ox === a[0] && oy === a[1] && ix === b[0] && iy === b[1];
        return straight ? `L${f(b[0])} ${f(b[1])}` : `C${f(ox)} ${f(oy)} ${f(ix)} ${f(iy)} ${f(b[0])} ${f(b[1])}`;
      };
      for (let i = 1; i < sp.pts.length; i++) d += seg(sp.pts[i - 1]!, sp.pts[i]!);
      if (sp.closed) d += seg(sp.pts[sp.pts.length - 1]!, sp.pts[0]!) + 'Z';
      return d;
    })
    .join('');
}
