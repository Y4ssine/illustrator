/**
 * Grid & guide commands (Smart Grid, quick guides, offsets, safe zones,
 * visibility/lock, delete plugin guides).
 */

import type { DocumentCommand, PlanContext, CommandPlan } from '../core/commands/types';
import { activeTemplate, ensureGuideLayer, findRoleLayer, itemBounds, layerTop, requireDoc, subjectItems } from '../core/commands/helpers';
import type { HostTransaction } from '../core/host';
import { AFError } from '../core/errors';
import { activeArtboard, type DocumentSnapshot } from '../core/snapshot';
import { encodeMeta } from '../core/tags';
import { unionRects, type Rect } from '../geometry/rect';
import { makeId, plural } from '../utils/misc';
import { computeGrid, GridError, type GridSpec, type GuideLine } from './grid-engine';
import { offsetGuides, quickGuides, safeAreaGuides, QUICK_GUIDE_LABELS, type QuickGuideKind } from './guide-generator';
import { SAFE_ZONES, scaledInset } from './safe-zones';

export type GridTarget = 'activeArtboard' | 'allArtboards' | 'selectionBounds' | 'eachSelected' | 'custom';

export const GRID_TARGET_LABEL: Record<GridTarget, string> = {
  activeArtboard: 'Active artboard',
  allArtboards: 'All artboards',
  selectionBounds: 'Selection bounds',
  eachSelected: 'Each selected object',
  custom: 'Custom area',
};

export interface GridParams {
  presetId: string | null;
  presetName: string;
  spec: GridSpec;
  target: GridTarget;
  custom: Rect | null;
  /** Remove earlier plugin grids on the same artboard(s) first. */
  replaceExisting: boolean;
}

interface Area {
  rect: Rect;
  label: string;
  artboard: number | null;
}

function resolveAreas(snapshot: DocumentSnapshot, p: GridParams, ctx: PlanContext): Area[] {
  const doc = snapshot.doc!;
  switch (p.target) {
    case 'activeArtboard': {
      const ab = activeArtboard(doc);
      if (!ab) throw new AFError('NO_ARTBOARD', 'The document has no artboard.');
      return [{ rect: ab.rect, label: ab.name, artboard: ab.index }];
    }
    case 'allArtboards':
      return doc.artboards.map((a) => ({ rect: a.rect, label: a.name, artboard: a.index }));
    case 'selectionBounds': {
      const items = subjectItems(snapshot);
      const u = unionRects(items.map((i) => itemBounds(i, ctx.settings)));
      if (!u) throw new AFError('NO_SELECTION', 'Select the object(s) to build the grid inside.', { soft: true });
      return [{ rect: u, label: 'Selection', artboard: null }];
    }
    case 'eachSelected': {
      const items = subjectItems(snapshot);
      if (items.length === 0) throw new AFError('NO_SELECTION', 'Select the object(s) to build grids inside.', { soft: true });
      return items.map((i) => ({ rect: itemBounds(i, ctx.settings), label: i.name || i.typename, artboard: null }));
    }
    case 'custom': {
      if (!p.custom || !(p.custom.w > 0 && p.custom.h > 0)) throw new AFError('BAD_AREA', 'Enter a custom area with a width and height.');
      return [{ rect: p.custom, label: 'Custom area', artboard: null }];
    }
  }
}

export function toTuples(lines: readonly GuideLine[]): Array<[number, number, number, number]> {
  const r = (v: number): number => Math.round(v * 1000) / 1000;
  return lines.map((l) => [r(l.x1), r(l.y1), r(l.x2), r(l.y2)]);
}

/** Records a tagged guide group with the given lines. */
export function addGuideGroup(tx: HostTransaction, layer: string, name: string, lines: readonly GuideLine[], meta: Parameters<typeof encodeMeta>[0]): void {
  const group = tx.shapes.group(layerTop(layer), { name, tags: encodeMeta(meta) });
  tx.guides.lines({ k: 'inside', ref: group, at: 'top' }, toTuples(lines));
}

