/**
 * Built-in shadow presets (Shadow v2). Each one is a complete, tested
 * parameter set for a common real-world situation.
 */

import type { ShadowPreset } from '../presets/models';
import { DEFAULT_SHADOW, type ShadowParams } from './shadow-engine';

const p = (id: string, name: string, overrides: Partial<ShadowParams>, notes: string): ShadowPreset => ({
  id,
  name,
  builtin: true,
  notes,
  params: { ...DEFAULT_SHADOW, ...overrides },
});

export const BUILTIN_SHADOW_PRESETS: readonly ShadowPreset[] = [
  p('studio-product', 'Studio product', { style: 'ground', subject: 'product', strength: 72, softness: 62, lightAngle: 320, elevation: 45 }, 'Crisp contact, soft core and a wide ambient pool — the e-commerce hero look.'),
  p('person-grounded', 'Person on the ground', { style: 'ground', subject: 'person', strength: 70, softness: 55, lightAngle: 300, elevation: 50 }, 'Tight contact under the feet plus a soft pool; works for cut-out photos.'),
  p('golden-cast', 'Golden-hour cast', { style: 'cast', subject: 'person', strength: 62, softness: 55, lightAngle: 290, elevation: 14, length: 90, color: '#2B170B' }, 'Low warm sun from the left: a long shadow falling to the right.'),
  p('noon-sun', 'Noon sun', { style: 'cast', subject: 'person', strength: 78, softness: 18, lightAngle: 340, elevation: 72 }, 'Hard, short, almost under the subject.'),
  p('backlit-hero', 'Backlit hero', { style: 'cast', subject: 'person', strength: 70, softness: 45, lightAngle: 0, elevation: 22, length: 80 }, 'Light behind the subject: the shadow comes toward the viewer.'),
  p('luxury-product', 'Luxury product', { style: 'ground', subject: 'bottle', strength: 82, softness: 35, lightAngle: 20, elevation: 55, spread: 90, color: '#0E0B08' }, 'Thin, dark contact line with a restrained pool.'),
  p('bottle-cast', 'Bottle on a table', { style: 'cast', subject: 'bottle', strength: 65, softness: 60, lightAngle: 60, elevation: 32 }, 'Soft side light from the right, shadow leaning left.'),
  p('car-grounded', 'Car grounded', { style: 'ground', subject: 'car', strength: 80, softness: 45, lightAngle: 350, elevation: 70, spread: 104 }, 'Long, flat contact along the wheelbase.'),
  p('logo-silhouette', 'Logo / type silhouette', { style: 'silhouette', subject: 'text', strength: 55, softness: 50, lightAngle: 315, elevation: 28, length: 70 }, 'Real projected shadow of vector art or live text.'),
  p('floating-card', 'Floating card (UI)', { style: 'floating', subject: 'card', floatMode: 'card', strength: 65, softness: 70, lift: 25, lightAngle: 0, elevation: 60 }, 'Two-layer elevation: soft ambient + directional key.'),
  p('hover-product', 'Hovering product', { style: 'floating', subject: 'product', floatMode: 'hover', strength: 70, softness: 70, lift: 25 }, 'The object floats; its shadow stays on the floor, softer the higher it goes.'),
  p('long-flat', 'Long shadow 45°', { style: 'long', subject: 'icon', strength: 45, softness: 20, lightAngle: 315, length: 100, footprint: 'round', radius: 24 }, 'Flat-design long shadow, clipped to the artboard.'),
  p('contact-only', 'Contact line only', { style: 'contact', subject: 'product', strength: 80, softness: 35 }, 'Just grounds the object — pair with your own lighting.'),
];
