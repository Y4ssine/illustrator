import { describe, expect, it } from 'vitest';
import { billboard, buildShadow, castFactor, castMatrix, castOffset, falloffStops, FORESHORTEN, groundDir, sanitizeShadowParams, DEFAULT_SHADOW, SHADOW_STYLES } from '../../src/effects/shadow-engine';
import { BUILTIN_SHADOW_PRESETS } from '../../src/effects/shadow-presets';
import { ArraySink } from '../../src/core/opsink';
import { effectXml, parseEffectXml } from '../../src/effects/effect-xml';
import { shapeBounds } from '../../src/geometry/path';

describe('shadow engine v2', () => {
  const subject = { x: 390, y: 520, w: 300, h: 640 };
  const ref = { k: 'sel', i: 0 } as const;

  it('produces a monotonic radial falloff ending at 0', () => {
    for (const s of [0, 0.35, 0.75, 1]) {
      const stops = falloffStops(s, '#000000');
      expect(stops[0]!.o).toBe(100);
      expect(stops[stops.length - 1]!.o).toBe(0);
      for (let i = 1; i < stops.length; i++) {
        expect(stops[i]!.p).toBeGreaterThan(stops[i - 1]!.p);
        expect(stops[i]!.o).toBeLessThanOrEqual(stops[i - 1]!.o);
      }
    }
    expect(falloffStops(0.2, '#000')[1]!.p).toBeGreaterThan(falloffStops(0.8, '#000')[1]!.p);
  });

  it('derives direction and length from the light (compass + elevation)', () => {
    // Light from the left → shadow falls to the right.
    expect(groundDir(270).x).toBeCloseTo(1);
    // Light from behind (top of the compass) → shadow comes toward the viewer (down on screen).
    expect(castOffset({ lightAngle: 0, elevation: 45, length: 100 }, 100).y).toBeCloseTo(100 * FORESHORTEN);
    // 45° → shadow as long as the object is tall; low sun → longer; noon → almost none.
    expect(castFactor({ elevation: 45, length: 100 })).toBeCloseTo(1);
    expect(castFactor({ elevation: 15, length: 100 })).toBeGreaterThan(3);
    expect(castFactor({ elevation: 89, length: 100 })).toBeLessThan(0.03);
  });

  it('cast matrix keeps the base line fixed and projects the top along the light', () => {
    const p = { lightAngle: 270, elevation: 45, length: 100 };
    const baseY = 1000;
    const [a, b, c, d, tx, ty] = castMatrix(p, baseY);
    const map = (x: number, y: number): [number, number] => [a * x + c * y + tx, b * x + d * y + ty];
    expect(map(200, baseY)[0]).toBeCloseTo(200);
    expect(map(200, baseY)[1]).toBeCloseTo(baseY);
    const top = map(200, baseY - 100);
    expect(top[0]).toBeCloseTo(300); // 100 tall, cot(45°) = 1, light from the left
    // Side light has no depth; a sliver is kept behind the subject so it reads.
    expect(top[1]).toBeLessThan(baseY);
  });

  it('sanitises parameters', () => {
    const p = sanitizeShadowParams({ style: 'nope' as never, strength: 400, lightAngle: -90, color: 'nope', lift: -5 });
    expect(p.style).toBe(DEFAULT_SHADOW.style);
    expect(p.strength).toBe(100);
    expect(p.lightAngle).toBe(270);
    expect(p.color).toBe(DEFAULT_SHADOW.color);
    expect(p.lift).toBe(0);
  });

  it('builds a tagged group for every style; silhouettes copy vector art, images fall back', () => {
    for (const style of SHADOW_STYLES.map((s) => s.id)) {
      const sink = new ArraySink(5);
      const r = buildShadow({ sink, subject: { rect: subject, ref, kind: 'group', name: 'Hero' }, params: sanitizeShadowParams({ style }), place: { k: 'below', ref }, tags: { AF_type: 'x' }, blurOk: true, artboard: { x: 0, y: 0, w: 1080, h: 1350 } });
      expect(r.top).toEqual({ k: 'op', i: 5 });
      expect(sink.ops[0]).toMatchObject({ op: 'group.create', name: expect.stringMatching(/^SHADOW — /), tags: { AF_type: 'x' } });
    }
    const vec = new ArraySink();
    buildShadow({ sink: vec, subject: { rect: subject, ref, kind: 'compound', name: 'Logo' }, params: sanitizeShadowParams({ style: 'silhouette' }), place: { k: 'below', ref }, tags: {}, blurOk: false, artboard: null });
    expect(vec.ops.filter((o) => o.op === 'item.duplicate')).toHaveLength(2);
    expect(vec.ops.some((o) => o.op === 'item.effect')).toBe(false);
    const img = new ArraySink();
    const r = buildShadow({ sink: img, subject: { rect: subject, ref, kind: 'placed', name: 'Photo' }, params: sanitizeShadowParams({ style: 'silhouette' }), place: { k: 'below', ref }, tags: {}, blurOk: true, artboard: null });
    expect(img.ops.some((o) => o.op === 'item.duplicate')).toBe(false);
    expect(r.notes.join()).toMatch(/Images cannot be recoloured/);
  });

  it('subject billboards stand on the base line', () => {
    for (const k of ['person', 'bottle', 'car', 'product'] as const) {
      const b = shapeBounds(billboard(k, subject, 1));
      expect(b.y + b.h).toBeCloseTo(subject.y + subject.h, 0);
    }
  });

  it('live effect XML round-trips (blur, drop shadow, glows)', () => {
    expect(effectXml({ kind: 'blur', radius: 12.345 })).toBe('<LiveEffect name="Adobe PSL Gaussian Blur"><Dict data="R PrevDocScale 1 I PrevDres 300 R blur 12.345 "/></LiveEffect>');
    const ds = effectXml({ kind: 'dropShadow', dx: 0, dy: 7, blur: 5, opacity: 75, color: '#1E3C78', multiply: true });
    expect(ds).toContain('<Fill color="5 0.118 0.235 0.471"/>');
    expect(parseEffectXml(ds)).toMatchObject({ kind: 'dropShadow', dy: 7, blur: 5, opacity: 75, multiply: true, color: '#1e3c78' });
    expect(parseEffectXml(effectXml({ kind: 'innerGlow', blur: 4, opacity: 60, color: '#FFFFFF', fromEdge: true }))).toMatchObject({ kind: 'innerGlow', fromEdge: true });
  });

  it('ships presets that are all valid', () => {
    for (const preset of BUILTIN_SHADOW_PRESETS) expect(sanitizeShadowParams(preset.params)).toEqual(preset.params);
    expect(new Set(BUILTIN_SHADOW_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_SHADOW_PRESETS.length);
  });
});
