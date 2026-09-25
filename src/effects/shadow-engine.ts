/**
 * Shadow engine v2 — photographic shadows built from ordinary vector art.
 *
 * Every shadow is a named group of plain objects (gradient-filled shapes,
 * Multiply, optional Gaussian Blur live effects) tagged with its parameters so
 * it can be edited later. One light model drives everything: `lightAngle`
 * (compass, where the light comes FROM) and `elevation` (how high the light
 * is) give the direction and length of cast shadows, exactly like the Light
 * tab's rig.
 *
 * Styles
 *  - ground     layered pool: tight contact + core + wide ambient (studio look)
 *  - contact    only the tight contact line (grounding)
 *  - cast       perspective cast shadow of a subject-shaped silhouette
 *               (person, bottle, product…) — works for images too
 *  - silhouette true cast shadow from a copy of the artwork itself (vector art)
 *  - floating   UI/card elevation, or a product hovering above the floor
 *  - long       flat-design long shadow
 *
 * Geometry notes. The ground plane is seen from a low camera: a ground vector
 * g = (gx, gz) (gz = away from the viewer) projects to the screen as
 * (gx, -gz·FORESHORTEN). A point at height z above the subject's base casts to
 * base + z·cot(elevation)·g. For a subject standing on its bottom edge that is
 * the affine map `castMatrix`, applied by the host to a copy of the art.
 */

import type { BlendMode, GradientPaint, GradientStopSpec, Paint, Place, Ref, TagMap } from '../core/protocol';
import { shortHash, type OpRef, type OpSink } from '../core/opsink';
import type { ItemKind } from '../core/snapshot';
import type { Point, Rect } from '../geometry/rect';
import { convexHull, ellipsePath, polygonPath, roundedRectPath, smoothClosed, type PathShape, type SubPath } from '../geometry/path';
import { clamp } from '../utils/misc';
import { normalizeHex } from '../utils/color';
import { fxOp } from './effect-xml';

export type ShadowStyle = 'ground' | 'contact' | 'cast' | 'silhouette' | 'floating' | 'long';
export type SubjectKind = 'person' | 'product' | 'bottle' | 'car' | 'box' | 'card' | 'icon' | 'text';
export type Footprint = 'rect' | 'round' | 'ellipse';

export interface ShadowParams {
  style: ShadowStyle;
  subject: SubjectKind;
  /** Compass degrees the light comes FROM: 0 top/behind, 90 right, 180 front, 270 left. */
  lightAngle: number;
  /** 5 = sunset (very long shadows) … 90 = overhead (none). */
  elevation: number;
  /** Overall darkness 0–100. */
  strength: number;
  /** 0 = hard sun, 100 = overcast/softbox. */
  softness: number;
  /** Cast/long shadow length, % of the physical length. */
  length: number;
  /** Width of the shadow footprint, %. */
  spread: number;
  color: string;
  /** Add Gaussian Blur live effects (photographic softness). Vector falloff is always there. */
  blur: boolean;
  /** Add a contact shadow under cast / silhouette shadows. */
  contact: boolean;
  /** Floating: gap between the object and the surface, % of the object height. */
  lift: number;
  /** Floating: 'card' = UI elevation behind the object, 'hover' = pool on the floor below it. */
  floatMode: 'card' | 'hover';
  /** Long / bounds-based floating shadows. */
  footprint: Footprint;
  /** Corner radius for rounded footprints, pt. */
  radius: number;
  blend: BlendMode;
}

export const SHADOW_STYLES: ReadonlyArray<{ id: ShadowStyle; name: string; hint: string }> = [
  { id: 'ground', name: 'Studio ground', hint: 'Layered contact + core + ambient pool. The safe, realistic default.' },
  { id: 'cast', name: 'Cast (light)', hint: 'Perspective shadow thrown by the light — long at sunset, short at noon.' },
  { id: 'silhouette', name: 'True silhouette', hint: 'A copy of your artwork projected onto the floor (vector art, text, logos).' },
  { id: 'contact', name: 'Contact line', hint: 'Only the dark line where the object touches the ground.' },
  { id: 'floating', name: 'Floating', hint: 'Elevated card / hovering product.' },
  { id: 'long', name: 'Long (flat)', hint: 'Flat-design long shadow for icons, badges and type.' },
];

