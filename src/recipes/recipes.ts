/**
 * Design recipes: complete, editable starting compositions built on the
 * target artboard in one undo step — background, frames, lighting, shadow
 * placeholders and live type — all from the active palette and scene light.
 * Every part lands on a named layer (BACKGROUND, DECORATIONS, LIGHTING,
 * TYPOGRAPHY…) and is tagged, so the designer keeps full control.
 */

import type { CommandPlan, DocumentCommand, PlanContext } from '../core/commands/types';
import { requireDoc } from '../core/commands/helpers';
import { activePalette, fontStacks, layerTop, roleLayer, targetArtboard } from '../core/commands/creative';
import type { HostTransaction } from '../core/host';
import type { Paint } from '../core/protocol';
import type { OpRef } from '../core/opsink';
import { shortHash } from '../core/opsink';
import type { Rect } from '../geometry/rect';
import { ellipsePath, roundedRectPath } from '../geometry/path';
import { mix, onColor } from '../color/color-math';
import { darkOf, goldFoilPaint, gradientStyles, lightOf, type BrandPalette } from '../color/palette-engine';
import { buildBackground, type BackgroundStyle } from '../color/color-commands';
import { findShape, defaultParams } from '../shapes/shape-library';
import * as L from '../effects/light-engine';
import { buildShadow, sanitizeShadowParams } from '../effects/shadow-engine';
import { planInfo, defaultInfoParams } from '../infographic/info-commands';
import type { LayerRole } from '../layers/naming';

export type RecipeId = 'campaign-hero' | 'product-spotlight' | 'infographic-poster' | 'celebration' | 'quote-card';

export const RECIPES: ReadonlyArray<{ id: RecipeId; name: string; hint: string }> = [
  { id: 'campaign-hero', name: 'Campaign hero', hint: 'Glowing arch frame, aurora background, light rays and a headline — national days, launches, events.' },
  { id: 'product-spotlight', name: 'Product spotlight', hint: 'Studio stage with floor, key light, rim, ground shadow and a product placeholder.' },
  { id: 'infographic-poster', name: 'Infographic poster', hint: 'Header, stat cards, donut and steps on a soft background — replace the data.' },
  { id: 'celebration', name: 'Celebration post', hint: 'Sunburst, ribbon banner, sparkles and a big title — Eid, anniversaries, offers.' },
  { id: 'quote-card', name: 'Quote / announcement', hint: 'Frosted glass card over a brand gradient with a badge and quote text.' },
];

export interface RecipeParams {
  recipe: RecipeId;
  dark: boolean;
  headline: string;
  subline: string;
  seed: number;
}

interface Kit {
  tx: HostTransaction;
  ctx: PlanContext;
  pal: BrandPalette;
  ab: Rect;
  rtl: boolean;
  blur: boolean;
  layer(role: LayerRole, fallback: string, anchor?: 'top' | 'bottom'): string;
}

function text(k: Kit, layer: string, x: number, y: number, contents: string, size: number, color: string, bold: boolean, name: string, align: 'left' | 'center' | 'right' = 'center'): OpRef {
  const fonts = fontStacks(k.ctx.settings, k.rtl);
  return k.tx.push({ op: 'text.point', x, y: y + size * 0.82, contents, size, color, fonts: bold ? fonts.bold : fonts.regular, weight: bold ? 700 : 400, align, rtl: k.rtl, into: layerTop(layer), name });
}

function shapeAt(k: Kit, layer: string, id: string, box: Rect, fill: Paint, name: string, over: Record<string, number> = {}, stroke?: { c: string; w: number }): OpRef {
  const def = findShape(id)!;
  return k.tx.push({ op: 'shape.path', paths: def.build(box, { ...defaultParams(def), ...over }), into: layerTop(layer), fill, ...(stroke ? { stroke } : {}), name });
}

function lightCtx(k: Kit, rig: L.LightRig, seed: number): L.LightContext {
  return { sink: k.tx, rig, area: k.ab, into: layerTop(k.layer('lighting', 'LIGHTING', 'top')), blur: k.blur, seed };
}

