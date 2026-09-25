/**
 * Built-in presets for every kind that ships in Phase 1. They are read-only;
 * "Duplicate" creates an editable user copy.
 */

import { uniformMargins } from '../geometry/rect';
import { BUILTIN_SHADOW_PRESETS } from '../effects/shadow-presets';
import { BUILTIN_LAYER_TEMPLATES } from '../layers/templates';
import { ARTBOARD_PRESETS } from '../layout/artboard-presets';
import type { AnyPreset, ArtboardSizePreset, GridPreset, PalettePreset, PresetKind, PresetKindMap, SpacingPreset } from './models';

export const BUILTIN_GRID_PRESETS: readonly GridPreset[] = [
  {
    id: 'campaign-grid',
    name: 'Campaign Grid',
    builtin: true,
    notes: '6 × 8 modular grid, 24 pt gutters, 72 pt margins, centre axes. Tuned for 1080-wide social posts.',
    spec: {
      margins: uniformMargins(72),
      columns: { count: 6, gutter: 24 },
      rows: { count: 8, gutter: 24 },
      center: true,
      marginGuides: true,
      spanArea: true,
    },
  },
  {
    id: 'twelve-column',
    name: '12 Columns',
    builtin: true,
    spec: { margins: uniformMargins(64), columns: { count: 12, gutter: 24 }, marginGuides: true, spanArea: true },
  },
  {
    id: 'poster',
    name: 'Poster (12 col + baseline + thirds)',
    builtin: true,
    notes: '12 columns, 12 pt baseline, thirds and centre axis.',
    spec: {
      margins: { top: 96, right: 72, bottom: 120, left: 72 },
      columns: { count: 12, gutter: 20 },
      baseline: { increment: 12, offset: 0 },
      thirds: true,
      center: true,
      marginGuides: true,
      spanArea: true,
    },
  },
  {
    id: 'editorial',
    name: 'Editorial (5 col, deep foot)',
    builtin: true,
    spec: {
      margins: { top: 80, right: 64, bottom: 140, left: 64 },
      columns: { count: 5, gutter: 20 },
      rows: { count: 6, gutter: 20 },
      marginGuides: true,
      spanArea: true,
    },
  },
  {
    id: 'thirds',
    name: 'Rule of Thirds',
    builtin: true,
    spec: { margins: uniformMargins(0), thirds: true, marginGuides: false },
  },
  {
    id: 'golden',
    name: 'Golden Sections',
    builtin: true,
    spec: { margins: uniformMargins(0), golden: true, center: false, marginGuides: false },
  },
  {
    id: 'diagonal',
    name: 'Diagonal Method',
    builtin: true,
    spec: { margins: uniformMargins(0), diagonals: 'fortyFive', center: true, marginGuides: false },
  },
  {
    id: 'baseline-8',
    name: 'Baseline 8',
    builtin: true,
    spec: { margins: uniformMargins(64), baseline: { increment: 8, offset: 0 }, marginGuides: true },
  },
  {
    id: 'radial-12',
    name: 'Radial 12 spokes',
    builtin: true,
    spec: { margins: uniformMargins(0), radial: { spokes: 12 }, center: true, marginGuides: false },
  },
];

export const BUILTIN_SPACING_PRESETS: readonly SpacingPreset[] = [
  { id: 'sp-4', name: '4 px system', builtin: true, system: { kind: 'multiple', base: 4 } },
  { id: 'sp-8', name: '8 px system', builtin: true, system: { kind: 'multiple', base: 8 } },
  { id: 'sp-10', name: '10 px system', builtin: true, system: { kind: 'multiple', base: 10 } },
  { id: 'sp-12', name: '12 px system', builtin: true, system: { kind: 'multiple', base: 12 } },
  {
    id: 'sp-tokens',
    name: 'Token scale (4 → 128)',
    builtin: true,
    system: { kind: 'scale', values: [4, 8, 12, 16, 24, 32, 48, 64, 96, 128] },
    tokens: { XS: 4, S: 8, M: 16, L: 32, XL: 64 },
  },
];

/**
 * Example campaign palettes. These are editable starting points, NOT official
 * brand or national colour specifications. Always use the colour values from
 * the client's own brand guidelines.
 */
export const BUILTIN_PALETTES: readonly PalettePreset[] = [
  {
    id: 'pal-green-sand',
    name: 'Green & Sand (example)',
    builtin: true,
    notes: 'Illustrative example palette — not an official specification.',
    colors: [
      { name: 'Campaign Green', hex: '#0B6B3A', role: 'primary' },
      { name: 'Deep Green', hex: '#063D24', role: 'secondary' },
      { name: 'Sand', hex: '#D8C3A0', role: 'background' },
      { name: 'Warm Beige', hex: '#EFE3CF', role: 'background' },
      { name: 'Antique Gold', hex: '#B08D4A', role: 'accent' },
      { name: 'Warm White', hex: '#FAF6EE', role: 'neutral' },
      { name: 'Charcoal', hex: '#2A2A28', role: 'text' },
    ],
  },
  {
    id: 'pal-night-gold',
    name: 'Night & Gold (example)',
    builtin: true,
    notes: 'Illustrative example palette.',
    colors: [
      { name: 'Night', hex: '#0F1A17', role: 'background' },
      { name: 'Oasis Green', hex: '#1F5C45', role: 'primary' },
      { name: 'Gold', hex: '#C9A45C', role: 'accent' },
      { name: 'Dune', hex: '#E6D5B8', role: 'neutral' },
      { name: 'Ivory', hex: '#FBF7EF', role: 'text' },
    ],
  },
];

export const BUILTIN_ARTBOARD_PRESETS: readonly ArtboardSizePreset[] = ARTBOARD_PRESETS.map((p) => ({
  id: p.id,
  name: p.name,
  builtin: true,
  code: p.code,
  w: p.w,
  h: p.h,
  colorSpace: p.colorSpace,
  ...(p.safeZone ? { safeZone: p.safeZone } : {}),
}));

export const BUILTIN_PRESETS: { [K in PresetKind]: ReadonlyArray<PresetKindMap[K]> } = {
  shadow: BUILTIN_SHADOW_PRESETS,
  grid: BUILTIN_GRID_PRESETS,
  layerTemplate: BUILTIN_LAYER_TEMPLATES,
  palette: BUILTIN_PALETTES,
  spacing: BUILTIN_SPACING_PRESETS,
  artboard: BUILTIN_ARTBOARD_PRESETS,
  pattern: [],
  lighting: [],
  export: [],
};

export function allBuiltins(): AnyPreset[] {
  return Object.values(BUILTIN_PRESETS).flat() as AnyPreset[];
}
