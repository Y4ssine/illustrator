import { describe, expect, it } from 'vitest';
import { computeGrid, computeTracks, dedupeLines, GridError, type GuideLine } from '../../src/guides/grid-engine';
import { offsetGuides, quickGuides, safeAreaGuides } from '../../src/guides/guide-generator';
import { SAFE_ZONES, scaledInset } from '../../src/guides/safe-zones';
import { uniformMargins } from '../../src/geometry/rect';
import { BUILTIN_GRID_PRESETS } from '../../src/presets/builtin';

const AB = { x: 0, y: 0, w: 1080, h: 1350 };
const verticals = (lines: GuideLine[]): number[] => lines.filter((l) => l.x1 === l.x2).map((l) => l.x1).sort((a, b) => a - b);
const horizontals = (lines: GuideLine[]): number[] => lines.filter((l) => l.y1 === l.y2).map((l) => l.y1).sort((a, b) => a - b);

describe('computeTracks', () => {
  it('splits equal columns with gutters', () => {
    const t = computeTracks(64, 952, { count: 12, gutter: 24 });
    expect(t).toHaveLength(12);
    const w = (952 - 24 * 11) / 12;
    t.forEach((tr) => expect(tr.size).toBeCloseTo(w, 9));
    expect(t[0]!.start).toBe(64);
    expect(t[11]!.start + t[11]!.size).toBeCloseTo(64 + 952, 9);
  });

  it('supports custom ratios', () => {
    const t = computeTracks(0, 1000, { count: 3, gutter: 0, ratios: [1, 2, 1] });
    expect(t.map((x) => x.size)).toEqual([250, 500, 250]);
  });

  it('rejects impossible grids with a readable message', () => {
    expect(() => computeTracks(0, 100, { count: 10, gutter: 20 })).toThrow(/do not fit/);
    expect(() => computeTracks(0, 100, { count: 0, gutter: 0 })).toThrow(GridError);
    expect(() => computeTracks(0, 100, { count: 2, gutter: 0, ratios: [1, 2, 3] })).toThrow(/ratios/);
  });
});

