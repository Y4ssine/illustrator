/**
 * Palette engine: colours extracted from a selection (e.g. a vector logo) →
 * clustered, ranked palette with roles → harmonies, tint/shade ramps and
 * ready-to-use gradient styles.
 */

import { hexToRgb, normalizeHex, rgbToHex } from '../utils/color';
import type { GradientStopSpec, Paint } from '../core/protocol';
import { chroma, deltaE, hexToHsl, hslToHex, lighten, lightness, mix, oklabToRgb, rgbToOklab, rotateHue, saturate } from './color-math';

export interface ColorSample {
  hex: string;
  /** Relative importance, e.g. the area of the object using it. */
  weight: number;
}

export type ColorRole = 'primary' | 'secondary' | 'accent' | 'neutral' | 'dark' | 'light';

export interface PaletteColor {
  hex: string;
  weight: number;
  role: ColorRole | null;
}

export interface BrandPalette {
  colors: PaletteColor[];
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  light: string;
}

const NEUTRAL_CHROMA = 0.035;

/** Merge perceptually close colours (weighted average in OKLab). */
export function clusterColors(samples: readonly ColorSample[], threshold = 0.06): ColorSample[] {
  const clusters: Array<{ L: number; a: number; b: number; w: number }> = [];
  const sorted = [...samples].filter((s) => normalizeHex(s.hex) && s.weight > 0).sort((a, b) => b.weight - a.weight);
  for (const s of sorted) {
    const c = rgbToOklab(hexToRgb(s.hex));
    const hit = clusters.find((k) => Math.hypot(k.L - c.L, k.a - c.a, k.b - c.b) < threshold);
    if (hit) {
      const w = hit.w + s.weight;
      hit.L = (hit.L * hit.w + c.L * s.weight) / w;
      hit.a = (hit.a * hit.w + c.a * s.weight) / w;
      hit.b = (hit.b * hit.w + c.b * s.weight) / w;
      hit.w = w;
    } else clusters.push({ ...c, w: s.weight });
  }
  return clusters.sort((a, b) => b.w - a.w).map((k) => ({ hex: rgbToHex(oklabToRgb(k)), weight: k.w }));
}

export function extractPalette(samples: readonly ColorSample[], maxColors = 8): BrandPalette {
  const clusters = clusterColors(samples).slice(0, 24);
  if (clusters.length === 0) throw new Error('No solid colours found in the selection.');
  const total = clusters.reduce((s, c) => s + c.weight, 0) || 1;
  const chromatic = clusters.filter((c) => chroma(c.hex) >= NEUTRAL_CHROMA);
  const neutrals = clusters.filter((c) => chroma(c.hex) < NEUTRAL_CHROMA);
  const primary = chromatic[0]?.hex ?? clusters[0]!.hex;
  const secondary = chromatic.find((c) => deltaE(c.hex, primary) > 0.12)?.hex ?? rotateHue(primary, 30);
  // Accent: the most colourful remaining colour, otherwise the complement of the primary.
  const accentCand = chromatic.filter((c) => c.hex !== primary && c.hex !== secondary).sort((a, b) => chroma(b.hex) - chroma(a.hex))[0];
  const accent = accentCand?.hex ?? saturate(rotateHue(primary, 180), 1.1);
  const byL = [...clusters].sort((a, b) => lightness(a.hex) - lightness(b.hex));
  const dark = lightness(byL[0]!.hex) < 0.3 ? byL[0]!.hex : darkOf(primary);
  const light = lightness(byL[byL.length - 1]!.hex) > 0.93 ? byL[byL.length - 1]!.hex : lightOf(primary);
  const roleOf = (hex: string): ColorRole | null =>
    hex === primary ? 'primary' : hex === secondary ? 'secondary' : hex === accent ? 'accent' : hex === dark ? 'dark' : hex === light ? 'light' : chroma(hex) < NEUTRAL_CHROMA ? 'neutral' : null;
  const colors: PaletteColor[] = [...chromatic, ...neutrals].slice(0, maxColors).map((c) => ({ hex: c.hex, weight: c.weight / total, role: roleOf(c.hex) }));
  return { colors, primary, secondary, accent, dark, light };
}

export function paletteFromHexes(hexes: readonly string[]): BrandPalette {
  return extractPalette(hexes.map((hex, i) => ({ hex, weight: hexes.length - i })));
}

export function darkOf(hex: string): string {
  const L = lightness(hex);
  return lighten(saturate(hex, 0.8), Math.min(0, 0.2 - L));
}

export function lightOf(hex: string): string {
  const L = lightness(hex);
  return lighten(saturate(hex, 0.35), Math.max(0, 0.96 - L));
}

export type Harmony = 'complementary' | 'split' | 'analogous' | 'triadic' | 'tetradic' | 'monochrome';

export function harmony(base: string, kind: Harmony): string[] {
  switch (kind) {
    case 'complementary':
      return [base, rotateHue(base, 180)];
    case 'split':
      return [base, rotateHue(base, 150), rotateHue(base, 210)];
    case 'analogous':
      return [rotateHue(base, -30), base, rotateHue(base, 30)];
    case 'triadic':
      return [base, rotateHue(base, 120), rotateHue(base, 240)];
    case 'tetradic':
      return [base, rotateHue(base, 90), rotateHue(base, 180), rotateHue(base, 270)];
    case 'monochrome':
      return ramp(base, 5);
  }
}

