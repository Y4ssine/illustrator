// Verifies the ExtendScript host is valid ECMAScript 3 (what Illustrator's
// ExtendScript engine runs) and pure ASCII. Catches trailing commas, let/const,
// arrow functions, reserved words used as property names, etc.
import { parse } from 'acorn';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildHostSource, jsxFiles, JSX_DIR } from './jsx-sources.mjs';

let failed = false;
const check = (name, src) => {
  try {
    parse(src, { ecmaVersion: 3, sourceType: 'script', allowReserved: false, locations: true });
  } catch (e) {
    failed = true;
    console.error(`✗ ${name}: ${e.message}`);
  }
};

for (const f of jsxFiles()) {
  const src = readFileSync(join(JSX_DIR, f), 'utf8');
  check(f, src);
  src.split('\n').forEach((line, i) => {
    if (/\.(forEach|map|filter|reduce|indexOf|some|every)\(/.test(line) && !/String\(|\.name\)\.indexOf|\$\.os\.indexOf/.test(line)) {
      console.warn(`! ${f}:${i + 1} uses an ES5 array method? ${line.trim()}`);
    }
    if (/\bJSON\./.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line)) {
      failed = true;
      console.error(`✗ ${f}:${i + 1} uses JSON (not available in ExtendScript)`);
    }
  });
}
const bundle = buildHostSource();
check('host.jsx (bundle)', bundle);
if (/[^\x00-\x7f]/.test(bundle)) {
  failed = true;
  console.error('✗ host.jsx contains non-ASCII characters');
}
// Trigger scripts and (when built) the generated self-test/benchmark.
const extra = [...readdirSafe('scripts-menu'), ...readdirSafe('dist/tests'), ...readdirSafe('dist/cep/com.artboardforge.panel/jsx')];
for (const f of extra) {
  try {
    check(f, readFileSync(f, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
function readdirSafe(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.jsx')).map((f) => join(dir, f));
  } catch {
    return [];
  }
}
if (failed) process.exit(1);
console.log(`✓ ExtendScript sources are valid ES3 (${jsxFiles().length} files + bundle)`);
