/** Every document command, in palette order. */

import { SHADOW_COMMANDS } from '../../effects/shadow-commands';
import { LIGHT_COMMANDS } from '../../effects/light-commands';
import { COLOR_COMMANDS } from '../../color/color-commands';
import { SHAPE_COMMANDS } from '../../shapes/shape-commands';
import { INFO_COMMANDS } from '../../infographic/info-commands';
import { RECIPE_COMMANDS } from '../../recipes/recipes';
import { GRID_COMMANDS } from '../../guides/grid-commands';
import { LAYER_COMMANDS } from '../../layers/layer-commands';
import { ARTBOARD_COMMANDS } from '../../layout/artboard-commands';
import { SPACING_COMMANDS } from '../../layout/spacing-commands';
import type { AnyCommand } from './types';

export const DOCUMENT_COMMANDS: AnyCommand[] = [
  ...RECIPE_COMMANDS,
  ...LIGHT_COMMANDS,
  ...SHADOW_COMMANDS,
  ...SHAPE_COMMANDS,
  ...COLOR_COMMANDS,
  ...INFO_COMMANDS,
  ...ARTBOARD_COMMANDS,
  ...GRID_COMMANDS,
  ...SPACING_COMMANDS,
  ...LAYER_COMMANDS,
];
