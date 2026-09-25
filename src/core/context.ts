/**
 * Selection context: what is selected, and which actions make sense.
 * Drives the context-aware HOME panel and palette ordering.
 */

import type { DocumentSnapshot, ItemDescriptor } from './snapshot';
import { AF_TYPE_LABEL, isShadowType, type AfType } from './tags';

export type ContextKind =
  | 'noDocument'
  | 'none'
  | 'textEditing'
  | 'text'
  | 'image'
  | 'path'
  | 'group'
  | 'afItem'
  | 'multiple';

export interface SelectionContext {
  kind: ContextKind;
  count: number;
  label: string;
  afType: AfType | null;
  /** Command ids, most relevant first. */
  suggestions: string[];
}

const SUGGEST: Record<ContextKind, string[]> = {
  noDocument: ['setup.wizard', 'artboard.ig-portrait', 'artboard.ig-story', 'artboard.ig-square'],
  none: ['recipe.build', 'color.background', 'info.statCards', 'grid.build', 'artboard.ig-portrait', 'layers.organize'],
  textEditing: [],
  text: ['light.effect', 'shadow.silhouette', 'color.apply', 'spacing.normalize', 'guides.quick'],
  image: ['light.scene', 'shadow.create', 'color.fade', 'shadow.cast', 'grid.buildFromSelection', 'layers.organize'],
  path: ['color.apply', 'light.scene', 'shadow.create', 'grid.buildFromSelection', 'guides.offset'],
  group: ['light.scene', 'shadow.create', 'color.apply', 'grid.buildFromSelection', 'guides.quick'],
  afItem: ['shadow.edit', 'layers.organize'],
  multiple: ['spacing.normalize', 'spacing.distribute', 'light.scene', 'shadow.create', 'layers.organize'],
};

export function classifySelection(snap: DocumentSnapshot): SelectionContext {
  if (!snap.doc) return make('noDocument', 0, 'No document open', null);
  const sel = snap.selection;
  if (sel.mode === 'text-editing') return make('textEditing', 0, 'Editing text', null);
  if (sel.count === 0) return make('none', 0, 'Nothing selected', null);
  const items = sel.items;
  if (sel.count > 1) {
    const afTypes = new Set(items.map((i) => i.af?.type ?? null));
    if (afTypes.size === 1 && isShadowType([...afTypes][0] ?? null)) {
      return make('afItem', sel.count, `${sel.count} shadows`, [...afTypes][0] ?? null);
    }
    return make('multiple', sel.count, `${sel.count} objects`, null);
  }
  const it = items[0]!;
  const t = it.af?.type ?? null;
  if (t && t !== 'subject') return make('afItem', 1, AF_TYPE_LABEL[t], t);
  return make(kindOf(it), 1, describeItem(it), null);
}

function kindOf(it: ItemDescriptor): ContextKind {
  switch (it.kind) {
    case 'text':
      return 'text';
    case 'placed':
    case 'raster':
      return 'image';
    case 'group':
    case 'clipGroup':
    case 'symbol':
      return 'group';
    default:
      return 'path';
  }
}

export function describeItem(it: ItemDescriptor): string {
  const kind =
    it.kind === 'text'
      ? it.text?.arabic
        ? 'Arabic text'
        : 'Text'
      : it.kind === 'placed'
        ? 'Linked image'
        : it.kind === 'raster'
          ? 'Embedded image'
          : it.kind === 'clipGroup'
            ? 'Clipping group'
            : it.kind === 'group'
              ? 'Group'
              : it.kind === 'compound'
                ? 'Compound path'
                : it.kind === 'guide'
                  ? 'Guide'
                  : it.kind === 'symbol'
                    ? 'Symbol'
                    : 'Path';
  return it.name ? `${kind} “${it.name}”` : kind;
}

function make(kind: ContextKind, count: number, label: string, afType: AfType | null): SelectionContext {
  const suggestions = kind === 'afItem' && afType && !isShadowType(afType) ? ['guides.deletePlugin', 'layers.organize'] : SUGGEST[kind];
  return { kind, count, label, afType, suggestions };
}
