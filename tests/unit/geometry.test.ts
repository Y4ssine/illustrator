import { describe, expect, it } from 'vitest';
import { fromIllustratorBounds, insetRect, intersectRects, pairDistance, roundTo, toIllustratorBounds, unionRects } from '../../src/geometry/rect';
import { formatLength, fromPoints, parseLength, toPoints } from '../../src/geometry/units';
import { describeRatio, GOLDEN_RATIO, parseAspectRatio, parseRatioList, sizeForRatio } from '../../src/geometry/ratio';

describe('rect', () => {
  it('unions and intersects', () => {
    expect(unionRects([])).toBeNull();
    expect(unionRects([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: -5, w: 5, h: 5 }])).toEqual({ x: 0, y: -5, w: 25, h: 15 });
    expect(intersectRects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(intersectRects({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 })).toBeNull();
  });

  it('insets by margins', () => {
    expect(insetRect({ x: 0, y: 0, w: 1080, h: 1350 }, { top: 72, right: 64, bottom: 100, left: 64 })).toEqual({ x: 64, y: 72, w: 952, h: 1178 });
  });

  it('measures pair distances (negative = overlap)', () => {
    const d = pairDistance({ x: 0, y: 0, w: 100, h: 50 }, { x: 130, y: 80, w: 40, h: 40 });
    expect(d.gapX).toBe(30);
    expect(d.gapY).toBe(30);
    expect(d.edge).toBeCloseTo(Math.hypot(30, 30));
    const o = pairDistance({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 150, w: 100, h: 100 });
    expect(o.gapX).toBe(-50);
    expect(o.gapY).toBe(50);
    expect(o.edge).toBe(50);
  });

  it('converts Illustrator Y-up bounds to design space and back', () => {
    // A 1080×1350 artboard at the document origin: [0, 0, 1080, -1350] in Illustrator.
    const r = fromIllustratorBounds([0, 0, 1080, -1350]);
    expect(r).toEqual({ x: 0, y: 0, w: 1080, h: 1350 });
    expect(toIllustratorBounds(r)).toEqual([0, 0, 1080, -1350]);
    const item = fromIllustratorBounds([100, -200, 300, -500]);
    expect(item).toEqual({ x: 100, y: 200, w: 200, h: 300 });
  });

  it('rounds without negative zero', () => {
    expect(Object.is(roundTo(-0.0001, 2), 0)).toBe(true);
    expect(roundTo(1.23456, 3)).toBe(1.235);
  });
});

describe('units', () => {
  it('converts and parses', () => {
    expect(toPoints(210, 'mm')).toBeCloseTo(595.2756, 3);
    expect(fromPoints(72, 'in')).toBe(1);
    expect(parseLength('24', 'px')).toBe(24);
    expect(parseLength('5 mm', 'px')).toBeCloseTo(14.1732, 3);
    expect(parseLength('1.5in', 'px')).toBe(108);
    expect(parseLength('abc', 'px')).toBeNull();
    expect(formatLength(14.1732, 'mm')).toBe('5 mm');
  });
});

describe('ratios', () => {
  it('parses aspect ratios', () => {
    expect(parseAspectRatio('4:5')).toBeCloseTo(0.8);
    expect(parseAspectRatio('16/9')).toBeCloseTo(16 / 9);
    expect(parseAspectRatio('9 × 16')).toBeCloseTo(9 / 16);
    expect(parseAspectRatio('1.618')).toBeCloseTo(1.618);
    expect(parseAspectRatio('golden')).toBe(GOLDEN_RATIO);
    expect(parseAspectRatio('0:5')).toBeNull();
    expect(parseAspectRatio('wide')).toBeNull();
  });

  it('parses ratio lists', () => {
    expect(parseRatioList('1:2:1')).toEqual([1, 2, 1]);
    expect(parseRatioList('3 2 1')).toEqual([3, 2, 1]);
    expect(parseRatioList('1:-2')).toBeNull();
    expect(parseRatioList('')).toBeNull();
  });

  it('sizes and describes', () => {
    expect(sizeForRatio(4 / 5, { width: 1080 })).toEqual({ width: 1080, height: 1350 });
    expect(sizeForRatio(9 / 16, { height: 1920 })).toEqual({ width: 1080, height: 1920 });
    expect(describeRatio(1080 / 1350)).toBe('4:5');
    expect(describeRatio(1.23)).toBe('1.230');
  });
});
