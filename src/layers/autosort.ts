/**
 * Auto-sort proposals for SELECTED items only.
 *
 * Each proposal carries a confidence and a plain-language reason. Only
 * high/medium confidence proposals are pre-checked in the preview; weak
 * guesses (e.g. "this photo is probably the subject") are shown unchecked or
 * not proposed at all. Nothing moves until the designer confirms.
 */

import type { ItemDescriptor } from '../core/snapshot';
import { isShadowType } from '../core/tags';
import type { LayerRole } from './naming';

export type Confidence = 'high' | 'medium' | 'low';

export interface SortProposal {
  itemIndex: number;
  itemLabel: string;
  role: LayerRole | null;
  targetLayer: string | null;
  confidence: Confidence;
  reason: string;
  /** Pre-checked in the preview. */
  selected: boolean;
  /** When true the item cannot be moved (inside a group, already there...). */
  blocked: boolean;
}

export interface SortRule {
  id: string;
  role: LayerRole;
  confidence: Confidence;
  reason: string;
  test: (item: ItemDescriptor) => boolean;
}

const nameHas = (re: RegExp) => (item: ItemDescriptor): boolean => re.test(item.name);

/** Ordered: the first matching rule wins. */
export const DEFAULT_SORT_RULES: readonly SortRule[] = [
  { id: 'af-grid', role: 'guides', confidence: 'high', reason: 'Grid or guides created by Artboard Forge', test: (i) => i.af?.type === 'grid' || i.af?.type === 'guides' },
  { id: 'guide', role: 'guides', confidence: 'high', reason: 'Illustrator guide', test: (i) => i.kind === 'guide' },
  { id: 'text', role: 'typography', confidence: 'high', reason: 'Text object', test: (i) => i.kind === 'text' },
  { id: 'name-brand', role: 'brand', confidence: 'medium', reason: 'Name suggests a logo / brand mark', test: nameHas(/\b(logo|brand|emblem|wordmark)\b|شعار|هوية/i) },
  { id: 'name-shadow', role: 'shadows', confidence: 'medium', reason: 'Name mentions a shadow', test: (i) => !isShadowType(i.af?.type ?? null) && /\bshadows?\b|ظل/i.test(i.name) },
  { id: 'name-light', role: 'lighting', confidence: 'medium', reason: 'Name mentions light or glow', test: nameHas(/\b(light|lighting|glow|flare|beam)\b|إضاءة|ضوء/i) },
  { id: 'name-texture', role: 'texture', confidence: 'medium', reason: 'Name mentions texture / grain', test: nameHas(/\b(texture|grain|noise|paper|dust)\b/i) },
  { id: 'name-bg', role: 'background', confidence: 'medium', reason: 'Name suggests a background', test: nameHas(/\b(bg|background|backdrop|sky)\b|خلفية|سماء/i) },
  { id: 'name-atmos', role: 'atmosphere', confidence: 'medium', reason: 'Name suggests haze / atmosphere', test: nameHas(/\b(haze|fog|mist|atmosphere)\b|ضباب/i) },
  { id: 'name-arch', role: 'architecture', confidence: 'medium', reason: 'Name suggests architecture', test: nameHas(/\b(building|architecture|tower|arch|mosque|palace)\b|مبنى|عمارة/i) },
  { id: 'name-decor', role: 'decorations', confidence: 'medium', reason: 'Name suggests a decoration / motif', test: nameHas(/\b(pattern|motif|decor|ornament|star|confetti)\b|زخرفة|نقش/i) },
  { id: 'name-subject', role: 'subject', confidence: 'medium', reason: 'Name suggests the main subject', test: nameHas(/\b(hero|subject|person|model|product|character)\b|بطل|شخص|منتج/i) },
  { id: 'name-fg', role: 'foreground', confidence: 'medium', reason: 'Name suggests a foreground element', test: nameHas(/\b(fg|foreground)\b/i) },
];

export function itemLabel(item: ItemDescriptor): string {
  if (item.name) return item.name;
  switch (item.kind) {
    case 'text':
      return 'Text';
    case 'placed':
      return 'Placed image';
    case 'raster':
      return 'Embedded image';
    case 'clipGroup':
      return 'Clipping group';
    case 'group':
      return 'Group';
    case 'compound':
      return 'Compound path';
    case 'guide':
      return 'Guide';
    default:
      return item.typename || 'Object';
  }
}

export function proposeSort(
  items: readonly ItemDescriptor[],
  roleNames: Partial<Record<LayerRole, string>>,
  opts: { shadowPlacement: 'belowSubject' | 'shadowLayer'; rules?: readonly SortRule[] },
): SortProposal[] {
  const rules = opts.rules ?? DEFAULT_SORT_RULES;
  return items.map((item) => {
    const base = { itemIndex: item.index, itemLabel: itemLabel(item) };
    if (!item.topLevel) {
      return { ...base, role: null, targetLayer: null, confidence: 'low', reason: 'Inside a group — organise the group instead.', selected: false, blocked: true } satisfies SortProposal;
    }
    if (isShadowType(item.af?.type ?? null)) {
      if (opts.shadowPlacement === 'shadowLayer' && roleNames.shadows) {
        return proposal(base, item, 'shadows', roleNames.shadows, 'high', 'Shadow created by Artboard Forge');
      }
      return { ...base, role: null, targetLayer: null, confidence: 'high', reason: 'Linked shadow — travels with its subject.', selected: false, blocked: true } satisfies SortProposal;
    }
    for (const rule of rules) {
      if (!rule.test(item)) continue;
      const target = roleNames[rule.role];
      if (!target) continue;
      return proposal(base, item, rule.role, target, rule.confidence, rule.reason);
    }
    const weak =
      item.kind === 'placed' || item.kind === 'raster'
        ? 'Image with no descriptive name — not enough information to sort. Name it (e.g. “hero”) or move it manually.'
        : 'No confident rule matched — left in place.';
    return { ...base, role: null, targetLayer: null, confidence: 'low', reason: weak, selected: false, blocked: true } satisfies SortProposal;
  });
}

function proposal(
  base: { itemIndex: number; itemLabel: string },
  item: ItemDescriptor,
  role: LayerRole,
  target: string,
  confidence: Confidence,
  reason: string,
): SortProposal {
  if (item.layer === target) {
    return { ...base, role, targetLayer: target, confidence, reason: `Already on “${target}”.`, selected: false, blocked: true };
  }
  return { ...base, role, targetLayer: target, confidence, reason, selected: confidence !== 'low', blocked: false };
}
