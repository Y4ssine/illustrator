/**
 * Layer Organizer planner — decides which layers to create, rename or move to
 * match a template. Pure; the command layer turns the plan into host ops and
 * shows it as a preview before anything changes.
 *
 * Safety rules:
 *  - Never deletes or merges layers.
 *  - Never moves an existing layer unless `reorderExisting` is on (moving a
 *    layer with artwork changes what overlaps what).
 *  - Unrecognised layers ("Layer 1", client layers) are left exactly where
 *    they are; missing template layers are inserted relative to recognised
 *    ones, or above everything when none are recognised.
 */

import type { HostOp } from '../core/protocol';
import type { LayerInfo } from '../core/snapshot';
import type { LayerTemplate, LayerTemplateEntry } from '../presets/models';
import { formatLayerName, normalizeLayerName, resolveRole, type LayerRole } from './naming';

export type LayerAction =
  | { kind: 'create'; name: string; role: LayerRole; anchor: 'top' | { name: string; place: 'above' | 'below' }; printable: boolean }
  | { kind: 'rename'; from: string; to: string; role: LayerRole }
  | { kind: 'move'; name: string; role: LayerRole; anchor: { name: string; place: 'above' } }
  | { kind: 'props'; name: string; role: LayerRole; printable: boolean }
  | { kind: 'keep'; name: string; role: LayerRole };

export interface OrganizeOptions {
  renameMatched: boolean;
  reorderExisting: boolean;
  createMissing: boolean;
}

export const DEFAULT_ORGANIZE_OPTIONS: OrganizeOptions = { renameMatched: true, reorderExisting: false, createMissing: true };

export interface OrganizePlan {
  actions: LayerAction[];
  /** Role → final layer name after the plan runs (existing or created). */
  roleNames: Partial<Record<LayerRole, string>>;
  unmatched: string[];
  duplicates: string[];
  warnings: string[];
}

export function templateLabelMap(t: LayerTemplate): Map<string, LayerRole> {
  const m = new Map<string, LayerRole>();
  for (const e of t.layers) m.set(normalizeLayerName(e.label), e.role);
  return m;
}

export function templateName(t: LayerTemplate, e: LayerTemplateEntry): string {
  return formatLayerName(e, t.format);
}