async function planGrid(ctx: PlanContext, p: GridParams): Promise<CommandPlan> {
  const { snapshot, settings, presets } = ctx;
  const doc = snapshot.doc!;
  const areas = resolveAreas(snapshot, p, ctx);
  const tx = ctx.host.begin(`Grid — ${p.presetName}`);
  const template = activeTemplate(settings, presets);
  const warnings: string[] = [];
  let total = 0;
  const computed = areas.map((a) => {
    try {
      return { a, g: computeGrid(a.rect, p.spec) };
    } catch (e) {
      if (e instanceof GridError) throw new AFError('GRID', `${a.label}: ${e.message}`);
      throw e;
    }
  });
  const layer = ensureGuideLayer(tx, doc, settings, template);
  if (p.replaceExisting) {
    for (const { a } of computed) if (a.artboard !== null) tx.meta.removeTagged(['grid'], { artboard: a.artboard });
  }
  for (const { a, g } of computed) {
    warnings.push(...g.warnings);
    total += g.lines.length;
    addGuideGroup(tx, layer, `GRID — ${p.presetName} — ${a.label}`, g.lines, {
      type: 'grid',
      id: makeId(),
      params: { presetId: p.presetId, spec: p.spec, target: p.target, area: a.rect, artboard: a.artboard },
    });
  }
  return {
    batch: tx.toBatch(),
    summary: `${p.presetName}: ${plural(total, 'guide')} on ${areas.length === 1 ? areas[0]!.label : plural(areas.length, 'area')} (layer “${layer}”).`,
    warnings: [...new Set(warnings)],
  };
}

function gridDefaults(ctx: PlanContext | { settings: PlanContext['settings']; presets: PlanContext['presets'] }, target: GridTarget): GridParams {
  const preset = ctx.presets.get('grid', ctx.settings.gridPreset) ?? ctx.presets.list('grid')[0]!;
  return { presetId: preset.id, presetName: preset.name, spec: preset.spec, target, custom: null, replaceExisting: true };
}

export const gridBuild: DocumentCommand<GridParams> = {
  kind: 'document',
  id: 'grid.build',
  title: 'Build Grid',
  category: 'grid',
  view: 'grid',
  keywords: ['grid', 'columns', 'rows', 'modular', 'campaign grid', 'guides', 'layout', 'margins', 'baseline'],
  description: 'Create a column/row/modular grid as guides on the active artboard (or other target).',
  supportsPreview: true,
  defaultParams: (ctx) => gridDefaults(ctx, 'activeArtboard'),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if ((p.target === 'selectionBounds' || p.target === 'eachSelected') && subjectItems(snapshot).length === 0) {
      return 'Build Grid from Selection requires at least one selected object.';
    }
    return null;
  },
  plan: planGrid,
};

export const gridBuildFromSelection: DocumentCommand<GridParams> = {
  ...gridBuild,
  id: 'grid.buildFromSelection',
  title: 'Build Grid from Selection',
  keywords: ['grid', 'selection', 'inside shape', 'rectangle', 'frame', 'clipping'],
  description: 'Create the current grid inside the bounds of the selected object (clip bounds for clipping groups).',
  defaultParams: (ctx) => gridDefaults(ctx, 'selectionBounds'),
};

export interface QuickGuideParams {
  kinds: QuickGuideKind[];
  source: 'selection' | 'artboard';
}

