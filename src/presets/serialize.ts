/**
 * Preset files: a versioned JSON envelope plus per-kind validation.
 *
 *   { "format": "artboard-forge.presets", "version": 1, "kind": "shadow", "presets": [ ... ] }
 *
 * Validation is hand-written (no schema dependency) and tolerant: unknown
 * fields are dropped, numeric fields are clamped by the engines when used,
 * and invalid presets are reported individually instead of failing the file.
 */

import { sanitizeShadowParams } from '../effects/shadow-engine';
import { LAYER_ROLES, NAMING_FORMATS, type LayerRole, type NamingFormat } from '../layers/naming';
import { normalizeHex } from '../utils/color';
import type { AnyPreset, GridPreset, LayerTemplate, PalettePreset, PresetKind, PresetKindMap, ShadowPreset, SpacingPreset, ArtboardSizePreset } from './models';
import { PRESET_KINDS } from './models';

export const PRESET_FORMAT = 'artboard-forge.presets';
export const PRESET_FILE_VERSION = 1;

export interface PresetFile<K extends PresetKind = PresetKind> {
  format: typeof PRESET_FORMAT;
  version: number;
  kind: K;
  exportedAt?: string;
  presets: Array<PresetKindMap[K]>;
}

export interface ParseResult<K extends PresetKind = PresetKind> {
  kind: K | null;
  presets: Array<PresetKindMap[K]>;
  errors: string[];
}

export function serializePresets<K extends PresetKind>(kind: K, presets: ReadonlyArray<PresetKindMap[K]>): string {
  const file: PresetFile<K> = {
    format: PRESET_FORMAT,
    version: PRESET_FILE_VERSION,
    kind,
    exportedAt: new Date().toISOString(),
    presets: presets.map((p) => {
      const { builtin: _builtin, ...rest } = p as AnyPreset & { builtin?: boolean };
      return rest as PresetKindMap[K];
    }),
  };
  return JSON.stringify(file, null, 2);
}

