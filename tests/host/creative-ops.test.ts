/**
 * Creative host ops against the mock DOM: bezier/compound paths, gradient
 * angle and elliptical fit, RTL text, duplicate, restyle, transform, rotate,
 * clipping groups, swatch groups and colour sampling.
 */

import { describe, expect, it } from 'vitest';
import { makeSim } from '../helpers/host';
import {
  createDocument,
  ENUMS,
  GradientColor,
  MockCompoundPathItem,
  MockGroupItem,
  MockPathItem,
  MockTextFrame,
  RGBColor,
  type MockDocument,
} from '../../src/illustrator/sim/mock-dom';
import { placedItem, rectItem, selectByName } from '../../src/illustrator/sim/sample-doc';
import type { Batch, BatchResult, HostOp, Paint } from '../../src/core/protocol';
import { ellipsePath, roundedRectPath } from '../../src/geometry/path';
import { serializeDoc } from '../../src/illustrator/sim/serialize';

async function sim() {
  const s = await makeSim();
  const doc = createDocument(s.runtime.app, 'Creative.ai', ENUMS.DocumentColorSpace.RGB, 1000, 1000);
  const layer = doc._layers[0]!;
  rectItem(layer, 'logo', 100, 100, 200, 100, '#0E7A4B');
  placedItem(layer, 'photo', 500, 100, 300, 300);
  return { ...s, doc, layer };
}

const L = { k: 'layer', name: 'Layer 1', at: 'top' } as const;
const op = (i: number) => ({ k: 'op', i }) as const;
const run = (adapter: Awaited<ReturnType<typeof sim>>['adapter'], ops: HostOp[], label = 'test'): Promise<BatchResult> => adapter.run({ label, ops } satisfies Batch);
const named = (doc: MockDocument, name: string) => doc.pageItems.find((i) => i._name === name)!;

const linear: Paint = { t: 'linear', name: 'T lin', angle: 90, stops: [{ p: 0, c: '#FF0000', o: 100 }, { p: 100, c: '#0000FF', o: 0 }] };

describe('shape.path', () => {
  it('draws bezier paths with smooth handles and fits a rotated linear gradient', async () => {
    const { adapter, doc } = await sim();
    const shape = roundedRectPath({ x: 0, y: 0, w: 400, h: 100 }, 20);
    const r = await run(adapter, [{ op: 'shape.path', paths: [shape], into: L, fill: linear, name: 'Card' }]);
    expect(r.ok).toBe(true);
    const p = named(doc, 'Card') as MockPathItem;
    expect(p.shape.kind).toBe('bez');
    const [l, t, rr, b] = p.geometricBounds;
    expect([l, t, rr, b].map((v) => Math.round(v) + 0)).toEqual([0, 0, 400, -100]);
    // Vertical gradient (90°): the gradient vector now points up and spans the height.
    const g = p._grad!;
    expect(Math.round(Math.hypot(g[0], g[1]))).toBe(100);
    expect(g[1]).toBeGreaterThan(0);
    expect(p.fillColor).toBeInstanceOf(GradientColor);
  });

  it('builds compound paths (holes) painted through the first sub-path', async () => {
    const { adapter, doc } = await sim();
    const outer = ellipsePath(200, 200, 100, 100);
    const inner = ellipsePath(200, 200, 60, 60);
    const r = await run(adapter, [{ op: 'shape.path', paths: [outer, inner], into: L, fill: { t: 'solid', c: '#C9A227' }, name: 'Ring' }]);
    expect(r.ok).toBe(true);
    const c = named(doc, 'Ring') as MockCompoundPathItem;
    expect(c).toBeInstanceOf(MockCompoundPathItem);
    expect(c._items).toHaveLength(2);
    const first = c._items[0] as MockPathItem;
    expect(first.evenodd).toBe(true);
    expect((first.fillColor as RGBColor).red).toBe(0xc9);
  });

  it('radial fills with fit=ellipse scale only the gradient', async () => {
    const { adapter, doc } = await sim();
    const glow: Paint = { t: 'radial', name: 'T glow', fit: 'ellipse', stops: [{ p: 0, c: '#FFFFFF', o: 100 }, { p: 100, c: '#FFFFFF', o: 0 }] };
    await run(adapter, [{ op: 'shape.rect', x: 0, y: 0, w: 400, h: 100, into: L, fill: glow, name: 'Wide glow' }]);
    const p = named(doc, 'Wide glow') as MockPathItem;
    expect(p.geometricBounds.map((v) => Math.round(v) + 0)).toEqual([0, 0, 400, -100]);
    expect(Math.round(p._grad![0])).toBe(200);
    expect(Math.round(p._grad![3])).toBe(50);
  });
});

