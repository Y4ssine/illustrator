/**
 * Built-in layer templates.
 *
 * `layers` is listed in Layers-panel order: first entry = top of the panel
 * (front-most). Numbers are part of the visible name only; stacking comes from
 * list order. Utility layers (guides, notes) sit on top and do not print.
 *
 * Note on SHADOWS: the default shadow placement is "directly below the
 * subject, on the subject's layer", which composites correctly regardless of
 * where the SHADOWS layer sits. The SHADOWS layer is used when the user
 * switches placement to "Shadows layer".
 */

import type { LayerTemplate } from '../presets/models';

export const CAMPAIGN_STANDARD: LayerTemplate = {
  id: 'campaign-standard',
  name: 'Campaign Standard',
  builtin: true,
  format: 'dash',
  layers: [
    { role: 'guides', label: 'GUIDES', number: 0, printable: false },
    { role: 'notes', label: 'NOTES', number: 12, printable: false },
    { role: 'brand', label: 'BRAND', number: 11 },
    { role: 'typography', label: 'TYPOGRAPHY', number: 10 },
    { role: 'texture', label: 'TEXTURE', number: 9 },
    { role: 'lighting', label: 'LIGHTING', number: 8 },
    { role: 'shadows', label: 'SHADOWS', number: 7 },
    { role: 'foreground', label: 'FOREGROUND', number: 6 },
    { role: 'subject', label: 'SUBJECT', number: 5 },
    { role: 'midground', label: 'MIDGROUND', number: 4 },
    { role: 'architecture', label: 'ARCHITECTURE', number: 3 },
    { role: 'atmosphere', label: 'ATMOSPHERE', number: 2 },
    { role: 'background', label: 'BACKGROUND', number: 1 },
  ],
};

export const SAUDI_CAMPAIGN: LayerTemplate = {
  id: 'saudi-campaign',
  name: 'Saudi Campaign Workspace',
  builtin: true,
  format: 'dash',
  notes: 'Layer and grid workflow only. Inserts no logos, emblems or artwork.',
  layers: [
    { role: 'guides', label: 'GUIDES', number: 0, printable: false },
    { role: 'brand', label: 'BRAND', number: 11 },
    { role: 'typography', label: 'TYPOGRAPHY', number: 10 },
    { role: 'decorations', label: 'DECORATIONS', number: 9 },
    { role: 'lighting', label: 'LIGHTING', number: 8 },
    { role: 'shadows', label: 'SHADOWS', number: 7 },
    { role: 'foreground', label: 'FOREGROUND', number: 6 },
    { role: 'subject', label: 'HERO', number: 5 },
    { role: 'midground', label: 'MIDGROUND', number: 4 },
    { role: 'atmosphere', label: 'ATMOSPHERE', number: 3 },
    { role: 'architecture', label: 'ARCHITECTURE', number: 2 },
    { role: 'background', label: 'BACKGROUND', number: 1 },
  ],
};

export const DEPTH_STACK: LayerTemplate = {
  id: 'depth-stack',
  name: 'Depth Stack',
  builtin: true,
  format: 'dash',
  notes: 'Numbers follow the depth list (01 = nearest); stacking keeps type and branding in front.',
  layers: [
    { role: 'brand', label: 'BRANDING', number: 9 },
    { role: 'typography', label: 'TYPOGRAPHY', number: 8 },
    { role: 'texture', label: 'TEXTURE', number: 7 },
    { role: 'lighting', label: 'LIGHTING', number: 6 },
    { role: 'foreground', label: 'FOREGROUND', number: 1 },
    { role: 'subject', label: 'SUBJECT', number: 2 },
    { role: 'midground', label: 'MIDGROUND', number: 3 },
    { role: 'atmosphere', label: 'ATMOSPHERE', number: 5 },
    { role: 'background', label: 'BACKGROUND', number: 4 },
  ],
};

export const BUILTIN_LAYER_TEMPLATES: readonly LayerTemplate[] = [CAMPAIGN_STANDARD, SAUDI_CAMPAIGN, DEPTH_STACK];