function campaignHero(k: Kit, p: RecipeParams): void {
  const { ab, pal } = k;
  buildBackground(pal, ab, { style: 'aurora', dark: p.dark, seed: p.seed }, k.tx, { k: 'layer', name: k.layer('background', 'BACKGROUND', 'bottom'), at: 'bottom' }, k.blur);
  const deco = k.layer('decorations', 'DECORATIONS');
  const aw = ab.w * 0.56;
  const ah = aw * 1.45;
  const arch: Rect = { x: ab.x + (ab.w - aw) / 2, y: ab.y + ab.h * 0.12, w: aw, h: Math.min(ah, ab.h * 0.6) };
  const inner = gradientStyles(pal).find((g) => g.id === 'deep')!.paint;
  const archRef = shapeAt(k, deco, 'pointedArch', arch, inner, 'Arch', { sharpness: 55 });
  const frame = shapeAt(k, deco, 'pointedArch', { x: arch.x - aw * 0.035, y: arch.y - aw * 0.035, w: arch.w + aw * 0.07, h: arch.h + aw * 0.07 }, { t: 'none' }, 'Neon frame', { sharpness: 55 }, { c: mix(lightOf(pal.accent), '#FFFFFF', 0.3), w: Math.max(2, aw * 0.012) });
  const rig: L.LightRig = { ...k.ctx.settings.lightRig, angle: 0, elevation: 30, intensity: 85, softness: 65, color: pal.accent };
  const lc = lightCtx(k, rig, p.seed);
  L.backGlow(lc, arch, { k: 'below', ref: archRef }, { size: 170, blend: 'screen' });
  L.neon(lc, { ref: frame, strokeWidth: Math.max(2, aw * 0.012), strokeOnly: true }, { k: 'below', ref: frame }, { color: lightOf(pal.accent), spread: 45 });
  L.beams({ ...lc, rig: { ...rig, angle: 0 } }, { count: 7, spread: 50, length: 85, width: 55, blend: 'screen' });
  L.bokeh(lc, { count: 30, minSize: ab.w * 0.006, maxSize: ab.w * 0.05, blend: 'screen' });
  L.vignette(lc, { color: '#000000', strength: p.dark ? 65 : 25, softness: 60, blend: 'multiply' });
  const type = k.layer('typography', 'TYPOGRAPHY', 'top');
  const hs = ab.w * 0.075;
  const ty = arch.y + arch.h + ab.h * 0.06;
  text(k, type, ab.x + ab.w / 2, ty, p.headline, hs, p.dark ? '#FFFFFF' : pal.dark, true, 'Headline');
  text(k, type, ab.x + ab.w / 2, ty + hs * 1.4, p.subline, hs * 0.42, p.dark ? mix('#FFFFFF', pal.accent, 0.35) : pal.primary, false, 'Subline');
}

