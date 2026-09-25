/**
 * Shadow commands (v2): create any shadow style, quick one-style commands for
 * the palette, and Edit Selected Shadow (also upgrades shadows made by v1).
 */

import type { CommandPlan, DocumentCommand, PlanContext } from '../core/commands/types';
import { activeTemplate, itemBounds, requireDoc, roleLayerName, subjectItems, subjectLabel } from '../core/commands/helpers';
import { AFError } from '../core/errors';
import type { HostTransaction } from '../core/host';
import type { Place } from '../core/protocol';
import type { DocumentInfo, DocumentSnapshot, ItemDescriptor } from '../core/snapshot';
import type { Settings } from '../core/settings';
import { encodeMeta, isShadowType, type AfType } from '../core/tags';
import { center, type Rect } from '../geometry/rect';
import { makeId, plural } from '../utils/misc';
import { buildShadow, canSilhouette, sanitizeShadowParams, SHADOW_AF_TYPE, SHADOW_STYLE_LABEL, type ShadowParams, type ShadowStyle } from './shadow-engine';

export interface ShadowCommandParams {
  presetId: string | null;
  params: ShadowParams;
}

/** Stored in AF_params so the shadow can be edited later. */
interface StoredShadowParams extends ShadowParams {
  presetId: string | null;
  subjectRect: Rect;
}