describe('text', () => {
  it('creates RTL point text with the World-Ready composer and a font fallback', async () => {
    const { adapter, doc } = await sim();
    const r = await run(adapter, [
      { op: 'text.point', x: 500, y: 300, into: L, contents: 'اليوم الوطني ٩٥', size: 48, color: '#FFFFFF', fonts: ['NotInstalled-Bold', 'Tajawal-Bold'], align: 'right', rtl: true, name: 'Title' },
      { op: 'text.area', x: 100, y: 400, w: 300, h: 120, into: L, contents: 'سطر أول\nسطر ثانٍ', size: 18, color: '#222222', fonts: ['Missing-Font'], align: 'right', rtl: true, leading: 26, name: 'Body' },
    ]);
    expect(r.ok ? 'ok' : r.error.message).toBe('ok');
    const t = named(doc, 'Title') as MockTextFrame;
    expect(t.direction).toBe('RIGHT_TO_LEFT_DIRECTION');
    expect(t.composer).toBe('optycaComposer');
    expect(t.fontName).toBe('Tajawal-Bold');
    expect(t.justification).toBe(ENUMS.Justification.RIGHT);
    expect(t.geometricBounds[2]).toBeCloseTo(500);
    const body = named(doc, 'Body') as MockTextFrame;
    expect(body.kind).toBe(ENUMS.TextType.AREATEXT);
    expect(body.contents).toBe('سطر أول\rسطر ثانٍ');
    expect(body.leading).toBe(26);
    expect(r.ok && r.warnings.some((w) => w.includes('Missing-Font'))).toBe(true);
  });
});