function productSpotlight(k: Kit, p: RecipeParams): void {
  const { ab, pal } = k;
  buildBackground(pal, ab, { style: 'spotlight', dark: p.dark, seed: p.seed }, k.tx, { k: 'layer', name: k.layer('background', 'BACKGROUND', 'bottom'), at: 'bottom' }, k.blur);
  const mid = k.layer('midground', 'MIDGROUND');
  // Floor: an ellipse "stage" whose far edge fades into the background.
  const floorY = ab.y + ab.h * 0.7;
  const stops = [
    { p: 0, c: mix(pal.primary, '#FFFFFF', p.dark ? 0.1 : 0.6), o: 100 },
    { p: 70, c: p.dark ? darkOf(pal.dark) : lightOf(pal.primary), o: 60, m: 45 },
    { p: 100, c: p.dark ? darkOf(pal.dark) : lightOf(pal.primary), o: 0 },
  ];
  k.tx.push({ op: 'shape.ellipse', cx: ab.x + ab.w / 2, cy: floorY, w: ab.w * 0.95, h: ab.h * 0.16, into: layerTop(mid), fill: { t: 'radial', stops, name: `AF Stage ${shortHash(stops)}` }, name: 'Stage', opacity: 100 });
  const sub = k.layer('subject', 'SUBJECT');
  const pw = ab.w * 0.24;
  const ph = ab.h * 0.36;
  const prod: Rect = { x: ab.x + (ab.w - pw) / 2, y: floorY - ph, w: pw, h: ph };
  const foil = gradientStyles(pal).find((g) => g.id === 'foil')!.paint;
  const productRef = k.tx.push({ op: 'shape.path', paths: [roundedRectPath(prod, pw * 0.18)], into: layerTop(sub), fill: foil, name: 'PRODUCT (replace me)' });
  const rig: L.LightRig = { ...k.ctx.settings.lightRig, angle: 320, elevation: 45, kelvin: 5200, color: null, intensity: 70, softness: 75 };
  const lc = lightCtx(k, rig, p.seed);
  L.floorGlow(lc, prod, { k: 'below', ref: productRef }, { width: 260, blend: 'screen' });
  // Placed last so it sits directly under the product, above the floor glow.
  buildShadow({ sink: k.tx, subject: { rect: prod, ref: productRef, kind: 'path', name: 'Product' }, params: sanitizeShadowParams({ style: 'ground', subject: 'product', lightAngle: rig.angle, elevation: rig.elevation, strength: 78, color: mix(pal.dark, '#000000', 0.6) }), place: { k: 'below', ref: productRef }, tags: { AF_type: 'groundShadow', AF_ver: '1' }, blurOk: k.blur, artboard: ab });
  L.rimLight(lc, { ref: productRef, rect: prod, vector: true }, { k: 'above', ref: productRef }, { width: 35, blend: 'screen' });
  L.keySpot(lc, { size: 70, blend: 'screen' });
  L.vignette(lc, { color: '#000000', strength: p.dark ? 55 : 20, softness: 60, blend: 'multiply' });
  const type = k.layer('typography', 'TYPOGRAPHY', 'top');
  const hs = ab.w * 0.07;
  text(k, type, ab.x + ab.w / 2, ab.y + ab.h * 0.08, p.headline, hs, p.dark ? '#FFFFFF' : pal.dark, true, 'Headline');
  text(k, type, ab.x + ab.w / 2, ab.y + ab.h * 0.08 + hs * 1.35, p.subline, hs * 0.42, p.dark ? lightOf(pal.accent) : pal.primary, false, 'Subline');
}

function infographicPoster(k: Kit, p: RecipeParams): void {
  const { ab, pal } = k;
  buildBackground(pal, ab, { style: 'soft', dark: false, seed: p.seed }, k.tx, { k: 'layer', name: k.layer('background', 'BACKGROUND', 'bottom'), at: 'bottom' }, k.blur);
  if (!k.ctx.snapshot.doc!.layers.some((l) => l.name === 'INFOGRAPHIC')) k.tx.layers.ensure('INFOGRAPHIC', { anchor: 'top' });
  const into = { k: 'layer' as const, name: 'INFOGRAPHIC', at: 'top' as const };
  const m = ab.w * 0.08;
  const W = ab.w - 2 * m;
  const s = k.ctx.settings;
  let y = ab.y + m;
  const block = (id: Parameters<typeof defaultInfoParams>[0], h: number, over: Partial<ReturnType<typeof defaultInfoParams>> = {}): void => {
    planInfo(s, { ...defaultInfoParams(id, s), ...over }, { x: ab.x + m, y, w: W, h }, k.tx, into);
    y += h + ab.h * 0.035;
  };
  const H = ab.h - 2 * m;
  block('header', H * 0.15, { title: p.headline, subtitle: p.subline });
  block('statCards', H * 0.21);
  block('donut', H * 0.25);
  block('steps', H * 0.24);
  void pal;
}

