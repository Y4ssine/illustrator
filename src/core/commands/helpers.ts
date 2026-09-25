/**
 * Helpers shared by command modules.
 */

import type { HostTransaction } from '../host';
import type { Place } from '../protocol';
import type { Settings } from '../settings';
import { perceivedBounds, type DocumentInfo, type DocumentSnapshot, type ItemDescriptor } from '../snapshot';
import { isGeneratedType } from '../tags';
import { formatLayerName, resolveRole, type LayerRole } from '../../layers/naming';
import { templateLabelMap } from '../../layers/organizer';
import type { LayerTemplate } from '../../presets/models';
import type { PresetStore } from '../../presets/store';
import { CAMPAIGN_STANDARD } from '../../layers/templates';
import type { Rect } from '../../geometry/rect';

export function activeTemplate(settings: Settings, presets: PresetStore): LayerTemplate {
  const t = presets.get('layerTemplate', settings.layerTemplate) ?? CAMPAIGN_STANDARD;
  return settings.namingFormat ? { ...t, format: settings.namingFormat } : t;
}

/** Existing top-level layer that plays `role`, if any. */
export function findRoleLayer(doc: DocumentInfo, role: LayerRole, template?: LayerTemplate): string | null {
  const labels = template ? templateLabelMap(template) : undefined;
  for (const l of doc.layers) if (resolveRole(l.name, labels) === role) return l.name;
  return null;
}

/**
 * Name of the layer guides go on. Reuses any recognised guides layer
 * ("_GUIDES", "00 — GUIDES", ...), otherwise records a create op at the top
 * of the stack using the configured utility name.
 */
export function ensureGuideLayer(tx: HostTransaction, doc: DocumentInfo, settings: Settings, template: LayerTemplate): string {
  const existing = findRoleLayer(doc, 'guides', template);
  if (existing) return existing;
  const name = settings.guideLayerName.trim() || '_GUIDES';
  tx.layers.ensure(name, { anchor: 'top', printable: false });
  return name;
}

/** Name for a template role (existing layer if recognised, otherwise the template's formatted name). */
export function roleLayerName(doc: DocumentInfo, role: LayerRole, template: LayerTemplate): string | null {
  const existing = findRoleLayer(doc, role, template);
  if (existing) return existing;
  const entry = template.layers.find((e) => e.role === role);
  return entry ? formatLayerName(entry, template.format) : null;
}

export function requireDoc(snapshot: DocumentSnapshot): string | null {
  if (!snapshot.doc) return 'Open or create a document first.';
  if (snapshot.selection.mode === 'text-editing') return 'You are editing text. Press Esc to leave the text, then try again.';
  return null;
}

/** Selected items a generator may use as subjects (skips guides and plugin-generated art). */
export function subjectItems(snapshot: DocumentSnapshot): ItemDescriptor[] {
  return snapshot.selection.items.filter((i) => i.kind !== 'guide' && !isGeneratedType(i.af?.type ?? null));
}

export function itemBounds(item: ItemDescriptor, settings: Settings): Rect {
  return perceivedBounds(item, settings.boundsMode);
}

export function layerTop(name: string): Place {
  return { k: 'layer', name, at: 'top' };
}

export function subjectLabel(item: ItemDescriptor): string {
  if (item.name) return item.name;
  switch (item.kind) {
    case 'placed':
    case 'raster':
      return 'Image';
    case 'text':
      return 'Text';
    case 'clipGroup':
      return 'Clip group';
    case 'group':
      return 'Group';
    default:
      return 'Object';
  }
}
