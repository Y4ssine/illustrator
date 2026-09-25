/**
 * Shadow engine — pure geometry and gradient maths.
 *
 * Ground and contact shadows are built as a single ellipse with a radial
 * gradient whose stop opacities follow a smooth (Gaussian-like) falloff. This
 * is fully vector, resolution independent, cheap to render and editable in
 * the Gradient panel. A live Gaussian Blur can optionally be added on top, but
 * it is a raster effect and therefore off by default.
 *
 * Implementation detail the host relies on: the ellipse is drawn as a CIRCLE,
 * filled with the radial gradient and then scaled vertically with
 * "transform gradients" on, which turns the circular falloff into an
 * elliptical one. Filling an ellipse directly would give a circular gradient
 * that gets cut off at the top and bottom of the ellipse.
 */

import type { Rect } from '../geometry/rect';
import type { BlendMode, GradientStopSpec, HostOp, Paint, Place } from '../core/protocol';
import { clamp } from '../utils/misc';
import { normalizeHex } from '../utils/color';

export type ShadowKind = 'ground' | 'contact' | 'contactAmbient';

export interface EllipseLayer {
  /** Shadow width as a fraction of the subject width. */
  widthScale: number;
  /** Shadow height as a fraction of the shadow width. */
  flatness: number;
  /** 0 = hard edge, 1 = very soft. */
  softness: number;
  /** Item opacity, 0–100. */
  opacity: number;
}

export interface ShadowParams extends EllipseLayer {
  kind: ShadowKind;
  /** Horizontal offset as % of subject width (+ = right). */
  offsetX: number;
  /** Vertical offset as % of subject height (+ = down). 0 centres the ellipse on the subject's bottom edge. */
  offsetY: number;
  rotation: number;
  color: string;
  blend: BlendMode;
  /** Optional live Gaussian Blur radius in pt (raster effect). 0 = off. */
  liveBlur: number;
  /** Second, wider and softer ellipse used by 'contactAmbient'. */
  ambient: EllipseLayer;
}

export const SHADOW_LIMITS = {
  widthScale: [0.05, 4],
  flatness: [0.01, 1],
  softness: [0, 1],
  opacity: [0, 100],
  offsetX: [-200, 200],
  offsetY: [-100, 100],
  rotation: [-180, 180],
  liveBlur: [0, 250],
} as const;

export const DEFAULT_AMBIENT: EllipseLayer = { widthScale: 1.15, flatness: 0.2, softness: 0.92, opacity: 22 };

export const SHADOW_DEFAULTS: Record<ShadowKind, ShadowParams> = {
  ground: {
    kind: 'ground',
    widthScale: 0.9,
    flatness: 0.14,
    softness: 0.75,
    opacity: 30,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    color: '#1A1410',
    blend: 'multiply',
    liveBlur: 0,
    ambient: DEFAULT_AMBIENT,
  },
  contact: {
    kind: 'contact',
    widthScale: 0.62,
    flatness: 0.06,
    softness: 0.35,
    opacity: 60,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    color: '#120E0B',
    blend: 'multiply',
    liveBlur: 0,
    ambient: DEFAULT_AMBIENT,
  },
  contactAmbient: {
    kind: 'contactAmbient',
    widthScale: 0.62,
    flatness: 0.06,
    softness: 0.35,
    opacity: 55,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
    color: '#120E0B',
    blend: 'multiply',
    liveBlur: 0,
    ambient: DEFAULT_AMBIENT,
  },
};

export const SHADOW_KIND_LABEL: Record<ShadowKind, string> = {
  ground: 'Ground',
  contact: 'Contact',
  contactAmbient: 'Contact + Ambient',
};

/** Clamp every numeric parameter into its supported range and fill gaps from defaults. */
export function sanitizeShadowParams(input: Partial<ShadowParams> & { kind?: ShadowKind }): ShadowParams {
  const kind: ShadowKind = input.kind && input.kind in SHADOW_DEFAULTS ? input.kind : 'ground';
  const d = SHADOW_DEFAULTS[kind];
  const num = (v: unknown, fallback: number, [lo, hi]: readonly [number, number]): number =>
    typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
  const amb = (input.ambient ?? {}) as Partial<EllipseLayer>;
  return {
    kind,
    widthScale: num(input.widthScale, d.widthScale, SHADOW_LIMITS.widthScale),
    flatness: num(input.flatness, d.flatness, SHADOW_LIMITS.flatness),
    softness: num(input.softness, d.softness, SHADOW_LIMITS.softness),
    opacity: num(input.opacity, d.opacity, SHADOW_LIMITS.opacity),
    offsetX: num(input.offsetX, d.offsetX, SHADOW_LIMITS.offsetX),
    offsetY: num(input.offsetY, d.offsetY, SHADOW_LIMITS.offsetY),
    rotation: num(input.rotation, d.rotation, SHADOW_LIMITS.rotation),
    color: (typeof input.color === 'string' && normalizeHex(input.color)) || d.color,
    blend: typeof input.blend === 'string' ? input.blend : d.blend,
    liveBlur: num(input.liveBlur, d.liveBlur, SHADOW_LIMITS.liveBlur),
    ambient: {
      widthScale: num(amb.widthScale, d.ambient.widthScale, SHADOW_LIMITS.widthScale),
      flatness: num(amb.flatness, d.ambient.flatness, SHADOW_LIMITS.flatness),
      softness: num(amb.softness, d.ambient.softness, SHADOW_LIMITS.softness),
      opacity: num(amb.opacity, d.ambient.opacity, SHADOW_LIMITS.opacity),
    },
  };
}