function celebration(k: Kit, p: RecipeParams): void {
  const { ab, pal } = k;
  buildBackground(pal, ab, { style: 'rays' as BackgroundStyle, dark: p.dark, seed: p.seed }, k.tx, { k: 'layer', name: k.layer('background', 'BACKGROUND', 'bottom'), at: 'bottom' }, k.blur);
  const deco = k.layer('decorations', 'DECORATIONS');
  const bw = ab.w * 0.46;
  const badge: Rect = { x: ab.x + (ab.w - bw) / 2, y: ab.y + ab.h * 0.16, w: bw, h: bw };
  const badgeRef = shapeAt(k, deco, 'star8', badge, goldFoilPaint(30), 'Badge');
  const centre = gradientStyles(pal).find((g) => g.id === 'deep')!.paint;
  k.tx.push({ op: 'shape.path', paths: [ellipsePath(badge.x + bw / 2, badge.y + bw / 2, bw * 0.34, bw * 0.34)], into: layerTop(deco), fill: centre, stroke: { c: '#F3E1A4', w: Math.max(1.5, bw * 0.012) }, name: 'Badge centre' });
  const rw = ab.w * 0.8;
  const def = findShape('ribbon')!;
  const rbox: Rect = { x: ab.x + (ab.w - rw) / 2, y: badge.y + bw * 0.98, w: rw, h: rw / 4.2 };
  const rg = k.tx.push({ op: 'group.create', into: layerTop(deco), name: 'Ribbon' });
  for (const part of def.parts!(rbox, defaultParams(def))) {
    k.tx.push({ op: 'shape.path', paths: part.shape, into: { k: 'inside', ref: rg, at: 'top' }, fill: { t: 'solid', c: part.shade ? mix(pal.primary, '#000000', -part.shade * 2) : pal.primary }, name: part.name });
  }
  const rig: L.LightRig = { ...k.ctx.settings.lightRig, angle: 0, elevation: 30, intensity: 80, softness: 60, color: lightOf(pal.accent) };
  const lc = lightCtx(k, rig, p.seed);
  L.backGlow(lc, badge, { k: 'below', ref: badgeRef }, { size: 190, blend: 'screen' });
  L.bokeh(lc, { count: 36, minSize: ab.w * 0.005, maxSize: ab.w * 0.035, blend: 'screen' });
  const type = k.layer('typography', 'TYPOGRAPHY', 'top');
  const hs = ab.w * 0.12;
  text(k, type, badge.x + bw / 2, badge.y + bw / 2 - hs * 0.55, p.headline.split(/\s+/)[0] ?? p.headline, hs * 0.7, '#FFFFFF', true, 'Badge text');
  text(k, type, ab.x + ab.w / 2, rbox.y + rbox.h * 0.18, p.headline, rbox.h * 0.32, onColor(pal.primary), true, 'Ribbon text');
  text(k, type, ab.x + ab.w / 2, rbox.y + rbox.h * 1.35, p.subline, ab.w * 0.035, p.dark ? '#FFFFFF' : pal.dark, false, 'Subline');
}