/** Tint/shade ramp in perceptual lightness (lightest first). */
export function ramp(base: string, steps = 9): string[] {
  const out: string[] = [];
  const baseL = lightness(base);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const targetL = 0.97 - t * (0.97 - 0.18);
    const chromaScale = 1 - Math.abs(targetL - baseL) * 0.9;
    out.push(lighten(saturate(base, Math.max(0.25, chromaScale)), targetL - baseL));
  }
  return out;
}

/** Series colours for charts: palette first, then rotations that stay distinct. */
export function seriesColors(p: BrandPalette, n: number): string[] {
  const base = [p.primary, p.accent, p.secondary, ...p.colors.filter((c) => c.role === null).map((c) => c.hex)];
  const out: string[] = [];
  for (const c of base) if (!out.some((o) => deltaE(o, c) < 0.08)) out.push(c);
  let k = 1;
  while (out.length < n) {
    const cand = rotateHue(p.primary, (k * 137.5) % 360);
    if (!out.some((o) => deltaE(o, cand) < 0.08)) out.push(cand);
    k++;
    if (k > 60) out.push(lighten(p.primary, (out.length % 3) * 0.1));
  }
  return out.slice(0, n);
}

// ---------------------------------------------------------------------------
// Gradient styles
// ---------------------------------------------------------------------------

export type GradientStyleId = 'brand' | 'deep' | 'glow' | 'duotone' | 'fade' | 'foil' | 'glass' | 'sunset' | 'mono';

export interface GradientStyle {
  id: GradientStyleId;
  name: string;
  description: string;
  paint: Extract<Paint, { t: 'radial' | 'linear' }>;
}

const stop = (p: number, c: string, o = 100, m = 50): GradientStopSpec => ({ p, c, o, m });

export const GOLD_FOIL = ['#7A5A22', '#E9D08A', '#A67C35', '#FFF2C2', '#8E6A2B'];

/** Classic gold foil (independent of the palette) — badges, frames, premium accents. */
export function goldFoilPaint(angle = 30): GradientStyle['paint'] {
  const stops = GOLD_FOIL.map((c, i) => stop(i * 25, c));
  return { t: 'linear', stops, angle, name: 'AF Gold Foil' };
}

export function gradientStyles(p: BrandPalette): GradientStyle[] {
  const key = p.primary.replace('#', '');
  const g = (id: GradientStyleId, name: string, description: string, t: 'linear' | 'radial', stops: GradientStopSpec[], angle?: number): GradientStyle => ({
    id,
    name,
    description,
    paint: { t, stops, name: `AF ${name} ${key}`, ...(angle !== undefined ? { angle } : {}) },
  });
  return [
    g('brand', 'Brand', 'Primary → secondary, perceptual blend', 'linear', [stop(0, p.primary), stop(50, mix(p.primary, p.secondary, 0.5)), stop(100, p.secondary)], 45),
    g('deep', 'Deep', 'Dark base rising into the primary colour', 'linear', [stop(0, p.dark), stop(100, p.primary, 100, 40)], 90),
    g('glow', 'Glow', 'Radial: light centre → primary → dark edge', 'radial', [stop(0, lightOf(p.primary)), stop(45, p.primary), stop(100, p.dark)]),
    g('duotone', 'Duotone', 'Primary ↔ accent', 'linear', [stop(0, p.primary), stop(100, p.accent)], 135),
    g('fade', 'Fade', 'Primary fading to transparent', 'linear', [stop(0, p.primary, 100), stop(100, p.primary, 0)], 90),
    g('foil', 'Foil', 'Metallic sheen built from the primary colour', 'linear', [
      stop(0, darkOf(p.primary)),
      stop(28, lighten(p.primary, 0.12)),
      stop(52, p.primary),
      stop(74, lightOf(p.primary)),
      stop(100, darkOf(p.primary)),
    ], 30),
    g('glass', 'Glass', 'White sheen for frosted panels', 'linear', [stop(0, '#FFFFFF', 55), stop(100, '#FFFFFF', 8)], 120),
    g('sunset', 'Sunset', 'Accent → primary through a warm midpoint', 'linear', [stop(0, p.accent), stop(50, mix(p.accent, '#FF9A3C', 0.35)), stop(100, p.primary)], 90),
    g('mono', 'Mono', 'Light → dark tints of the primary', 'linear', [stop(0, lightOf(p.primary)), stop(100, darkOf(p.primary))], 90),
  ];
}

/** CSS preview of a gradient paint (panel swatches). */
export function paintToCss(paint: Paint): string {
  if (paint.t === 'none') return 'transparent';
  if (paint.t === 'solid') return paint.c;
  const stops = paint.stops.map((s) => {
    const { r, g, b } = hexToRgb(s.c);
    return `rgba(${r},${g},${b},${s.o / 100}) ${s.p}%`;
  });
  return paint.t === 'radial' ? `radial-gradient(circle, ${stops.join(', ')})` : `linear-gradient(${90 - (paint.angle ?? 0)}deg, ${stops.join(', ')})`;
}

export function describeHsl(hex: string): string {
  const h = hexToHsl(hex);
  return `H${Math.round(h.h)} S${Math.round(h.s * 100)} L${Math.round(h.l * 100)}`;
}

export { hslToHex };