export const SUBJECT_KINDS: ReadonlyArray<{ id: SubjectKind; name: string }> = [
  { id: 'person', name: 'Person' },
  { id: 'product', name: 'Product' },
  { id: 'bottle', name: 'Bottle / can' },
  { id: 'car', name: 'Car' },
  { id: 'box', name: 'Box / pack' },
  { id: 'card', name: 'Card / UI' },
  { id: 'icon', name: 'Icon / badge' },
  { id: 'text', name: 'Headline' },
];

export const SHADOW_STYLE_LABEL: Record<ShadowStyle, string> = {
  ground: 'Ground',
  contact: 'Contact',
  cast: 'Cast',
  silhouette: 'Silhouette',
  floating: 'Floating',
  long: 'Long',
};

export const SHADOW_AF_TYPE = {
  ground: 'groundShadow',
  contact: 'contactShadow',
  cast: 'castShadow',
  silhouette: 'silhouetteShadow',
  floating: 'elevationShadow',
  long: 'longShadow',
} as const satisfies Record<ShadowStyle, string>;

export const SHADOW_COLORS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: 'Neutral', hex: '#17141A' },
  { name: 'Warm', hex: '#2B170B' },
  { name: 'Cool', hex: '#0C1829' },
  { name: 'Emerald', hex: '#05241A' },
  { name: 'Black', hex: '#000000' },
];

export const DEFAULT_SHADOW: ShadowParams = {
  style: 'ground',
  subject: 'product',
  lightAngle: 320,
  elevation: 40,
  strength: 70,
  softness: 60,
  length: 100,
  spread: 100,
  color: '#17141A',
  blur: true,
  contact: true,
  lift: 18,
  floatMode: 'card',
  footprint: 'round',
  radius: 16,
  blend: 'multiply',
};

const STYLES = SHADOW_STYLES.map((s) => s.id);
const SUBJECTS = SUBJECT_KINDS.map((s) => s.id);

export function sanitizeShadowParams(input: Partial<ShadowParams> | null | undefined): ShadowParams {
  const d = DEFAULT_SHADOW;
  const i = (input ?? {}) as Partial<ShadowParams>;
  const num = (v: unknown, fb: number, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fb);
  return {
    style: STYLES.includes(i.style as ShadowStyle) ? (i.style as ShadowStyle) : d.style,
    subject: SUBJECTS.includes(i.subject as SubjectKind) ? (i.subject as SubjectKind) : d.subject,
    lightAngle: ((num(i.lightAngle, d.lightAngle, -720, 720) % 360) + 360) % 360,
    elevation: num(i.elevation, d.elevation, 5, 90),
    strength: num(i.strength, d.strength, 0, 100),
    softness: num(i.softness, d.softness, 0, 100),
    length: num(i.length, d.length, 10, 300),
    spread: num(i.spread, d.spread, 30, 250),
    color: (typeof i.color === 'string' && normalizeHex(i.color)) || d.color,
    blur: typeof i.blur === 'boolean' ? i.blur : d.blur,
    contact: typeof i.contact === 'boolean' ? i.contact : d.contact,
    lift: num(i.lift, d.lift, 0, 100),
    floatMode: i.floatMode === 'hover' || i.floatMode === 'card' ? i.floatMode : d.floatMode,
    footprint: i.footprint === 'rect' || i.footprint === 'round' || i.footprint === 'ellipse' ? i.footprint : d.footprint,
    radius: num(i.radius, d.radius, 0, 500),
    blend: typeof i.blend === 'string' ? i.blend : d.blend,
  };
}

// ---------------------------------------------------------------------------
// Light geometry
// ---------------------------------------------------------------------------

/** Screen compression of ground-plane depth (a low, product-photography camera). */
export const FORESHORTEN = 0.45;

interface SubjectProfile {
  /** Footprint half-width as a fraction of the subject half-width. */
  foot: number;
  /** Depth of the ground pool relative to its width. */
  depth: number;
}

const PROFILE: Record<SubjectKind, SubjectProfile> = {
  person: { foot: 0.45, depth: 0.24 },
  product: { foot: 0.92, depth: 0.2 },
  bottle: { foot: 0.72, depth: 0.28 },
  car: { foot: 0.96, depth: 0.16 },
  box: { foot: 1, depth: 0.26 },
  card: { foot: 0.92, depth: 0.12 },
  icon: { foot: 0.85, depth: 0.2 },
  text: { foot: 0.96, depth: 0.1 },
};

