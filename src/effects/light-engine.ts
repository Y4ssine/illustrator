/**
 * Light engine — pure op builders for professional lighting in vector form.
 *
 * Everything is ordinary, editable Illustrator art: gradient-filled shapes
 * with blend modes and (optionally) Gaussian Blur live effects. A single
 * LightRig (direction, elevation, colour temperature, intensity, softness)
 * drives every effect so glows, beams, rim light and shadows agree.
 *
 * Direction convention (designer friendly, "compass"): `angle` is where the
 * light comes FROM, 0 = top, 90 = right, 180 = bottom, 270 = left.
 */

import type { BlendMode, GradientPaint, GradientStopSpec, HostOp, Paint, Place, Ref } from '../core/protocol';
import { shortHash, type OpRef, type OpSink } from '../core/opsink';
import type { Point, Rect } from '../geometry/rect';
import { kelvinToHex, lighten, mix, rotateHue, saturate } from '../color/color-math';
import { createRng } from '../utils/random';
import { clamp } from '../utils/misc';
import { fxOp } from './effect-xml';

export interface LightRig {
  /** Where the light comes from (compass degrees: 0 top, 90 right, 180 bottom, 270 left). */
  angle: number;
  /** Height of the light above the ground: 90 = overhead (short shadows), 10 = low sun (long shadows). */
  elevation: number;
  kelvin: number;
  /** Overrides the Kelvin colour when set. */
  color: string | null;
  /** 0–100 */
  intensity: number;
  /** 0 = hard light (sun), 100 = very soft (overcast / softbox). */
  softness: number;
}

export const DEFAULT_RIG: LightRig = { angle: 315, elevation: 35, kelvin: 3400, color: null, intensity: 70, softness: 60 };

export const RIG_PRESETS: ReadonlyArray<{ id: string; name: string; rig: LightRig }> = [
  { id: 'golden-hour', name: 'Golden hour', rig: { angle: 290, elevation: 12, kelvin: 2600, color: null, intensity: 80, softness: 45 } },
  { id: 'studio-key-left', name: 'Studio key (left)', rig: { angle: 300, elevation: 45, kelvin: 5200, color: null, intensity: 65, softness: 80 } },
  { id: 'studio-key-right', name: 'Studio key (right)', rig: { angle: 60, elevation: 45, kelvin: 5200, color: null, intensity: 65, softness: 80 } },
  { id: 'noon-sun', name: 'Noon sun', rig: { angle: 350, elevation: 78, kelvin: 5600, color: null, intensity: 85, softness: 15 } },
  { id: 'backlight', name: 'Backlit hero', rig: { angle: 0, elevation: 25, kelvin: 3000, color: null, intensity: 90, softness: 55 } },
  { id: 'lantern', name: 'Lantern / candle', rig: { angle: 45, elevation: 30, kelvin: 1900, color: null, intensity: 75, softness: 70 } },
  { id: 'moonlight', name: 'Moonlight', rig: { angle: 320, elevation: 40, kelvin: 9000, color: null, intensity: 50, softness: 65 } },
  { id: 'neon-night', name: 'Neon night', rig: { angle: 90, elevation: 30, kelvin: 6500, color: '#35E0B0', intensity: 80, softness: 50 } },
  { id: 'emerald', name: 'Emerald glow', rig: { angle: 0, elevation: 30, kelvin: 6500, color: '#2FD48A', intensity: 70, softness: 70 } },
];

export function lightColor(rig: LightRig): string {
  return rig.color ?? kelvinToHex(rig.kelvin);
}

