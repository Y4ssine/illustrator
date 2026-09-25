/** Every document command, in palette order. */

import { SHADOW_COMMANDS } from '../../effects/shadow-commands';
import { GRID_COMMANDS } from '../../guides/grid-commands';
import { LAYER_COMMANDS } from '../../layers/layer-commands';
import { ARTBOARD_COMMANDS } from '../../layout/artboard-commands';
import { SPACING_COMMANDS } from '../../layout/spacing-commands';
import type { AnyCommand } from './types';

export const DOCUMENT_COMMANDS: AnyCommand[] = [...ARTBOARD_COMMANDS, ...GRID_COMMANDS, ...SPACING_COMMANDS, ...SHADOW_COMMANDS, ...LAYER_COMMANDS];