describe('computeGrid', () => {
  it('builds a 12-column grid with margins', () => {
    const g = computeGrid(AB, { margins: uniformMargins(64), columns: { count: 12, gutter: 24 }, marginGuides: true });
    const xs = verticals(g.lines);
    // 12 columns → 24 edges; the two outer edges coincide with margin guides.
    expect(xs).toHaveLength(24);
    expect(xs[0]).toBe(64);
    expect(xs[xs.length - 1]).toBeCloseTo(1016, 9);
    expect(horizontals(g.lines)).toEqual([64, 1286]);
    expect(g.content).toEqual({ x: 64, y: 64, w: 952, h: 1222 });
    expect(g.columns).toHaveLength(12);
  });

  it('builds the Campaign Grid preset (6 × 8 modular + centre axes)', () => {
    const preset = BUILTIN_GRID_PRESETS.find((p) => p.id === 'campaign-grid')!;
    const g = computeGrid(AB, preset.spec);
    expect(g.modules).toHaveLength(48);
    expect(verticals(g.lines)).toContain(540); // centre axis
    expect(horizontals(g.lines)).toContain(675);
    // 12 column edges + centre = 13 verticals, 16 row edges + centre = 17 horizontals (margins coincide with outer edges)
    expect(g.lines).toHaveLength(30);
    // Modules tile the content box exactly.
    const area = g.modules.reduce((a, m) => a + m.w * m.h, 0);
    const colW = (936 - 5 * 24) / 6;
    const rowH = (1206 - 7 * 24) / 8;
    expect(area).toBeCloseTo(48 * colW * rowH, 6);
  });

  it('places thirds and golden sections on the area', () => {
    const g = computeGrid(AB, { margins: uniformMargins(0), thirds: true, golden: true, marginGuides: false });
    const xs = verticals(g.lines);
    expect(xs).toHaveLength(4);
    expect(xs[0]).toBe(360);
    expect(xs[1]).toBeCloseTo(1080 * 0.381966, 3);
    expect(xs[2]).toBeCloseTo(1080 * 0.618034, 3);
    expect(xs[3]).toBe(720);
    expect(horizontals(g.lines)).toContain(450);
  });

  it('creates a baseline grid inside the content box', () => {
    const g = computeGrid({ x: 0, y: 0, w: 100, h: 100 }, { margins: uniformMargins(10), baseline: { increment: 8, offset: 0 }, marginGuides: false });
    const ys = horizontals(g.lines);
    expect(ys[0]).toBe(10);
    expect(ys[ys.length - 1]).toBe(90);
    expect(ys).toHaveLength(11);
  });

  it('refuses baselines that would create thousands of guides', () => {
    expect(() => computeGrid({ x: 0, y: 0, w: 100, h: 50000 }, { margins: uniformMargins(0), baseline: { increment: 1, offset: 0 } })).toThrow(/Use a larger increment/);
  });

  it('draws diagonals and radial spokes', () => {
    const d = computeGrid({ x: 0, y: 0, w: 200, h: 100 }, { margins: uniformMargins(0), diagonals: 'fortyFive', marginGuides: false });
    expect(d.lines).toHaveLength(4);
    expect(d.lines[0]).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 100 });
    const r = computeGrid({ x: 0, y: 0, w: 200, h: 100 }, { margins: uniformMargins(0), radial: { spokes: 4 }, marginGuides: false });
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toMatchObject({ x1: 100, y1: 50, x2: 100, y2: 0 });
  });

  it('works on selection-sized areas anywhere on the canvas', () => {
    const g = computeGrid({ x: -300, y: 500, w: 400, h: 200 }, { margins: uniformMargins(20), columns: { count: 4, gutter: 10 } });
    expect(verticals(g.lines)[0]).toBe(-280);
    expect(g.lines.every((l) => l.y1 >= 500 && l.y2 <= 700)).toBe(true);
  });

  it('snaps to whole pixels on request and warns', () => {
    const g = computeGrid({ x: 0, y: 0, w: 1000, h: 100 }, { margins: uniformMargins(0), columns: { count: 3, gutter: 10 }, pixelSnap: true, marginGuides: false });
    expect(verticals(g.lines).every((x) => Number.isInteger(x))).toBe(true);
    expect(g.warnings.join()).toMatch(/whole pixels/);
  });

  it('validates areas and margins', () => {
    expect(() => computeGrid({ x: 0, y: 0, w: 0, h: 10 }, { margins: uniformMargins(0) })).toThrow(/no size/);
    expect(() => computeGrid({ x: 0, y: 0, w: 100, h: 100 }, { margins: uniformMargins(60) })).toThrow(/Margins/);
  });

  it('dedupes coincident lines, keeping the first role', () => {
    const lines: GuideLine[] = [
      { x1: 10, y1: 0, x2: 10, y2: 100, role: 'margin' },
      { x1: 10, y1: 0, x2: 10, y2: 100, role: 'column' },
      { x1: 10, y1: 20, x2: 10, y2: 80, role: 'column' },
      { x1: 20, y1: 0, x2: 20, y2: 100, role: 'column' },
    ];
    const d = dedupeLines(lines);
    expect(d).toHaveLength(2);
    expect(d[0]!.role).toBe('margin');
  });
});

describe('guide generator', () => {
  const sel = { x: 100, y: 200, w: 300, h: 150 };
  it('creates quick guides spanning the artboard', () => {
    const g = quickGuides(sel, ['edges', 'center'], AB);
    expect(verticals(g)).toEqual([100, 250, 400]);
    expect(horizontals(g)).toEqual([200, 275, 350]);
    expect(g.every((l) => (l.x1 === l.x2 ? l.y1 === 0 && l.y2 === 1350 : l.x1 === 0 && l.x2 === 1080))).toBe(true);
  });

  it('creates offset guides around a selection', () => {
    const g = offsetGuides(sel, [16], AB);
    expect(verticals(g)).toEqual([84, 416]);
    expect(horizontals(g)).toEqual([184, 366]);
    expect(offsetGuides(sel, [-200], AB)).toHaveLength(0); // collapses → nothing
  });

  it('creates safe-area guides and scales presets', () => {
    const story = SAFE_ZONES.find((z) => z.id === 'ig-story')!;
    expect(scaledInset(story, 1080, 1920)).toEqual(story.inset);
    const half = scaledInset(story, 540, 960);
    expect(half.top).toBe(125);
    const lines = safeAreaGuides({ x: 0, y: 0, w: 1080, h: 1920 }, story.inset);
    expect(horizontals(lines)).toEqual([250, 1670]);
    const print = SAFE_ZONES.find((z) => z.id === 'print-5mm')!;
    expect(scaledInset(print, 2000, 3000)).toEqual(print.inset);
  });
});
