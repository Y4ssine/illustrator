/**
 * Metadata written onto generated artwork so the plugin can recognise and
 * re-edit it later — including after the document is saved and reopened.
 *
 * Storage: Illustrator `PageItem.tags` (name/value strings saved inside the
 * .ai file). The human-readable object name ("SHADOW — Ground — Hero") is a
 * second, visible signal; tags are the source of truth.
 *
 *   AF_type   groundShadow | contactShadow | grid | guides | ...
 *   AF_ver    metadata schema version
 *   AF_id     stable id of this generated item
 *   AF_src    AF_id of the source/subject item (the subject gets an AF_id tag too)
 *   AF_params JSON of the parameters used, for "Edit existing effect"
 */

import { TAG, TAG_NAME_RE, type TagMap } from './protocol';

export const META_VERSION = 1;

export const SHADOW_TYPES = ['groundShadow', 'contactShadow', 'contactAmbientShadow', 'castShadow', 'silhouetteShadow', 'elevationShadow', 'longShadow'] as const;
export type ShadowAfType = (typeof SHADOW_TYPES)[number];

export type AfType =
  | ShadowAfType
  | 'grid'
  | 'guides'
  | 'subject'
  | 'artboardMarker'
  /** Lighting effect group (AF_light names the effect). */
  | 'light'
  | 'shape'
  | 'infographic'
  | 'background'
  | 'decor';

export const AF_TYPES: readonly AfType[] = [...SHADOW_TYPES, 'grid', 'guides', 'subject', 'artboardMarker', 'light', 'shape', 'infographic', 'background', 'decor'];

export interface AfMeta {
  type: AfType | null;
  version: number;
  id: string | null;
  source: string | null;
  params: Record<string, unknown> | null;
  preview: boolean;
  /** Raw params string when it failed to parse (kept for diagnostics). */
  rawParams?: string;
}

export function encodeMeta(meta: {
  type: AfType;
  id: string;
  source?: string | null;
  params?: Record<string, unknown> | null;
  preview?: boolean;
}): TagMap {
  const tags: TagMap = {
    [TAG.type]: meta.type,
    [TAG.version]: String(META_VERSION),
    [TAG.id]: meta.id,
  };
  if (meta.source) tags[TAG.source] = meta.source;
  if (meta.params) tags[TAG.params] = JSON.stringify(meta.params);
  if (meta.preview) tags[TAG.preview] = '1';
  for (const k of Object.keys(tags)) {
    if (!TAG_NAME_RE.test(k)) throw new Error(`Invalid tag name: ${k}`);
  }
  return tags;
}

/** Decode tags read from an item. Returns null when the item carries no AF tags. */
export function decodeMeta(tags: Record<string, string>): AfMeta | null {
  const hasAny = Object.keys(tags).some((k) => k.startsWith('AF_'));
  if (!hasAny) return null;
  const typeRaw = tags[TAG.type];
  const type = (AF_TYPES as readonly string[]).includes(typeRaw ?? '') ? (typeRaw as AfType) : null;
  let params: Record<string, unknown> | null = null;
  let rawParams: string | undefined;
  const p = tags[TAG.params];
  if (p) {
    try {
      const parsed: unknown = JSON.parse(p);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
      else rawParams = p;
    } catch {
      rawParams = p;
    }
  }
  const meta: AfMeta = {
    type,
    version: Number(tags[TAG.version] ?? '0') || 0,
    id: tags[TAG.id] ?? null,
    source: tags[TAG.source] ?? null,
    params,
    preview: tags[TAG.preview] === '1',
  };
  if (rawParams !== undefined) meta.rawParams = rawParams;
  return meta;
}

export function isGeneratedType(type: AfType | null): boolean {
  return type !== null && type !== 'subject';
}

export function isShadowType(type: AfType | null): type is ShadowAfType {
  return type !== null && (SHADOW_TYPES as readonly string[]).includes(type);
}

export const AF_TYPE_LABEL: Record<AfType, string> = {
  groundShadow: 'Ground Shadow',
  contactShadow: 'Contact Shadow',
  contactAmbientShadow: 'Contact + Ambient Shadow',
  castShadow: 'Cast Shadow',
  silhouetteShadow: 'Silhouette Shadow',
  elevationShadow: 'Floating Shadow',
  longShadow: 'Long Shadow',
  light: 'Lighting',
  shape: 'Shape',
  infographic: 'Infographic',
  background: 'Background',
  decor: 'Decor',
  grid: 'Grid',
  guides: 'Guides',
  subject: 'Subject',
  artboardMarker: 'Artboard marker',
};