/** Ground direction of the shadow (unit, x right / z away from the viewer). */
export function groundDir(lightAngle: number): { x: number; z: number } {
  const a = (lightAngle * Math.PI) / 180;
  // Light from the top of the compass = from behind the subject → the shadow comes toward the viewer.
  return { x: -Math.sin(a), z: -Math.cos(a) };
}

/** Cast length factor: shadow length / object height = cot(elevation), capped. */
export function castFactor(p: Pick<ShadowParams, 'elevation' | 'length'>): number {
  const e = (clamp(p.elevation, 5, 90) * Math.PI) / 180;
  return Math.min(4, Math.cos(e) / Math.max(0.05, Math.sin(e))) * (p.length / 100);
}

/** Screen offset of the shadow of a point `height` above the ground. */
export function castOffset(p: Pick<ShadowParams, 'lightAngle' | 'elevation' | 'length'>, height: number): Point {
  const g = groundDir(p.lightAngle);
  const k = castFactor(p) * height;
  return { x: g.x * k, y: -g.z * k * FORESHORTEN };
}

/**
 * Affine map (design space) projecting art standing on the line y = baseY onto
 * the ground: (x, y) → (x + (baseY − y)·k·gx, baseY − (baseY − y)·k·gz·f).
 * Returned as [a, b, c, d, tx, ty] for `item.transform`.
 */
export function castMatrix(p: Pick<ShadowParams, 'lightAngle' | 'elevation' | 'length'>, baseY: number): [number, number, number, number, number, number] {
  const g = groundDir(p.lightAngle);
  const k = castFactor(p);
  let dz = k * g.z * FORESHORTEN;
  // Side light gives a zero-depth shadow; keep a sliver behind the subject so it still reads.
  const minDz = 0.18;
  if (Math.abs(dz) < minDz) dz = dz < -1e-9 ? -minDz : minDz;
  const c = -k * g.x;
  const d = dz;
  return [1, 0, c, d, -c * baseY, baseY - d * baseY];
}

// ---------------------------------------------------------------------------
// Paint
// ---------------------------------------------------------------------------

const r1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Radial stops (centre → edge). The opaque core shrinks as softness grows;
 * outside it the opacity follows a normalised Gaussian that reaches exactly 0.
 */
export function falloffStops(softness: number, color: string, samples = 5): GradientStopSpec[] {
  const s = clamp(softness, 0, 1);
  const core = (1 - s) * 0.72;
  const k = 4.5;
  const tail = Math.exp(-k);
  const at = (u: number): number => (Math.exp(-k * u * u) - tail) / (1 - tail);
  const stops: GradientStopSpec[] = [{ p: 0, c: color, o: 100 }];
  if (core > 0.01) stops.push({ p: r1(core * 100), c: color, o: 100 });
  for (let i = 1; i <= samples; i++) {
    const u = i / samples;
    stops.push({ p: r1((core + (1 - core) * u) * 100), c: color, o: r1(at(u) * 100) });
  }
  return stops.map((st) => ({ ...st, m: 50 }));
}

export function poolPaint(color: string, softness: number): GradientPaint {
  const stops = falloffStops(softness, color);
  return { t: 'radial', stops, name: `AF Shadow ${color.replace('#', '')} s${Math.round(softness * 100)}`, fallback: 'fadeToWhiteMultiply' };
}

