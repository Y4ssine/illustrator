// npm run package → dist/ArtboardForge-<version>.zip
// A ready-to-install bundle: extension folder, install scripts, self-test,
// benchmark and F-key trigger scripts. Zip writer is self-contained (no CLI).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { stdio: 'inherit' });

const DIST = join(ROOT, 'dist');
const TOP = `ArtboardForge-${pkg.version}`;
const entries = []; // { name, data, mode }
const addDir = (src, dest) => {
  for (const f of readdirSync(src)) {
    const p = join(src, f);
    if (statSync(p).isDirectory()) addDir(p, `${dest}/${f}`);
    else if (!f.endsWith('.map')) entries.push({ name: `${dest}/${f}`, data: readFileSync(p), mode: 0o644 });
  }
};
addDir(join(DIST, 'cep', 'com.artboardforge.panel'), `${TOP}/com.artboardforge.panel`);
addDir(join(DIST, 'tests'), `${TOP}/tests`);
addDir(join(DIST, 'scripts-menu'), `${TOP}/scripts-menu`);
for (const f of ['README-INSTALL.txt', 'install-windows.bat', 'install-mac.command']) {
  entries.push({ name: `${TOP}/${f}`, data: readFileSync(join(ROOT, 'packaging', f)), mode: f.endsWith('.command') ? 0o755 : 0o644 });
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const locals = [];
const centrals = [];
let offset = 0;
const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
for (const e of entries) {
  const name = Buffer.from(e.name, 'utf8');
  const comp = zlib.deflateRawSync(e.data, { level: 9 });
  const crc = crc32(e.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, comp);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix → permissions honoured
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(e.data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);
  offset += local.length + name.length + comp.length;
}
const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
const out = join(DIST, `${TOP}.zip`);
writeFileSync(out, Buffer.concat([...locals, centralBuf, end]));
console.log(`✓ ${relative(ROOT, out)} (${entries.length} files)`);
