/**
 * Helpers shared by the creative commands (light, colour, shapes,
 * infographics, recipes): active palette, target artboard, role layers.
 */

import type { HostTransaction } from '../host';
import type { Place } from '../protocol';
import type { Settings } from '../settings';
import { activeArtboard, type DocumentInfo, type DocumentSnapshot, type ItemDescriptor } from '../snapshot';
import type { PresetStore } from '../../presets/store';
import { paletteFromHexes, type BrandPalette } from '../../color/palette-engine';
import { center, unionRects, type Rect } from '../../geometry/rect';
import type { LayerRole } from '../../layers/naming';
import { activeTemplate, itemBounds, roleLayerName, subjectItems } from './helpers';

/** Rich, neutral-friendly default until the designer extracts a brand palette. */
export const DEFAULT_PALETTE_HEXES = ['#0E7A4B', '#C9A227', '#1F3B73', '#0B2E22', '#F4F1EA'];

export function activePalette(settings: Settings): BrandPalette {
  const hexes = settings.palette && settings.palette.length > 0 ? settings.palette : DEFAULT_PALETTE_HEXES;
  try {
    return paletteFromHexes(hexes);
  } catch {
    return paletteFromHexes(DEFAULT_PALETTE_HEXES);
  }
}

/** Artboard under the selection (or the active one). */
export function targetArtboard(snapshot: DocumentSnapshot, settings: Settings): { index: number; rect: Rect } | null {
  const doc = snapshot.doc;
  if (!doc) return null;
  const subj = subjectItems(snapshot);
  if (subj.length > 0) {
    const u = unionRects(subj.map((s) => itemBounds(s, settings)));
    if (u) {
      const c = center(u);
      const hit = doc.artboards.find((a) => c.x >= a.rect.x && c.x <= a.rect.x + a.rect.w && c.y >= a.rect.y && c.y <= a.rect.y + a.rect.h);
      if (hit) return { index: hit.index, rect: hit.rect };
    }
  }
  const ab = activeArtboard(doc);
  return ab ? { index: ab.index, rect: ab.rect } : null;
}

/**
 * Layer for a template role (LIGHTING, BACKGROUND…): reuses a recognised
 * layer or records its creation. `anchor` decides where a new layer goes.
 */
export function roleLayer(tx: HostTransaction, doc: DocumentInfo, settings: Settings, presets: PresetStore, role: LayerRole, fallback: string, anchor: 'top' | 'bottom', created: Set<string>): string {
  const template = activeTemplate(settings, presets);
  const name = roleLayerName(doc, role, template) ?? fallback;
  if (!doc.layers.some((l) => l.name === name) && !created.has(name)) {
    tx.layers.ensure(name, { anchor });
    created.add(name);
  }
  return name;
}

export const layerTop = (name: string): Place => ({ k: 'layer', name, at: 'top' });

/** Selection union bounds, if anything usable is selected. */
export function selectionRect(snapshot: DocumentSnapshot, settings: Settings): Rect | null {
  const subj = subjectItems(snapshot);
  return subj.length ? unionRects(subj.map((s) => itemBounds(s, settings))) : null;
}

export function isVector(item: ItemDescriptor): boolean {
  return item.kind === 'path' || item.kind === 'compound' || item.kind === 'group' || item.kind === 'text';
}

/** Font candidate lists from settings: Arabic first when the text is Arabic. */
export function fontStacks(settings: Settings, arabic: boolean): { bold: string[]; regular: string[] } {
  const bold = arabic ? [...settings.fontsArabic, ...settings.fontsLatin] : [...settings.fontsLatin, ...settings.fontsArabic];
  const regular = [...new Set([...bold.map((f) => f.replace(/-(ExtraBold|Black|Heavy|SemiBold|Bold|Medium)$/, '-Regular')), ...bold])];
  return { bold, regular };
}
