import type { Unit } from '../geometry/units';
import type { BoundsMode } from './snapshot';
import type { NamingFormat } from '../layers/naming';
import type { ArtboardMode } from '../layout/artboard-engine';
import { DEFAULT_RIG, type LightRig } from '../effects/light-engine';

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
  /** Scene light shared by the Light and Shadow tabs. */
  lightRig: LightRig;
  /** Active brand palette (hex), e.g. extracted from a logo. Null = built-in palette. */
  palette: string[] | null;
  /** Font candidates (PostScript names) for generated Arabic / Latin text. First installed wins. */
  fontsArabic: string[];
  fontsLatin: string[];
  /** Digits in generated numbers: Western (123) or Arabic-Indic (١٢٣). */
  digits: 'western' | 'arabic';
  /** Use Gaussian Blur live effects in lights and shadows. */
  liveBlur: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  units: 'px',
  density: 'compact',
  direction: 'rtl',
  boundsMode: 'visible',
  spacingPreset: 'sp-8',
  shadowPreset: 'studio-product',
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
  favorites: ['artboard.ig-portrait', 'grid.build', 'shadow.create', 'light.scene', 'info.statCards'],
  recent: [],
  lightRig: { ...DEFAULT_RIG },
  palette: null,
  fontsArabic: ['Tajawal-Bold', 'Cairo-Bold', 'Almarai-Bold', 'DINNextLTArabic-Bold', 'NotoKufiArabic-Bold', 'MyriadArabic-Bold', 'ArialMT'],
  fontsLatin: ['Montserrat-Bold', 'Inter-Bold', 'Poppins-Bold', 'MyriadPro-Bold', 'Arial-BoldMT'],
  digits: 'western',
  liveBlur: true,
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
  if (!out.lightRig || typeof out.lightRig.angle !== 'number') out.lightRig = { ...DEFAULT_RIG };
  else out.lightRig = { ...DEFAULT_RIG, ...out.lightRig };
  if (out.palette !== null && (!Array.isArray(out.palette) || out.palette.some((c) => typeof c !== 'string'))) out.palette = null;
  for (const k of ['fontsArabic', 'fontsLatin'] as const) if (!Array.isArray(out[k]) || out[k].length === 0) out[k] = [...DEFAULT_SETTINGS[k]];
  if (out.digits !== 'arabic') out.digits = 'western';
  out.pollInterval = Math.min(5000, Math.max(300, Number(out.pollInterval) || DEFAULT_SETTINGS.pollInterval));
  return out;
}
