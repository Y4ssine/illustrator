/**
 * Shadow commands: Ground, Contact, Contact + Ambient, and Edit Existing.
 */

import type { DocumentCommand, PlanContext, CommandPlan } from '../core/commands/types';
import { activeTemplate, itemBounds, requireDoc, roleLayerName, subjectItems, subjectLabel } from '../core/commands/helpers';
import { AFError } from '../core/errors';
import type { Place } from '../core/protocol';
import type { DocumentSnapshot, ItemDescriptor } from '../core/snapshot';
import { encodeMeta, isShadowType, type AfType } from '../core/tags';
import { center, type Rect } from '../geometry/rect';
import { makeId, plural } from '../utils/misc';
import { buildShadowOps, ellipseFor, sanitizeShadowParams, SHADOW_KIND_LABEL, type ShadowKind, type ShadowParams } from './shadow-engine';

const TYPE_FOR: Record<ShadowKind, AfType> = { ground: 'groundShadow', contact: 'contactShadow', contactAmbient: 'contactAmbientShadow' };
const KIND_FOR: Partial<Record<AfType, ShadowKind>> = { groundShadow: 'ground', contactShadow: 'contact', contactAmbientShadow: 'contactAmbient' };

export interface ShadowCommandParams {
  presetId: string | null;
  params: ShadowParams;
}

/** Stored in AF_params so the shadow can be edited later. */
interface StoredShadowParams extends ShadowParams {
  presetId: string | null;
  subjectRect: Rect;
}

function placementFor(ctx: PlanContext, subject: ItemDescriptor, tx: ReturnType<PlanContext['host']['begin']>, createdLayers: Set<string>, warnings: string[]): Place {
  if (ctx.settings.shadowPlacement === 'belowSubject') return { k: 'below', ref: subject.ref };
  const doc = ctx.snapshot.doc!;
  const template = activeTemplate(ctx.settings, ctx.presets);
  const name = roleLayerName(doc, 'shadows', template) ?? 'SHADOWS';
  const exists = doc.layers.some((l) => l.name === name);
  if (!exists && !createdLayers.has(name)) {
    // New SHADOWS layer goes directly below the subject's layer so it composites behind it.
    tx.layers.ensure(name, { anchor: { name: subject.layer, place: 'below' } });
    createdLayers.add(name);
  } else if (exists) {
    const idxShadow = doc.layers.findIndex((l) => l.name === name);
    const idxSubject = doc.layers.findIndex((l) => l.name === subject.layer);
    if (idxSubject >= 0 && idxShadow >= 0 && idxShadow < idxSubject) {
      warnings.push(`“${name}” is above “${subject.layer}”, so the shadow will draw over the subject. Move the layer down or use “Below subject” placement.`);
    }
  }
  return { k: 'layer', name, at: 'top' };
}

function shadowCommand(kind: ShadowKind): DocumentCommand<ShadowCommandParams> {
  const label = SHADOW_KIND_LABEL[kind];
  return {
    kind: 'document',
    id: `shadow.${kind}`,
    title: `Add ${label} Shadow`,
    category: 'shadow',
    view: 'shadow',
    supportsPreview: true,
    keywords: ['shadow', label.toLowerCase(), 'ground', 'drop', 'floor', 'contact', 'ambient', 'grounding', 'ظل'],
    description:
      kind === 'ground'
        ? 'Soft elliptical shadow under the selected object(s), placed directly below each one.'
        : kind === 'contact'
          ? 'Tight, darker shadow where the subject meets the ground (feet, bottles, products).'
          : 'Contact shadow plus a wide ambient pool, grouped as one editable shadow.',
    defaultParams: ({ settings, presets }) => {
      const preset = presets.get('shadow', settings.shadowPreset);
      const params = preset && preset.params.kind === kind ? preset.params : sanitizeShadowParams({ kind });
      return { presetId: preset && preset.params.kind === kind ? preset.id : null, params };
    },
    validate(snapshot) {
      const d = requireDoc(snapshot);
      if (d) return d;
      if (subjectItems(snapshot).length === 0) {
        return snapshot.selection.count > 0
          ? `${label} Shadow needs an object to shadow — the selection only contains guides or plugin-generated items.`
          : `${label} Shadow requires at least one selected object.`;
      }
      return null;
    },
    async plan(ctx, p) {
      const params = sanitizeShadowParams({ ...p.params, kind });
      const subjects = subjectItems(ctx.snapshot);
      const tx = ctx.host.begin(`${label} Shadow`);
      const warnings: string[] = [];
      const created = new Set<string>();
      for (const s of subjects) {
        if (s.hidden) warnings.push(`“${subjectLabel(s)}” is hidden; its shadow is created anyway.`);
        const subjectId = s.af?.id ?? makeId();
        if (!s.af?.id) tx.meta.tag(s.ref, encodeMeta({ type: 'subject', id: subjectId }));
        const rect = itemBounds(s, ctx.settings);
        const stored: StoredShadowParams = { ...params, presetId: p.presetId, subjectRect: rect };
        const tags = encodeMeta({ type: TYPE_FOR[kind], id: makeId(), source: subjectId, params: stored as unknown as Record<string, unknown> });
        const place = placementFor(ctx, s, tx, created, warnings);
        const built = buildShadowOps({ subject: rect, subjectName: subjectLabel(s), params, place, tags, preview: false }, tx.ops.length);
        tx.append(built.ops);
      }
      if (params.liveBlur > 0 && !ctx.host.info?.capabilities.applyEffect) {
        warnings.push('Live blur is not available in this Illustrator version; the vector falloff is used instead.');
      }
      return {
        batch: tx.toBatch(),
        summary: `${label} shadow added to ${plural(subjects.length, 'object')}.`,
        warnings,
      };
    },
  };
}

