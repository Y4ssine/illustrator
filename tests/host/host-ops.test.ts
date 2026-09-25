/**
 * ExtendScript host behaviour against the mock DOM: preview safety, rollback,
 * locked layers, degraded capabilities, CMYK, stale selections, Arabic text.
 */

import { describe, expect, it } from 'vitest';
import { makeSim } from '../helpers/host';
import { gridBuild, guidesDeletePlugin, guidesLock } from '../../src/guides/grid-commands';
import { shadowGround } from '../../src/effects/shadow-commands';
import { spacingNormalize } from '../../src/layout/spacing-commands';
import { layersOrganize } from '../../src/layers/layer-commands';
import { ARTBOARD_COMMANDS } from '../../src/layout/artboard-commands';
import { createDocument, ENUMS, CMYKColor, GradientColor, MockPathItem, type MockDocument } from '../../src/illustrator/sim/mock-dom';
import { serializeDoc } from '../../src/illustrator/sim/serialize';
import { placedItem, rectItem, seedSample, selectByName, textItem } from '../../src/illustrator/sim/sample-doc';
import { AFError } from '../../src/core/errors';
import { PREVIEW_NAME_PREFIX } from '../../src/core/protocol';

const state = (d: MockDocument): string => JSON.stringify(serializeDoc(d, false));

async function simWithHero(opts = {}, settings = {}) {
  const sim = await makeSim(opts, settings);
  const doc = createDocument(sim.runtime.app, 'Test.ai', ENUMS.DocumentColorSpace.RGB, 1080, 1350);
  const layer = doc._layers[0]!;
  placedItem(layer, 'hero', 390, 520, 300, 640);
  rectItem(layer, 'bg', 0, 0, 1080, 1350, '#D8C3A0');
  selectByName(doc, 'hero');
  return { ...sim, doc, layer };
}