describe('duplicate, restyle, transform, clip', () => {
  it('duplicates a subject without its AF tags and recolours only the copy', async () => {
    const { adapter, doc, runtime } = await sim();
    const logo = named(doc, 'logo') as MockPathItem;
    const t = logo.tags.add();
    t.name = 'AF_id';
    t.value = 'subject1';
    selectByName(doc, 'logo');
    const r = await run(adapter, [
      { op: 'group.create', into: L, name: 'FX' },
      { op: 'item.duplicate', ref: { k: 'sel', i: 0 }, to: { k: 'inside', ref: op(0), at: 'top' }, name: 'Silhouette' },
      { op: 'item.restyle', ref: op(1), fill: { t: 'solid', c: '#000000' }, stroke: null, opacity: 40, blend: 'multiply', recursive: true },
    ]);
    expect(r.ok).toBe(true);
    const sil = named(doc, 'Silhouette') as MockPathItem;
    expect(sil._tags.map((x) => x.name)).not.toContain('AF_id');
    expect((sil.fillColor as RGBColor).red).toBe(0);
    expect(sil.opacity).toBe(40);
    expect(sil.blendingMode).toBe('MULTIPLY');
    expect((logo.fillColor as RGBColor).green).toBe(0x7a);
    expect(runtime.app.activeDocument.pageItems.filter((i) => i._tags.some((x) => x.value === 'subject1'))).toHaveLength(1);
  });

  it('applies a design-space affine exactly (pivot corrected)', async () => {
    const { adapter, doc } = await sim();
    // Shear the square so its bottom edge stays put and the top leans right,
    // then squash it to 30% height — a cast-shadow style transform.
    const bx = 150;
    const by = 400;
    const m: [number, number, number, number, number, number] = [1, 0, 0.8, 0.3, -0.8 * by, by - 0.3 * by];
    const r = await run(adapter, [
      { op: 'shape.rect', x: 100, y: 300, w: 100, h: 100, into: L, fill: { t: 'solid', c: '#000000' }, name: 'Sq' },
      { op: 'item.transform', ref: op(0), m, gradients: true },
    ]);
    expect(r.ok).toBe(true);
    const sq = named(doc, 'Sq') as MockPathItem;
    const pts = (sq.shape as { pts: Array<[number, number]> }).pts.map(([x, y]) => [Math.round(x), Math.round(-y)]);
    // Design-space expectations: (x, y) -> (x + 0.8 y - 320, 0.3 y + 280)
    expect(pts).toEqual([
      [100 + 240 - 320, 90 + 280],
      [200 + 240 - 320, 90 + 280],
      [200 + 320 - 320, 120 + 280],
      [100 + 320 - 320, 120 + 280],
    ]);
    void bx;
  });

  it('refuses to transform the designer’s own artwork', async () => {
    const { adapter, doc } = await sim();
    selectByName(doc, 'logo');
    const r = await run(adapter, [{ op: 'item.rotate', ref: { k: 'sel', i: 0 }, angle: 10, about: 'center', gradients: true }]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.code).toBe('BAD_OP');
  });

  it('makes clipping groups from a created group', async () => {
    const { adapter, doc } = await sim();
    const r = await run(adapter, [
      { op: 'group.create', into: L, name: 'Clip' },
      { op: 'shape.rect', x: 0, y: 0, w: 100, h: 100, into: { k: 'inside', ref: op(0), at: 'top' }, fill: { t: 'none' }, name: 'Mask' },
      { op: 'shape.ellipse', cx: 100, cy: 100, w: 300, h: 300, into: { k: 'inside', ref: op(0), at: 'bottom' }, fill: { t: 'solid', c: '#FFCC00' }, name: 'Glow' },
      { op: 'group.clip', ref: op(0) },
    ]);
    expect(r.ok).toBe(true);
    const g = named(doc, 'Clip') as MockGroupItem;
    expect(g.clipped).toBe(true);
    expect((g._items[0] as MockPathItem).clipping).toBe(true);
  });

  it('rolls back everything, including restyled existing art, when an op fails', async () => {
    const { adapter, doc } = await sim();
    const before = JSON.stringify(serializeDoc(doc, false));
    selectByName(doc, 'logo');
    const r = await run(adapter, [
      { op: 'item.restyle', ref: { k: 'sel', i: 0 }, fill: linear, recursive: true },
      { op: 'shape.path', paths: [], into: L, fill: { t: 'none' } },
    ]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(serializeDoc(doc, false))).toBe(before);
  });
});

describe('swatches and colour sampling', () => {
  it('creates a named swatch group once', async () => {
    const { adapter, doc } = await sim();
    const colors = [
      { name: 'Brand Primary', c: '#0E7A4B' },
      { name: 'Brand Accent', c: '#C9A227' },
    ];
    await run(adapter, [{ op: 'swatch.group', name: 'Brand', colors }]);
    await run(adapter, [{ op: 'swatch.group', name: 'Brand', colors }]);
    expect(doc._swatchGroups).toHaveLength(1);
    expect(doc._swatchGroups[0]!._swatches.map((s) => s.name)).toEqual(['Brand Primary', 'Brand Accent']);
  });

  it('samples colours from vector art and counts images', async () => {
    const { adapter, doc } = await sim();
    selectByName(doc, 'logo', 'photo');
    const res = await adapter.document.sampleColors();
    expect(res.samples[0]!.hex).toBe('#0E7A4B');
    expect(res.images).toBe(1);
  });
});

describe('preview', () => {
  it('previews creative ops and removes them cleanly', async () => {
    const { adapter, doc } = await sim();
    const before = JSON.stringify(serializeDoc(doc, false));
    selectByName(doc, 'logo');
    const ops: HostOp[] = [
      { op: 'group.create', into: L, name: 'Neon' },
      { op: 'item.duplicate', ref: { k: 'sel', i: 0 }, to: { k: 'inside', ref: op(0), at: 'top' } },
      { op: 'item.restyle', ref: op(1), fill: { t: 'solid', c: '#35E0B0' }, recursive: true, blend: 'screen' },
      { op: 'item.transform', ref: op(1), m: [1.1, 0, 0, 1.1, -20, -15], gradients: true },
    ];
    const r = await adapter.preview.show({ label: 'pv', ops });
    expect(r.ok).toBe(true);
    await adapter.preview.cancel();
    expect(JSON.stringify(serializeDoc(doc, false))).toBe(before);
  });
});
