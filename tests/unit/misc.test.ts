import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../../src/utils/random';
import { decodeMeta, encodeMeta } from '../../src/core/tags';
import { searchCommands, scoreCommand } from '../../src/core/commands/search';
import { DOCUMENT_COMMANDS } from '../../src/core/commands/all';
import { classifySelection } from '../../src/core/context';
import { History } from '../../src/core/commands/history';
import { formatArtboardName, nextArtboardNumber, placeNextTo, planCarousel, planSocialArtboard } from '../../src/layout/artboard-engine';
import { ARTBOARD_PRESETS, findArtboardPreset } from '../../src/layout/artboard-presets';
import { mergeSettings, DEFAULT_SETTINGS } from '../../src/core/settings';
import { hexToRgb, normalizeHex, rgbToCmykNaive } from '../../src/utils/color';
import { toScriptLiteral, hostCall } from '../../src/illustrator/script-adapter';
import type { DocumentInfo, DocumentSnapshot } from '../../src/core/snapshot';

describe('seeded random', () => {
  it('same seed → same sequence', () => {
    const a = createRng('founding-day');
    const b = createRng('founding-day');
    const sa = Array.from({ length: 50 }, () => a.next());
    const sb = Array.from({ length: 50 }, () => b.next());
    expect(sa).toEqual(sb);
    expect(createRng('other').next()).not.toBe(sa[0]);
    expect(hashSeed(42)).toBe(42);
  });

  it('respects ranges and distributions', () => {
    const r = createRng(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.range(-20, 20);
      expect(v).toBeGreaterThanOrEqual(-20);
      expect(v).toBeLessThan(20);
      const n = r.int(1, 3);
      expect([1, 2, 3]).toContain(n);
      for (const d of ['uniform', 'gaussian', 'centered', 'edge'] as const) {
        const j = r.jitter(8, d);
        expect(Math.abs(j)).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe('metadata tags', () => {
  it('encodes and decodes', () => {
    const tags = encodeMeta({ type: 'groundShadow', id: 'af1', source: 'af0', params: { opacity: 30, name: 'بطل' } });
    expect(tags).toMatchObject({ AF_type: 'groundShadow', AF_ver: '1', AF_id: 'af1', AF_src: 'af0' });
    const meta = decodeMeta(tags)!;
    expect(meta.type).toBe('groundShadow');
    expect(meta.params).toEqual({ opacity: 30, name: 'بطل' });
    expect(decodeMeta({ other: 'x' })).toBeNull();
    const broken = decodeMeta({ AF_type: 'grid', AF_params: '{oops' })!;
    expect(broken.params).toBeNull();
    expect(broken.rawParams).toBe('{oops');
    expect(decodeMeta({ AF_type: 'future-type' })!.type).toBeNull();
  });
});

describe('command palette search', () => {
  it('finds shadow commands for "shadow"', () => {
    const hits = searchCommands(DOCUMENT_COMMANDS, 'shadow').map((h) => h.command.id);
    expect(hits.slice(0, 6).every((id) => id.startsWith('shadow.'))).toBe(true);
    expect(hits).toContain('shadow.create');
    expect(hits).toContain('shadow.edit');
  });

  it('finds grid commands, keyword matches and multi-term queries', () => {
    expect(searchCommands(DOCUMENT_COMMANDS, 'grid')[0]!.command.id).toBe('grid.build');
    expect(searchCommands(DOCUMENT_COMMANDS, '4:5').map((h) => h.command.id)).toContain('artboard.ig-portrait');
    expect(searchCommands(DOCUMENT_COMMANDS, 'normalize 8px')[0]!.command.id).toBe('spacing.normalize');
    expect(searchCommands(DOCUMENT_COMMANDS, 'zzzz')).toHaveLength(0);
  });

  it('boosts recent commands', () => {
    const base = searchCommands(DOCUMENT_COMMANDS, 'guides');
    const boosted = searchCommands(DOCUMENT_COMMANDS, 'guides', ['guides.lock']);
    expect(boosted.findIndex((h) => h.command.id === 'guides.lock')).toBeLessThanOrEqual(base.findIndex((h) => h.command.id === 'guides.lock'));
    expect(scoreCommand(DOCUMENT_COMMANDS[0]!, '')).toBe(1);
  });

  it('has unique ids and complete metadata', () => {
    const ids = DOCUMENT_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DOCUMENT_COMMANDS) {
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });
});

describe('selection context', () => {
  const doc: DocumentInfo = { name: 'd', saved: true, colorSpace: 'RGB', artboards: [], activeArtboard: 0, layers: [] };
  const snap = (over: Partial<DocumentSnapshot['selection']>, withDoc = true): DocumentSnapshot => ({
    doc: withDoc ? doc : null,
    selection: { mode: 'none', count: 0, truncated: false, items: [], ...over },
    signature: '',
  });
  it('classifies', () => {
    expect(classifySelection(snap({}, false)).kind).toBe('noDocument');
    expect(classifySelection(snap({})).kind).toBe('none');
    expect(classifySelection(snap({ mode: 'text-editing' })).kind).toBe('textEditing');
    expect(classifySelection(snap({ mode: 'items', count: 3 })).kind).toBe('multiple');
    expect(classifySelection(snap({})).suggestions).toContain('grid.build');
  });
});

describe('history', () => {
  it('keeps the last 10 and survives JSON', () => {
    const h = new History();
    for (let i = 0; i < 14; i++) h.push({ commandId: `c${i}`, title: `T${i}`, summary: '', params: { i } });
    expect(h.list()).toHaveLength(10);
    expect(h.last()!.commandId).toBe('c13');
    const h2 = History.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
    expect(h2.list().map((e) => e.commandId)).toEqual(h.list().map((e) => e.commandId));
    expect(History.fromJSON('garbage').list()).toHaveLength(0);
  });
});

describe('artboards', () => {
  const ig = findArtboardPreset('ig-portrait')!;
  const doc = (over: Partial<DocumentInfo>): DocumentInfo => ({
    name: 'd',
    saved: true,
    colorSpace: 'RGB',
    artboards: [{ index: 0, name: 'Artboard 1', rect: { x: 0, y: 0, w: 612, h: 792 } }],
    activeArtboard: 0,
    layers: [{ name: 'Layer 1', visible: true, locked: false, printable: true, items: 0, sublayers: 0 }],
    ...over,
  });
  const opts = { mode: 'auto' as const, spacing: 100, namePattern: '{CODE}_{nn}' };

  it('creates a document when none is open', () => {
    expect(planSocialArtboard(null, ig, opts)).toEqual({ kind: 'createDocument', w: 1080, h: 1350, colorSpace: 'RGB', name: 'IG_PORTRAIT_01' });
  });

  it('resizes an empty single-artboard document', () => {
    expect(planSocialArtboard(doc({}), ig, opts)).toMatchObject({ kind: 'resize', index: 0, rect: { x: 0, y: 0, w: 1080, h: 1350 } });
  });

  it('adds next to existing artwork and reports matches', () => {
    const d = doc({ layers: [{ name: 'Layer 1', visible: true, locked: false, printable: true, items: 3, sublayers: 0 }] });
    expect(planSocialArtboard(d, ig, opts)).toMatchObject({ kind: 'add', rect: { x: 712, y: 0, w: 1080, h: 1350 }, name: 'IG_PORTRAIT_01' });
    const m = doc({ artboards: [{ index: 0, name: 'IG_PORTRAIT_01', rect: { x: 0, y: 0, w: 1080, h: 1350 } }] });
    expect(planSocialArtboard(m, ig, opts).kind).toBe('alreadyMatches');
    const added = planSocialArtboard({ ...m, layers: d.layers }, ig, { ...opts, mode: 'add' });
    expect(added).toMatchObject({ kind: 'add', name: 'IG_PORTRAIT_02' });
  });

  it('names and numbers', () => {
    expect(formatArtboardName('Slide {nn}', 3)).toBe('Slide 03');
    expect(formatArtboardName('{CODE}_{nnn}', 7, ig)).toBe('IG_PORTRAIT_007');
    expect(nextArtboardNumber(['IG_PORTRAIT_01', 'IG_PORTRAIT_02'], '{CODE}_{nn}', ig)).toBe(3);
    expect(placeNextTo([], 10, 10, 50)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('plans a continuous carousel', () => {
    const slides = planCarousel([{ x: 0, y: 0, w: 1080, h: 1350 }], ig, 10, 0, 'Slide {nn}');
    expect(slides).toHaveLength(10);
    expect(slides[0]!.rect.x).toBe(1180);
    expect(slides[1]!.rect.x).toBe(1180 + 1080);
    expect(slides[9]!.name).toBe('Slide 10');
    expect(() => planCarousel([], ig, 0, 0, 'x')).toThrow();
  });

  it('ships sane presets', () => {
    for (const p of ARTBOARD_PRESETS) {
      expect(p.w).toBeGreaterThan(0);
      expect(p.h).toBeGreaterThan(0);
    }
    expect(findArtboardPreset('a4')!.w).toBeCloseTo(595.276, 2);
  });
});

describe('settings, colours, script literals', () => {
  it('merges settings defensively', () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    const s = mergeSettings({ units: 'mm', pollInterval: 10, favorites: 'bad', bogus: 1 });
    expect(s.units).toBe('mm');
    expect(s.pollInterval).toBe(300);
    expect(s.favorites).toEqual(DEFAULT_SETTINGS.favorites);
    expect('bogus' in s).toBe(false);
  });

  it('handles colours', () => {
    expect(normalizeHex('0b6')).toBe('#00BB66');
    expect(normalizeHex('#zzzzzz')).toBeNull();
    expect(hexToRgb('#0B6B3A')).toEqual({ r: 11, g: 107, b: 58 });
    expect(rgbToCmykNaive({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('builds ES3-safe script literals (Arabic is escaped)', () => {
    const lit = toScriptLiteral({ name: 'يوم التأسيس', sep: ' ' });
    expect(/^[\x00-\x7f]*$/.test(lit)).toBe(true);
    expect(JSON.parse(lit)).toEqual({ name: 'يوم التأسيس', sep: ' ' });
    expect(hostCall('ping')).toBe('AFHost.call("ping", {})');
  });
});

describe('command wiring', () => {
  it('every suggested or favourite command id exists, and ids are unique', async () => {
    const { readFileSync } = await import('node:fs');
    const { DEFAULT_SETTINGS } = await import('../../src/core/settings');
    const ids = new Set(DOCUMENT_COMMANDS.map((c) => c.id));
    const ui = ['app.palette', 'app.repeatLast', 'document.scan', 'app.settings', 'app.presets', 'preview.cancel'];
    const src = readFileSync(new URL('../../src/core/context.ts', import.meta.url), 'utf8');
    const used = [...src.matchAll(/'([a-z]+\.[A-Za-z.-]+)'/g)].map((m) => m[1]!);
    expect([...used, ...DEFAULT_SETTINGS.favorites].filter((id) => !ids.has(id) && !ui.includes(id))).toEqual([]);
    expect(ids.size).toBe(DOCUMENT_COMMANDS.length);
  });
});
