import { describe, expect, it } from 'vitest';
import { parsePresetFile, serializePresets, validatePreset, PRESET_FORMAT } from '../../src/presets/serialize';
import { PresetStore } from '../../src/presets/store';
import { BUILTIN_PRESETS } from '../../src/presets/builtin';
import { PRESET_KINDS } from '../../src/presets/models';
import type { StorageAdapter } from '../../src/core/host';

function memoryStorage(): StorageAdapter & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    read: async (k) => data.get(k) ?? null,
    write: async (k, v) => {
      data.set(k, v);
    },
    importFile: async () => null,
    exportFile: async () => null,
  };
}

describe('preset serialization', () => {
  it('round-trips every built-in preset kind', () => {
    for (const kind of PRESET_KINDS) {
      const list = BUILTIN_PRESETS[kind];
      const text = serializePresets(kind, list);
      const parsed = parsePresetFile(text);
      expect(parsed.errors).toEqual([]);
      expect(parsed.kind).toBe(kind);
      expect(parsed.presets.map((p) => p.id)).toEqual(list.map((p) => p.id));
      expect(parsed.presets.some((p) => (p as { builtin?: boolean }).builtin)).toBe(false);
    }
  });

  it('rejects foreign or future files clearly', () => {
    expect(parsePresetFile('{nope').errors[0]).toMatch(/Not valid JSON/);
    expect(parsePresetFile('{"format":"other"}').errors[0]).toMatch(/not an Artboard Forge preset/);
    expect(parsePresetFile(JSON.stringify({ format: PRESET_FORMAT, version: 99, kind: 'grid', presets: [] })).errors[0]).toMatch(/newer Artboard Forge/);
    expect(parsePresetFile(JSON.stringify({ format: PRESET_FORMAT, version: 1, kind: 'wat', presets: [] })).errors[0]).toMatch(/Unknown preset kind/);
  });

  it('reports invalid presets individually', () => {
    const r = parsePresetFile(
      JSON.stringify({
        format: PRESET_FORMAT,
        version: 1,
        kind: 'palette',
        presets: [
          { id: 'a', name: 'Good', colors: [{ name: 'Green', hex: '#0b6b3a' }] },
          { id: 'b', name: 'Bad', colors: [{ name: 'X', hex: 'green' }] },
          { name: 'no id', colors: [] },
        ],
      }),
    );
    expect(r.presets).toHaveLength(1);
    expect((r.presets[0] as { colors: Array<{ hex: string }> }).colors[0]!.hex).toBe('#0B6B3A');
    expect(r.errors).toHaveLength(2);
  });

  it('validates layer templates and grids', () => {
    expect(validatePreset('layerTemplate', { id: 't', name: 'T', format: 'dash', layers: [{ role: 'nope', label: 'X', number: 1 }] })).toMatch(/invalid layer role/);
    expect(validatePreset('layerTemplate', { id: 't', name: 'T', format: 'dash', layers: [{ role: 'subject', label: 'A', number: 1 }, { role: 'subject', label: 'B', number: 2 }] })).toMatch(/twice/);
    expect(validatePreset('grid', { id: 'g', name: 'G', spec: { margins: { top: -1, right: 0, bottom: 0, left: 0 } } })).toMatch(/margin/);
    expect(typeof validatePreset('grid', { id: 'g', name: 'G', spec: { margins: { top: 1, right: 0, bottom: 0, left: 0 }, columns: { count: 3, gutter: 4 } } })).toBe('object');
  });
});

describe('PresetStore', () => {
  it('creates, renames, duplicates, deletes and persists user presets', async () => {
    const storage = memoryStorage();
    const store = new PresetStore(storage);
    await store.loadAll(PRESET_KINDS);
    const builtinCount = store.list('shadow').length;
    const dup = await store.duplicate('shadow', 'soft-social');
    expect(dup.name).toBe('Soft Social Media copy');
    expect(store.list('shadow')).toHaveLength(builtinCount + 1);
    await store.rename('shadow', dup.id, 'My soft');
    expect(store.get('shadow', dup.id)!.name).toBe('My soft');
    await expect(store.rename('shadow', 'soft-social', 'x')).rejects.toThrow(/Only your own/);
    await expect(store.save('shadow', { ...store.get('shadow', 'soft-social')! })).rejects.toThrow(/read-only/);

    // Persisted and reloaded by a fresh store.
    const store2 = new PresetStore(storage);
    await store2.loadAll(PRESET_KINDS);
    expect(store2.get('shadow', dup.id)!.name).toBe('My soft');

    await store2.remove('shadow', dup.id);
    expect(store2.get('shadow', dup.id)).toBeUndefined();
    await expect(store2.remove('shadow', 'soft-social')).rejects.toThrow(/Only your own/);
  });

  it('imports with conflict handling', async () => {
    const store = new PresetStore(memoryStorage());
    await store.loadAll(PRESET_KINDS);
    const text = store.exportText('spacing', ['sp-8']);
    const r = await store.importText(text);
    expect(r.added).toBe(1);
    const mine = store.userPresets('spacing');
    expect(mine[0]!.id).not.toBe('sp-8');
    expect(mine[0]!.name).toBe('8 px system 2');
  });
});

describe('example preset files', () => {
  it('all parse without errors', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../../presets/examples/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const r = parsePresetFile(readFileSync(new URL(f, dir), 'utf8'));
      expect(r.errors, f).toEqual([]);
      expect(r.presets.length, f).toBeGreaterThan(0);
    }
  });
});
