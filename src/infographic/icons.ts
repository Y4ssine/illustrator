/**
 * Small built-in pictogram set for infographics. Each glyph is a clean,
 * filled compound path fitted to a square box (holes by even-odd), so it is
 * ordinary editable vector art and recolours with a single fill.
 */

import { arcPoints, ellipsePath, mergeDuplicates, polygonPath, pt, roundedRectPath, smoothClosed, type PathShape, type SubPath } from '../geometry/path';
import type { Point, Rect } from '../geometry/rect';

export type IconId =
  | 'person'
  | 'people'
  | 'check'
  | 'heart'
  | 'pin'
  | 'clock'
  | 'calendar'
  | 'chart'
  | 'star'
  | 'bolt'
  | 'drop'
  | 'home'
  | 'target'
  | 'coin'
  | 'crescent'
  | 'dome';

export const ICONS: ReadonlyArray<{ id: IconId; name: string; keywords: string }> = [
  { id: 'person', name: 'Person', keywords: 'user people visitor pilgrim شخص' },
  { id: 'people', name: 'People', keywords: 'group team community crowd ناس' },
  { id: 'check', name: 'Check', keywords: 'done yes ok completed صح' },
  { id: 'heart', name: 'Heart', keywords: 'health love care قلب صحة' },
  { id: 'pin', name: 'Location', keywords: 'map place city موقع' },
  { id: 'clock', name: 'Time', keywords: 'hours duration وقت ساعة' },
  { id: 'calendar', name: 'Date', keywords: 'day event تاريخ' },
  { id: 'chart', name: 'Growth', keywords: 'stats increase نمو' },
  { id: 'star', name: 'Star', keywords: 'rating quality نجمة' },
  { id: 'bolt', name: 'Energy', keywords: 'power fast طاقة' },
  { id: 'drop', name: 'Water', keywords: 'blood liquid ماء' },
  { id: 'home', name: 'Home', keywords: 'house housing منزل' },
  { id: 'target', name: 'Goal', keywords: 'aim objective هدف' },
  { id: 'coin', name: 'Money', keywords: 'budget cost riyal مال' },
  { id: 'crescent', name: 'Crescent', keywords: 'moon ramadan eid هلال' },
  { id: 'dome', name: 'Dome', keywords: 'mosque heritage قبة' },
];

