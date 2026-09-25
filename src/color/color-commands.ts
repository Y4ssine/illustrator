/**
 * Colour commands: brand palette → swatches, gradient styles applied to the
 * selection, generated backgrounds and fade overlays.
 */

import type { CommandPlan, DocumentCommand } from '../core/commands/types';
import { requireDoc, subjectItems, itemBounds } from '../core/commands/helpers';
import { activePalette, layerTop, roleLayer, targetArtboard } from '../core/commands/creative';
import type { GradientStopSpec, HostOp, Paint, Place } from '../core/protocol';
import { shortHash, type OpRef, type OpSink } from '../core/opsink';
import type { Rect } from '../geometry/rect';
import { fxOp } from '../effects/effect-xml';
import { plural } from '../utils/misc';
import { createRng } from '../utils/random';
import { SHAPES, defaultParams } from '../shapes/shape-library';
import { lighten, mix, rotateHue, saturate } from './color-math';
import { darkOf, gradientStyles, lightOf, ramp, type BrandPalette, type GradientStyleId } from './palette-engine';

// ---------------------------------------------------------------------------
// Apply gradient / colour style to the selection
// ---------------------------------------------------------------------------

export type FillStyleId = GradientStyleId | 'primary' | 'secondary' | 'accent' | 'dark' | 'light';

export const SOLID_STYLES: ReadonlyArray<{ id: FillStyleId; name: string }> = [
  { id: 'primary', name: 'Primary' },
  { id: 'secondary', name: 'Secondary' },
  { id: 'accent', name: 'Accent' },
  { id: 'dark', name: 'Dark' },
  { id: 'light', name: 'Light' },
];

export function fillFor(p: BrandPalette, id: FillStyleId): Paint {
  switch (id) {
    case 'primary':
    case 'secondary':
    case 'accent':
    case 'dark':
    case 'light':
      return { t: 'solid', c: p[id] };
    default: {
      const g = gradientStyles(p).find((s) => s.id === id);
      return g ? g.paint : { t: 'solid', c: p.primary };
    }
  }
}

export interface ApplyStyleParams {
  style: FillStyleId;
}

export const colorApplyStyle: DocumentCommand<ApplyStyleParams> = {
  kind: 'document',
  id: 'color.apply',
  title: 'Apply Colour Style',
  category: 'color',
  view: 'color',
  keywords: ['gradient', 'fill', 'brand', 'colour', 'color', 'foil', 'gold', 'duotone', 'fade', 'تدرج', 'لون'],
  description: 'Fill the selected vector art and text with a brand colour or gradient style (from the active palette).',
  defaultParams: () => ({ style: 'brand' }),
  validate(snapshot) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (subjectItems(snapshot).length === 0) return 'Select the vector objects or text to colour.';
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const palette = activePalette(ctx.settings);
    const fill = fillFor(palette, p.style);
    const tx = ctx.host.begin('Apply Colour Style');
    const warnings: string[] = [];
    const items = subjectItems(ctx.snapshot);
    for (const s of items) {
      if (s.kind === 'placed' || s.kind === 'raster') {
        warnings.push('Images cannot be recoloured; use a Fade overlay or Colour grade instead.');
        continue;
      }
      tx.push({ op: 'item.restyle', ref: s.ref, fill, recursive: true });
    }
    return { batch: tx.toBatch(), summary: `Style applied to ${plural(items.length, 'object')}.`, warnings: [...new Set(warnings)] };
  },
};

// ---------------------------------------------------------------------------
// Swatches
// ---------------------------------------------------------------------------

export interface SwatchParams {
  name: string;
  tints: boolean;
}

export const colorSwatches: DocumentCommand<SwatchParams> = {
  kind: 'document',
  id: 'color.swatches',
  title: 'Add Palette to Swatches',
  category: 'color',
  view: 'color',
  keywords: ['swatches', 'palette', 'brand', 'colour group', 'حوامل'],
  description: 'Adds the active palette (and tint ramps) as a named colour group in the Swatches panel.',
  defaultParams: () => ({ name: 'Brand', tints: true }),
  validate: (snapshot) => requireDoc(snapshot),
  async plan(ctx, p): Promise<CommandPlan> {
    const pal = activePalette(ctx.settings);
    const colors: Array<{ name: string; c: string }> = [];
    const add = (name: string, c: string): void => {
      if (!colors.some((x) => x.c === c)) colors.push({ name: `${p.name} ${name}`, c });
    };
    add('Primary', pal.primary);
    add('Secondary', pal.secondary);
    add('Accent', pal.accent);
    add('Dark', pal.dark);
    add('Light', pal.light);
    pal.colors.forEach((c, i) => add(`Colour ${i + 1}`, c.hex));
    if (p.tints) ramp(pal.primary, 5).forEach((c, i) => add(`Primary ${(i + 1) * 20}`, c));
    const tx = ctx.host.begin('Palette to Swatches');
    tx.push({ op: 'swatch.group', name: p.name || 'Brand', colors });
    return { batch: tx.toBatch(), summary: `${plural(colors.length, 'swatch', 'swatches')} added to “${p.name}”.`, warnings: [] };
  },
};

