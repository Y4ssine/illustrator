/**
 * Insert ready-made shapes, styled from the active palette (solid, brand
 * gradients, foil, glass, outline, neon) with optional native effects.
 */

import type { CommandPlan, DocumentCommand } from '../core/commands/types';
import { requireDoc, subjectItems } from '../core/commands/helpers';
import { activePalette, layerTop, roleLayer, selectionRect, targetArtboard } from '../core/commands/creative';
import type { Paint, Place, StrokeSpec } from '../core/protocol';
import { shortHash } from '../core/opsink';
import { fxOp } from '../effects/effect-xml';
import { lightColor, neon } from '../effects/light-engine';
import type { Rect } from '../geometry/rect';
import { lighten, mix } from '../color/color-math';
import { lightOf } from '../color/palette-engine';
import { fillFor, type FillStyleId } from '../color/color-commands';
import { defaultParams, findShape, SHAPES } from './shape-library';

export type ShapeStyleId = FillStyleId | 'outline' | 'neon' | 'glass';

export const SHAPE_STYLES: ReadonlyArray<{ id: ShapeStyleId; name: string }> = [
  { id: 'primary', name: 'Primary' },
  { id: 'accent', name: 'Accent' },
  { id: 'brand', name: 'Brand gradient' },
  { id: 'deep', name: 'Deep' },
  { id: 'glow', name: 'Glow' },
  { id: 'duotone', name: 'Duotone' },
  { id: 'foil', name: 'Foil' },
  { id: 'fade', name: 'Fade' },
  { id: 'glass', name: 'Glass' },
  { id: 'outline', name: 'Outline' },
  { id: 'neon', name: 'Neon' },
];

export type ShapeFx = 'none' | 'shadow' | 'glow' | 'innerGlow';

export interface ShapeInsertParams {
  shapeId: string;
  params: Record<string, number>;
  style: ShapeStyleId;
  fx: ShapeFx;
  /** Size as % of the artboard's shorter side (ignored when fitting the selection). */
  size: number;
  /** Fit to the selected object's bounds instead of centring on the artboard. */
  fitSelection: boolean;
}

function boxFor(aspect: number, area: Rect, sizePct: number): Rect {
  const s = (Math.min(area.w, area.h) * Math.max(5, Math.min(150, sizePct))) / 100;
  const w = aspect >= 1 ? s : s * aspect;
  const h = aspect >= 1 ? s / aspect : s;
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

export const shapeInsert: DocumentCommand<ShapeInsertParams> = {
  kind: 'document',
  id: 'shape.insert',
  title: 'Insert Shape',
  category: 'create',
  view: 'create',
  supportsPreview: true,
  keywords: ['shape', 'arch', 'frame', 'badge', 'star', 'ribbon', 'label', 'blob', 'wave', 'divider', 'شكل', 'قوس', 'إطار'],
  description: 'Insert a ready-made shape (arches, frames, badges, ribbons, dividers…) styled from your palette.',
  defaultParams: () => ({ shapeId: 'pointedArch', params: defaultParams(SHAPES.find((s) => s.id === 'pointedArch')!), style: 'brand', fx: 'none', size: 45, fitSelection: false }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (!findShape(p.shapeId)) return 'Unknown shape.';
    if (p.fitSelection && subjectItems(snapshot).length === 0) return 'Select an object to fit the shape to (or turn “Fit selection” off).';
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const def = findShape(p.shapeId)!;
    const pal = activePalette(ctx.settings);
    const params = { ...defaultParams(def), ...p.params };
    const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
    const sel = p.fitSelection ? selectionRect(ctx.snapshot, ctx.settings) : null;
    const box = sel ?? boxFor(def.aspect, ab.rect, p.size);
    const tx = ctx.host.begin(`Insert ${def.name}`);
    const created = new Set<string>();
    const first = subjectItems(ctx.snapshot)[0];
    const into: Place = p.fitSelection && first ? { k: 'above', ref: first.ref } : layerTop(roleLayer(tx, ctx.snapshot.doc!, ctx.settings, ctx.presets, 'decorations', 'DECORATIONS', 'top', created));
    const minSide = Math.min(box.w, box.h);
    let fill: Paint;
    let stroke: StrokeSpec | undefined;
    let opacity = 100;
    switch (p.style) {
      case 'outline':
        fill = { t: 'none' };
        stroke = { c: pal.primary, w: Math.max(1.5, minSide * 0.012) };
        break;
      case 'neon':
        fill = { t: 'none' };
        stroke = { c: mix(lightOf(pal.accent), '#FFFFFF', 0.35), w: Math.max(2, minSide * 0.014) };
        break;
      case 'glass': {
        const stops = [
          { p: 0, c: '#FFFFFF', o: 42 },
          { p: 100, c: '#FFFFFF', o: 8 },
        ];
        fill = { t: 'linear', stops, angle: 300, name: `AF Glass ${shortHash(stops)}` };
        stroke = { c: '#FFFFFF', w: Math.max(0.75, minSide * 0.004) };
        opacity = 90;
        break;
      }
      default:
        fill = fillFor(pal, p.style);
    }
    const tags = { AF_type: 'shape', AF_ver: '1', AF_params: JSON.stringify({ shapeId: def.id, params, style: p.style, fx: p.fx }) };
    let top;
    if (def.parts) {
      top = tx.push({ op: 'group.create', into, name: def.name, tags });
      for (const part of def.parts(box, params)) {
        const partFill: Paint = part.shade !== 0 && fill.t === 'solid' ? { t: 'solid', c: lighten(fill.c, part.shade) } : part.shade !== 0 && fill.t !== 'none' ? { t: 'solid', c: lighten(pal.primary, part.shade) } : fill;
        tx.push({ op: 'shape.path', paths: part.shape, into: { k: 'inside', ref: top, at: 'top' }, fill: partFill, ...(stroke ? { stroke } : {}), opacity, name: part.name });
      }
    } else {
      top = tx.push({ op: 'shape.path', paths: def.build(box, params), into, fill, ...(stroke ? { stroke } : {}), opacity, name: def.name, tags });
    }
    if (p.style === 'neon') {
      const blur = ctx.settings.liveBlur && !!ctx.host.info?.capabilities.applyEffect;
      neon({ sink: tx, rig: { ...ctx.settings.lightRig, color: pal.accent }, area: ab.rect, into, blur, seed: 1 }, { ref: top, strokeWidth: stroke!.w, strokeOnly: true }, { k: 'below', ref: top }, { color: lightColor({ ...ctx.settings.lightRig, color: pal.accent }), spread: 40 });
    }
    if (p.fx === 'shadow') tx.push(fxOp(top, { kind: 'dropShadow', dx: 0, dy: box.h * 0.04, blur: minSide * 0.08, opacity: 35, color: pal.dark, multiply: true }));
    else if (p.fx === 'glow') tx.push(fxOp(top, { kind: 'outerGlow', blur: minSide * 0.1, opacity: 75, color: lightOf(pal.accent), multiply: false }));
    else if (p.fx === 'innerGlow') tx.push(fxOp(top, { kind: 'innerGlow', blur: minSide * 0.06, opacity: 60, color: '#FFFFFF', fromEdge: true }));
    const warnings = p.fx !== 'none' && !ctx.host.info?.capabilities.applyEffect ? ['Live effects are not available in this Illustrator version; the shape was added without the effect.'] : [];
    return { batch: tx.toBatch(), summary: `${def.name} added.`, warnings };
  },
};

export const SHAPE_COMMANDS = [shapeInsert];
