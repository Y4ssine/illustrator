/**
 * Plugin data model. Every preset kind is plain JSON so it can be exported,
 * imported, versioned and diffed. Kinds whose engines are not built yet
 * (pattern, lighting, palette application) still have their models defined
 * here so presets can be authored and stored ahead of the feature.
 */

import type { Margins } from '../geometry/rect';
import type { BlendMode } from '../core/protocol';
import type { ShadowParams } from '../effects/shadow-engine';
import type { GridSpec } from '../guides/grid-engine';
import type { LayerRole, NamingFormat } from '../layers/naming';

export interface PresetBase {
  id: string;
  name: string;
  /** Built-in presets are read-only; "Duplicate" makes an editable copy. */
  builtin?: boolean;
  notes?: string;
}

export interface ShadowPreset extends PresetBase {
  params: ShadowParams;
}

export interface GridPreset extends PresetBase {
  spec: GridSpec;
  /** Also draw column/row fills on a non-printing layer. */
  overlay?: boolean;
}

export interface LayerTemplateEntry {
  role: LayerRole;
  label: string;
  number: number | null;
  printable?: boolean;
  locked?: boolean;
}

export interface LayerTemplate extends PresetBase {
  format: NamingFormat;
  /** Layers-panel order, top (front) first. */
  layers: LayerTemplateEntry[];
}

export interface PaletteColor {
  name: string;
  hex: string;
  role?: 'primary' | 'secondary' | 'accent' | 'neutral' | 'background' | 'text';
}

export interface PalettePreset extends PresetBase {
  colors: PaletteColor[];
}

export interface SpacingPreset extends PresetBase {
  system: { kind: 'multiple'; base: number } | { kind: 'scale'; values: number[] };
  tokens?: Record<string, number>;
}

export interface ArtboardSizePreset extends PresetBase {
  code: string;
  w: number;
  h: number;
  colorSpace: 'RGB' | 'CMYK';
  safeZone?: string;
}

export interface PatternPreset extends PresetBase {
  type: 'triangle' | 'diamond' | 'square' | 'hexagon' | 'star' | 'interlock' | 'lines' | 'weave';
  cellSize: number;
  spacing: number;
  strokeWidth: number;
  rotation: number;
  offset: number;
  alternation: number;
  symmetry: number;
  density: number;
  /** Always procedural and labelled "inspired by"; never claims historical authenticity. */
  inspiration?: string;
}

export interface LightingPreset extends PresetBase {
  type: 'spotlight' | 'radialGlow' | 'beam' | 'topLight' | 'window' | 'sunset' | 'edge' | 'floor';
  angle: number;
  spread: number;
  strength: number;
  falloff: number;
  color: string;
  blend: BlendMode;
  opacity: number;
}

export interface ExportPreset extends PresetBase {
  format: 'png' | 'jpeg' | 'svg' | 'pdf';
  scales: number[];
  transparent: boolean;
  namePattern: string;
}

export interface DesignTokens {
  spacing: Record<string, number>;
  radii: Record<string, number>;
  colors: Record<string, string>;
  shadows: Record<string, string>;
}

export interface PresetKindMap {
  shadow: ShadowPreset;
  grid: GridPreset;
  layerTemplate: LayerTemplate;
  palette: PalettePreset;
  spacing: SpacingPreset;
  artboard: ArtboardSizePreset;
  pattern: PatternPreset;
  lighting: LightingPreset;
  export: ExportPreset;
}

export type PresetKind = keyof PresetKindMap;

export const PRESET_KINDS: readonly PresetKind[] = [
  'shadow',
  'grid',
  'layerTemplate',
  'palette',
  'spacing',
  'artboard',
  'pattern',
  'lighting',
  'export',
];

export const PRESET_KIND_LABEL: Record<PresetKind, string> = {
  shadow: 'Shadow',
  grid: 'Grid',
  layerTemplate: 'Layer template',
  palette: 'Palette',
  spacing: 'Spacing',
  artboard: 'Artboard size',
  pattern: 'Pattern',
  lighting: 'Lighting',
  export: 'Export',
};

export type AnyPreset = PresetKindMap[PresetKind];

export type { Margins };
