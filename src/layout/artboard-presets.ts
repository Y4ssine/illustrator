/**
 * Artboard size presets (points; 1 pt == 1 px in RGB documents).
 * Platform sizes are the commonly recommended upload sizes; they are data and
 * can be overridden with user presets.
 */

export interface ArtboardPreset {
  id: string;
  name: string;
  /** Short prefix used for auto-numbered names, e.g. IG_PORTRAIT_01. */
  code: string;
  w: number;
  h: number;
  colorSpace: 'RGB' | 'CMYK';
  /** Suggested safe-zone preset id. */
  safeZone?: string;
  group: 'Social' | 'Screen' | 'Print';
}

const mm = (v: number): number => (v * 72) / 25.4;

export const ARTBOARD_PRESETS: readonly ArtboardPreset[] = [
  { id: 'ig-square', name: 'Instagram Square', code: 'IG_SQUARE', w: 1080, h: 1080, colorSpace: 'RGB', group: 'Social' },
  { id: 'ig-portrait', name: 'Instagram Portrait', code: 'IG_PORTRAIT', w: 1080, h: 1350, colorSpace: 'RGB', safeZone: 'ig-portrait-grid', group: 'Social' },
  { id: 'ig-story', name: 'Instagram Story', code: 'IG_STORY', w: 1080, h: 1920, colorSpace: 'RGB', safeZone: 'ig-story', group: 'Social' },
  { id: 'x-post', name: 'X / Twitter Post', code: 'X_POST', w: 1600, h: 900, colorSpace: 'RGB', group: 'Social' },
  { id: 'linkedin-square', name: 'LinkedIn Square', code: 'LI_SQUARE', w: 1200, h: 1200, colorSpace: 'RGB', group: 'Social' },
  { id: 'linkedin-landscape', name: 'LinkedIn Landscape', code: 'LI_LANDSCAPE', w: 1200, h: 627, colorSpace: 'RGB', group: 'Social' },
  { id: 'youtube-thumb', name: 'YouTube Thumbnail', code: 'YT_THUMB', w: 1280, h: 720, colorSpace: 'RGB', safeZone: 'action-safe-5', group: 'Social' },
  { id: 'presentation', name: 'Presentation 16:9', code: 'SLIDE', w: 1920, h: 1080, colorSpace: 'RGB', safeZone: 'title-safe-10', group: 'Screen' },
  { id: 'a4', name: 'A4 Portrait', code: 'A4', w: mm(210), h: mm(297), colorSpace: 'CMYK', safeZone: 'print-5mm', group: 'Print' },
  { id: 'a3', name: 'A3 Portrait', code: 'A3', w: mm(297), h: mm(420), colorSpace: 'CMYK', safeZone: 'print-5mm', group: 'Print' },
];

export function findArtboardPreset(id: string): ArtboardPreset | undefined {
  return ARTBOARD_PRESETS.find((p) => p.id === id);
}