/** Glyph fitted to a square of side `s` centred in `box`. */
export function iconShape(id: IconId, box: Rect): PathShape {
  const s = Math.min(box.w, box.h);
  const ox = box.x + (box.w - s) / 2;
  const oy = box.y + (box.h - s) / 2;
  const P = (u: number, v: number): Point => ({ x: ox + u * s, y: oy + v * s });
  const poly = (pts: Array<[number, number]>): SubPath => polygonPath(pts.map(([u, v]) => P(u, v)));
  const circle = (u: number, v: number, r: number): SubPath => ellipsePath(ox + u * s, oy + v * s, r * s, r * s);
  const rrect = (u: number, v: number, w: number, h: number, r: number | [number, number, number, number]): SubPath =>
    roundedRectPath({ x: ox + u * s, y: oy + v * s, w: w * s, h: h * s }, Array.isArray(r) ? (r.map((x) => x * s) as [number, number, number, number]) : r * s);
  switch (id) {
    case 'person':
      return [circle(0.5, 0.22, 0.16), rrect(0.2, 0.44, 0.6, 0.5, [0.26, 0.26, 0.06, 0.06])];
    case 'people':
      return [
        circle(0.5, 0.24, 0.13),
        rrect(0.3, 0.42, 0.4, 0.46, [0.18, 0.18, 0.05, 0.05]),
        circle(0.2, 0.34, 0.1),
        rrect(0.04, 0.49, 0.26, 0.37, [0.12, 0.12, 0.04, 0.04]),
        circle(0.8, 0.34, 0.1),
        rrect(0.7, 0.49, 0.26, 0.37, [0.12, 0.12, 0.04, 0.04]),
      ];
    case 'check':
      return [poly([[0.08, 0.54], [0.2, 0.42], [0.39, 0.61], [0.8, 0.2], [0.92, 0.32], [0.39, 0.85]])];
    case 'heart': {
      const pts: Point[] = [];
      for (let i = 0; i < 18; i++) {
        const t = (i / 18) * Math.PI * 2;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
        pts.push(P(0.5 + x / 36, 0.47 - y / 34));
      }
      return [smoothClosed(pts, 0.95)];
    }
    case 'pin': {
      const cx = ox + 0.5 * s;
      const cy = oy + 0.38 * s;
      const r = 0.3 * s;
      const tip = { x: cx, y: oy + 0.96 * s };
      const d = tip.y - cy;
      const a = Math.acos(r / d);
      const arc = arcPoints(cx, cy, r, r, Math.PI / 2 + a, Math.PI / 2 - a + Math.PI * 2);
      return [{ closed: true, pts: [...arc, pt(tip.x, tip.y)] }, circle(0.5, 0.38, 0.12)];
    }
    case 'clock':
      return [circle(0.5, 0.5, 0.44), circle(0.5, 0.5, 0.35), poly([[0.46, 0.2], [0.54, 0.2], [0.54, 0.46], [0.72, 0.58], [0.68, 0.65], [0.46, 0.53]])];
    case 'calendar':
      return [
        rrect(0.1, 0.16, 0.8, 0.76, 0.1),
        rrect(0.18, 0.4, 0.64, 0.44, 0.03),
        rrect(0.26, 0.48, 0.12, 0.1, 0.02),
        rrect(0.44, 0.48, 0.12, 0.1, 0.02),
        rrect(0.62, 0.48, 0.12, 0.1, 0.02),
        rrect(0.26, 0.64, 0.12, 0.1, 0.02),
        rrect(0.44, 0.64, 0.12, 0.1, 0.02),
        rrect(0.28, 0.06, 0.08, 0.18, 0.04),
        rrect(0.64, 0.06, 0.08, 0.18, 0.04),
      ];
    case 'chart':
      return [rrect(0.12, 0.56, 0.18, 0.32, 0.04), rrect(0.41, 0.36, 0.18, 0.52, 0.04), rrect(0.7, 0.14, 0.18, 0.74, 0.04), rrect(0.06, 0.9, 0.88, 0.05, 0.025)];
    case 'star': {
      const out: Point[] = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? 0.47 : 0.2;
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        out.push(P(0.5 + rad * Math.cos(ang), 0.53 + rad * Math.sin(ang)));
      }
      return [polygonPath(out)];
    }
    case 'bolt':
      return [poly([[0.58, 0.04], [0.18, 0.56], [0.46, 0.56], [0.38, 0.96], [0.82, 0.4], [0.54, 0.4], [0.64, 0.04]])];
    case 'drop': {
      const cx = ox + 0.5 * s;
      const cy = oy + 0.62 * s;
      const r = 0.32 * s;
      const tip = { x: cx, y: oy + 0.04 * s };
      const d = cy - tip.y;
      const a = Math.acos(r / d);
      const arc = arcPoints(cx, cy, r, r, -Math.PI / 2 + a, -Math.PI / 2 - a + Math.PI * 2);
      return [{ closed: true, pts: [...arc, pt(tip.x, tip.y)] }];
    }
    case 'home':
      return [poly([[0.5, 0.08], [0.94, 0.46], [0.84, 0.46], [0.84, 0.92], [0.16, 0.92], [0.16, 0.46], [0.06, 0.46]]), rrect(0.4, 0.6, 0.2, 0.32, [0.1, 0.1, 0, 0])];
    case 'target':
      return [circle(0.5, 0.5, 0.46), circle(0.5, 0.5, 0.35), circle(0.5, 0.5, 0.24), circle(0.5, 0.5, 0.12)];
    case 'coin':
      return [circle(0.5, 0.5, 0.45), circle(0.5, 0.5, 0.34), rrect(0.44, 0.28, 0.12, 0.44, 0.03)];
    case 'crescent':
      return [crescent(P(0.46, 0.5), 0.42 * s, P(0.62, 0.4), 0.36 * s)];
    case 'dome': {
      const base = rrect(0.14, 0.72, 0.72, 0.2, 0.02);
      const dome: SubPath = {
        closed: true,
        pts: [pt(ox + 0.18 * s, oy + 0.72 * s), ...arcPoints(ox + 0.5 * s, oy + 0.72 * s, 0.32 * s, 0.42 * s, Math.PI, Math.PI * 2), pt(ox + 0.82 * s, oy + 0.72 * s)],
      };
      const finial = rrect(0.475, 0.08, 0.05, 0.2, 0.025);
      return [base, dome, finial];
    }
  }
}

/** Arc from angle `from` to `to` on a circle, going the way that passes `via` (radians, screen space). */
function arcVia(c: Point, r: number, from: number, to: number, via: number): ReturnType<typeof arcPoints> {
  const norm = (a: number): number => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const cw = norm(to - from);
  const passesCw = norm(via - from) < cw;
  const end = passesCw ? from + cw : from - (2 * Math.PI - cw);
  return arcPoints(c.x, c.y, r, r, from, end);
}

/** Crescent: the part of disc 1 outside disc 2 (the discs must intersect). */
function crescent(c1: Point, r1: number, c2: Point, r2: number): SubPath {
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const d = Math.hypot(dx, dy);
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * dx) / d;
  const my = c1.y + (a * dy) / d;
  const A = { x: mx - (h * dy) / d, y: my + (h * dx) / d };
  const B = { x: mx + (h * dy) / d, y: my - (h * dx) / d };
  const ang = (c: Point, q: Point): number => Math.atan2(q.y - c.y, q.x - c.x);
  const toC2 = Math.atan2(dy, dx);
  const outer = arcVia(c1, r1, ang(c1, A), ang(c1, B), toC2 + Math.PI);
  const inner = arcVia(c2, r2, ang(c2, B), ang(c2, A), toC2 + Math.PI);
  return mergeDuplicates({ closed: true, pts: [...outer, ...inner] });
}
