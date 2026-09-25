// Build script.
//   node scripts/build.mjs            → dist/ (CEP extension, scripts-menu, simulator, self-test)
//   node scripts/build.mjs --release  → same, without the .debug remote-debugging file
//   node scripts/build.mjs --watch    → rebuild on change
//   node scripts/build.mjs --dev      → watch + serve the simulator on http://localhost:8123
import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildHostSource, escapeNonAscii, jsxFiles, JSX_DIR } from './jsx-sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const args = new Set(process.argv.slice(2));
const DEV = args.has('--dev');
const WATCH = DEV || args.has('--watch');
const RELEASE = args.has('--release');

const DIST = join(ROOT, 'dist');
const EXT = join(DIST, 'cep', 'com.artboardforge.panel');
const SIM = join(DIST, 'sim');

// CEP 11 ships Chromium 88 (Illustrator 25.3+); keep syntax at that level.
const TARGET = ['chrome88'];

const hostJsxPlugin = {
  name: 'af-host-jsx',
  setup(build) {
    build.onResolve({ filter: /^virtual:af-host-jsx$/ }, () => ({ path: 'host.jsx', namespace: 'af-host' }));
    build.onLoad({ filter: /.*/, namespace: 'af-host' }, () => ({
      contents: `export default ${JSON.stringify(buildHostSource(pkg.version))};`,
      loader: 'js',
      watchFiles: jsxFiles().map((f) => join(JSX_DIR, f)),
    }));
  },
};

function writeHost() {
  mkdirSync(join(EXT, 'jsx'), { recursive: true });
  writeFileSync(join(EXT, 'jsx', 'host.jsx'), buildHostSource(pkg.version));
}

function copyStatic() {
  mkdirSync(join(EXT, 'CSXS'), { recursive: true });
  mkdirSync(join(EXT, 'css'), { recursive: true });
  cpSync(join(ROOT, 'cep', 'CSXS', 'manifest.xml'), join(EXT, 'CSXS', 'manifest.xml'));
  cpSync(join(ROOT, 'cep', 'index.html'), join(EXT, 'index.html'));
  if (!RELEASE) cpSync(join(ROOT, 'cep', '.debug'), join(EXT, '.debug'));
  cpSync(join(ROOT, 'src', 'ui', 'styles', 'panel.css'), join(EXT, 'css', 'panel.css'));
  mkdirSync(join(SIM, 'css'), { recursive: true });
  cpSync(join(ROOT, 'src', 'ui', 'styles', 'panel.css'), join(SIM, 'css', 'panel.css'));
  cpSync(join(ROOT, 'dev', 'index.html'), join(SIM, 'index.html'));
  cpSync(join(ROOT, 'dev', 'sim.css'), join(SIM, 'sim.css'));
  const menuSrc = join(ROOT, 'scripts-menu');
  if (existsSync(menuSrc)) {
    mkdirSync(join(DIST, 'scripts-menu'), { recursive: true });
    for (const f of readdirSync(menuSrc)) cpSync(join(menuSrc, f), join(DIST, 'scripts-menu', f));
  }
}

async function generateSelfTest() {
  // Bundles the TypeScript fixture generator for Node and runs it, so the
  // in-Illustrator self-test executes exactly the ops the core produces.
  const gen = join(ROOT, 'tests', 'illustrator', 'gen-selftest.ts');
  if (!existsSync(gen)) return;
  const out = join(DIST, '.tmp', 'gen-selftest.mjs');
  await esbuild.build({ entryPoints: [gen], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
  const mod = await import(`${pathToFileURL(out).href}?t=${Date.now()}`);
  const text = await mod.generateSelfTest(buildHostSource(pkg.version), pkg.version);
  mkdirSync(join(DIST, 'tests'), { recursive: true });
  // ExtendScript files have no BOM here: keep them pure ASCII.
  writeFileSync(join(DIST, 'tests', 'af-selftest.jsx'), escapeNonAscii(text));
  const bench = await mod.generateBenchmark(buildHostSource(pkg.version), pkg.version);
  writeFileSync(join(DIST, 'tests', 'af-benchmark.jsx'), escapeNonAscii(bench));
}

const common = { bundle: true, format: 'iife', target: TARGET, sourcemap: !RELEASE, logLevel: 'info', legalComments: 'none', plugins: [hostJsxPlugin] };

async function main() {
  rmSync(DIST, { recursive: true, force: true });
  writeHost();
  copyStatic();
  const panel = { ...common, entryPoints: [join(ROOT, 'src', 'ui', 'main-cep.ts')], outfile: join(EXT, 'js', 'panel.js'), minify: RELEASE };
  const sim = { ...common, entryPoints: [join(ROOT, 'src', 'ui', 'main-sim.ts')], outfile: join(SIM, 'js', 'sim.js') };
  if (!WATCH) {
    await esbuild.build(panel);
    await esbuild.build(sim);
    await generateSelfTest();
    console.log(`✓ Built Artboard Forge ${pkg.version} → dist/`);
    return;
  }
  const rebuildStatic = {
    name: 'static',
    setup(b) {
      b.onStart(() => {
        writeHost();
        copyStatic();
      });
    },
  };
  const c1 = await esbuild.context({ ...panel, plugins: [...common.plugins, rebuildStatic] });
  const c2 = await esbuild.context(sim);
  await Promise.all([c1.watch(), c2.watch()]);
  if (DEV) {
    const { port } = await c2.serve({ servedir: SIM, port: 8123 });
    console.log(`Simulator: http://localhost:${port}/`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
