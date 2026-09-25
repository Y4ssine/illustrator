import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulatorAdapter } from '../../src/illustrator/sim/sim-adapter';
import type { RuntimeOptions } from '../../src/illustrator/sim/runtime';
import { PresetStore } from '../../src/presets/store';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings';
import type { PlanContext } from '../../src/core/commands/types';
import { CommandRunner } from '../../src/core/commands/runner';
import { History } from '../../src/core/commands/history';

const JSX_DIR = fileURLToPath(new URL('../../src/illustrator/jsx/', import.meta.url));

export function hostSource(): string {
  return readdirSync(JSX_DIR)
    .filter((f) => /^\d\d-.*\.jsx$/.test(f))
    .sort()
    .map((f) => readFileSync(join(JSX_DIR, f), 'utf8'))
    .join('\n');
}

export async function makeSim(opts: RuntimeOptions = {}, settings: Partial<Settings> = {}) {
  const { adapter, runtime } = createSimulatorAdapter(hostSource(), opts);
  await adapter.connect();
  const presets = new PresetStore(adapter.storage);
  const s: Settings = { ...DEFAULT_SETTINGS, ...settings };
  const history = new History();
  const runner = new CommandRunner({ host: adapter, presets, history, settings: () => s, confirm: async () => true });
  const ctx = async (): Promise<PlanContext> => ({ host: adapter, snapshot: await adapter.document.snapshot(), settings: s, presets });
  return { adapter, runtime, presets, settings: s, runner, history, ctx };
}