function quoteCard(k: Kit, p: RecipeParams): void {
  const { ab, pal } = k;
  buildBackground(pal, ab, { style: 'duotone', dark: p.dark, seed: p.seed }, k.tx, { k: 'layer', name: k.layer('background', 'BACKGROUND', 'bottom'), at: 'bottom' }, k.blur);
  const deco = k.layer('decorations', 'DECORATIONS');
  const cw = ab.w * 0.78;
  const ch = ab.h * 0.5;
  const card: Rect = { x: ab.x + (ab.w - cw) / 2, y: ab.y + (ab.h - ch) / 2, w: cw, h: ch };
  const glass: Paint = { t: 'linear', stops: [{ p: 0, c: '#FFFFFF', o: 38 }, { p: 100, c: '#FFFFFF', o: 10 }], angle: 300, name: 'AF Glass card' };
  const cardRef = k.tx.push({ op: 'shape.path', paths: [roundedRectPath(card, cw * 0.06)], into: layerTop(deco), fill: glass, stroke: { c: '#FFFFFF', w: Math.max(1, cw * 0.003) }, name: 'Glass card' });
  buildShadow({ sink: k.tx, subject: { rect: card, ref: cardRef, kind: 'path', name: 'Card' }, params: sanitizeShadowParams({ style: 'floating', subject: 'card', floatMode: 'card', lift: 25, strength: 55, softness: 75, color: darkOf(pal.dark) }), place: { k: 'below', ref: cardRef }, tags: { AF_type: 'elevationShadow', AF_ver: '1' }, blurOk: k.blur, artboard: ab });
  const bd = cw * 0.2;
  shapeAt(k, deco, 'sealRing', { x: card.x + cw / 2 - bd / 2, y: card.y - bd / 2, w: bd, h: bd }, goldFoilPaint(35), 'Badge');
  const type = k.layer('typography', 'TYPOGRAPHY', 'top');
  const fonts = fontStacks(k.ctx.settings, k.rtl);
  k.tx.push({ op: 'text.area', x: card.x + cw * 0.1, y: card.y + ch * 0.22, w: cw * 0.8, h: ch * 0.5, contents: p.headline, size: cw * 0.065, color: '#FFFFFF', fonts: fonts.bold, weight: 700, align: 'center', rtl: k.rtl, leading: cw * 0.09, into: layerTop(type), name: 'Quote' });
  text(k, type, card.x + cw / 2, card.y + ch * 0.8, p.subline, cw * 0.035, mix('#FFFFFF', pal.accent, 0.3), false, 'Author');
}

export const recipeBuild: DocumentCommand<RecipeParams> = {
  kind: 'document',
  id: 'recipe.build',
  title: 'Build Design Recipe',
  category: 'create',
  view: 'create',
  supportsPreview: true,
  keywords: ['template', 'recipe', 'composition', 'poster', 'campaign', 'hero', 'product', 'celebration', 'quote', 'infographic', 'قالب', 'تصميم'],
  description: 'Build a complete, editable composition on the artboard (background, frames, lighting, type) from your palette.',
  defaultParams: ({ settings }) => {
    const ar = settings.direction === 'rtl';
    return { recipe: 'campaign-hero', dark: true, headline: ar ? 'عنوان الحملة هنا' : 'Your headline here', subline: ar ? 'سطر وصفي قصير يوضح الرسالة' : 'A short line that supports the message', seed: 5 };
  },
  validate: (snapshot) => requireDoc(snapshot),
  async plan(ctx, p): Promise<CommandPlan> {
    const tx = ctx.host.begin(`Recipe: ${RECIPES.find((r) => r.id === p.recipe)?.name ?? p.recipe}`);
    const created = new Set<string>();
    const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
    const rtl = /[؀-ۿ]/.test(`${p.headline}${p.subline}`) || (ctx.settings.direction === 'rtl' && !/[A-Za-z]/.test(p.headline));
    const k: Kit = {
      tx,
      ctx,
      pal: activePalette(ctx.settings),
      ab: ab.rect,
      rtl,
      blur: ctx.settings.liveBlur && !!ctx.host.info?.capabilities.applyEffect,
      layer: (role, fallback, anchor = 'top') => roleLayer(tx, ctx.snapshot.doc!, ctx.settings, ctx.presets, role, fallback, anchor, created),
    };
    switch (p.recipe) {
      case 'campaign-hero':
        campaignHero(k, p);
        break;
      case 'product-spotlight':
        productSpotlight(k, p);
        break;
      case 'infographic-poster':
        infographicPoster(k, p);
        break;
      case 'celebration':
        celebration(k, p);
        break;
      case 'quote-card':
        quoteCard(k, p);
        break;
    }
    const warnings = k.blur ? [] : ['Live blur is off or unavailable: glows use their vector gradients only (softer look with blur on in Settings).'];
    return { batch: tx.toBatch({ keepSelection: false }), summary: `${RECIPES.find((r) => r.id === p.recipe)?.name} built on “${ctx.snapshot.doc!.artboards.find((a) => a.index === ab.index)?.name ?? 'artboard'}”.`, warnings };
  },
};

export const RECIPE_COMMANDS = [recipeBuild];