// ---------------------------------------------------------------------------
// Backgrounds
// ---------------------------------------------------------------------------

export type BackgroundStyle = 'aurora' | 'spotlight' | 'linear' | 'duotone' | 'rays' | 'soft';

export const BACKGROUND_STYLES: ReadonlyArray<{ id: BackgroundStyle; name: string; hint: string }> = [
  { id: 'aurora', name: 'Aurora', hint: 'Soft blurred colour clouds from your palette — modern campaign look.' },
  { id: 'spotlight', name: 'Spotlight', hint: 'Dark base with a glowing centre: products, portraits, titles.' },
  { id: 'rays', name: 'Sunburst', hint: 'Radiating rays over a gradient: celebrations and announcements.' },
  { id: 'linear', name: 'Brand gradient', hint: 'Deep brand gradient, top to bottom.' },
  { id: 'duotone', name: 'Duotone split', hint: 'Two brand colours with a soft diagonal transition.' },
  { id: 'soft', name: 'Soft light', hint: 'Light, airy tint — infographics and editorial layouts.' },
];

export interface BackgroundParams {
  style: BackgroundStyle;
  dark: boolean;
  seed: number;
}

const st = (p: number, c: string, o = 100, m = 50): GradientStopSpec => ({ p, c, o, m });

export function buildBackground(pal: BrandPalette, r: Rect, p: BackgroundParams, sink: OpSink, into: Place, blurOk: boolean): OpRef {
  const push = (op: HostOp): OpRef => sink.push(op);
  const base = p.dark ? darkOf(pal.dark) : mix(pal.light, '#FFFFFF', 0.4);
  const g = push({ op: 'group.create', into, name: `BACKGROUND — ${BACKGROUND_STYLES.find((b) => b.id === p.style)?.name ?? p.style}`, tags: { AF_type: 'background', AF_ver: '1', AF_params: JSON.stringify(p) } });
  const inside = (at: 'top' | 'bottom' = 'top') => ({ k: 'inside' as const, ref: g, at });
  const rect = (fill: Paint, name: string, opacity = 100, blend: 'normal' | 'screen' | 'softLight' | 'multiply' | 'overlay' = 'normal') =>
    push({ op: 'shape.rect', x: r.x, y: r.y, w: r.w, h: r.h, into: inside(), fill, opacity, blend, name });
  const clip = (): void => {
    push({ op: 'shape.rect', x: r.x, y: r.y, w: r.w, h: r.h, into: inside('top'), fill: { t: 'none' }, name: 'Artboard clip' });
    push({ op: 'group.clip', ref: g });
  };
  const blur = (ref: OpRef, radius: number): void => {
    if (blurOk) push(fxOp(ref, { kind: 'blur', radius }));
  };
  const D = Math.max(r.w, r.h);
  switch (p.style) {
    case 'linear': {
      const stops = p.dark ? [st(0, mix(pal.primary, pal.dark, 0.35)), st(100, darkOf(pal.dark))] : [st(0, lightOf(pal.primary)), st(100, mix(lightOf(pal.secondary), '#FFFFFF', 0.3))];
      rect({ t: 'linear', stops, angle: 270, name: `AF BG ${shortHash(stops)}` }, 'Gradient');
      break;
    }
    case 'spotlight': {
      rect({ t: 'solid', c: base }, 'Base');
      const glowC = p.dark ? mix(pal.primary, '#FFFFFF', 0.15) : lightOf(pal.primary);
      const stops = [st(0, glowC, 95), st(35, pal.primary, 55, 45), st(70, pal.primary, 12, 40), st(100, pal.primary, 0)];
      push({ op: 'shape.ellipse', cx: r.x + r.w / 2, cy: r.y + r.h * 0.42, w: r.w * 1.3, h: r.h * 0.95, into: inside(), fill: { t: 'radial', stops, name: `AF Spot ${shortHash(stops)}` }, blend: p.dark ? 'screen' : 'normal', opacity: 100, name: 'Spotlight' });
      const vs = [st(0, '#000000', 0), st(55, '#000000', 0, 60), st(100, '#000000', p.dark ? 70 : 18)];
      push({ op: 'shape.ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w * 1.5, h: r.h * 1.5, into: inside(), fill: { t: 'radial', stops: vs, name: `AF Vignette ${shortHash(vs)}` }, blend: 'multiply', opacity: 100, name: 'Vignette' });
      clip();
      break;
    }
    case 'aurora': {
      rect({ t: 'solid', c: base }, 'Base');
      const rng = createRng(p.seed);
      const cols = [pal.primary, pal.secondary, pal.accent, rotateHue(pal.primary, 25), saturate(lighten(pal.accent, 0.1), 1.2)];
      for (let i = 0; i < 6; i++) {
        const c = cols[i % cols.length]!;
        const w = D * rng.range(0.45, 0.85);
        const h = w * rng.range(0.5, 0.9);
        const stops = [st(0, c, p.dark ? 85 : 70), st(55, c, p.dark ? 38 : 30, 45), st(100, c, 0)];
        const e = push({ op: 'shape.ellipse', cx: r.x + rng.range(0.05, 0.95) * r.w, cy: r.y + rng.range(0.05, 0.95) * r.h, w, h, rotation: rng.range(-40, 40), into: inside(), fill: { t: 'radial', stops, name: `AF Aurora ${shortHash(stops)}`, fit: 'ellipse' }, blend: p.dark ? 'screen' : 'normal', opacity: 100, name: `Cloud ${i + 1}` });
        blur(e, w * 0.08);
      }
      clip();
      break;
    }
    case 'duotone': {
      const stops = [st(0, pal.primary), st(46, pal.primary, 100, 60), st(54, pal.secondary, 100, 40), st(100, p.dark ? darkOf(pal.secondary) : pal.secondary)];
      rect({ t: 'linear', stops, angle: 35, name: `AF Duo ${shortHash(stops)}` }, 'Duotone');
      break;
    }
    case 'rays': {
      const stops = p.dark ? [st(0, mix(pal.primary, '#FFFFFF', 0.1)), st(100, darkOf(pal.dark))] : [st(0, lightOf(pal.accent)), st(100, pal.accent)];
      push({ op: 'shape.ellipse', cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: D * 1.6, h: D * 1.6, into: inside(), fill: { t: 'radial', stops, name: `AF Rays BG ${shortHash(stops)}` }, opacity: 100, name: 'Base' });
      const def = SHAPES.find((s) => s.id === 'rays')!;
      const R = D * 0.9;
      const rs = [st(0, '#FFFFFF', p.dark ? 16 : 40), st(100, '#FFFFFF', 0)];
      push({ op: 'shape.path', paths: def.build({ x: r.x + r.w / 2 - R, y: r.y + r.h / 2 - R, w: R * 2, h: R * 2 }, { ...defaultParams(def), rays: 24, width: 50 }), into: inside(), fill: { t: 'radial', stops: rs, name: `AF Rays ${shortHash(rs)}` }, blend: p.dark ? 'screen' : 'softLight', opacity: 100, name: 'Rays' });
      clip();
      break;
    }
    case 'soft': {
      const stops = [st(0, mix(lightOf(pal.primary), '#FFFFFF', 0.5)), st(100, mix(lightOf(pal.secondary), '#FFFFFF', 0.35))];
      rect({ t: 'linear', stops, angle: 300, name: `AF Soft ${shortHash(stops)}` }, 'Tint');
      const c = pal.primary;
      const gs = [st(0, c, 22), st(100, c, 0)];
      const e = push({ op: 'shape.ellipse', cx: r.x + r.w * 0.85, cy: r.y + r.h * 0.12, w: D * 0.7, h: D * 0.7, into: inside(), fill: { t: 'radial', stops: gs, name: `AF Soft glow ${shortHash(gs)}` }, opacity: 100, name: 'Glow' });
      blur(e, D * 0.03);
      clip();
      break;
    }
  }
  return g;
}

export const colorBackground: DocumentCommand<BackgroundParams> = {
  kind: 'document',
  id: 'color.background',
  title: 'Generate Background',
  category: 'color',
  view: 'color',
  supportsPreview: true,
  keywords: ['background', 'aurora', 'gradient', 'spotlight', 'sunburst', 'rays', 'mesh', 'خلفية'],
  description: 'Fill the artboard with a background made from the active palette (aurora, spotlight, sunburst…).',
  defaultParams: () => ({ style: 'aurora', dark: true, seed: 11 }),
  validate: (snapshot) => requireDoc(snapshot),
  async plan(ctx, p): Promise<CommandPlan> {
    const pal = activePalette(ctx.settings);
    const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
    const tx = ctx.host.begin('Background');
    const created = new Set<string>();
    const layer = roleLayer(tx, ctx.snapshot.doc!, ctx.settings, ctx.presets, 'background', 'BACKGROUND', 'bottom', created);
    buildBackground(pal, ab.rect, p, tx, { k: 'layer', name: layer, at: 'bottom' }, ctx.settings.liveBlur && !!ctx.host.info?.capabilities.applyEffect);
    return { batch: tx.toBatch(), summary: `${BACKGROUND_STYLES.find((b) => b.id === p.style)?.name ?? 'Background'} background added.`, warnings: [] };
  },
};

// ---------------------------------------------------------------------------
// Fades
// ---------------------------------------------------------------------------

export type FadeEdge = 'bottom' | 'top' | 'left' | 'right' | 'radial';

export interface FadeParams {
  edge: FadeEdge;
  /** 'dark' | 'primary' | 'accent' | 'light' | '#hex' */
  color: string;
  /** How far the fade reaches into the area, %. */
  length: number;
  strength: number;
  target: 'selection' | 'artboard';
}

function fadeColor(pal: BrandPalette, c: string): string {
  if (c === 'dark' || c === 'primary' || c === 'accent' || c === 'light' || c === 'secondary') return pal[c];
  return /^#[0-9a-f]{6}$/i.test(c) ? c : pal.dark;
}

export function fadePaintFor(edge: FadeEdge, color: string, length: number, strength: number): Paint {
  const L = Math.max(5, Math.min(100, length));
  if (edge === 'radial') {
    const stops = [st(0, color, 0), st(100 - L, color, 0, 55), st(100, color, strength)];
    return { t: 'radial', stops, fit: 'ellipse', name: `AF Fade R ${shortHash(stops)}` };
  }
  // Gradient runs from the faded edge (full colour) into the area (transparent).
  const angle = { bottom: 90, top: 270, left: 0, right: 180 }[edge];
  const stops = [st(0, color, strength), st(L * 0.5, color, strength * 0.55, 45), st(L, color, 0)];
  return { t: 'linear', stops, angle, name: `AF Fade ${shortHash(stops)}` };
}

export const colorFade: DocumentCommand<FadeParams> = {
  kind: 'document',
  id: 'color.fade',
  title: 'Add Fade',
  category: 'color',
  view: 'color',
  supportsPreview: true,
  keywords: ['fade', 'gradient', 'overlay', 'blend', 'text legibility', 'image fade', 'تلاشي'],
  description: 'Fade the selected image/object (or the artboard edge) into a brand colour — for text legibility and seamless blends.',
  defaultParams: () => ({ edge: 'bottom', color: 'dark', length: 55, strength: 90, target: 'selection' }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (p.target === 'selection' && subjectItems(snapshot).length === 0) return 'Select the image or object to fade (or switch the target to the artboard).';
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const pal = activePalette(ctx.settings);
    const color = fadeColor(pal, p.color);
    const tx = ctx.host.begin('Fade');
    const fill = fadePaintFor(p.edge, color, p.length, p.strength);
    let n = 0;
    if (p.target === 'selection') {
      for (const s of subjectItems(ctx.snapshot)) {
        const r = itemBounds(s, ctx.settings);
        tx.push({ op: 'shape.rect', x: r.x, y: r.y, w: r.w, h: r.h, into: { k: 'above', ref: s.ref }, fill, name: 'FADE', tags: { AF_type: 'decor', AF_ver: '1', AF_params: JSON.stringify(p) } });
        n++;
      }
    } else {
      const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
      const created = new Set<string>();
      const layer = roleLayer(tx, ctx.snapshot.doc!, ctx.settings, ctx.presets, 'atmosphere', 'ATMOSPHERE', 'top', created);
      const r = ab.rect;
      tx.push({ op: 'shape.rect', x: r.x, y: r.y, w: r.w, h: r.h, into: layerTop(layer), fill, name: 'FADE — artboard', tags: { AF_type: 'decor', AF_ver: '1', AF_params: JSON.stringify(p) } });
      n = 1;
    }
    return { batch: tx.toBatch(), summary: `${plural(n, 'fade')} added.`, warnings: [] };
  },
};

export const COLOR_COMMANDS = [colorApplyStyle, colorSwatches, colorBackground, colorFade];
