/**
 * Built-in shadow presets. Every preset is expressible with the ellipse
 * shadow model implemented today. Presets that need a true cast/perspective
 * shadow (e.g. "Architectural") are deliberately not shipped until the cast
 * shadow engine exists (Phase 2).
 */

import type { ShadowPreset } from '../presets/models';
import { DEFAULT_AMBIENT, SHADOW_DEFAULTS, type ShadowParams } from './shadow-engine';

const p = (id: string, name: string, overrides: Partial<ShadowParams> & Pick<ShadowParams, 'kind'>, notes: string): ShadowPreset => ({
  id,
  name,
  builtin: true,
  notes,
  params: { ...SHADOW_DEFAULTS[overrides.kind], ...overrides, ambient: { ...DEFAULT_AMBIENT, ...(overrides.ambient ?? {}) } },
});

export const BUILTIN_SHADOW_PRESETS: readonly ShadowPreset[] = [
  p('soft-social', 'Soft Social Media', { kind: 'ground', widthScale: 0.95, flatness: 0.16, softness: 0.85, opacity: 26 }, 'Gentle, wide, low contrast. Safe default for feeds.'),
  p('person-grounded', 'Person Grounded', { kind: 'contactAmbient', widthScale: 0.55, flatness: 0.07, softness: 0.4, opacity: 58, ambient: { widthScale: 1.2, flatness: 0.18, softness: 0.95, opacity: 20 } }, 'Tight contact under the feet plus a soft ambient pool.'),
  p('product-photo', 'Product Photography', { kind: 'contactAmbient', widthScale: 0.85, flatness: 0.08, softness: 0.3, opacity: 62, ambient: { widthScale: 1.25, flatness: 0.16, softness: 0.9, opacity: 24 } }, 'Studio product on a sweep: crisp contact, soft spread.'),
  p('luxury-product', 'Luxury Product', { kind: 'contactAmbient', widthScale: 0.8, flatness: 0.05, softness: 0.25, opacity: 70, color: '#0E0B08', ambient: { widthScale: 1.1, flatness: 0.12, softness: 0.95, opacity: 16 } }, 'Very thin, dark contact line with a restrained halo.'),
  p('floating-card', 'Floating Card', { kind: 'ground', widthScale: 0.82, flatness: 0.12, softness: 0.95, opacity: 22, offsetY: 8 }, 'Detached from the object to suggest lift.'),
  p('car-grounded', 'Car Grounded', { kind: 'contactAmbient', widthScale: 0.92, flatness: 0.09, softness: 0.3, opacity: 65, ambient: { widthScale: 1.08, flatness: 0.2, softness: 0.85, opacity: 26 } }, 'Long, flat contact along the wheelbase.'),
  p('poster-dramatic', 'Poster Dramatic (ground)', { kind: 'ground', widthScale: 1.25, flatness: 0.12, softness: 0.55, opacity: 48, color: '#000000' }, 'High-contrast ground pool for bold posters.'),
  p('sunset', 'Sunset (long ground)', { kind: 'ground', widthScale: 1.9, flatness: 0.07, softness: 0.8, opacity: 30, offsetX: 55, color: '#2A1608' }, 'Low sun: elongated, warm, pushed away from the light.'),
  p('studio-left', 'Studio Left', { kind: 'ground', widthScale: 1.05, flatness: 0.13, softness: 0.7, opacity: 32, offsetX: 14, rotation: -3 }, 'Key light from the left; shadow falls right.'),
  p('studio-right', 'Studio Right', { kind: 'ground', widthScale: 1.05, flatness: 0.13, softness: 0.7, opacity: 32, offsetX: -14, rotation: 3 }, 'Key light from the right; shadow falls left.'),
  p('soft-noon', 'Soft Noon', { kind: 'ground', widthScale: 0.75, flatness: 0.2, softness: 0.9, opacity: 28 }, 'Overhead diffuse light: small, round, soft.'),
  p('hard-noon', 'Hard Noon', { kind: 'ground', widthScale: 0.7, flatness: 0.18, softness: 0.2, opacity: 45 }, 'Overhead direct sun: compact and crisp.'),
];
