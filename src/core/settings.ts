import type { Unit } from '../geometry/units';
import type { BoundsMode } from './snapshot';
import type { NamingFormat } from '../layers/naming';
import type { ArtboardMode } from '../layout/artboard-engine';

export interface Settings {
  units: Unit;
  density: 'compact' | 'comfortable';
  /** Layout direction. 'rtl' keeps the right-most item fixed when spacing horizontally. */
  direction: 'rtl' | 'ltr';
  boundsMode: BoundsMode;
  spacingPreset: string;
  shadowPreset: string;
  shadowPlacement: 'belowSubject' | 'shadowLayer';
  gridPreset: string;
  layerTemplate: string;
  /** Overrides the template's own naming format when set. */
  namingFormat: NamingFormat | null;
  /** Name of the guide layer created when no guides layer exists yet. */
  guideLayerName: string;
  artboardSpacing: number;
  artboardNamePattern: string;
  artboardMode: ArtboardMode;
  safeMode: boolean;
  /** Selection polling interval in ms (the host has no selection-change event). */
  pollInterval: number;
  favorites: string[];
  /** Recently used command ids, newest first. */
  recent: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'px',
  density: 'compact',
  direction: 'rtl',
  boundsMode: 'visible',
  spacingPreset: 'sp-8',
  shadowPreset: 'soft-social',
  shadowPlacement: 'belowSubject',
  gridPreset: 'campaign-grid',
  layerTemplate: 'campaign-standard',
  namingFormat: null,
  guideLayerName: '_GUIDES',
  artboardSpacing: 100,
  artboardNamePattern: '{CODE}_{nn}',
  artboardMode: 'auto',
  safeMode: true,
  pollInterval: 700,
  favorites: ['artboard.ig-portrait', 'grid.build', 'shadow.ground', 'spacing.normalize', 'layers.organize'],
  recent: [],
};

export function mergeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const r = raw as Partial<Settings>;
  const out: Settings = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    const v = r[key];
    if (v === undefined) continue;
    const d = DEFAULT_SETTINGS[key];
    if (d === null || typeof v === typeof d) (out as unknown as Record<string, unknown>)[key] = v;
  }
  if (!Array.isArray(out.favorites)) out.favorites = [...DEFAULT_SETTINGS.favorites];
  if (!Array.isArray(out.recent)) out.recent = [];
  out.pollInterval = Math.min(5000, Math.max(300, Number(out.pollInterval) || DEFAULT_SETTINGS.pollInterval));
  return out;
}
