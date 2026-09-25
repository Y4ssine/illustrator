/**
 * Spacing commands. Items are measured with perceived bounds (clip bounds
 * for clipping groups, visible bounds by default). Plugin shadows whose
 * subject is also selected travel with the subject instead of being spaced
 * as separate objects.
 */

import type { DocumentCommand } from '../core/commands/types';
import { itemBounds, requireDoc } from '../core/commands/helpers';
import type { Settings } from '../core/settings';
import type { DocumentSnapshot, ItemDescriptor } from '../core/snapshot';
import { isShadowType } from '../core/tags';
import type { Axis } from '../geometry/rect';
import type { PresetStore } from '../presets/store';
import { analyzeSpacing, planSpacing, SPACING_SYSTEMS, type SpacingAnalysis, type SpacingAnchor, type SpacingOperation, type SpacingSystem } from './spacing-engine';

export interface SpacingParams {
  operation: SpacingOperation;
  axis: Axis | 'auto';
}

export function spacingSystem(settings: Settings, presets: PresetStore): SpacingSystem {
  return presets.get('spacing', settings.spacingPreset)?.system ?? SPACING_SYSTEMS['8']!;
}

export function spacingAnchor(settings: Settings, axis: Axis): SpacingAnchor {
  return axis === 'x' && settings.direction === 'rtl' ? 'end' : 'start';
}

interface Partitioned {
  layoutItems: ItemDescriptor[];
  followers: Map<number, ItemDescriptor[]>;
}

/** Split the selection into items to lay out and shadows that follow their subject. */
export function partitionSelection(snapshot: DocumentSnapshot): Partitioned {
  const items = snapshot.selection.items.filter((i) => i.kind !== 'guide');
  const byAfId = new Map<string, ItemDescriptor>();
  for (const i of items) if (i.af?.id && !isShadowType(i.af.type)) byAfId.set(i.af.id, i);
  const followers = new Map<number, ItemDescriptor[]>();
  const layoutItems: ItemDescriptor[] = [];
  for (const i of items) {
    const subject = isShadowType(i.af?.type ?? null) && i.af?.source ? byAfId.get(i.af.source) : undefined;
    if (subject) {
      const list = followers.get(subject.index) ?? [];
      list.push(i);
      followers.set(subject.index, list);
    } else {
      layoutItems.push(i);
    }
  }
  return { layoutItems, followers };
}

export function analyzeSelectionSpacing(snapshot: DocumentSnapshot, settings: Settings, presets: PresetStore, axis: Axis | 'auto' = 'auto'): SpacingAnalysis | null {
  const { layoutItems } = partitionSelection(snapshot);
  if (layoutItems.length < 2) return null;
  return analyzeSpacing(
    layoutItems.map((i) => ({ id: String(i.index), rect: itemBounds(i, settings) })),
    axis,
    spacingSystem(settings, presets),
  );
}

function spacingCommand(id: string, title: string, operation: SpacingOperation, keywords: string[], description: string): DocumentCommand<SpacingParams> {
  return {
    kind: 'document',
    id,
    title,
    category: 'align',
    view: 'align',
    maxSelection: 10000,
    keywords: ['spacing', 'gap', 'gaps', ...keywords],
    description,
    defaultParams: () => ({ operation, axis: 'auto' }),
    validate(snapshot, p) {
      const d = requireDoc(snapshot);
      if (d) return d;
      const n = partitionSelection(snapshot).layoutItems.length;
      if (n < 2) return `${title} requires at least two selected objects.`;
      if (p.operation.kind === 'distribute' && n < 3) return 'Distribute Evenly needs at least three objects (the outer two stay in place).';
      if (snapshot.selection.truncated) return 'The selection is too large to space precisely. Select fewer objects.';
      return null;
    },
    async plan(ctx, p) {
      const { layoutItems, followers } = partitionSelection(ctx.snapshot);
      const items = layoutItems.map((i) => ({ id: String(i.index), rect: itemBounds(i, ctx.settings) }));
      const system = spacingSystem(ctx.settings, ctx.presets);
      const axis = p.axis === 'auto' ? analyzeSpacing(items, 'auto', system).axis : p.axis;
      const plan = planSpacing(items, p.operation, { axis, anchor: spacingAnchor(ctx.settings, axis), system });
      const tx = ctx.host.begin(title);
      const byIndex = new Map(layoutItems.map((i) => [String(i.index), i]));
      for (const m of plan.moves) {
        const item = byIndex.get(m.id)!;
        tx.transform.translate(item.ref, m.dx, m.dy);
        for (const f of followers.get(item.index) ?? []) tx.transform.translate(f.ref, m.dx, m.dy);
      }
      if (plan.moves.length === 0) return { batch: tx.toBatch(), summary: '', warnings: [], nothing: plan.message };
      const followerCount = [...followers.values()].reduce((a, b) => a + b.length, 0);
      return {
        batch: tx.toBatch(),
        summary: plan.message,
        warnings: followerCount ? [`${followerCount} linked shadow(s) moved with their subject.`] : [],
      };
    },
  };
}

export const spacingNormalize = spacingCommand(
  'spacing.normalize',
  'Normalize Spacing',
  { kind: 'normalize' },
  ['normalize', 'snap', '8px', 'system', 'consistent'],
  'Set every gap to the nearest value of your spacing system (e.g. 37.4 → 40 on an 8 px system).',
);
export const spacingDistribute = spacingCommand('spacing.distribute', 'Distribute Evenly', { kind: 'distribute' }, ['distribute', 'even', 'equal'], 'Equal gaps between the outer two objects.');
export const spacingMatchSmallest = spacingCommand('spacing.matchSmallest', 'Match Smallest Gap', { kind: 'matchSmallest' }, ['smallest', 'min', 'tight'], 'Every gap becomes the smallest current gap.');
export const spacingMatchLargest = spacingCommand('spacing.matchLargest', 'Match Largest Gap', { kind: 'matchLargest' }, ['largest', 'max', 'loose'], 'Every gap becomes the largest current gap.');
export const spacingMatchFirst = spacingCommand('spacing.matchFirst', 'Match First Gap', { kind: 'matchFirst' }, ['first', 'match'], 'Every gap becomes the first gap (in reading order along the axis).');
export const spacingExact = spacingCommand('spacing.exact', 'Set Exact Gap', { kind: 'exact', value: 32 }, ['exact', 'set', 'value', 'custom'], 'Every gap becomes the value you type.');

export const SPACING_COMMANDS = [spacingNormalize, spacingDistribute, spacingMatchSmallest, spacingMatchLargest, spacingMatchFirst, spacingExact];
