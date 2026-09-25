/**
 * Safe-zone presets.
 *
 * IMPORTANT: platform UI overlays change often and are not formally
 * published. These values are commonly cited working guidance, shipped as
 * editable starting points — not platform specifications. The UI says so.
 */

import type { Margins } from '../geometry/rect';

export interface SafeZonePreset {
  id: string;
  name: string;
  /** Artboard size the insets were designed for; insets scale proportionally to other sizes. */
  reference: { w: number; h: number };
  inset: Margins;
  note: string;
}

export const SAFE_ZONES: readonly SafeZonePreset[] = [
  {
    id: 'ig-story',
    name: 'Instagram Story (UI overlays)',
    reference: { w: 1080, h: 1920 },
    inset: { top: 250, right: 64, bottom: 250, left: 64 },
    note: 'Keeps key content clear of the profile bar and reply field. Approximate; check the current app.',
  },
  {
    id: 'ig-reel',
    name: 'Instagram Reel cover/overlay',
    reference: { w: 1080, h: 1920 },
    inset: { top: 220, right: 140, bottom: 420, left: 64 },
    note: 'Extra room for the caption block and the action column on the right. Approximate.',
  },
  {
    id: 'ig-portrait-grid',
    name: 'Instagram Portrait → 3:4 profile grid crop',
    reference: { w: 1080, h: 1350 },
    inset: { top: 0, right: 34, bottom: 0, left: 34 },
    note: 'Profile grids crop 4:5 posts to roughly 3:4. Approximate.',
  },
  {
    id: 'title-safe-10',
    name: 'Title safe (10%)',
    reference: { w: 1920, h: 1080 },
    inset: { top: 108, right: 192, bottom: 108, left: 192 },
    note: 'Broadcast convention, useful for presentations and video frames.',
  },
  {
    id: 'action-safe-5',
    name: 'Action safe (5%)',
    reference: { w: 1920, h: 1080 },
    inset: { top: 54, right: 96, bottom: 54, left: 96 },
    note: 'Broadcast convention.',
  },
  {
    id: 'print-5mm',
    name: 'Print safe 5 mm inside trim',
    reference: { w: 595.276, h: 841.89 },
    inset: { top: 14.173, right: 14.173, bottom: 14.173, left: 14.173 },
    note: 'Fixed 5 mm; does not scale with the artboard.',
  },
];

/** Scale a preset's insets to an artboard of a different size (fixed-size presets are not scaled). */
export function scaledInset(preset: SafeZonePreset, w: number, h: number): Margins {
  if (preset.id === 'print-5mm') return { ...preset.inset };
  const sx = w / preset.reference.w;
  const sy = h / preset.reference.h;
  return {
    top: preset.inset.top * sy,
    bottom: preset.inset.bottom * sy,
    left: preset.inset.left * sx,
    right: preset.inset.right * sx,
  };
}
