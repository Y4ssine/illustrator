/**
 * Layer naming and role recognition.
 *
 * A "role" is the stable meaning of a layer (BACKGROUND, SUBJECT...). The
 * visible name is produced from a template entry and a naming format, so a
 * studio can switch between "05 — SUBJECT" and "05_SUBJECT" without breaking
 * recognition. Existing layers are matched by normalising their names and
 * comparing against the template labels and a list of aliases (English and
 * Arabic), so "_GUIDES", "Guides" and "00 — GUIDES" all resolve to GUIDES.
 */

import { pad } from '../utils/misc';

export type LayerRole =
  | 'guides'
  | 'notes'
  | 'brand'
  | 'typography'
  | 'texture'
  | 'lighting'
  | 'shadows'
  | 'foreground'
  | 'subject'
  | 'midground'
  | 'architecture'
  | 'atmosphere'
  | 'background'
  | 'decorations'
  | 'images';

export const LAYER_ROLES: readonly LayerRole[] = [
  'guides',
  'notes',
  'brand',
  'typography',
  'texture',
  'lighting',
  'shadows',
  'foreground',
  'subject',
  'midground',
  'architecture',
  'atmosphere',
  'background',
  'decorations',
  'images',
];

export const ROLE_ALIASES: Record<LayerRole, readonly string[]> = {
  guides: ['GUIDES', 'GUIDE', 'GRID', 'GRIDS', 'PERSPECTIVE GUIDES'],
  notes: ['NOTES', 'NOTE', 'COMMENTS', 'ملاحظات'],
  brand: ['BRAND', 'BRANDING', 'LOGO', 'LOGOS', 'شعار', 'الشعار', 'الهوية'],
  typography: ['TYPOGRAPHY', 'TYPE', 'TEXT', 'COPY', 'نصوص', 'النصوص'],
  texture: ['TEXTURE', 'TEXTURES', 'GRAIN', 'NOISE'],
  lighting: ['LIGHTING', 'LIGHT', 'LIGHTS', 'إضاءة'],
  shadows: ['SHADOWS', 'SHADOW', 'ظلال', 'الظلال'],
  foreground: ['FOREGROUND', 'FG', 'FRONT'],
  subject: ['SUBJECT', 'HERO', 'MAIN', 'SUBJECTS'],
  midground: ['MIDGROUND', 'MID', 'MIDDLE'],
  architecture: ['ARCHITECTURE', 'ARCH', 'BUILDINGS'],
  atmosphere: ['ATMOSPHERE', 'ATMOS', 'HAZE', 'FOG', 'MIST'],
  background: ['BACKGROUND', 'BG', 'BACK', 'خلفية', 'الخلفية'],
  decorations: ['DECORATIONS', 'DECORATION', 'DECOR', 'MOTIFS', 'PATTERNS', 'زخارف'],
  images: ['IMAGES', 'IMAGE', 'PHOTOS', 'صور'],
};

export type NamingFormat = 'dash' | 'underscore' | 'dot' | 'plain';

export const NAMING_FORMATS: Record<NamingFormat, { label: string; example: string }> = {
  dash: { label: '01 — NAME', example: '05 — SUBJECT' },
  underscore: { label: '01_NAME', example: '05_SUBJECT' },
  dot: { label: '01. Name', example: '05. Subject' },
  plain: { label: 'NAME', example: 'SUBJECT' },
};

export interface NamedEntry {
  label: string;
  number: number | null;
}

export function formatLayerName(entry: NamedEntry, format: NamingFormat): string {
  const num = entry.number === null ? null : pad(entry.number, 2);
  switch (format) {
    case 'dash':
      return num === null ? entry.label : `${num} — ${entry.label}`;
    case 'underscore':
      return num === null ? entry.label : `${num}_${entry.label}`;
    case 'dot': {
      const title = titleCase(entry.label);
      return num === null ? title : `${num}. ${title}`;
    }
    case 'plain':
      return entry.label;
  }
}

/**
 * Canonical comparison key: strips leading numbering, separators and
 * decoration; upper-cases Latin letters (Arabic is left as is).
 *   "05 — Subject" → "SUBJECT", "_GUIDES" → "GUIDES", "01_BG" → "BG"
 */
export function normalizeLayerName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/^[\s\d_.\-—–:|#·•]+/u, '')
    .replace(/[\s_.\-—–:|#·•]+$/u, '')
    .replace(/[\s_\-—–]+/gu, ' ')
    .trim()
    .toUpperCase();
}

export function resolveRole(name: string, templateLabels?: ReadonlyMap<string, LayerRole>): LayerRole | null {
  const key = normalizeLayerName(name);
  if (!key) return null;
  if (templateLabels) {
    const hit = templateLabels.get(key);
    if (hit) return hit;
  }
  for (const role of LAYER_ROLES) {
    if (ROLE_ALIASES[role].some((a) => normalizeLayerName(a) === key)) return role;
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}
