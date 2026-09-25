/**
 * Layer Organizer commands.
 */

import type { CommandPlan, DocumentCommand, PlanContext } from '../core/commands/types';
import { requireDoc } from '../core/commands/helpers';
import { plural } from '../utils/misc';
import type { LayerTemplate } from '../presets/models';
import { CAMPAIGN_STANDARD } from './templates';
import { proposeSort, type SortProposal } from './autosort';
import { DEFAULT_ORGANIZE_OPTIONS, describeAction, organizeOps, planOrganize, type OrganizeOptions, type OrganizePlan } from './organizer';

export interface OrganizeParams {
  templateId: string;
  options: OrganizeOptions;
  /** Move selected items by rule. */
  sortSelection: boolean;
  /**
   * Item indices (selection order) the designer confirmed in the preview.
   * null = use the pre-checked proposals and ask for confirmation.
   */
  accepted: number[] | null;
}

export interface OrganizePreview {
  template: LayerTemplate;
  plan: OrganizePlan;
  proposals: SortProposal[];
}

export function templateFor(ctx: Pick<PlanContext, 'settings' | 'presets'>, id: string): LayerTemplate {
  const t = ctx.presets.get('layerTemplate', id) ?? ctx.presets.get('layerTemplate', ctx.settings.layerTemplate) ?? CAMPAIGN_STANDARD;
  return ctx.settings.namingFormat ? { ...t, format: ctx.settings.namingFormat } : t;
}

/** Pure preview used by the LAYERS view and by the command itself. */
export function previewOrganize(ctx: Pick<PlanContext, 'snapshot' | 'settings' | 'presets'>, p: OrganizeParams): OrganizePreview {
  const template = templateFor(ctx, p.templateId);
  const plan = planOrganize(ctx.snapshot.doc!.layers, template, p.options);
  const proposals = p.sortSelection ? proposeSort(ctx.snapshot.selection.items, plan.roleNames, { shadowPlacement: ctx.settings.shadowPlacement }) : [];
  return { template, plan, proposals };
}

export const layersOrganize: DocumentCommand<OrganizeParams> = {
  kind: 'document',
  id: 'layers.organize',
  title: 'Organize Layers',
  category: 'layers',
  view: 'layers',
  maxSelection: 10000,
  keywords: ['layers', 'organize', 'organise', 'structure', 'template', 'sort', 'clean', 'rename'],
  description: 'Create/rename layers to match a template and move selected items to the right layers (preview first).',
  defaultParams: ({ settings }) => ({ templateId: settings.layerTemplate, options: DEFAULT_ORGANIZE_OPTIONS, sortSelection: true, accepted: null }),
  validate: (snapshot) => requireDoc(snapshot),
  async plan(ctx, p): Promise<CommandPlan> {
    const { template, plan, proposals } = previewOrganize(ctx, p);
    const tx = ctx.host.begin('Organize Layers');
    tx.append(organizeOps(plan));
    const accepted = new Set(p.accepted ?? proposals.filter((x) => x.selected && !x.blocked).map((x) => x.itemIndex));
    const byLayer = new Map<string, number[]>();
    for (const pr of proposals) {
      if (pr.blocked || !pr.targetLayer || !accepted.has(pr.itemIndex)) continue;
      const list = byLayer.get(pr.targetLayer) ?? [];
      list.push(pr.itemIndex);
      byLayer.set(pr.targetLayer, list);
    }
    const items = ctx.snapshot.selection.items;
    let moved = 0;
    for (const [layer, idxs] of byLayer) {
      const refs = idxs.map((i) => items.find((it) => it.index === i)!.ref);
      tx.transform.toLayer(refs, layer, 'top');
      moved += refs.length;
    }
    const changes = plan.actions.filter((a) => a.kind !== 'keep');
    if (changes.length === 0 && moved === 0) {
      return { batch: tx.toBatch(), summary: '', warnings: plan.warnings, nothing: `Layers already match “${template.name}”.` };
    }
    const details = [...changes.map(describeAction), ...[...byLayer].map(([layer, idxs]) => `Move ${plural(idxs.length, 'item')} → “${layer}”`)];
    const summary = `${template.name}: ${plural(changes.length, 'layer change')}${moved ? `, ${plural(moved, 'item')} moved` : ''}.`;
    return {
      batch: tx.toBatch(),
      summary,
      warnings: [...plan.warnings, ...(moved ? ['Moving items between layers can change which artwork appears in front. Check the result; one Undo reverts everything.'] : [])],
      ...(p.accepted === null ? { confirm: { title: 'Organize Layers', message: `Apply these changes to match “${template.name}”?`, details } } : {}),
    };
  },
};

export const LAYER_COMMANDS = [layersOrganize];