/** Unit vector (screen space, Y down) pointing from the scene towards the light. */
export function toLight(rig: LightRig): Point {
  const a = (rig.angle * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** Where the light enters an area: the point on the area's edge facing the light, pushed out. */
export function lightEntry(area: Rect, rig: LightRig, push = 0.15): Point {
  const u = toLight(rig);
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const t = Math.min(Math.abs(u.x) > 1e-6 ? area.w / 2 / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-6 ? area.h / 2 / Math.abs(u.y) : Infinity);
  return { x: cx + u.x * t * (1 + push), y: cy + u.y * t * (1 + push) };
}

// ---------------------------------------------------------------------------
// Paint helpers
// ---------------------------------------------------------------------------

const stop = (p: number, c: string, o: number, m = 50): GradientStopSpec => ({ p: Math.round(p * 10) / 10, c, o: Math.round(clamp(o, 0, 100) * 10) / 10, m });

/** Soft radial glow: bright core → smooth falloff → transparent. */
export function glowPaint(color: string, intensity: number, softness: number, core = '#FFFFFF'): GradientPaint {
  const s = clamp(softness, 0, 100) / 100;
  const i = clamp(intensity, 0, 100);
  const hot = mix(color, core, 0.55);
  const stops = [stop(0, hot, i), stop(12 + 10 * (1 - s), mix(color, core, 0.2), i * 0.8), stop(38, color, i * 0.42, 45), stop(70, color, i * 0.12, 40), stop(100, color, 0)];
  return { t: 'radial', stops, name: `AF Glow ${shortHash(stops)}`, fit: 'ellipse' };
}

/** Linear fade from colour at `from`% opacity to `to`%. */
export function fadePaint(color: string, from: number, to: number, angle: number, color2 = color): GradientPaint {
  const stops = [stop(0, color, from), stop(55, mix(color, color2, 0.5), (from + to) / 2 - (from - to) * 0.12, 45), stop(100, color2, to)];
  return { t: 'linear', stops, angle, name: `AF Fade ${shortHash(stops)}` };
}

export function vignettePaint(color: string, strength: number, softness: number): GradientPaint {
  const inner = 30 + 30 * (softness / 100);
  const stops = [stop(0, color, 0), stop(inner, color, 0, 60), stop(100, color, strength)];
  return { t: 'radial', stops, name: `AF Vignette ${shortHash(stops)}`, fit: 'ellipse' };
}

/** Screen-space angle (Y down, clockwise) → Illustrator gradient/rotation angle. */
export function screenToAi(deg: number): number {
  return -deg;
}

function screenAngleOf(v: Point): number {
  return (Math.atan2(v.y, v.x) * 180) / Math.PI;
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface LightContext {
  sink: OpSink;
  rig: LightRig;
  /** Area to light (artboard or selection bounds). */
  area: Rect;
  /** Where area-wide effects go (lighting layer). */
  into: Place;
  /** Raster blur allowed (Gaussian Blur live effect). */
  blur: boolean;
  seed: number;
}

export interface LightResult {
  top: OpRef;
  summary: string;
}

function group(ctx: LightContext, name: string, type: string, params: Record<string, unknown>, into: Place = ctx.into): OpRef {
  return ctx.sink.push({ op: 'group.create', into, name, tags: { AF_type: 'light', AF_light: type, AF_ver: '1', AF_params: JSON.stringify(params) } });
}

function inside(ref: Ref, at: 'top' | 'bottom' = 'top'): Place {
  return { k: 'inside', ref, at };
}

function ellipse(ctx: LightContext, into: Place, c: Point, w: number, h: number, fill: Paint, blend: BlendMode, opacity: number, name: string, rotation = 0): OpRef {
  return ctx.sink.push({ op: 'shape.ellipse', cx: c.x, cy: c.y, w, h, rotation, into, fill, blend, opacity, name });
}

function blurIf(ctx: LightContext, ref: OpRef, radius: number): void {
  if (ctx.blur && radius > 0.5) ctx.sink.push(fxOp(ref, { kind: 'blur', radius }));
}

/**
 * Clipping group limited to `area` (keeps big glows from spilling off the
 * artboard). Call `close()` after adding the content: the group is turned into
 * a clipping group only once it has a mask and content.
 */
function clipped(ctx: LightContext, name: string, type: string, params: Record<string, unknown>): { group: OpRef; content: Place; close(): void } {
  const g = group(ctx, name, type, params);
  ctx.sink.push({ op: 'shape.rect', x: ctx.area.x, y: ctx.area.y, w: ctx.area.w, h: ctx.area.h, into: inside(g, 'top'), fill: { t: 'none' }, name: 'Clip' });
  return { group: g, content: inside(g, 'bottom'), close: () => void ctx.sink.push({ op: 'group.clip', ref: g }) };
}

/** Key light pool: a large soft glow where the light lands on the scene. */
export function keySpot(ctx: LightContext, opts: { size: number; blend: BlendMode }): LightResult {
  const { rig, area } = ctx;
  const u = toLight(rig);
  const c = { x: area.x + area.w / 2 + u.x * area.w * 0.22, y: area.y + area.h / 2 + u.y * area.h * 0.22 };
  const d = Math.hypot(area.w, area.h) * (opts.size / 100);
  const { group: g, content, close } = clipped(ctx, 'LIGHT — Key spot', 'keySpot', { ...opts });
  const e = ellipse(ctx, content, c, d, d * 0.75, glowPaint(lightColor(rig), rig.intensity, rig.softness), opts.blend, 100, 'Key light', screenToAi(screenAngleOf(u)));
  blurIf(ctx, e, d * 0.04 * (rig.softness / 100));
  close();
  return { top: g, summary: 'Key light pool added.' };
}

/** Halo behind the subject (backlight / hero glow). Place directly below the subject. */
export function backGlow(ctx: LightContext, subject: Rect, place: Place, opts: { size: number; blend: BlendMode }): LightResult {
  const { rig } = ctx;
  const u = toLight(rig);
  const size = Math.max(subject.w, subject.h) * (opts.size / 100);
  const c = { x: subject.x + subject.w / 2 + u.x * subject.w * 0.08, y: subject.y + subject.h * 0.45 + u.y * subject.h * 0.05 };
  const g = group(ctx, 'LIGHT — Back glow', 'backGlow', { ...opts }, place);
  const color = lightColor(rig);
  const outer = ellipse(ctx, inside(g, 'bottom'), c, size, size * 1.05, glowPaint(color, rig.intensity * 0.85, 90), opts.blend, 100, 'Halo');
  blurIf(ctx, outer, size * 0.05);
  const core = ellipse(ctx, inside(g, 'top'), c, size * 0.45, size * 0.5, glowPaint(lighten(color, 0.08), rig.intensity, 50), opts.blend, 100, 'Core');
  blurIf(ctx, core, size * 0.03);
  return { top: g, summary: 'Back glow added behind the subject.' };
}

/** God rays: tapered beams from the light entry point across the area. */
export function beams(ctx: LightContext, opts: { count: number; spread: number; length: number; width: number; blend: BlendMode }): LightResult {
  const { rig, area } = ctx;
  const rng = createRng(ctx.seed);
  const src = lightEntry(area, rig, 0.1);
  const u = toLight(rig);
  const dirDeg = screenAngleOf({ x: -u.x, y: -u.y });
  const L = Math.hypot(area.w, area.h) * (opts.length / 100);
  const color = lightColor(rig);
  const { group: g, content, close } = clipped(ctx, 'LIGHT — Beams', 'beams', { ...opts, seed: ctx.seed });
  const n = Math.max(1, Math.round(opts.count));
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1) - 0.5;
    const ang = dirDeg + t * opts.spread + rng.jitter(opts.spread / (n * 2));
    const w0 = Math.max(2, (opts.width / 100) * L * 0.02 * rng.range(0.4, 1));
    const w1 = w0 * rng.range(5, 12);
    const len = L * rng.range(0.7, 1.05);
    // Axis-aligned trapezoid starting at the source, then rotated about its left edge.
    const pts: number[][] = [
      [src.x, src.y - w0 / 2],
      [src.x + len, src.y - w1 / 2],
      [src.x + len, src.y + w1 / 2],
      [src.x, src.y + w0 / 2],
    ];
    const op: HostOp = {
      op: 'shape.path',
      paths: [{ closed: true, pts }],
      into: content,
      fill: fadePaint(color, rig.intensity * rng.range(0.35, 0.7), 0, 0),
      blend: opts.blend,
      opacity: 100,
      name: `Beam ${i + 1}`,
    };
    const ref = ctx.sink.push(op);
    ctx.sink.push({ op: 'item.rotate', ref, angle: screenToAi(ang), about: 'left', gradients: true });
    blurIf(ctx, ref, w1 * 0.18 * (0.5 + rig.softness / 100));
  }
  close();
  return { top: g, summary: `${n} light beams added.` };
}

/** Warm light leaks at the edge facing the light. */
export function lightLeak(ctx: LightContext, opts: { size: number; hueShift: number; blend: BlendMode }): LightResult {
  const { rig, area } = ctx;
  const entry = lightEntry(area, rig, -0.05);
  const base = lightColor(rig);
  const d = Math.hypot(area.w, area.h) * (opts.size / 100);
  const { group: g, content, close } = clipped(ctx, 'LIGHT — Light leak', 'leak', { ...opts });
  const colors = [saturate(base, 1.4), rotateHue(saturate(base, 1.5), opts.hueShift), rotateHue(saturate(base, 1.3), -opts.hueShift / 2)];
  colors.forEach((c, i) => {
    const off = { x: entry.x + (i - 1) * d * 0.25, y: entry.y + (i - 1) * d * 0.12 };
    const e = ellipse(ctx, content, off, d * (1 - i * 0.2), d * 0.6 * (1 - i * 0.15), glowPaint(c, rig.intensity * (0.9 - i * 0.2), 85, c), opts.blend, 100, `Leak ${i + 1}`);
    blurIf(ctx, e, d * 0.06);
  });
  close();
  return { top: g, summary: 'Light leak added.' };
}

/** Bokeh / sparkle orbs scattered across the area. */
export function bokeh(ctx: LightContext, opts: { count: number; minSize: number; maxSize: number; blend: BlendMode }): LightResult {
  const { rig, area } = ctx;
  const rng = createRng(ctx.seed);
  const color = lightColor(rig);
  const { group: g, content, close } = clipped(ctx, 'LIGHT — Bokeh', 'bokeh', { ...opts, seed: ctx.seed });
  const n = Math.max(1, Math.round(opts.count));
  for (let i = 0; i < n; i++) {
    const s = rng.range(opts.minSize, opts.maxSize);
    const c = { x: area.x + rng.range(0, area.w), y: area.y + rng.range(0, area.h) };
    const tint = mix(color, rotateHue(color, rng.range(-25, 25)), 0.5);
    const depth = rng.next();
    const e = ellipse(ctx, content, c, s, s, glowPaint(tint, rig.intensity * (0.35 + 0.65 * depth), 30 + 60 * depth), opts.blend, 100, `Orb ${i + 1}`);
    blurIf(ctx, e, s * 0.08 * (1 - depth));
  }
  close();
  return { top: g, summary: `${n} bokeh orbs added.` };
}

/** Vignette: darkened edges (or a coloured edge fade). */
export function vignette(ctx: LightContext, opts: { color: string; strength: number; softness: number; blend: BlendMode }): LightResult {
  const { area } = ctx;
  const { group: g, content, close } = clipped(ctx, 'LIGHT — Vignette', 'vignette', { ...opts });
  const c = { x: area.x + area.w / 2, y: area.y + area.h / 2 };
  ellipse(ctx, content, c, area.w * 1.45, area.h * 1.45, vignettePaint(opts.color, opts.strength, opts.softness), opts.blend, 100, 'Vignette');
  close();
  return { top: g, summary: 'Vignette added.' };
}

export interface GradePreset {
  id: string;
  name: string;
  build(rig: LightRig): Array<{ paint: Paint; blend: BlendMode; opacity: number; name: string }>;
}

/** Colour-grade overlays (the "colour grading" layer photographers use). */
export const GRADES: readonly GradePreset[] = [
  {
    id: 'golden',
    name: 'Golden hour',
    build: (rig) => [
      { paint: fadePaint('#FF9A3C', 70, 0, screenToAi(screenAngleOf({ x: -toLight(rig).x, y: -toLight(rig).y }))), blend: 'softLight', opacity: 85, name: 'Warm wash' },
      { paint: { t: 'solid', c: '#3A1E0A' }, blend: 'multiply', opacity: 12, name: 'Warm shadows' },
    ],
  },
  {
    id: 'teal-orange',
    name: 'Teal & orange',
    build: () => [{ paint: fadePaint('#FF8A3D', 60, 60, 90, '#0E6E78'), blend: 'softLight', opacity: 80, name: 'Split tone' }],
  },
  { id: 'emerald', name: 'Emerald mood', build: () => [{ paint: fadePaint('#0B6B3A', 55, 25, 90, '#063D24'), blend: 'color', opacity: 30, name: 'Emerald tint' }, { paint: { t: 'solid', c: '#062A1A' }, blend: 'multiply', opacity: 18, name: 'Depth' }] },
  { id: 'night', name: 'Night blue', build: () => [{ paint: { t: 'solid', c: '#0B1F4A' }, blend: 'multiply', opacity: 45, name: 'Night' }, { paint: fadePaint('#3A6BFF', 35, 0, 270), blend: 'screen', opacity: 60, name: 'Moon lift' }] },
  { id: 'desert', name: 'Desert heat', build: () => [{ paint: fadePaint('#FFC37A', 45, 10, 90, '#C9722E'), blend: 'overlay', opacity: 55, name: 'Heat' }] },
  { id: 'cinematic', name: 'Cinematic fade', build: () => [{ paint: { t: 'solid', c: '#2B3A4A' }, blend: 'screen', opacity: 14, name: 'Lifted blacks' }, { paint: fadePaint('#FFB070', 0, 45, 270, '#1E4A5C'), blend: 'softLight', opacity: 70, name: 'Tone' }] },
  { id: 'luxury', name: 'Luxury gold', build: () => [{ paint: fadePaint('#E9C878', 55, 0, 90), blend: 'softLight', opacity: 80, name: 'Gold wash' }, { paint: { t: 'solid', c: '#120C04' }, blend: 'multiply', opacity: 20, name: 'Rich shadows' }] },
];

export function grade(ctx: LightContext, gradeId: string, amount: number): LightResult {
  const preset = GRADES.find((g) => g.id === gradeId) ?? GRADES[0]!;
  const { group: g, content, close } = clipped(ctx, `LIGHT — Grade: ${preset.name}`, 'grade', { gradeId, amount });
  for (const layer of preset.build(ctx.rig)) {
    ctx.sink.push({ op: 'shape.rect', x: ctx.area.x, y: ctx.area.y, w: ctx.area.w, h: ctx.area.h, into: content, fill: layer.paint, blend: layer.blend, opacity: Math.round(layer.opacity * (amount / 100)), name: layer.name });
  }
  close();
  return { top: g, summary: `${preset.name} grade added.` };
}

/** Atmospheric haze rising from the bottom (or from the horizon). */
export function haze(ctx: LightContext, opts: { height: number; color: string | null; blend: BlendMode }): LightResult {
  const { area, rig } = ctx;
  const color = opts.color ?? mix(lightColor(rig), '#FFFFFF', 0.35);
  const h = area.h * (opts.height / 100);
  const { group: g, content, close } = clipped(ctx, 'LIGHT — Haze', 'haze', { ...opts });
  const r = ctx.sink.push({ op: 'shape.rect', x: area.x, y: area.y + area.h - h, w: area.w, h, into: content, fill: fadePaint(color, rig.intensity * 0.8, 0, 90), blend: opts.blend, opacity: 100, name: 'Haze' });
  blurIf(ctx, r, h * 0.05);
  close();
  return { top: g, summary: 'Haze added.' };
}

/** Light pool on the floor under a product/subject. */
export function floorGlow(ctx: LightContext, subject: Rect, place: Place, opts: { width: number; blend: BlendMode }): LightResult {
  const { rig } = ctx;
  const w = subject.w * (opts.width / 100);
  const c = { x: subject.x + subject.w / 2, y: subject.y + subject.h };
  const g = group(ctx, 'LIGHT — Floor glow', 'floorGlow', { ...opts }, place);
  const e = ellipse(ctx, inside(g), c, w, w * 0.22, glowPaint(lightColor(rig), rig.intensity, 70), opts.blend, 100, 'Floor light');
  blurIf(ctx, e, w * 0.03);
  return { top: g, summary: 'Floor glow added.' };
}

/**
 * Rim / edge light on a subject.
 * Vector art and text: a copy of the subject recoloured with a gradient that
 * is bright on the side facing the light and fades across the shape (Screen),
 * so the light follows the real outline. Images cannot be recoloured by a
 * script: they get a gradient clipped to their bounds instead.
 */
export function rimLight(ctx: LightContext, subject: { ref: Ref; rect: Rect; vector: boolean }, place: Place, opts: { width: number; blend: BlendMode }): LightResult {
  const { rig } = ctx;
  const u = toLight(rig);
  const g = group(ctx, 'LIGHT — Rim light', 'rim', { ...opts }, place);
  const r = subject.rect;
  // Gradient runs from the lit edge inward.
  const angle = screenToAi(screenAngleOf({ x: -u.x, y: -u.y }));
  const w = clamp(opts.width, 2, 90);
  const lit = lightColor(rig);
  const stops: GradientStopSpec[] = [stop(0, lighten(lit, 0.12), rig.intensity), stop(w * 0.35, lit, rig.intensity * 0.55), stop(w, lit, 0)];
  const paint: GradientPaint = { t: 'linear', stops, angle, name: `AF Rim ${shortHash(stops)}` };
  if (subject.vector) {
    const d = ctx.sink.push({ op: 'item.duplicate', ref: subject.ref, to: inside(g, 'top'), name: 'Rim light' });
    ctx.sink.push({ op: 'item.restyle', ref: d, fill: paint, stroke: null, recursive: true, blend: opts.blend, opacity: 100 });
    return { top: g, summary: 'Rim light added along the artwork’s lit edge.' };
  }
  ctx.sink.push({ op: 'shape.rect', x: r.x, y: r.y, w: r.w, h: r.h, into: inside(g, 'top'), fill: { t: 'none' }, name: 'Rim mask' });
  ctx.sink.push({ op: 'shape.rect', x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4, into: inside(g, 'bottom'), fill: paint, blend: opts.blend, opacity: 100, name: 'Rim light' });
  ctx.sink.push({ op: 'group.clip', ref: g });
  return { top: g, summary: 'Edge light added (clipped to the image bounds — images cannot follow their outline).' };
}

/**
 * Neon glow for vector strokes and text: soft coloured copies stacked behind
 * the original. The original is untouched.
 */
export function neon(ctx: LightContext, subject: { ref: Ref; strokeWidth: number; strokeOnly?: boolean }, place: Place, opts: { color: string; spread: number }): LightResult {
  const g = group(ctx, 'LIGHT — Neon', 'neon', { ...opts }, place);
  const base = Math.max(1, subject.strokeWidth);
  const layers = [
    { w: base * (2 + opts.spread * 0.08), blur: base * 2 + opts.spread * 0.3, o: 70 },
    { w: base * (4 + opts.spread * 0.16), blur: base * 5 + opts.spread * 0.8, o: 45 },
    { w: base * (7 + opts.spread * 0.3), blur: base * 10 + opts.spread * 1.6, o: 30 },
  ];
  layers.forEach((l, i) => {
    const d = ctx.sink.push({ op: 'item.duplicate', ref: subject.ref, to: inside(g, 'bottom'), name: `Neon ${i + 1}` });
    // Outlines (frames, line art) glow along the stroke only; filled art and type glow as a whole.
    ctx.sink.push({ op: 'item.restyle', ref: d, fill: subject.strokeOnly ? { t: 'none' } : { t: 'solid', c: opts.color }, stroke: { c: opts.color, w: l.w }, opacity: l.o, blend: 'screen', recursive: true });
    if (ctx.blur) ctx.sink.push(fxOp(d, { kind: 'blur', radius: l.blur }));
  });
  return { top: g, summary: 'Neon glow added behind the artwork.' };
}