export const guidesQuick: DocumentCommand<QuickGuideParams> = {
  kind: 'document',
  id: 'guides.quick',
  title: 'Add Guides',
  category: 'guides',
  view: 'grid',
  keywords: ['guide', 'edges', 'center', 'centre', 'thirds', 'quarters', 'golden', 'midpoint'],
  description: 'Add edge, centre, thirds, quarter or golden-section guides for the selection or the artboard.',
  defaultParams: () => ({ kinds: ['center'], source: 'selection' }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (p.kinds.length === 0) return 'Choose at least one guide type.';
    if (p.source === 'selection' && subjectItems(snapshot).length === 0) return 'Select an object, or switch the source to Artboard.';
    return null;
  },
  async plan(ctx, p) {
    const doc = ctx.snapshot.doc!;
    const ab = activeArtboard(doc)!;
    const area = p.source === 'artboard' ? ab.rect : unionRects(subjectItems(ctx.snapshot).map((i) => itemBounds(i, ctx.settings)))!;
    const lines = quickGuides(area, p.kinds, ab.rect);
    const tx = ctx.host.begin('Add Guides');
    const layer = ensureGuideLayer(tx, doc, ctx.settings, activeTemplate(ctx.settings, ctx.presets));
    const label = p.kinds.map((k) => QUICK_GUIDE_LABELS[k]).join(', ');
    addGuideGroup(tx, layer, `GUIDES — ${label} — ${p.source === 'artboard' ? ab.name : 'Selection'}`, lines, {
      type: 'guides',
      id: makeId(),
      params: { kinds: p.kinds, source: p.source, artboard: ab.index },
    });
    return { batch: tx.toBatch(), summary: `${plural(lines.length, 'guide')} added (${label}).`, warnings: [] };
  },
};

export interface OffsetGuideParams {
  offsets: number[];
}

export const guidesOffset: DocumentCommand<OffsetGuideParams> = {
  kind: 'document',
  id: 'guides.offset',
  title: 'Guides Around Selection (Offset)',
  category: 'guides',
  view: 'grid',
  keywords: ['offset', 'padding', 'around', 'guide', '+8', '+16', '+24', '+32', 'breathing room'],
  description: 'Add guides offset outward from the selection edges, e.g. +16 and +32.',
  defaultParams: () => ({ offsets: [16] }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (subjectItems(snapshot).length === 0) return 'Guides Around Selection requires at least one selected object.';
    if (p.offsets.length === 0) return 'Enter at least one offset.';
    return null;
  },
  async plan(ctx, p) {
    const doc = ctx.snapshot.doc!;
    const ab = activeArtboard(doc)!;
    const area = unionRects(subjectItems(ctx.snapshot).map((i) => itemBounds(i, ctx.settings)))!;
    const lines = offsetGuides(area, p.offsets, ab.rect);
    const tx = ctx.host.begin('Offset Guides');
    const layer = ensureGuideLayer(tx, doc, ctx.settings, activeTemplate(ctx.settings, ctx.presets));
    addGuideGroup(tx, layer, `GUIDES — Offset ${p.offsets.map((o) => (o >= 0 ? `+${o}` : `${o}`)).join(' ')} — Selection`, lines, {
      type: 'guides',
      id: makeId(),
      params: { offsets: p.offsets, artboard: ab.index },
    });
    return { batch: tx.toBatch(), summary: `${plural(lines.length, 'guide')} around the selection.`, warnings: [] };
  },
};

export interface SafeZoneParams {
  zoneId: string;
}

export const guidesSafeZone: DocumentCommand<SafeZoneParams> = {
  kind: 'document',
  id: 'guides.safeZone',
  title: 'Add Safe-Area Guides',
  category: 'guides',
  view: 'grid',
  keywords: ['safe', 'safe zone', 'safe area', 'story', 'reels', 'instagram', 'title safe', 'print'],
  description: 'Add safe-area guides for a social or print format on the active artboard.',
  defaultParams: () => ({ zoneId: 'ig-story' }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (!SAFE_ZONES.some((z) => z.id === p.zoneId)) return 'Unknown safe-zone preset.';
    return null;
  },
  async plan(ctx, p) {
    const doc = ctx.snapshot.doc!;
    const ab = activeArtboard(doc)!;
    const zone = SAFE_ZONES.find((z) => z.id === p.zoneId)!;
    const inset = scaledInset(zone, ab.rect.w, ab.rect.h);
    const lines = safeAreaGuides(ab.rect, inset);
    const tx = ctx.host.begin('Safe Area');
    const layer = ensureGuideLayer(tx, doc, ctx.settings, activeTemplate(ctx.settings, ctx.presets));
    addGuideGroup(tx, layer, `SAFE AREA — ${zone.name} — ${ab.name}`, lines, { type: 'guides', id: makeId(), params: { zoneId: zone.id, artboard: ab.index } });
    const warn: string[] = [];
    const ref = zone.reference;
    if (Math.abs(ab.rect.w / ab.rect.h - ref.w / ref.h) > 0.02) warn.push(`The artboard's proportions differ from ${zone.name}; insets were scaled.`);
    return { batch: tx.toBatch(), summary: `${zone.name} safe area added.`, warnings: [...warn, zone.note] };
  },
};