function placementFor(ctx: PlanContext, subject: ItemDescriptor, tx: HostTransaction, createdLayers: Set<string>, warnings: string[]): Place {
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

export function artboardOf(doc: DocumentInfo, r: Rect): Rect | null {
  const c = center(r);
  const hit = doc.artboards.find((a) => c.x >= a.rect.x && c.x <= a.rect.x + a.rect.w && c.y >= a.rect.y && c.y <= a.rect.y + a.rect.h);
  return hit?.rect ?? null;
}

function blurAllowed(ctx: PlanContext, params: ShadowParams): boolean {
  return params.blur && ctx.settings.liveBlur && !!ctx.host.info?.capabilities.applyEffect;
}

function presetParams(settings: Settings, presets: PlanContext['presets'], style?: ShadowStyle): ShadowCommandParams {
  const preset = presets.get('shadow', settings.shadowPreset);
  const base = sanitizeShadowParams(preset?.params ?? {});
  const rig = settings.lightRig;
  const params = sanitizeShadowParams({ ...base, ...(style ? { style } : {}), lightAngle: rig.angle, elevation: rig.elevation });
  return { presetId: preset?.id ?? null, params };
}

function planCreate(label: string) {
  return async (ctx: PlanContext, p: ShadowCommandParams): Promise<CommandPlan> => {
    const params = sanitizeShadowParams(p.params);
    const subjects = subjectItems(ctx.snapshot);
    const tx = ctx.host.begin(label);
    const warnings: string[] = [];
    const created = new Set<string>();
    const blurOk = blurAllowed(ctx, params);
    for (const s of subjects) {
      if (s.hidden) warnings.push(`“${subjectLabel(s)}” is hidden; its shadow is created anyway.`);
      const subjectId = s.af?.id ?? makeId();
      if (!s.af?.id) tx.meta.tag(s.ref, encodeMeta({ type: 'subject', id: subjectId }));
      const rect = itemBounds(s, ctx.settings);
      const stored: StoredShadowParams = { ...params, presetId: p.presetId, subjectRect: rect };
      const tags = encodeMeta({ type: SHADOW_AF_TYPE[params.style], id: makeId(), source: subjectId, params: stored as unknown as Record<string, unknown> });
      const place = placementFor(ctx, s, tx, created, warnings);
      const res = buildShadow({
        sink: tx,
        subject: { rect, ref: s.ref, kind: s.kind, name: subjectLabel(s) },
        params,
        place,
        tags,
        blurOk,
        artboard: artboardOf(ctx.snapshot.doc!, rect),
      });
      for (const n of res.notes) if (!warnings.includes(n)) warnings.push(n);
    }
    if (params.blur && !blurOk && ctx.settings.liveBlur && !ctx.host.info?.capabilities.applyEffect) {
      warnings.push('Live blur is not available in this Illustrator version; the vector falloff is used instead.');
    }
    return {
      batch: tx.toBatch(),
      summary: `${SHADOW_STYLE_LABEL[params.style]} shadow added to ${plural(subjects.length, 'object')}.`,
      warnings,
    };
  };
}

function validateSubjects(snapshot: DocumentSnapshot): string | null {
  const d = requireDoc(snapshot);
  if (d) return d;
  if (subjectItems(snapshot).length === 0) {
    return snapshot.selection.count > 0 ? 'Shadows need an object to shadow — the selection only contains guides or plugin-generated items.' : 'Select the object(s) that need a shadow.';
  }
  return null;
}

export const shadowCreate: DocumentCommand<ShadowCommandParams> = {
  kind: 'document',
  id: 'shadow.create',
  title: 'Add Shadow',
  category: 'shadow',
  view: 'shadow',
  supportsPreview: true,
  keywords: ['shadow', 'ground', 'drop', 'floor', 'contact', 'cast', 'light', 'studio', 'ظل'],
  description: 'Add a realistic shadow (studio ground, cast, silhouette, floating or long) below the selected objects.',
  defaultParams: ({ settings, presets }) => presetParams(settings, presets),
  validate: validateSubjects,
  plan: planCreate('Add Shadow'),
};

function quick(style: ShadowStyle, title: string, description: string, keywords: string[]): DocumentCommand<ShadowCommandParams> {
  return {
    kind: 'document',
    id: `shadow.${style}`,
    title,
    category: 'shadow',
    view: 'shadow',
    supportsPreview: true,
    keywords: ['shadow', 'ظل', ...keywords],
    description,
    defaultParams: ({ settings, presets }) => presetParams(settings, presets, style),
    validate: validateSubjects,
    plan: planCreate(title),
  };
}

export const shadowGround = quick('ground', 'Add Studio Ground Shadow', 'Layered contact + core + ambient pool under each selected object.', ['ground', 'floor', 'studio', 'product', 'pool']);
export const shadowContact = quick('contact', 'Add Contact Shadow', 'Tight dark line where the object meets the ground.', ['contact', 'grounding', 'feet']);
export const shadowCast = quick('cast', 'Add Cast Shadow', 'Perspective shadow thrown by the scene light (length from the light elevation).', ['cast', 'sun', 'perspective', 'long', 'golden hour']);
export const shadowSilhouette = quick('silhouette', 'Add Silhouette Shadow', 'Projects a copy of the vector artwork or live text onto the floor.', ['silhouette', 'projected', 'logo', 'text', 'type']);
export const shadowFloating = quick('floating', 'Add Floating Shadow', 'Elevation shadow for cards/buttons, or a floor pool under a hovering product.', ['floating', 'elevation', 'card', 'ui', 'hover', 'drop']);
export const shadowLong = quick('long', 'Add Long Shadow', 'Flat-design long shadow, clipped to the artboard.', ['long', 'flat', 'icon', '45']);

export function selectedShadows(snapshot: DocumentSnapshot): ItemDescriptor[] {
  return snapshot.selection.items.filter((i) => isShadowType(i.af?.type ?? null));
}

const V1_STYLE: Partial<Record<AfType, ShadowStyle>> = { groundShadow: 'ground', contactAmbientShadow: 'ground', contactShadow: 'contact' };

/** Parameters stored on an existing shadow (v2, or v1 upgraded), sanitised. */
export function storedShadowParams(item: ItemDescriptor): (ShadowParams & { presetId: string | null; subjectRect: Rect | null }) | null {
  if (!item.af?.type || !isShadowType(item.af.type)) return null;
  const raw = (item.af.params ?? {}) as Partial<StoredShadowParams> & { kind?: string; opacity?: number };
  const upgraded: Partial<ShadowParams> = raw.style ? raw : { style: V1_STYLE[item.af.type] ?? 'ground', strength: typeof raw.opacity === 'number' ? Math.min(100, raw.opacity * 1.6) : undefined, color: raw.color };
  const params = sanitizeShadowParams(upgraded);
  const sr = raw.subjectRect;
  const subjectRect = sr && typeof sr.x === 'number' && typeof sr.w === 'number' ? sr : null;
  return { ...params, presetId: typeof raw.presetId === 'string' ? raw.presetId : null, subjectRect };
}

export interface EditShadowParams {
  params: ShadowParams;
}

export const shadowEdit: DocumentCommand<EditShadowParams> = {
  kind: 'document',
  id: 'shadow.edit',
  title: 'Edit Selected Shadow',
  category: 'shadow',
  view: 'shadow',
  supportsPreview: false,
  keywords: ['edit', 'shadow', 'update', 'refit', 'regenerate', 'upgrade'],
  // No live preview: editing replaces existing artwork, which a preview could not always restore exactly.
  description: 'Rebuild the selected Artboard Forge shadow(s) with new settings, fitted to the subject’s current position.',
  defaultParams: () => ({ params: sanitizeShadowParams({}) }),
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
    const params = sanitizeShadowParams(p.params);
    const blurOk = blurAllowed(ctx, params);
    for (const sh of shadows) {
      const stored = storedShadowParams(sh);
      let subject: ItemDescriptor | null = null;
      if (sh.af?.source) {
        subject = await ctx.host.document.findByAfId(sh.af.source, sh.ref);
        if (!subject) warnings.push(`The subject of “${sh.name}” was not found; the stored size is used.`);
      }
      const rect = subject ? itemBounds(subject, ctx.settings) : (stored?.subjectRect ?? null);
      if (!rect) throw new AFError('NO_SUBJECT', `“${sh.name}” has no stored subject size and its subject is missing.`);
      let style = params.style;
      if (!subject && (style === 'silhouette' || (style === 'floating' && params.floatMode === 'card'))) {
        warnings.push('The subject is missing, so its artwork cannot be copied; a shape-based shadow was used.');
      }
      if (subject && style === 'silhouette' && !canSilhouette(subject.kind)) style = 'cast';
      const final = { ...params, style };
      const storedNext: StoredShadowParams = { ...final, presetId: stored?.presetId ?? null, subjectRect: rect };
      const tags = encodeMeta({ type: SHADOW_AF_TYPE[style], id: sh.af?.id ?? makeId(), source: sh.af?.source ?? null, params: storedNext as unknown as Record<string, unknown> });
      const res = buildShadow({
        sink: tx,
        // Without the subject, silhouette/card styles fall back to shapes (kind 'placed' = not copyable).
        subject: { rect, ref: subject?.ref ?? sh.ref, kind: subject?.kind ?? 'placed', name: subject ? subjectLabel(subject) : sh.name.split(' — ').slice(2).join(' — ') || 'Object' },
        params: final,
        place: { k: 'replace', ref: sh.ref },
        tags,
        blurOk,
        artboard: artboardOf(ctx.snapshot.doc!, rect),
      });
      for (const n of res.notes) if (!warnings.includes(n)) warnings.push(n);
    }
    return { batch: tx.toBatch({ keepSelection: false }), summary: `Updated ${plural(shadows.length, 'shadow')}.`, warnings };
  },
};

export const SHADOW_COMMANDS = [shadowCreate, shadowGround, shadowContact, shadowCast, shadowSilhouette, shadowFloating, shadowLong, shadowEdit];
