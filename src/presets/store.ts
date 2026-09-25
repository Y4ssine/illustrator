/**
 * Preset store: built-in (read-only) + user presets persisted through the
 * StorageAdapter (a JSON file per kind under the user's Adobe data folder when
 * running in Illustrator).
 */

import type { StorageAdapter } from '../core/host';
import { makeId, deepClone } from '../utils/misc';
import { BUILTIN_PRESETS } from './builtin';
import type { PresetKind, PresetKindMap } from './models';
import { parsePresetFile, serializePresets, validatePreset } from './serialize';

type Listener = () => void;

export class PresetStore {
  private readonly storage: StorageAdapter;
  private user: { [K in PresetKind]?: Array<PresetKindMap[K]> } = {};
  private listeners = new Set<Listener>();

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  private key(kind: PresetKind): string {
    return `presets.${kind}`;
  }

  async load(kind: PresetKind): Promise<void> {
    const raw = await this.storage.read(this.key(kind));
    if (!raw) {
      (this.user as Record<string, unknown>)[kind] = [];
      return;
    }
    const parsed = parsePresetFile(raw);
    (this.user as Record<string, unknown>)[kind] = parsed.kind === kind ? parsed.presets : [];
  }

  async loadAll(kinds: readonly PresetKind[]): Promise<void> {
    for (const k of kinds) await this.load(k);
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  list<K extends PresetKind>(kind: K): Array<PresetKindMap[K]> {
    const builtins = BUILTIN_PRESETS[kind] as ReadonlyArray<PresetKindMap[K]>;
    const users = (this.user[kind] ?? []) as Array<PresetKindMap[K]>;
    return [...builtins, ...users];
  }

  userPresets<K extends PresetKind>(kind: K): Array<PresetKindMap[K]> {
    return [...((this.user[kind] ?? []) as Array<PresetKindMap[K]>)];
  }

  get<K extends PresetKind>(kind: K, id: string): PresetKindMap[K] | undefined {
    return this.list(kind).find((p) => p.id === id);
  }

  private async persist(kind: PresetKind): Promise<void> {
    await this.storage.write(this.key(kind), serializePresets(kind, this.userPresets(kind)));
    this.emit();
  }

  private uniqueName(kind: PresetKind, base: string): string {
    const names = new Set(this.list(kind).map((p) => p.name));
    if (!names.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const n = `${base} ${i}`;
      if (!names.has(n)) return n;
    }
    return `${base} ${Date.now()}`;
  }

  /** Create or update a user preset. Built-ins cannot be overwritten. */
  async save<K extends PresetKind>(kind: K, preset: PresetKindMap[K]): Promise<PresetKindMap[K]> {
    const clean = validatePreset(kind, preset);
    if (typeof clean === 'string') throw new Error(`Preset is invalid: ${clean}`);
    if ((BUILTIN_PRESETS[kind] as ReadonlyArray<{ id: string }>).some((b) => b.id === clean.id)) {
      throw new Error('Built-in presets are read-only. Duplicate it first.');
    }
    const list = this.userPresets(kind);
    const idx = list.findIndex((p) => p.id === clean.id);
    if (idx >= 0) list[idx] = clean as PresetKindMap[K];
    else list.push(clean as PresetKindMap[K]);
    (this.user as Record<string, unknown>)[kind] = list;
    await this.persist(kind);
    return clean as PresetKindMap[K];
  }

  async create<K extends PresetKind>(kind: K, name: string, data: Omit<PresetKindMap[K], 'id' | 'name' | 'builtin'>): Promise<PresetKindMap[K]> {
    const preset = { ...deepClone(data), id: makeId('p'), name: this.uniqueName(kind, name.trim() || 'Untitled') } as PresetKindMap[K];
    return this.save(kind, preset);
  }

  async duplicate<K extends PresetKind>(kind: K, id: string): Promise<PresetKindMap[K]> {
    const src = this.get(kind, id);
    if (!src) throw new Error('Preset not found.');
    const copy = deepClone(src) as PresetKindMap[K] & { builtin?: boolean };
    delete copy.builtin;
    copy.id = makeId('p');
    copy.name = this.uniqueName(kind, `${src.name} copy`);
    return this.save(kind, copy);
  }

  async rename(kind: PresetKind, id: string, name: string): Promise<void> {
    const list = this.userPresets(kind);
    const p = list.find((x) => x.id === id);
    if (!p) throw new Error('Only your own presets can be renamed.');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Name cannot be empty.');
    p.name = trimmed;
    (this.user as Record<string, unknown>)[kind] = list;
    await this.persist(kind);
  }

  async remove(kind: PresetKind, id: string): Promise<void> {
    const list = this.userPresets(kind);
    const next = list.filter((p) => p.id !== id);
    if (next.length === list.length) throw new Error('Only your own presets can be deleted.');
    (this.user as Record<string, unknown>)[kind] = next;
    await this.persist(kind);
  }

  exportText(kind: PresetKind, ids?: readonly string[]): string {
    const list = this.list(kind).filter((p) => !ids || ids.includes(p.id));
    return serializePresets(kind, list);
  }

  /** Import presets; name clashes get a numeric suffix, id clashes get a new id. */
  async importText(text: string): Promise<{ kind: PresetKind | null; added: number; errors: string[] }> {
    const parsed = parsePresetFile(text);
    if (!parsed.kind) return { kind: null, added: 0, errors: parsed.errors };
    const kind = parsed.kind;
    const list = this.userPresets(kind);
    const ids = new Set(this.list(kind).map((p) => p.id));
    let added = 0;
    for (const p of parsed.presets) {
      const copy = { ...p } as typeof p;
      if (ids.has(copy.id)) copy.id = makeId('p');
      copy.name = this.uniqueName(kind, copy.name);
      list.push(copy as never);
      ids.add(copy.id);
      added++;
    }
    (this.user as Record<string, unknown>)[kind] = list;
    await this.persist(kind);
    return { kind, added, errors: parsed.errors };
  }
}