/** @param layers existing top-level layers in panel order (top first) */
export function planOrganize(layers: readonly LayerInfo[], template: LayerTemplate, opts: OrganizeOptions = DEFAULT_ORGANIZE_OPTIONS): OrganizePlan {
  const labels = templateLabelMap(template);
  const roles = new Set(template.layers.map((e) => e.role));
  const matched = new Map<LayerRole, string>();
  const unmatched: string[] = [];
  const duplicates: string[] = [];
  const warnings: string[] = [];

  for (const l of layers) {
    const role = resolveRole(l.name, labels);
    if (role && roles.has(role)) {
      if (matched.has(role)) duplicates.push(l.name);
      else matched.set(role, l.name);
    } else {
      unmatched.push(l.name);
    }
  }
  if (duplicates.length) {
    warnings.push(`Several layers look like the same role (${duplicates.join(', ')}). Only the top one is used; the others are left untouched.`);
  }

  const actions: LayerAction[] = [];
  const finalName = new Map<LayerRole, string>();
  const existingNames = new Set(layers.map((l) => l.name));

  // 1. Renames (and printability of utility layers).
  for (const e of template.layers) {
    const current = matched.get(e.role);
    if (!current) continue;
    const target = templateName(template, e);
    if (opts.renameMatched && current !== target) {
      if (existingNames.has(target)) {
        warnings.push(`Cannot rename “${current}” to “${target}” because a layer with that name already exists.`);
        finalName.set(e.role, current);
        actions.push({ kind: 'keep', name: current, role: e.role });
      } else {
        actions.push({ kind: 'rename', from: current, to: target, role: e.role });
        finalName.set(e.role, target);
      }
    } else {
      finalName.set(e.role, current);
      actions.push({ kind: 'keep', name: current, role: e.role });
    }
    const current2 = finalName.get(e.role)!;
    const layerInfo = layers.find((l) => l.name === current);
    if (e.printable === false && layerInfo && layerInfo.printable) {
      actions.push({ kind: 'props', name: current2, role: e.role, printable: false });
    }
  }

  // 2. Creates — walk bottom → top so each new layer can anchor above the one below it.
  const present = new Set<LayerRole>(matched.keys());
  if (opts.createMissing) {
    const entries = template.layers;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (present.has(e.role)) continue;
      const name = templateName(template, e);
      if (existingNames.has(name)) {
        warnings.push(`A layer named “${name}” exists but was not recognised; it is reused as is.`);
        finalName.set(e.role, name);
        present.add(e.role);
        continue;
      }
      let anchor: 'top' | { name: string; place: 'above' | 'below' } = 'top';
      const below = findNeighbour(entries, i, +1, present);
      if (below) {
        anchor = { name: finalName.get(below.role)!, place: 'above' };
      } else {
        const above = findNeighbour(entries, i, -1, present);
        if (above) anchor = { name: finalName.get(above.role)!, place: 'below' };
      }
      actions.push({ kind: 'create', name, role: e.role, anchor, printable: e.printable !== false });
      finalName.set(e.role, name);
      present.add(e.role);
    }
  }

  // 3. Optional reorder of recognised existing layers.
  if (opts.reorderExisting) {
    const order = layers.map((l) => l.name);
    const existingInTemplate = template.layers.filter((e) => matched.has(e.role));
    const positions = existingInTemplate.map((e) => order.indexOf(matched.get(e.role)!));
    const sorted = positions.every((p, i) => i === 0 || p > positions[i - 1]!);
    if (!sorted) {
      warnings.push('Existing layers will be reordered to match the template. This can change which artwork appears in front.');
      for (let i = existingInTemplate.length - 2; i >= 0; i--) {
        const e = existingInTemplate[i]!;
        const next = existingInTemplate[i + 1]!;
        actions.push({ kind: 'move', name: finalName.get(e.role)!, role: e.role, anchor: { name: finalName.get(next.role)!, place: 'above' } });
      }
    }
  }

  const roleNames: Partial<Record<LayerRole, string>> = {};
  for (const [r, n] of finalName) roleNames[r] = n;
  return { actions, roleNames, unmatched, duplicates, warnings };
}

function findNeighbour(entries: readonly LayerTemplateEntry[], from: number, dir: 1 | -1, present: Set<LayerRole>): LayerTemplateEntry | null {
  for (let j = from + dir; j >= 0 && j < entries.length; j += dir) {
    if (present.has(entries[j]!.role)) return entries[j]!;
  }
  return null;
}

/**
 * Host ops for a plan: renames, then moves (so existing layers are in template
 * order), then creates (anchored to the now-ordered layers), then props.
 */
export function organizeOps(plan: OrganizePlan): HostOp[] {
  const ops: HostOp[] = [];
  for (const a of plan.actions) if (a.kind === 'rename') ops.push({ op: 'layer.rename', from: a.from, to: a.to });
  for (const a of plan.actions) if (a.kind === 'move') ops.push({ op: 'layer.move', name: a.name, anchor: a.anchor });
  for (const a of plan.actions) {
    if (a.kind === 'create') ops.push({ op: 'layer.ensure', name: a.name, anchor: a.anchor, printable: a.printable });
  }
  for (const a of plan.actions) if (a.kind === 'props') ops.push({ op: 'layer.props', name: a.name, printable: a.printable });
  return ops;
}

export function describeAction(a: LayerAction): string {
  switch (a.kind) {
    case 'create':
      return `Create “${a.name}”`;
    case 'rename':
      return `Rename “${a.from}” → “${a.to}”`;
    case 'move':
      return `Move “${a.name}” above “${a.anchor.name}”`;
    case 'props':
      return `Make “${a.name}” non-printing`;
    case 'keep':
      return `Keep “${a.name}”`;
  }
}
