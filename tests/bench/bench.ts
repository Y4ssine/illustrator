/**
 * Benchmark (spec §90): 50 / 500 / 5,000 objects.
 *
 * Two kinds of numbers:
 *  - "engine": the pure TypeScript planners (what runs in the panel)
 *  - "sim host": the real ExtendScript host code running on the mock DOM in
 *    Node. This measures our algorithmic cost, NOT Illustrator's DOM speed,
 *    which is typically 10–100× slower per property access. Real numbers come
 *    from dist/tests/af-benchmark.jsx run inside Illustrator.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSimulatorAdapter } from '../../src/illustrator/sim/sim-adapter';
import { createDocument, ENUMS } from '../../src/illustrator/sim/mock-dom';
import { rectItem } from '../../src/illustrator/sim/sample-doc';
import { PresetStore } from '../../src/presets/store';
import { PRESET_KINDS } from '../../src/presets/models';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { CommandRunner } from '../../src/core/commands/runner';
import { History } from '../../src/core/commands/history';
import { gridBuild } from '../../src/guides/grid-commands';
import { spacingNormalize } from '../../src/layout/spacing-commands';
import { layersOrganize } from '../../src/layers/layer-commands';
import { planSpacing, SPACING_SYSTEMS } from '../../src/layout/spacing-engine';
import { computeGrid } from '../../src/guides/grid-engine';
import { createRng } from '../../src/utils/random';

function hostSource(root: string): string {
  const dir = join(root, 'src', 'illustrator', 'jsx');
  return readdirSync(dir)
    .filter((f) => /^\d\d-.*\.jsx$/.test(f))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

async function time<T>(fn: () => Promise<T> | T): Promise<[number, T]> {
  const t0 = performance.now();
  const r = await fn();
  return [performance.now() - t0, r];
}

export async function runBench(root: string): Promise<string> {
  const src = hostSource(root);
  const rows: string[] = ['| Objects | Startup | Selection analysis | Grid creation | Spacing normalize | Layer organize | Document scan | Randomizer (engine only) |', '|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for (const n of [50, 500, 5000]) {
    const [startup, env] = await time(async () => {
      const { adapter, runtime } = createSimulatorAdapter(src);
      await adapter.connect();
      const presets = new PresetStore(adapter.storage);
      await presets.loadAll(PRESET_KINDS);
      return { adapter, runtime, presets };
    });
    const { adapter, runtime, presets } = env;
    const settings = { ...DEFAULT_SETTINGS };
    const runner = new CommandRunner({ host: adapter, presets, history: new History(), settings: () => settings, confirm: async () => true });
    const doc = createDocument(runtime.app, `bench-${n}.ai`, ENUMS.DocumentColorSpace.RGB, 1080, 1350);
    const layer = doc._layers[0]!;
    const cols = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) rectItem(layer, `item ${i}`, (i % cols) * 12.3, Math.floor(i / cols) * 9.1, 8, 6, '#888888');
    doc.selection = doc.pageItems;
    const [analysis] = await time(() => adapter.document.snapshot({ maxItems: 10000 }));
    const [grid] = await time(() => runner.run(gridBuild, gridBuild.defaultParams({ settings, presets })));
    const [spacing] = await time(() => runner.run(spacingNormalize, { operation: { kind: 'normalize' }, axis: 'x' }));
    doc.selection = doc.pageItems.filter((i) => i._name.startsWith('item'));
    const [organize] = await time(() => runner.run(layersOrganize, { ...layersOrganize.defaultParams({ settings, presets }), accepted: [] }));
    const [scan] = await time(() => adapter.document.scanTagged({ limit: 50000 }));
    const [rand] = await time(() => {
      const rng = createRng('bench');
      let s = 0;
      for (let i = 0; i < n; i++) s += rng.jitter(20, 'gaussian') + rng.jitter(12) + rng.range(0.92, 1.08);
      return s;
    });
    const f = (ms: number): string => `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`;
    rows.push(`| ${n.toLocaleString('en-US')} | ${f(startup)} | ${f(analysis)} | ${f(grid)} | ${f(spacing)} | ${f(organize)} | ${f(scan)} | ${f(rand)} |`);
  }

  // Pure engines at 5,000 items.
  const items = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), rect: { x: i * 11, y: 0, w: 8, h: 8 } }));
  const [sp] = await time(() => planSpacing(items, { kind: 'normalize' }, { axis: 'x', anchor: 'start', system: SPACING_SYSTEMS['8']! }));
  const [gr] = await time(() => computeGrid({ x: 0, y: 0, w: 1080, h: 1350 }, { margins: { top: 64, right: 64, bottom: 64, left: 64 }, columns: { count: 24, gutter: 8 }, rows: { count: 24, gutter: 8 }, baseline: { increment: 4, offset: 0 } }));
  return [
    '### Simulator host (real host script on the mock DOM, Node)',
    '',
    ...rows,
    '',
    '### Pure engines',
    '',
    `- Spacing plan for 5,000 items: ${sp.toFixed(1)} ms`,
    `- Dense grid (24×24 + 4 pt baseline): ${gr.toFixed(1)} ms`,
    '',
  ].join('\n');
}