export const shadowGround = shadowCommand('ground');
export const shadowContact = shadowCommand('contact');
export const shadowContactAmbient = shadowCommand('contactAmbient');

export function selectedShadows(snapshot: DocumentSnapshot): ItemDescriptor[] {
  return snapshot.selection.items.filter((i) => isShadowType(i.af?.type ?? null));
}

export function shadowKindOf(item: ItemDescriptor): ShadowKind | null {
  return item.af?.type ? (KIND_FOR[item.af.type] ?? null) : null;
}

/** Parameters stored on an existing shadow, sanitised. */
export function storedShadowParams(item: ItemDescriptor): (ShadowParams & { presetId: string | null; subjectRect: Rect | null }) | null {
  const kind = shadowKindOf(item);
  if (!kind || !item.af) return null;
  const raw = (item.af.params ?? {}) as Partial<StoredShadowParams>;
  const params = sanitizeShadowParams({ ...raw, kind });
  const sr = raw.subjectRect;
  const subjectRect = sr && typeof sr.x === 'number' && typeof sr.w === 'number' ? sr : null;
  return { ...params, presetId: typeof raw.presetId === 'string' ? raw.presetId : null, subjectRect };
}

export interface EditShadowParams {
  params: ShadowParams;
  /** Recompute position from the subject's current bounds (otherwise keep the shadow where it is now). */
  refit: boolean;
}

export const shadowEdit: DocumentCommand<EditShadowParams> = {
  kind: 'document',
  id: 'shadow.edit',
  title: 'Edit Selected Shadow',
  category: 'shadow',
  view: 'shadow',
  supportsPreview: false,
  keywords: ['edit', 'shadow', 'update', 'refit', 'regenerate'],
  // No live preview: editing replaces existing artwork, which a preview could not always restore exactly.
  description: 'Rebuild the selected Artboard Forge shadow(s) with new settings, keeping their stacking position.',
  defaultParams: () => ({ params: sanitizeShadowParams({ kind: 'ground' }), refit: false }),
  validate(snapshot) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (selectedShadows(snapshot).length === 0) return 'Select a shadow created by Artboard Forge to edit it.';
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const shadows = selectedShadows(ctx.snapshot);
    const tx = ctx.host.begin('Edit Shadow');
    const warnings: string[] = [];
    for (const sh of shadows) {
      const kind = shadowKindOf(sh)!;
      const stored = storedShadowParams(sh);
      const params = sanitizeShadowParams({ ...p.params, kind: p.params.kind ?? kind });
      const newKind = params.kind;
      let subjectRect: Rect | null = null;
      let subjectName = sh.name.split(' — ').slice(2).join(' — ') || 'Object';
      if (sh.af?.source) {
        const subject = await ctx.host.document.findByAfId(sh.af.source, sh.ref);
        if (subject) {
          subjectRect = itemBounds(subject, ctx.settings);
          subjectName = subjectLabel(subject);
        } else {
          warnings.push(`The subject of “${sh.name}” was not found; the stored size is used.`);
        }
      }
      subjectRect = subjectRect ?? stored?.subjectRect ?? null;
      if (!subjectRect) throw new AFError('NO_SUBJECT', `“${sh.name}” has no stored subject size and its subject is missing.`);
      let rect = subjectRect;
      if (!p.refit) {
        // Keep the shadow where the designer left it: shift the subject rect so the new ellipse is centred on the current shadow.
        const expected = ellipseFor(subjectRect, params, params);
        const cur = center(sh.visible);
        rect = { ...subjectRect, x: subjectRect.x + (cur.x - expected.cx), y: subjectRect.y + (cur.y - expected.cy) };
      }
      const storedNext: StoredShadowParams = { ...params, presetId: stored?.presetId ?? null, subjectRect };
      const tags = encodeMeta({
        type: TYPE_FOR[newKind],
        id: sh.af?.id ?? makeId(),
        source: sh.af?.source ?? null,
        params: storedNext as unknown as Record<string, unknown>,
      });
      const built = buildShadowOps({ subject: rect, subjectName, params, place: { k: 'replace', ref: sh.ref }, tags, preview: false }, tx.ops.length);
      tx.append(built.ops);
    }
    return { batch: tx.toBatch({ keepSelection: false }), summary: `Updated ${plural(shadows.length, 'shadow')}.`, warnings };
  },
};

export const SHADOW_COMMANDS = [shadowGround, shadowContact, shadowContactAmbient, shadowEdit];