/**
 * Radial gradient stops (centre → edge) for a given softness.
 * The opaque core shrinks as softness grows; outside the core the opacity
 * follows a normalised Gaussian so the edge reaches exactly 0.
 */
export function falloffStops(softness: number, color: string, samples = 5): GradientStopSpec[] {
  const s = clamp(softness, 0, 1);
  const core = (1 - s) * 0.72;
  const k = 4.5;
  const tail = Math.exp(-k);
  const at = (u: number): number => (Math.exp(-k * u * u) - tail) / (1 - tail);
  const stops: GradientStopSpec[] = [{ p: 0, c: color, o: 100 }];
  if (core > 0.01) stops.push({ p: round1(core * 100), c: color, o: 100 });
  for (let i = 1; i <= samples; i++) {
    const u = i / samples;
    const t = core + (1 - core) * u;
    stops.push({ p: round1(t * 100), c: color, o: round1(at(u) * 100) });
  }
  // Illustrator allows a midpoint in 13–87; 50 keeps the sampled curve.
  return stops.map((st) => ({ ...st, m: 50 }));
}

export interface EllipseGeometry {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export function ellipseFor(subject: Rect, layer: EllipseLayer, p: Pick<ShadowParams, 'offsetX' | 'offsetY' | 'rotation'>): EllipseGeometry {
  const w = Math.max(2, subject.w * layer.widthScale);
  // Height follows the width (camera angle) but is capped by the subject's own height.
  const h = Math.max(1, Math.min(w * layer.flatness, subject.h * 0.6));
  return {
    cx: subject.x + subject.w / 2 + (subject.w * p.offsetX) / 100,
    cy: subject.y + subject.h + (subject.h * p.offsetY) / 100,
    w,
    h,
    rotation: p.rotation,
  };
}

export function shadowGradientName(color: string, softness: number): string {
  return `AF Shadow ${color.replace('#', '')} s${Math.round(softness * 100)}`;
}

export function shadowPaint(color: string, softness: number): Paint {
  return {
    t: 'radial',
    stops: falloffStops(softness, color),
    name: shadowGradientName(color, softness),
    fallback: 'fadeToWhiteMultiply',
  };
}

export function gaussianBlurXml(radius: number): string {
  // Undocumented but widely used Live Effect XML; applied only when requested
  // and only if PageItem.applyEffect exists (the host checks and warns).
  const r = Math.round(clamp(radius, 0.1, 250) * 10) / 10;
  return `<LiveEffect name="Adobe PSL Gaussian Blur"><Dict data="R blur ${r} "/></LiveEffect>`;
}

export interface ShadowBuildInput {
  subject: Rect;
  subjectName: string;
  params: ShadowParams;
  place: Place;
  /** Tags for the top-level generated item (single ellipse or group). */
  tags: Record<string, string>;
  preview: boolean;
}

export const SHADOW_NAME: Record<ShadowKind, string> = {
  ground: 'Ground',
  contact: 'Contact',
  contactAmbient: 'Contact+Ambient',
};

export function shadowItemName(kind: ShadowKind, subjectName: string): string {
  return `SHADOW — ${SHADOW_NAME[kind]} — ${subjectName}`;
}

/**
 * Host ops that draw one shadow. Returns the ops plus the index (within the
 * returned list) of the top-level item so callers can reference it.
 */
export function buildShadowOps(input: ShadowBuildInput, baseIndex: number): { ops: HostOp[]; topIndex: number } {
  const { params: p, subject } = input;
  const name = shadowItemName(p.kind, input.subjectName);
  const blur = p.liveBlur > 0 ? gaussianBlurXml(p.liveBlur) : null;
  const ops: HostOp[] = [];
  if (p.kind !== 'contactAmbient') {
    const g = ellipseFor(subject, p, p);
    ops.push({
      op: 'shape.ellipse',
      ...g,
      into: input.place,
      fill: shadowPaint(p.color, p.softness),
      opacity: p.opacity,
      blend: p.blend,
      name,
      tags: input.tags,
    });
    if (blur) ops.push({ op: 'item.effect', ref: { k: 'op', i: baseIndex }, xml: blur, optional: true });
    return { ops, topIndex: baseIndex };
  }
  // Contact + ambient: a named group holding a wide soft ellipse under a tight dark one.
  ops.push({ op: 'group.create', into: input.place, name, tags: input.tags });
  const groupRef = { k: 'op' as const, i: baseIndex };
  const ambientGeom = ellipseFor(subject, p.ambient, p);
  const contactGeom = ellipseFor(subject, p, p);
  ops.push({
    op: 'shape.ellipse',
    ...ambientGeom,
    into: { k: 'inside', ref: groupRef, at: 'bottom' },
    fill: shadowPaint(p.color, p.ambient.softness),
    opacity: p.ambient.opacity,
    blend: p.blend,
    name: 'Ambient',
  });
  ops.push({
    op: 'shape.ellipse',
    ...contactGeom,
    into: { k: 'inside', ref: groupRef, at: 'top' },
    fill: shadowPaint(p.color, p.softness),
    opacity: p.opacity,
    blend: p.blend,
    name: 'Contact',
  });
  if (blur) ops.push({ op: 'item.effect', ref: { k: 'op', i: baseIndex + 1 }, xml: blur, optional: true });
  return { ops, topIndex: baseIndex };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
