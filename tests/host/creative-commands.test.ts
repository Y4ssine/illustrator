/**
 * Every creative command, end to end through the ExtendScript host (mock DOM):
 * commits in one undo step, previews and cancels cleanly, tags its output.
 */

import { describe, expect, it } from 'vitest';
import { makeSim } from '../helpers/host';
import { createDocument, ENUMS, MockGroupItem, type MockDocument } from '../../src/illustrator/sim/mock-dom';
import { placedItem, rectItem, selectByName, textItem } from '../../src/illustrator/sim/sample-doc';
import { serializeDoc } from '../../src/illustrator/sim/serialize';
import { lightEffect, lightScene, LIGHT_EFFECTS, SCENE_RECIPES } from '../../src/effects/light-commands';
import { shadowCreate, shadowEdit, storedShadowParams, selectedShadows } from '../../src/effects/shadow-commands';
import { SHADOW_STYLES, sanitizeShadowParams } from '../../src/effects/shadow-engine';
import { colorApplyStyle, colorBackground, colorFade, colorSwatches, BACKGROUND_STYLES } from '../../src/color/color-commands';
import { shapeInsert, SHAPE_STYLES } from '../../src/shapes/shape-commands';
import { SHAPES, defaultParams } from '../../src/shapes/shape-library';
import { infoBlock, defaultInfoParams } from '../../src/infographic/info-commands';
import { INFO_BLOCKS } from '../../src/infographic/info-engine';
import { recipeBuild, RECIPES } from '../../src/recipes/recipes';
import type { DocumentCommand } from '../../src/core/commands/types';

const state = (d: MockDocument): string => JSON.stringify(serializeDoc(d, false));

async function sim() {
  const s = await makeSim();
  const doc = createDocument(s.runtime.app, 'Creative.ai', ENUMS.DocumentColorSpace.RGB, 1080, 1350);
  const layer = doc._layers[0]!;
  rectItem(layer, 'bg', 0, 0, 1080, 1350, '#0B2E22');
  rectItem(layer, 'product', 440, 600, 200, 420, '#C9A227');
  placedItem(layer, 'photo', 100, 200, 300, 500);
  textItem(layer, 'title', 'اليوم الوطني', 200, 100, 600, 80, 64, true);
  return { ...s, doc };
}

async function runOk<P>(s: Awaited<ReturnType<typeof sim>>, cmd: DocumentCommand<P>, params: P): Promise<void> {
  const before = s.doc._undo.length;
  const res = await s.runner.run(cmd, params, { confirmed: true });
  expect(res.committed, `${cmd.id}: ${res.summary}`).toBe(true);
  expect(s.doc._undo.length).toBe(before + 1);
}

describe('light commands', () => {
  it.each(LIGHT_EFFECTS.map((e) => e.id))('light effect %s', async (effect) => {
    const s = await sim();
    selectByName(s.doc, 'product');
    const p = { ...lightEffect.defaultParams({ settings: s.settings, presets: s.presets }), effect };
    await runOk(s, lightEffect, p);
    expect(s.doc.pageItems.some((i) => i._tags.some((t) => t.name === 'AF_light'))).toBe(true);
  });

  it.each(SCENE_RECIPES.map((r) => r.id))('scene recipe %s previews, cancels and commits', async (recipeId) => {
    const s = await sim();
    selectByName(s.doc, 'product');
    const before = state(s.doc);
    const p = { recipeId, intensity: 100, seed: 3 };
    await s.runner.preview(lightScene, p);
    await s.runner.cancelPreview();
    expect(state(s.doc)).toBe(before);
    await runOk(s, lightScene, p);
  });
});

