/**
 * The first development milestone (spec §95), end to end, through the REAL
 * ExtendScript host code running against the mock DOM:
 *   Instagram Portrait → Campaign Grid → Ground Shadow → Normalize spacing →
 *   Organize layers → save/close/reopen → recognise generated items.
 */

import { describe, expect, it } from 'vitest';
import { makeSim } from '../helpers/host';
import { ARTBOARD_COMMANDS } from '../../src/layout/artboard-commands';
import { gridBuild } from '../../src/guides/grid-commands';
import { shadowEdit, shadowGround } from '../../src/effects/shadow-commands';
import { sanitizeShadowParams } from '../../src/effects/shadow-engine';
import { spacingNormalize } from '../../src/layout/spacing-commands';
import { layersOrganize } from '../../src/layers/layer-commands';
import { computeGrid } from '../../src/guides/grid-engine';
import { BUILTIN_GRID_PRESETS } from '../../src/presets/builtin';
import { MockGroupItem, MockPathItem, GradientColor, allLayerItems } from '../../src/illustrator/sim/mock-dom';
import { placedItem, textItem, selectByName } from '../../src/illustrator/sim/sample-doc';

const igPortrait = ARTBOARD_COMMANDS.find((c) => c.id === 'artboard.ig-portrait')!;

describe('vertical slice (simulated Illustrator)', () => {
  it('runs the whole milestone flow', async () => {
    const sim = await makeSim();
    const { runner, runtime, adapter, presets, settings } = sim;

    // 1–5. No document open → Instagram Portrait creates a 1080×1350 RGB document.
    let snap = await adapter.document.snapshot();
    expect(snap.doc).toBeNull();
    let res = await runner.run(igPortrait, igPortrait.defaultParams({ settings, presets }));
    expect(res.committed).toBe(true);
    snap = await adapter.document.snapshot();
    expect(snap.doc!.artboards).toHaveLength(1);
    expect(snap.doc!.artboards[0]!.rect).toEqual({ x: 0, y: 0, w: 1080, h: 1350 });
    expect(snap.doc!.artboards[0]!.name).toBe('IG_PORTRAIT_01');

    // Running it again is a no-op with an explanation.
    res = await runner.run(igPortrait, igPortrait.defaultParams({ settings, presets }));
    expect(res.committed).toBe(false);
    expect(res.summary).toMatch(/already 1080 × 1350/);

    // 6–7. Campaign Grid → guides on a guides layer.
    res = await runner.run(gridBuild, gridBuild.defaultParams({ settings, presets }));
    expect(res.committed).toBe(true);
    const doc = runtime.app.activeDocument;
    const guidesLayer = doc._layers.find((l) => l.name === '_GUIDES')!;
    expect(guidesLayer).toBeTruthy();
    expect(guidesLayer.printable).toBe(false);
    expect(doc._layers[0]).toBe(guidesLayer); // on top
    const grid = guidesLayer._items[0] as MockGroupItem;
    expect(grid.name).toBe('GRID — Campaign Grid — IG_PORTRAIT_01');
    const expected = computeGrid({ x: 0, y: 0, w: 1080, h: 1350 }, BUILTIN_GRID_PRESETS[0]!.spec).lines.length;
    expect(grid._items).toHaveLength(expected);
    expect(grid._items.every((p) => p instanceof MockPathItem && p.guides)).toBe(true);
    // First margin guide at x = 72 (design) → spans the artboard height (Y-up: 0 → -1350).
    const xs = grid._items.map((p) => ((p as MockPathItem).shape as { pts: number[][] }).pts[0]![0]);
    expect(xs).toContain(72);
    expect(grid._tags.find((t) => t.name === 'AF_type')!.value).toBe('grid');

    // 8–10. Select the subject → Ground Shadow directly below it.
    const layer1 = doc._layers.find((l) => l.name === 'Layer 1')!;
    textItem(layer1, 'headline', 'اليوم الوطني', 140, 150, 800, 100, 72, true);
    placedItem(layer1, 'hero', 390, 520, 300, 640);
    selectByName(doc, 'hero');
    res = await runner.run(shadowGround, shadowGround.defaultParams({ settings, presets }));
    expect(res.committed).toBe(true);
    const heroIdx = layer1._items.findIndex((i) => i._name === 'hero');
    const shadow = layer1._items[heroIdx + 1] as MockGroupItem;
    expect(shadow.name).toBe('SHADOW — Ground — hero');
    // Studio ground shadow: contact over core over ambient, all Multiply radial falloffs.
    expect(shadow._items.map((i) => i._name)).toEqual(['Contact', 'Core', 'Ambient']);
    const contact = shadow._items[0] as MockPathItem;
    expect(contact.blendingMode).toBe('MULTIPLY');
    expect(contact.shape.kind).toBe('ellipse');
    const g = (contact.fillColor as GradientColor).gradient!;
    expect(g.type).toBe('RADIAL');
    expect(g._stops[0]!.opacity).toBe(100);
    expect(g._stops[g._stops.length - 1]!.opacity).toBe(0);
    // Contact centred under the hero's bottom edge (y = 1160 design → -1160 AI).
    const sh = contact.shape as { cx: number; cy: number; rx: number; ry: number };
    expect(Math.abs(sh.cx - 540)).toBeLessThan(10);
    expect(Math.abs(sh.cy + 1160)).toBeLessThan(10);
    // Subject got a persistent id; shadow points at it.
    const hero = layer1._items[heroIdx]!;
    const heroId = hero._tags.find((t) => t.name === 'AF_id')!.value;
    expect(shadow._tags.find((t) => t.name === 'AF_src')!.value).toBe(heroId);
    // Selection preserved.
    expect((doc.selection as unknown[]).length).toBe(1);

    // 11–12. Headline + image → Normalize spacing (8 px system, vertical stack).
    selectByName(doc, 'headline', 'hero');
    res = await runner.run(spacingNormalize, spacingNormalize.defaultParams({ settings, presets }));
    expect(res.committed).toBe(true);
    const head = doc.pageItems.find((i) => i._name === 'headline')!;
    const heroNow = doc.pageItems.find((i) => i._name === 'hero')!;
    const gap = head.geometricBounds[3] - heroNow.geometricBounds[1]; // bottom of headline minus top of hero (Y-up)
    expect(gap % 8).toBeCloseTo(0, 6);
    expect(gap).toBe(272); // 270 → nearest multiple of 8

    // 13–14. Organize layers (selection sorted by rules; confirmation auto-accepted).
    res = await runner.run(layersOrganize, layersOrganize.defaultParams({ settings, presets }));
    expect(res.committed).toBe(true);
    const names = doc._layers.map((l) => l.name);
    expect(names[0]).toBe('00 — GUIDES'); // "_GUIDES" recognised and renamed
    expect(names).toContain('05 — SUBJECT');
    expect(names).toContain('10 — TYPOGRAPHY');
    expect(names[names.length - 1]).toBe('Layer 1'); // unrecognised layer left where it was
    const typo = doc._layers.find((l) => l.name === '10 — TYPOGRAPHY')!;
    expect(typo._items.map((i) => i._name)).toEqual(['headline']);
    const subj = doc._layers.find((l) => l.name === '05 — SUBJECT')!;
    // The linked shadow travelled with its subject and stayed directly below it.
    expect(subj._items.map((i) => i._name)).toEqual(['hero', 'SHADOW — Ground — hero']);

    // 15–17. Save, close, reopen → the plugin recognises its items (tags persist; uuids do not).
    const reopened = runtime.saveCloseReopen();
    expect(reopened.pageItems.some((i) => i.uuid === heroNow.uuid)).toBe(false);
    const scan = await adapter.document.scanTagged();
    expect(scan.counts).toMatchObject({ grid: 1, groundShadow: 1 });
    selectByName(reopened, 'SHADOW — Ground — hero');
    const s2 = await adapter.document.snapshot();
    const item = s2.selection.items[0]!;
    expect(item.af?.type).toBe('groundShadow');
    expect(item.af?.params?.['style']).toBe('ground');

    // "Edit existing effect": rebuild with new settings, keeps stacking slot and id.
    const oldId = item.af!.id;
    res = await runner.run(shadowEdit, { params: sanitizeShadowParams({ ...(item.af!.params as object), strength: 40 }) });
    expect(res.committed).toBe(true);
    const subj2 = reopened._layers.find((l) => l.name === '05 — SUBJECT')!;
    expect(subj2._items.map((i) => i._name)).toEqual(['hero', 'SHADOW — Ground — hero']);
    const edited = subj2._items[1]!;
    expect(JSON.parse(edited._tags.find((t) => t.name === 'AF_params')!.value).strength).toBe(40);
    expect(edited._tags.find((t) => t.name === 'AF_id')!.value).toBe(oldId);
    expect(allLayerItems(reopened._layers).filter((i) => i._name.startsWith('SHADOW')).length).toBe(1);
  });

  it('one command = one undo step', async () => {
    const { runner, runtime, presets, settings } = await makeSim();
    await runner.run(igPortrait, igPortrait.defaultParams({ settings, presets }));
    const doc = runtime.app.activeDocument;
    placedItem(doc._layers[0]!, 'hero', 100, 100, 200, 400);
    selectByName(doc, 'hero');
    const before = doc.pageItems.length;
    await runner.run(shadowGround, shadowGround.defaultParams({ settings, presets }));
    // One shadow group (with its layered ellipses) was added.
    expect(doc._layers[0]!._items.filter((i) => i._name.startsWith('SHADOW'))).toHaveLength(1);
    expect(doc.pageItems.length).toBeGreaterThan(before);
    runtime.evalScript('app.undo()');
    const after = runtime.app.activeDocument;
    expect(after.pageItems.length).toBe(before);
    // The subject's AF_id tag was part of the same step.
    expect(after.pageItems.find((i) => i._name === 'hero')!._tags).toHaveLength(0);
  });
});