export interface GuideLayerStateParams {
  visible?: boolean;
  locked?: boolean;
}

function guideLayerStateCommand(id: string, title: string, props: GuideLayerStateParams, keywords: string[]): DocumentCommand<GuideLayerStateParams> {
  return {
    kind: 'document',
    id,
    title,
    category: 'guides',
    view: 'grid',
    keywords,
    description: `${title} on the guides layer only (other guides are untouched).`,
    defaultParams: () => props,
    validate(snapshot) {
      return requireDoc(snapshot);
    },
    async plan(ctx, p): Promise<CommandPlan> {
      const doc = ctx.snapshot.doc!;
      const layer = findRoleLayer(doc, 'guides', activeTemplate(ctx.settings, ctx.presets));
      if (!layer) return { batch: { label: title, ops: [] }, summary: '', warnings: [], nothing: 'There is no guides layer yet.' };
      const tx = ctx.host.begin(title);
      tx.layers.setProps(layer, p);
      return { batch: tx.toBatch(), summary: `${title}: “${layer}”.`, warnings: [] };
    },
  };
}

export const guidesHide = guideLayerStateCommand('guides.hide', 'Hide Plugin Guides', { visible: false }, ['hide', 'guides', 'visibility']);
export const guidesShow = guideLayerStateCommand('guides.show', 'Show Plugin Guides', { visible: true }, ['show', 'guides', 'visibility']);
export const guidesLock = guideLayerStateCommand('guides.lock', 'Lock Guides Layer', { locked: true }, ['lock', 'guides']);
export const guidesUnlock = guideLayerStateCommand('guides.unlock', 'Unlock Guides Layer', { locked: false }, ['unlock', 'guides']);

export interface DeleteGuidesParams {
  scope: 'document' | 'activeArtboard';
}

export const guidesDeletePlugin: DocumentCommand<DeleteGuidesParams> = {
  kind: 'document',
  id: 'guides.deletePlugin',
  title: 'Delete Plugin Guides',
  category: 'guides',
  view: 'grid',
  destructive: true,
  keywords: ['delete', 'remove', 'clear', 'guides', 'grid'],
  description: 'Delete grids and guides created by Artboard Forge. Guides you drew yourself are never touched.',
  defaultParams: () => ({ scope: 'activeArtboard' }),
  validate: (snapshot) => requireDoc(snapshot),
  async plan(ctx, p) {
    const doc = ctx.snapshot.doc!;
    const ab = activeArtboard(doc)!;
    const tx = ctx.host.begin('Delete Plugin Guides');
    tx.meta.removeTagged(['grid', 'guides'], p.scope === 'document' ? 'document' : { artboard: ab.index });
    return {
      batch: tx.toBatch(),
      summary: p.scope === 'document' ? 'Plugin guides removed from the document.' : `Plugin guides removed from “${ab.name}”.`,
      warnings: [],
    };
  },
};

export const GRID_COMMANDS = [
  gridBuild,
  gridBuildFromSelection,
  guidesQuick,
  guidesOffset,
  guidesSafeZone,
  guidesHide,
  guidesShow,
  guidesLock,
  guidesUnlock,
  guidesDeletePlugin,
];