/** Linear fade along the shadow: dark at the base (stop 0) → transparent at the tip. */
export function castPaint(color: string, softness: number, angle: number): GradientPaint {
  const s = clamp(softness, 0, 1);
  const stops: GradientStopSpec[] = [
    { p: 0, c: color, o: 100, m: 50 },
    { p: r1(10 + 10 * (1 - s)), c: color, o: r1(88 - 14 * s), m: 45 },
    { p: r1(55 - 10 * s), c: color, o: r1(48 - 12 * s), m: 50 },
    { p: 100, c: color, o: 0, m: 50 },
  ];
  return { t: 'linear', stops, angle, name: `AF Cast ${shortHash(stops)}`, fallback: 'fadeToWhiteMultiply' };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface ShadowSubject {
  /** Bounds the viewer sees (clip bounds for clipping groups). */
  rect: Rect;
  ref: Ref;
  kind: ItemKind;
  name: string;
}

export interface ShadowBuildInput {
  sink: OpSink;
  subject: ShadowSubject;
  params: ShadowParams;
  place: Place;
  tags: TagMap;
  /** Host can apply live effects. */
  blurOk: boolean;
  /** Artboard containing the subject (long shadows are clipped to it). */
  artboard: Rect | null;
}

export interface ShadowBuildResult {
  top: OpRef;
  notes: string[];
}

export function shadowName(style: ShadowStyle, subjectName: string): string {
  return `SHADOW — ${SHADOW_STYLE_LABEL[style]} — ${subjectName}`;
}

/** Art we can duplicate and recolour (images cannot be recoloured by a script). */
export function canSilhouette(kind: ItemKind): boolean {
  return kind === 'path' || kind === 'compound' || kind === 'group' || kind === 'text';
}

interface Ctx {
  sink: OpSink;
  p: ShadowParams;
  s: number;
  soft: number;
  blurOk: boolean;
}

const inside = (ref: Ref, at: 'top' | 'bottom' = 'top'): Place => ({ k: 'inside', ref, at });

function blur(c: Ctx, ref: OpRef, radius: number): void {
  if (c.p.blur && c.blurOk && radius > 0.4) c.sink.push(fxOp(ref, { kind: 'blur', radius: Math.min(200, radius) }));
}

function pool(c: Ctx, into: Place, center: Point, w: number, h: number, softness: number, opacity: number, name: string, blurR: number): void {
  const e = c.sink.push({
    op: 'shape.ellipse',
    cx: center.x,
    cy: center.y,
    w: Math.max(2, w),
    h: Math.max(1, h),
    into,
    fill: poolPaint(c.p.color, softness),
    opacity: Math.round(clamp(opacity, 0, 100)),
    blend: c.p.blend,
    name,
  });
  blur(c, e, blurR);
}

/** Subject-shaped silhouette standing on its base (design space), for bounds-based cast shadows. */
export function billboard(kind: SubjectKind, r: Rect, spread: number): PathShape {
  const cx = r.x + r.w / 2;
  const base = r.y + r.h;
  const hw = (r.w / 2) * spread;
  const P = (u: number, v: number): Point => ({ x: cx + u * hw, y: base - v * r.h });
  const mirror = (half: Array<[number, number]>): Point[] => [...half.map(([u, v]) => P(u, v)), ...[...half].reverse().map(([u, v]) => P(-u, v))];
  // Smooth sides and top, but a straight bottom edge on the base line (first/last points are the feet).
  const standing = (half: Array<[number, number]>, tension: number): SubPath => {
    const sp = smoothClosed(mirror(half), tension);
    const f = sp.pts[0]!;
    const l = sp.pts[sp.pts.length - 1]!;
    sp.pts[0] = [f[0], f[1], f[0], f[1], f[4]!, f[5]!];
    sp.pts[sp.pts.length - 1] = [l[0], l[1], l[2]!, l[3]!, l[0], l[1]];
    return sp;
  };
  switch (kind) {
    case 'person':
      return [standing([[0.32, 0], [0.4, 0.28], [0.55, 0.52], [0.78, 0.76], [0.36, 0.84], [0.3, 0.95], [0.08, 1]], 0.9)];
    case 'bottle':
      return [standing([[0.8, 0], [0.86, 0.55], [0.55, 0.74], [0.26, 0.84], [0.24, 1]], 0.8)];
    case 'car':
      return [standing([[1, 0], [1, 0.42], [0.55, 0.62], [0.28, 1]], 0.7)];
    default:
      return [roundedRectPath({ x: cx - hw, y: r.y, w: hw * 2, h: r.h }, Math.min(hw, r.h) * 0.12)];
  }
}

function footprintShape(fp: Footprint, r: Rect, radius: number): PathShape {
  if (fp === 'ellipse') return [ellipsePath(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2)];
  return [roundedRectPath(r, fp === 'round' ? radius : 0)];
}

function footprintPoints(fp: Footprint, r: Rect, radius: number): Point[] {
  if (fp === 'rect') return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  const out: Point[] = [];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (fp === 'ellipse') out.push({ x: r.x + r.w / 2 + (r.w / 2) * Math.cos(a), y: r.y + r.h / 2 + (r.h / 2) * Math.sin(a) });
    else {
      const rr = Math.min(radius, r.w / 2, r.h / 2);
      const qx = Math.cos(a) >= 0 ? r.x + r.w - rr : r.x + rr;
      const qy = Math.sin(a) >= 0 ? r.y + r.h - rr : r.y + rr;
      out.push({ x: qx + rr * Math.cos(a), y: qy + rr * Math.sin(a) });
    }
  }
  return out;
}