export function parsePresetFile(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { kind: null, presets: [], errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  if (!isObj(data) || data['format'] !== PRESET_FORMAT) {
    return { kind: null, presets: [], errors: ['This is not an Artboard Forge preset file.'] };
  }
  const version = Number(data['version']);
  if (!(version >= 1)) return { kind: null, presets: [], errors: ['Missing preset file version.'] };
  if (version > PRESET_FILE_VERSION) {
    return { kind: null, presets: [], errors: [`This file was made by a newer Artboard Forge (format v${version}). Update the plugin to import it.`] };
  }
  const kind = data['kind'];
  if (typeof kind !== 'string' || !(PRESET_KINDS as readonly string[]).includes(kind)) {
    return { kind: null, presets: [], errors: [`Unknown preset kind “${String(kind)}”.`] };
  }
  const list = data['presets'];
  if (!Array.isArray(list)) return { kind: kind as PresetKind, presets: [], errors: ['“presets” must be a list.'] };
  const presets: AnyPreset[] = [];
  const errors: string[] = [];
  list.forEach((raw, i) => {
    const r = validatePreset(kind as PresetKind, raw);
    if (typeof r === 'string') errors.push(`Preset #${i + 1}: ${r}`);
    else presets.push(r);
  });
  return { kind: kind as PresetKind, presets: presets as Array<PresetKindMap[PresetKind]>, errors };
}

/** Returns the cleaned preset or an error string. */
export function validatePreset(kind: PresetKind, raw: unknown): AnyPreset | string {
  if (!isObj(raw)) return 'not an object';
  const id = typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : null;
  const name = typeof raw['name'] === 'string' && raw['name'].trim() ? raw['name'].trim() : null;
  if (!id) return 'missing id';
  if (!name) return 'missing name';
  const base = { id, name, ...(typeof raw['notes'] === 'string' ? { notes: raw['notes'] } : {}) };
  switch (kind) {
    case 'shadow': {
      if (!isObj(raw['params'])) return 'missing params';
      const out: ShadowPreset = { ...base, params: sanitizeShadowParams(raw['params'] as never) };
      return out;
    }
    case 'grid': {
      const spec = raw['spec'];
      if (!isObj(spec) || !isObj(spec['margins'])) return 'missing grid spec / margins';
      const m = spec['margins'];
      for (const k of ['top', 'right', 'bottom', 'left']) if (!isNum(m[k]) || (m[k] as number) < 0) return `margin “${k}” must be a non-negative number`;
      for (const t of ['columns', 'rows'] as const) {
        const tr = spec[t];
        if (tr === undefined || tr === null) continue;
        if (!isObj(tr) || !isNum(tr['count']) || (tr['count'] as number) < 1 || !isNum(tr['gutter'])) return `${t} must have count ≥ 1 and a gutter`;
      }
      const out: GridPreset = { ...base, spec: spec as unknown as GridPreset['spec'], ...(raw['overlay'] === true ? { overlay: true } : {}) };
      return out;
    }
    case 'layerTemplate': {
      const fmt = raw['format'];
      if (typeof fmt !== 'string' || !(fmt in NAMING_FORMATS)) return 'unknown naming format';
      const layers = raw['layers'];
      if (!Array.isArray(layers) || layers.length === 0) return 'template needs at least one layer';
      const seen = new Set<string>();
      const clean: LayerTemplate['layers'] = [];
      for (const l of layers) {
        if (!isObj(l) || typeof l['role'] !== 'string' || !(LAYER_ROLES as readonly string[]).includes(l['role'])) return `invalid layer role ${JSON.stringify(isObj(l) ? l['role'] : l)}`;
        if (seen.has(l['role'])) return `role “${l['role']}” appears twice`;
        seen.add(l['role']);
        if (typeof l['label'] !== 'string' || !l['label'].trim()) return 'layer label missing';
        const number = l['number'] === null || l['number'] === undefined ? null : Number(l['number']);
        if (number !== null && !Number.isFinite(number)) return 'layer number must be a number or null';
        clean.push({
          role: l['role'] as LayerRole,
          label: l['label'].trim(),
          number,
          ...(l['printable'] === false ? { printable: false } : {}),
          ...(l['locked'] === true ? { locked: true } : {}),
        });
      }
      const out: LayerTemplate = { ...base, format: fmt as NamingFormat, layers: clean };
      return out;
    }
    case 'palette': {
      const colors = raw['colors'];
      if (!Array.isArray(colors)) return 'missing colors';
      const clean: PalettePreset['colors'] = [];
      for (const c of colors) {
        if (!isObj(c) || typeof c['name'] !== 'string') return 'colour needs a name';
        const hex = typeof c['hex'] === 'string' ? normalizeHex(c['hex']) : null;
        if (!hex) return `invalid hex for “${c['name']}”`;
        clean.push({ name: c['name'], hex, ...(typeof c['role'] === 'string' ? { role: c['role'] as never } : {}) });
      }
      const out: PalettePreset = { ...base, colors: clean };
      return out;
    }
    case 'spacing': {
      const sys = raw['system'];
      if (!isObj(sys)) return 'missing system';
      if (sys['kind'] === 'multiple' && isNum(sys['base']) && (sys['base'] as number) > 0) {
        const out: SpacingPreset = { ...base, system: { kind: 'multiple', base: sys['base'] as number } };
        return out;
      }
      if (sys['kind'] === 'scale' && Array.isArray(sys['values']) && sys['values'].every((v) => isNum(v) && v >= 0)) {
        const out: SpacingPreset = { ...base, system: { kind: 'scale', values: (sys['values'] as number[]).slice().sort((a, b) => a - b) } };
        return out;
      }
      return 'spacing system must be {kind:"multiple",base} or {kind:"scale",values}';
    }
    case 'artboard': {
      if (!isNum(raw['w']) || !isNum(raw['h']) || (raw['w'] as number) <= 0 || (raw['h'] as number) <= 0) return 'width and height must be positive';
      const cs = raw['colorSpace'] === 'CMYK' ? 'CMYK' : 'RGB';
      const out: ArtboardSizePreset = {
        ...base,
        code: typeof raw['code'] === 'string' && raw['code'] ? raw['code'] : name.toUpperCase().replace(/\W+/g, '_'),
        w: raw['w'] as number,
        h: raw['h'] as number,
        colorSpace: cs,
        ...(typeof raw['safeZone'] === 'string' ? { safeZone: raw['safeZone'] } : {}),
      };
      return out;
    }
    case 'pattern':
    case 'lighting':
    case 'export':
      // Engines not built yet: keep the data as-is (minus unknown top-level junk) so it round-trips.
      return { ...(raw as object), ...base } as AnyPreset;
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
