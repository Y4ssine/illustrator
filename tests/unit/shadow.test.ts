import { describe, expect, it } from 'vitest';
import { buildShadowOps, ellipseFor, falloffStops, gaussianBlurXml, sanitizeShadowParams, SHADOW_DEFAULTS, shadowItemName } from '../../src/effects/shadow-engine';
import { BUILTIN_SHADOW_PRESETS } from '../../src/effects/shadow-presets';

describe('shadow engine', () => {
  const subject = { x: 390, y: 520, w: 300, h: 640 };

  it('places a ground ellipse centred on the subject bottom edge', () => {
    const p = SHADOW_DEFAULTS.ground;
    const e = ellipseFor(subject, p, p);
    expect(e.cx).toBe(540);
    expect(e.cy).toBe(1160);
    expect(e.w).toBeCloseTo(270, 9);
    expect(e.h).toBeCloseTo(270 * 0.14, 9);
  });

  it('applies relative offsets and caps height by subject height', () => {
    const e = ellipseFor(subject, { widthScale: 1, flatness: 1, softness: 0, opacity: 0 }, { offsetX: 10, offsetY: 5, rotation: 0 });
    expect(e.cx).toBe(540 + 30);
    expect(e.cy).toBe(1160 + 32);
    const flat = ellipseFor({ x: 0, y: 0, w: 1000, h: 20 }, { widthScale: 1, flatness: 1, softness: 0, opacity: 0 }, { offsetX: 0, offsetY: 0, rotation: 0 });
    expect(flat.h).toBe(12);
  });

  it('produces a monotonic falloff ending at 0', () => {
    for (const s of [0, 0.35, 0.75, 1]) {
      const stops = falloffStops(s, '#000000');
      expect(stops[0]!.o).toBe(100);
      expect(stops[stops.length - 1]!.o).toBe(0);
      expect(stops[stops.length - 1]!.p).toBe(100);
      for (let i = 1; i < stops.length; i++) {
        expect(stops[i]!.p).toBeGreaterThan(stops[i - 1]!.p);
        expect(stops[i]!.o).toBeLessThanOrEqual(stops[i - 1]!.o);
      }
      stops.forEach((st) => expect(st.m).toBeGreaterThanOrEqual(13));
    }
    // Softer → the fully opaque core is smaller.
    expect(falloffStops(0.2, '#000')[1]!.p).toBeGreaterThan(falloffStops(0.8, '#000')[1]!.p);
  });

  it('sanitises and clamps parameters', () => {
    const p = sanitizeShadowParams({ kind: 'contact', opacity: 400, widthScale: -3, color: 'nope', ambient: { opacity: 50 } as never });
    expect(p.opacity).toBe(100);
    expect(p.widthScale).toBe(0.05);
    expect(p.color).toBe(SHADOW_DEFAULTS.contact.color);
    expect(p.ambient.opacity).toBe(50);
    expect(p.ambient.widthScale).toBe(SHADOW_DEFAULTS.contact.ambient.widthScale);
    expect(sanitizeShadowParams({}).kind).toBe('ground');
  });

  it('builds host ops: one ellipse for ground, a group for contact + ambient', () => {
    const tags = { AF_type: 'groundShadow' };
    const g = buildShadowOps({ subject, subjectName: 'Hero', params: SHADOW_DEFAULTS.ground, place: { k: 'below', ref: { k: 'sel', i: 0 } }, tags, preview: false }, 3);
    expect(g.ops).toHaveLength(1);
    expect(g.ops[0]).toMatchObject({ op: 'shape.ellipse', blend: 'multiply', opacity: 30, name: 'SHADOW — Ground — Hero', tags });
    const ca = buildShadowOps({ subject, subjectName: 'Hero', params: { ...SHADOW_DEFAULTS.contactAmbient, liveBlur: 4 }, place: { k: 'below', ref: { k: 'sel', i: 0 } }, tags, preview: false }, 10);
    expect(ca.ops.map((o) => o.op)).toEqual(['group.create', 'shape.ellipse', 'shape.ellipse', 'item.effect']);
    expect(ca.ops[1]).toMatchObject({ into: { k: 'inside', ref: { k: 'op', i: 10 }, at: 'bottom' }, name: 'Ambient' });
    expect(ca.ops[3]).toMatchObject({ ref: { k: 'op', i: 11 }, optional: true });
  });

  it('names and blur XML', () => {
    expect(shadowItemName('contactAmbient', 'بطل')).toBe('SHADOW — Contact+Ambient — بطل');
    expect(gaussianBlurXml(12.345)).toBe('<LiveEffect name="Adobe PSL Gaussian Blur"><Dict data="R blur 12.3 "/></LiveEffect>');
  });

  it('ships presets that are all valid', () => {
    for (const preset of BUILTIN_SHADOW_PRESETS) {
      expect(sanitizeShadowParams(preset.params)).toEqual(preset.params);
    }
    expect(new Set(BUILTIN_SHADOW_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_SHADOW_PRESETS.length);
  });
});