export function buildShadow(input: ShadowBuildInput): ShadowBuildResult {
  const p = input.params;
  const { sink, subject } = input;
  const r = subject.rect;
  const notes: string[] = [];
  const c: Ctx = { sink, p, s: p.strength / 100, soft: p.softness / 100, blurOk: input.blurOk };
  const prof = PROFILE[p.subject];
  const base: Point = { x: r.x + r.w / 2, y: r.y + r.h };
  const fw = (r.w / 2) * prof.foot * (p.spread / 100);
  const top = sink.push({ op: 'group.create', into: input.place, name: shadowName(p.style, subject.name), tags: input.tags });
  const bottom = inside(top, 'bottom');
  const onTop = inside(top, 'top');
  const drift = castOffset(p, r.h);

  const groundPool = (scale: number, withAmbient: boolean, withCore: boolean): void => {
    // Pools drift a little toward the cast direction and stretch with it.
    const dx = drift.x * 0.12 * scale;
    const dy = drift.y * 0.12 * scale;
    const w0 = fw * 2;
    const depth = w0 * prof.depth;
    if (withAmbient) {
      pool(c, bottom, { x: base.x + dx, y: base.y + dy * 0.8 }, w0 * 2 + Math.abs(dx) * 2, depth * 2.1 + Math.abs(dy), 0.95, 42 * c.s, 'Ambient', w0 * 0.07 * (0.5 + c.soft));
    }
    if (withCore) {
      pool(c, withAmbient ? onTop : bottom, { x: base.x + dx * 1.2, y: base.y + dy * 0.9 }, w0 * 1.25 + Math.abs(dx) * 1.1, depth * 0.95 + Math.abs(dy) * 0.6, 0.45 + 0.35 * c.soft, 62 * c.s, 'Core', w0 * 0.035 * (0.4 + c.soft));
    }
    pool(c, onTop, { x: base.x + dx * 0.1, y: base.y - depth * 0.02 }, w0 * 0.94, Math.max(2, Math.min(depth * 0.32, r.h * 0.05)), 0.28 + 0.2 * c.soft, 92 * c.s, 'Contact', w0 * 0.012 * (0.4 + c.soft));
  };

  switch (p.style) {
    case 'ground':
      groundPool(1, true, true);
      break;
    case 'contact':
      groundPool(0.4, false, true);
      break;
    case 'cast':
    case 'silhouette': {
      const m = castMatrix(p, base.y);
      const angle = 90; // gradient runs up the standing art: base (dark) → top (clear)
      const useArt = p.style === 'silhouette' && canSilhouette(subject.kind);
      if (p.style === 'silhouette' && !useArt) notes.push('Images cannot be recoloured by a script, so a subject-shaped cast shadow was used instead of a silhouette.');
      const layers = [
        { spread: 1.12, o: 45, soft: Math.min(1, c.soft + 0.3), blur: 0.05, name: 'Cast (penumbra)' },
        { spread: 1, o: 88, soft: c.soft * 0.6, blur: 0.012, name: 'Cast (core)' },
      ];
      for (const l of layers) {
        let ref: OpRef;
        if (useArt) {
          ref = sink.push({ op: 'item.duplicate', ref: subject.ref, to: bottom, name: l.name });
          // One gradient per path would restart on every piece of a group; groups get a flat tone.
          const single = subject.kind === 'path' || subject.kind === 'compound';
          sink.push({ op: 'item.restyle', ref, fill: single ? castPaint(p.color, l.soft, angle) : { t: 'solid', c: p.color }, stroke: null, recursive: true, opacity: Math.round(l.o * c.s * (single ? 1 : 0.55)), blend: p.blend });
        } else {
          ref = sink.push({ op: 'shape.path', paths: billboard(p.subject, r, (p.spread / 100) * l.spread), into: bottom, fill: castPaint(p.color, l.soft, angle), opacity: Math.round(l.o * c.s), blend: p.blend, name: l.name });
        }
        sink.push({ op: 'item.transform', ref, m, gradients: true });
        const len = Math.hypot(drift.x, drift.y) + r.w * 0.2;
        blur(c, ref, len * l.blur * (0.4 + c.soft));
      }
      if (p.contact) groundPool(0.2, false, false);
      break;
    }
    case 'floating': {
      const gap = r.h * (p.lift / 100);
      if (p.floatMode === 'hover') {
        // Pool on the floor below a hovering object: smaller, softer and lighter the higher it floats.
        const t = clamp(p.lift / 100, 0, 1);
        const w0 = fw * 2 * (1.05 - 0.35 * t);
        const dx = drift.x * 0.15;
        pool(c, bottom, { x: base.x + dx, y: base.y + gap + w0 * prof.depth * 0.1 }, w0 * 1.6, w0 * prof.depth * 1.6, 0.95, 32 * c.s * (1 - 0.4 * t), 'Floor ambient', w0 * 0.08 * (0.6 + c.soft));
        pool(c, onTop, { x: base.x + dx, y: base.y + gap }, w0, w0 * prof.depth * 0.7, 0.55 + 0.35 * t, 70 * c.s * (1 - 0.55 * t), 'Floor core', w0 * 0.03 * (0.5 + c.soft + t));
        break;
      }
      // UI elevation: two soft copies behind the object (key + ambient), like Material/iOS cards.
      const lift = Math.max(2, r.h * 0.25 * (p.lift / 100) * 2);
      const dir = castOffset({ ...p, elevation: Math.max(35, p.elevation), length: 100 }, 1);
      const norm = Math.hypot(dir.x, dir.y) || 1;
      const ux = (dir.x / norm) * 0.35;
      const uy = Math.max(0.6, Math.abs(dir.y / norm));
      const layers = [
        { dx: ux * lift * 0.4, dy: uy * lift * 0.4, blur: lift * 1.6, o: 26, scale: 1.0, name: 'Ambient' },
        { dx: ux * lift, dy: uy * lift, blur: lift * 0.7, o: 38, scale: 0.94, name: 'Key' },
      ];
      const vector = canSilhouette(subject.kind);
      for (const l of layers) {
        let ref: OpRef;
        if (vector) {
          ref = sink.push({ op: 'item.duplicate', ref: subject.ref, to: bottom, name: `Elevation ${l.name}` });
          sink.push({ op: 'item.restyle', ref, fill: { t: 'solid', c: p.color }, stroke: null, recursive: true, opacity: Math.round(l.o * c.s), blend: p.blend });
        } else {
          ref = sink.push({ op: 'shape.path', paths: footprintShape(p.footprint, r, p.radius), into: bottom, fill: { t: 'solid', c: p.color }, opacity: Math.round(l.o * c.s), blend: p.blend, name: `Elevation ${l.name}` });
        }
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        const k = l.scale;
        sink.push({ op: 'item.transform', ref, m: [k, 0, 0, k, cx - k * cx + l.dx, cy - k * cy + l.dy], gradients: true });
        blur(c, ref, l.blur * (0.5 + c.soft));
      }
      if (!(p.blur && c.blurOk)) notes.push('Without live blur the floating shadow is a hard offset copy; turn blur on for the soft look.');
      break;
    }
    case 'long': {
      const a = (p.lightAngle * Math.PI) / 180;
      const dir = { x: -Math.sin(a), y: Math.cos(a) };
      const L = Math.max(r.w, r.h) * 1.6 * (p.length / 100);
      const fr: Rect = { x: r.x + (r.w * (1 - p.spread / 100)) / 2, y: r.y + (r.h * (1 - p.spread / 100)) / 2, w: (r.w * p.spread) / 100, h: (r.h * p.spread) / 100 };
      const pts = footprintPoints(p.footprint, fr, p.radius);
      const hull = convexHull([...pts, ...pts.map((q) => ({ x: q.x + dir.x * L, y: q.y + dir.y * L }))]);
      const aiAngle = -((Math.atan2(dir.y, dir.x) * 180) / Math.PI);
      const stops: GradientStopSpec[] = [
        { p: 0, c: p.color, o: 100, m: 50 },
        { p: 100, c: p.color, o: 0, m: 40 + 20 * c.soft },
      ];
      const fill: Paint = { t: 'linear', stops, angle: aiAngle, name: `AF Long ${shortHash(stops)}`, fallback: 'fadeToWhiteMultiply' };
      let into: Place = bottom;
      if (input.artboard) {
        const ab = input.artboard;
        sink.push({ op: 'shape.rect', x: ab.x, y: ab.y, w: ab.w, h: ab.h, into: onTop, fill: { t: 'none' }, name: 'Artboard clip' });
        into = bottom;
      }
      const ref = sink.push({ op: 'shape.path', paths: [polygonPath(hull)], into, fill, opacity: Math.round(60 * c.s + 20), blend: p.blend, name: 'Long shadow' });
      blur(c, ref, c.soft * 3);
      if (input.artboard) sink.push({ op: 'group.clip', ref: top });
      break;
    }
  }
  return { top, notes };
}
