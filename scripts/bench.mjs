// npm run bench — builds tests/bench/bench.ts for Node and prints a markdown table.
import * as esbuild from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(ROOT, 'dist', '.tmp', 'bench.mjs');
await esbuild.build({ entryPoints: [join(ROOT, 'tests', 'bench', 'bench.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
const mod = await import(pathToFileURL(out).href);
console.log(await mod.runBench(ROOT));