describe('live preview', () => {
  it('replaces and cancels previews through a guarded undo (clean history)', async () => {
    const { runner, doc, presets, settings } = await simWithHero();
    const original = state(doc);
    const p = shadowGround.defaultParams({ settings, presets });
    await runner.preview(shadowGround, p);
    expect(doc.pageItems.some((i) => i._name.startsWith(PREVIEW_NAME_PREFIX))).toBe(true);
    expect(doc._undo).toHaveLength(1);
    await runner.preview(shadowGround, { ...p, params: { ...p.params, strength: 55 } });
    // The first preview was undone, not deleted: still exactly one undo step.
    expect(doc._undo).toHaveLength(1);
    const pv = doc.pageItems.filter((i) => i._name.startsWith(`${PREVIEW_NAME_PREFIX} \u2014 SHADOW`));
    expect(pv).toHaveLength(1);
    expect(JSON.parse(pv[0]!._tags.find((t) => t.name === 'AF_params')!.value).strength).toBe(55);
    await runner.cancelPreview();
    expect(state(doc)).toBe(original);
    expect(doc._undo).toHaveLength(0);
  });

  it('never undoes the designer’s own action: falls back to deleting the preview', async () => {
    const { runner, doc, presets, settings, runtime } = await simWithHero();
    const p = shadowGround.defaultParams({ settings, presets });
    await runner.preview(shadowGround, p);
    // Designer changes the selection in Illustrator while the preview is up.
    selectByName(doc, 'bg');
    runtime.evalScript('AFHost.call("signature", {})');
    await runner.cancelPreview();
    expect(doc.pageItems.some((i) => i._name.startsWith(PREVIEW_NAME_PREFIX))).toBe(false);
    expect(doc.pageItems.find((i) => i._name === 'bg')!._selected).toBe(true);
    expect(doc.pageItems.map((i) => i._name).sort()).toEqual(['bg', 'hero']);
  });

  it('apply = one clean undo step', async () => {
    const { runner, doc, presets, settings, runtime } = await simWithHero();
    const original = state(doc);
    const p = shadowGround.defaultParams({ settings, presets });
    await runner.preview(shadowGround, p);
    const res = await runner.run(shadowGround, p);
    expect(res.committed).toBe(true);
    const shadows = doc.pageItems.filter((i) => i._name.startsWith('SHADOW'));
    expect(shadows).toHaveLength(1);
    expect(shadows[0]!._tags.some((t) => t.name === 'AF_preview')).toBe(false);
    expect(doc._undo).toHaveLength(1);
    runtime.evalScript('app.undo()');
    expect(state(doc)).toBe(original);
  });

  it('refuses to preview destructive operations', async () => {
    const { adapter, doc } = await simWithHero();
    const r = await adapter.preview.show({ label: 't', ops: [{ op: 'item.translate', ref: { k: 'uuid', v: doc.pageItems[0]!.uuid }, dx: 10, dy: 0 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('UNSUPPORTED');
  });

  it('grid previews never remove the existing grid', async () => {
    const { runner, doc, presets, settings } = await simWithHero();
    await runner.run(gridBuild, gridBuild.defaultParams({ settings, presets }));
    await runner.preview(gridBuild, gridBuild.defaultParams({ settings, presets }));
    const grids = doc.groupItems.filter((g) => g._name.includes('GRID'));
    expect(grids).toHaveLength(2); // committed grid + preview grid
    await runner.cancelPreview();
    expect(doc.groupItems.filter((g) => g._name.includes('GRID'))).toHaveLength(1);
  });
});

describe('batch safety', () => {
  it('rolls back every change when an op fails', async () => {
    const { adapter, doc } = await simWithHero();
    const before = state(doc);
    const r = await adapter.run({
      label: 'broken',
      ops: [
        { op: 'layer.ensure', name: 'NEW', anchor: 'top' },
        { op: 'shape.rect', x: 0, y: 0, w: 10, h: 10, into: { k: 'layer', name: 'NEW', at: 'top' }, fill: { t: 'solid', c: '#ff0000' }, name: 'r' },
        { op: 'item.tag', ref: { k: 'uuid', v: doc.pageItems.find((i) => i._name === 'hero')!.uuid }, tags: { AF_id: 'x' } },
        { op: 'layer.rename', from: 'DOES NOT EXIST', to: 'X' },
      ],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('LAYER_NOT_FOUND');
      expect(r.error.opIndex).toBe(3);
      expect(r.error.rolledBack).toBe('full');
    }
    expect(state(doc)).toBe(before);
  });

  it('restores stacking order when a bulk move is rolled back', async () => {
    const { adapter, doc, layer } = await simWithHero();
    textItem(layer, 't1', 'a', 0, 0, 10, 10, 10);
    textItem(layer, 't2', 'b', 0, 0, 10, 10, 10);
    const order = layer._items.map((i) => i._name);
    const uuid = (n: string): string => doc.pageItems.find((i) => i._name === n)!.uuid;
    const r = await adapter.run({
      label: 'x',
      ops: [
        { op: 'layer.ensure', name: 'TYPE', anchor: 'top' },
        { op: 'items.toLayer', refs: [{ k: 'uuid', v: uuid('t1') }, { k: 'uuid', v: uuid('hero') }], layer: 'TYPE', at: 'top', withLinked: true },
        { op: 'layer.move', name: 'missing', anchor: 'top' },
      ],
    });
    expect(r.ok).toBe(false);
    expect(doc._layers.map((l) => l.name)).toEqual(['Layer 1']);
    expect(layer._items.map((i) => i._name)).toEqual(order);
  });

  it('defers deletions until every op succeeded', async () => {
    const { runner, adapter, doc, presets, settings } = await simWithHero();
    await runner.run(shadowGround, shadowGround.defaultParams({ settings, presets }));
    const shadow = doc.pageItems.find((i) => i._name.startsWith('SHADOW'))!;
    const r = await adapter.run({ label: 'x', ops: [{ op: 'item.remove', ref: { k: 'uuid', v: shadow.uuid }, requireTag: true }, { op: 'layer.move', name: 'nope', anchor: 'top' }] });
    expect(r.ok).toBe(false);
    expect(shadow._dead).toBe(false);
  });

  it('refuses to delete artwork it did not create', async () => {
    const { adapter, doc } = await simWithHero();
    const r = await adapter.run({ label: 'x', ops: [{ op: 'item.remove', ref: { k: 'uuid', v: doc.pageItems.find((i) => i._name === 'bg')!.uuid }, requireTag: true }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('NOT_TAGGED');
  });

  it('reports text editing in plain language', async () => {
    const { runner, runtime, presets, settings } = await simWithHero();
    runtime.app._textEditing = true;
    await expect(runner.run(shadowGround, shadowGround.defaultParams({ settings, presets }))).rejects.toThrow(/editing text/);
  });

  it('detects a changed selection when uuids are unavailable (Illustrator < 24)', async () => {
    const { runner, doc, presets, settings, adapter } = await simWithHero({ version: '23.1.0' });
    expect(adapter.info!.capabilities.uuid).toBe(false);
    const snap = await adapter.document.snapshot();
    expect(snap.selection.items[0]!.ref.k).toBe('sel');
    // Move the hero after the snapshot but before the batch runs.
    const ctxSnap = snap;
    const hero = doc.pageItems.find((i) => i._name === 'hero')!;
    hero._translate(5, 0);
    const plan = await shadowGround.plan({ host: adapter, snapshot: ctxSnap, settings, presets }, shadowGround.defaultParams({ settings, presets }));
    const r = await adapter.run(plan.batch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('SELECTION_CHANGED');
    void runner;
  });
});

describe('layers and guides', () => {
  it('builds guides on a locked guides layer and re-locks it', async () => {
    const { runner, doc, presets, settings } = await simWithHero();
    await runner.run(gridBuild, gridBuild.defaultParams({ settings, presets }));
    await runner.run(guidesLock, guidesLock.defaultParams({ settings, presets }));
    const gl = doc._layers.find((l) => l.name === '_GUIDES')!;
    expect(gl.locked).toBe(true);
    await runner.run(gridBuild, gridBuild.defaultParams({ settings, presets }));
    expect(gl.locked).toBe(true);
    // replaceExisting: still one grid on the artboard
    expect(gl._items).toHaveLength(1);
  });

  it('deletes plugin guides per artboard only, never user guides', async () => {
    const sim = await makeSim();
    seedSample(sim.runtime.app);
    const doc = sim.runtime.app.activeDocument;
    const { runner, presets, settings, adapter } = sim;
    const userGuide = new MockPathItem();
    userGuide.guides = true;
    userGuide._name = 'my guide';
    userGuide.parent = doc._layers[0]!;
    doc._layers[0]!._items.push(userGuide);
    await runner.run(gridBuild, { ...gridBuild.defaultParams({ settings, presets }), target: 'allArtboards' });
    expect(doc.groupItems.filter((g) => g._name.startsWith('GRID'))).toHaveLength(2);
    await runner.run(guidesDeletePlugin, { scope: 'activeArtboard' });
    const left = doc.groupItems.filter((g) => g._name.startsWith('GRID'));
    expect(left).toHaveLength(1);
    expect(left[0]!._name).toContain('IG_PORTRAIT_02');
    expect(userGuide._dead).toBe(false);
    void adapter;
  });

  it('moves several items to a layer keeping their stacking order', async () => {
    const { runner, doc, presets, settings, layer } = await simWithHero();
    textItem(layer, 'title', 'Title', 100, 100, 300, 50, 40);
    textItem(layer, 'caption', 'Caption', 100, 200, 300, 30, 20);
    // Front-to-back order in Layer 1: hero, bg, title, caption → put captions in front first
    layer._items = [layer._items[3]!, layer._items[2]!, layer._items[0]!, layer._items[1]!];
    selectByName(doc, 'title', 'caption');
    await runner.run(layersOrganize, layersOrganize.defaultParams({ settings, presets }));
    const typo = doc._layers.find((l) => l.name === '10 — TYPOGRAPHY')!;
    expect(typo._items.map((i) => i._name)).toEqual(['caption', 'title']);
  });
});

describe('degraded capabilities and colour spaces', () => {
  it('falls back to a fade-to-white gradient when stop opacity is unavailable', async () => {
    const { runner, doc, presets, settings } = await simWithHero({ supportsStopOpacity: false });
    const res = await runner.run(shadowGround, shadowGround.defaultParams({ settings, presets }));
    expect(res.warnings.join()).toMatch(/fade-to-white/);
    const shadow = doc.pageItems.find((i) => i._name === 'Contact') as MockPathItem;
    const stops = (shadow.fillColor as GradientColor).gradient!._stops;
    const last = stops[stops.length - 1]!.color as { red: number; green: number; blue: number };
    expect([last.red, last.green, last.blue]).toEqual([255, 255, 255]);
  });

  it('keeps going (with a warning) when live effects are unsupported', async () => {
    const { runner, doc, presets, settings } = await simWithHero({ supportsApplyEffect: false });
    const p = shadowGround.defaultParams({ settings, presets });
    const res = await runner.run(shadowGround, { ...p, params: { ...p.params, blur: true } });
    expect(res.committed).toBe(true);
    // applyEffect fails on this host: the blur is skipped, the vector falloff remains, the user is told.
    expect(res.warnings.join()).toMatch(/Live effect skipped/);
    expect(doc.pageItems.filter((i) => i._name.startsWith('SHADOW'))).toHaveLength(1);
  });

  it('applies the live blur when supported', async () => {
    const { runner, doc, presets, settings } = await simWithHero();
    const p = shadowGround.defaultParams({ settings, presets });
    await runner.run(shadowGround, { ...p, params: { ...p.params, blur: true } });
    const s = doc.pageItems.find((i) => i._name === 'Ambient')!;
    expect(s._effects[0]).toContain('Adobe PSL Gaussian Blur');
  });

  it('uses CMYK colours in CMYK documents', async () => {
    const sim = await makeSim();
    const doc = createDocument(sim.runtime.app, 'Print.ai', ENUMS.DocumentColorSpace.CMYK, 595, 842);
    placedItem(doc._layers[0]!, 'bottle', 200, 200, 100, 300);
    selectByName(doc, 'bottle');
    await sim.runner.run(shadowGround, shadowGround.defaultParams({ settings: sim.settings, presets: sim.presets }));
    const s = doc.pageItems.find((i) => i._name === 'Contact') as MockPathItem;
    expect((s.fillColor as GradientColor).gradient!._stops[0]!.color).toBeInstanceOf(CMYKColor);
  });
});

describe('bridge encoding and storage', () => {
  it('round-trips Arabic names and text through the host', async () => {
    const sim = await makeSim();
    const doc = createDocument(sim.runtime.app, 'عربي.ai', ENUMS.DocumentColorSpace.RGB, 1080, 1350);
    textItem(doc._layers[0]!, 'العنوان', 'اليوم الوطني السعودي', 100, 100, 800, 100, 64, true);
    selectByName(doc, 'العنوان');
    const snap = await sim.adapter.document.snapshot();
    expect(snap.doc!.name).toBe('عربي.ai');
    const it0 = snap.selection.items[0]!;
    expect(it0.name).toBe('العنوان');
    expect(it0.text).toMatchObject({ arabic: true, justification: 'Justification.RIGHT', size: 64 });
  });

  it('reads and writes storage files', async () => {
    const sim = await makeSim();
    await sim.adapter.storage.write('settings', '{"units":"mm","label":"مرحبا"}');
    expect(await sim.adapter.storage.read('settings')).toBe('{"units":"mm","label":"مرحبا"}');
    expect(await sim.adapter.storage.read('missing')).toBeNull();
    await expect(sim.adapter.storage.read('../../etc/passwd')).rejects.toBeInstanceOf(AFError);
  });

  it('normalizes spacing with linked shadows travelling along', async () => {
    const { runner, doc, presets, settings, layer } = await simWithHero();
    await runner.run(shadowGround, shadowGround.defaultParams({ settings, presets }));
    textItem(layer, 'headline', 'Hello', 140, 150, 800, 100, 72);
    selectByName(doc, 'headline', 'hero', 'SHADOW — Ground — hero');
    const shadow = doc.pageItems.find((i) => i._name.startsWith('SHADOW'))!;
    const before = shadow.geometricBounds[1];
    const res = await runner.run(spacingNormalize, spacingNormalize.defaultParams({ settings, presets }));
    expect(res.warnings.join()).toMatch(/linked shadow/);
    expect(shadow.geometricBounds[1] - before).toBeCloseTo(-2, 6); // hero moved down by 2 → shadow too (Y-up)
  });

  it('artboard commands are a single undo step', async () => {
    const sim = await makeSim();
    const doc = createDocument(sim.runtime.app, 'x.ai', ENUMS.DocumentColorSpace.RGB, 1080, 1350);
    placedItem(doc._layers[0]!, 'a', 0, 0, 10, 10);
    const story = ARTBOARD_COMMANDS.find((c) => c.id === 'artboard.ig-story')!;
    await sim.runner.run(story, story.defaultParams({ settings: sim.settings, presets: sim.presets }));
    expect(doc._artboards).toHaveLength(2);
    expect(doc._active).toBe(1);
    sim.runtime.evalScript('app.undo()');
    expect(sim.runtime.app.activeDocument._artboards).toHaveLength(1);
  });
});