describe('shadow v2', () => {
  it.each(SHADOW_STYLES.map((x) => x.id))('style %s on vector art and on an image', async (style) => {
    const s = await sim();
    selectByName(s.doc, 'product', 'photo');
    const d = shadowCreate.defaultParams({ settings: s.settings, presets: s.presets });
    await runOk(s, shadowCreate, { ...d, params: sanitizeShadowParams({ ...d.params, style }) });
    const shadows = s.doc.pageItems.filter((i) => i._name.startsWith('SHADOW —'));
    expect(shadows).toHaveLength(2);
    expect(shadows.every((g) => g instanceof MockGroupItem)).toBe(true);
  });

  it('edits a shadow into another style, keeping it linked to its subject', async () => {
    const s = await sim();
    selectByName(s.doc, 'product');
    const d = shadowCreate.defaultParams({ settings: s.settings, presets: s.presets });
    await runOk(s, shadowCreate, d);
    const sh = s.doc.pageItems.find((i) => i._name.startsWith('SHADOW —'))!;
    selectByName(s.doc, sh._name);
    const ctx = await s.ctx();
    const stored = storedShadowParams(selectedShadows(ctx.snapshot)[0]!)!;
    expect(stored.style).toBe('ground');
    await runOk(s, shadowEdit, { params: sanitizeShadowParams({ ...stored, style: 'cast' }) });
    const after = s.doc.pageItems.filter((i) => i._name.startsWith('SHADOW —'));
    expect(after).toHaveLength(1);
    expect(after[0]!._tags.find((t) => t.name === 'AF_type')!.value).toBe('castShadow');
  });
});

describe('colour commands', () => {
  it('applies gradient styles, swatches, backgrounds and fades', async () => {
    const s = await sim();
    selectByName(s.doc, 'product');
    await runOk(s, colorApplyStyle, { style: 'foil' });
    await runOk(s, colorSwatches, { name: 'Brand', tints: true });
    expect(s.doc._swatchGroups[0]!._swatches.length).toBeGreaterThan(5);
    for (const b of BACKGROUND_STYLES) await runOk(s, colorBackground, { style: b.id, dark: true, seed: 2 });
    selectByName(s.doc, 'photo');
    await runOk(s, colorFade, { edge: 'bottom', color: 'dark', length: 50, strength: 90, target: 'selection' });
    await runOk(s, colorFade, { edge: 'radial', color: 'primary', length: 40, strength: 60, target: 'artboard' });
  });
});

describe('shapes', () => {
  it.each(SHAPES.map((x) => x.id))('inserts %s', async (shapeId) => {
    const s = await sim();
    const def = SHAPES.find((x) => x.id === shapeId)!;
    await runOk(s, shapeInsert, { shapeId, params: defaultParams(def), style: 'brand', fx: 'shadow', size: 40, fitSelection: false });
  });

  it.each(SHAPE_STYLES.map((x) => x.id))('style %s', async (style) => {
    const s = await sim();
    selectByName(s.doc, 'product');
    const def = SHAPES.find((x) => x.id === 'archFrame')!;
    await runOk(s, shapeInsert, { shapeId: def.id, params: defaultParams(def), style, fx: 'glow', size: 40, fitSelection: true });
  });
});

describe('infographics', () => {
  it.each(INFO_BLOCKS.map((b) => b.id))('block %s (Arabic sample data)', async (block) => {
    const s = await sim();
    const p = defaultInfoParams(block, s.settings);
    await runOk(s, infoBlock, p);
    const texts = s.doc.textFrames;
    expect(texts.length).toBeGreaterThan(1);
  });

  it('fits a selected placeholder and switches to LTR for English data', async () => {
    const s = await sim();
    selectByName(s.doc, 'photo');
    const p = { ...defaultInfoParams('barH', { ...s.settings, direction: 'ltr' }), fitSelection: true };
    await runOk(s, infoBlock, p);
    const label = s.doc.textFrames.find((t) => t.contents === 'Asia')!;
    expect(label.direction).toBe('LEFT_TO_RIGHT_DIRECTION');
    expect(label.geometricBounds[0]).toBeCloseTo(100, 0);
  });
});

describe('recipes', () => {
  it.each(RECIPES.map((r) => r.id))('%s builds in one undo step', async (recipe) => {
    const s = await sim();
    const p = { ...recipeBuild.defaultParams({ settings: s.settings, presets: s.presets }), recipe };
    await runOk(s, recipeBuild, p);
    expect(s.doc._layers.length).toBeGreaterThan(1);
  });
});
