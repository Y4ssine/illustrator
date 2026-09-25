import { describe, expect, it } from 'vitest';
import { analyzeSpacing, detectAxis, planSpacing, SPACING_SYSTEMS, suggestGap, type SpacingItem } from '../../src/layout/spacing-engine';

const row = (xs: Array<[number, number]>): SpacingItem[] => xs.map(([x, w], i) => ({ id: `i${i}`, rect: { x, y: 0, w, h: 40 } }));
const eight = SPACING_SYSTEMS['8']!;
const tokens = SPACING_SYSTEMS['tokens']!;

function apply(items: SpacingItem[], moves: Array<{ id: string; dx: number; dy: number }>): SpacingItem[] {
  return items.map((it) => {
    const m = moves.find((x) => x.id === it.id);
    return m ? { ...it, rect: { ...it.rect, x: it.rect.x + m.dx, y: it.rect.y + m.dy } } : it;
  });
}

describe('spacing engine', () => {
  // [ object ][23px][object][41px][object]
  const items = row([
    [0, 100],
    [123, 80],
    [244, 60],
  ]);

  it('measures gaps', () => {
    const a = analyzeSpacing(items, 'auto', eight);
    expect(a.axis).toBe('x');
    expect(a.gaps).toEqual([23, 41]);
    expect(a.min).toBe(23);
    expect(a.max).toBe(41);
    expect(a.mean).toBe(32);
    expect(a.suggested).toBe(32);
    expect(a.uniform).toBe(false);
  });

  it('suggests values from the chosen system', () => {
    expect(suggestGap(37.4, eight)).toBe(40);
    expect(suggestGap(37.4, tokens)).toBe(32);
    expect(suggestGap(37.4, SPACING_SYSTEMS['10']!)).toBe(40);
    expect(suggestGap(-3, eight)).toBe(0);
  });

  it('normalizes to 32 (first item fixed, LTR)', () => {
    const p = planSpacing(items, { kind: 'normalize' }, { axis: 'auto', anchor: 'start', system: eight });
    expect(p.targetGap).toBe(32);
    const after = analyzeSpacing(apply(items, p.moves), 'x', eight);
    expect(after.gaps).toEqual([32, 32]);
    expect(p.moves.find((m) => m.id === 'i0')).toBeUndefined();
  });

  it('keeps the right-most item fixed for RTL layouts', () => {
    const p = planSpacing(items, { kind: 'exact', value: 16 }, { axis: 'x', anchor: 'end', system: eight });
    const out = apply(items, p.moves);
    expect(out[2]!.rect.x).toBe(244);
    expect(analyzeSpacing(out, 'x', eight).gaps).toEqual([16, 16]);
  });

  it('keeps the centre fixed with the centre anchor', () => {
    const p = planSpacing(items, { kind: 'exact', value: 0 }, { axis: 'x', anchor: 'center', system: eight });
    const out = apply(items, p.moves);
    const beforeMid = (0 + 304) / 2;
    const afterMid = (out[0]!.rect.x + out[2]!.rect.x + out[2]!.rect.w) / 2;
    expect(afterMid).toBeCloseTo(beforeMid, 9);
  });

  it('distributes evenly between the outer two', () => {
    const p = planSpacing(items, { kind: 'distribute' }, { axis: 'x', anchor: 'start', system: eight });
    const out = apply(items, p.moves);
    expect(out[0]!.rect.x).toBe(0);
    expect(out[2]!.rect.x).toBe(244);
    const g = analyzeSpacing(out, 'x', eight).gaps;
    expect(g[0]).toBeCloseTo(32, 9);
    expect(g[1]).toBeCloseTo(32, 9);
    const two = planSpacing(items.slice(0, 2), { kind: 'distribute' }, { axis: 'x', anchor: 'start', system: eight });
    expect(two.moves).toHaveLength(0);
    expect(two.message).toMatch(/three/);
  });

  it('matches smallest / largest / first', () => {
    for (const [kind, expected] of [
      ['matchSmallest', 23],
      ['matchLargest', 41],
      ['matchFirst', 23],
    ] as const) {
      const p = planSpacing(items, { kind }, { axis: 'x', anchor: 'start', system: eight });
      expect(analyzeSpacing(apply(items, p.moves), 'x', eight).gaps).toEqual([expected, expected]);
    }
  });

  it('orders by position, not selection order, and handles overlaps', () => {
    const shuffled = [items[2]!, items[0]!, items[1]!];
    expect(analyzeSpacing(shuffled, 'x', eight).order).toEqual(['i0', 'i1', 'i2']);
    const overlapping = row([
      [0, 100],
      [80, 100],
    ]);
    const a = analyzeSpacing(overlapping, 'x', eight);
    expect(a.overlaps).toBe(1);
    const p = planSpacing(overlapping, { kind: 'exact', value: 8 }, { axis: 'x', anchor: 'start', system: eight });
    expect(p.moves).toEqual([{ id: 'i1', dx: 28, dy: 0 }]);
  });

  it('detects vertical stacks (headline above image)', () => {
    const stack: SpacingItem[] = [
      { id: 'headline', rect: { x: 140, y: 150, w: 800, h: 100 } },
      { id: 'hero', rect: { x: 390, y: 520, w: 300, h: 640 } },
    ];
    expect(detectAxis(stack)).toBe('y');
    const p = planSpacing(stack, { kind: 'normalize' }, { axis: 'auto', anchor: 'start', system: eight });
    expect(p.targetGap).toBe(272);
    expect(p.moves).toEqual([{ id: 'hero', dx: 0, dy: 2 }]);
  });

  it('reports "nothing to do" when spacing already matches', () => {
    const even = row([
      [0, 10],
      [42, 10],
      [84, 10],
    ]);
    const p = planSpacing(even, { kind: 'normalize' }, { axis: 'x', anchor: 'start', system: eight });
    expect(p.moves).toHaveLength(0);
    expect(p.message).toMatch(/already/);
  });

  it('scales to 5,000 items', () => {
    const many = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), rect: { x: i * 13.7, y: 0, w: 10, h: 10 } }));
    const t0 = performance.now();
    const p = planSpacing(many, { kind: 'normalize' }, { axis: 'x', anchor: 'start', system: eight });
    expect(performance.now() - t0).toBeLessThan(500);
    expect(p.moves.length).toBeGreaterThan(4000);
  });
});
