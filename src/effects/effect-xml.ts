/**
 * Live Effect XML for PageItem.applyEffect(). Adobe does not document the XML;
 * these templates follow a public, tested library
 * (mark1bean/live-effect-functions-for-illustrator — see docs/COMPATIBILITY.md).
 *
 * Verified parts: effect names, dictionary keys, colour encoding
 * ("5 r g b" with 0–1 floats), blend 0 = Normal / 1 = Multiply.
 * Every use is optional on the host: if applyEffect fails, the command still
 * succeeds and reports a warning.
 */

import type { HostOp, Ref } from '../core/protocol';
import { hexToRgb } from '../utils/color';
import { clamp } from '../utils/misc';

export type EffectSpec =
  | { kind: 'blur'; radius: number }
  | { kind: 'feather'; radius: number }
  /** Native Drop Shadow. dx/dy in points (design space: +dy = down), opacity 0–100. */
  | { kind: 'dropShadow'; dx: number; dy: number; blur: number; opacity: number; color: string; multiply: boolean }
  | { kind: 'outerGlow'; blur: number; opacity: number; color: string; multiply: boolean }
  | { kind: 'innerGlow'; blur: number; opacity: number; color: string; fromEdge: boolean };

const num = (v: number): string => String(Math.round(v * 1000) / 1000);

/** Live-effect colour: "5 r g b" (RGB, 0–1). */
export function effectColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `5 ${num(r / 255)} ${num(g / 255)} ${num(b / 255)}`;
}

export function effectXml(spec: EffectSpec): string {
  switch (spec.kind) {
    case 'blur':
      return `<LiveEffect name="Adobe PSL Gaussian Blur"><Dict data="R PrevDocScale 1 I PrevDres 300 R blur ${num(clamp(spec.radius, 0.1, 250))} "/></LiveEffect>`;
    case 'feather':
      return `<LiveEffect name="Adobe Fuzzy Mask"><Dict data="R Radius ${num(clamp(spec.radius, 0.1, 1000))} "/></LiveEffect>`;
    case 'dropShadow':
      return (
        `<LiveEffect name="Adobe Drop Shadow"><Dict data="I blnd ${spec.multiply ? 1 : 0} R opac ${num(clamp(spec.opacity, 0, 100) / 100)} ` +
        `R horz ${num(spec.dx)} R vert ${num(spec.dy)} R blur ${num(clamp(spec.blur, 0, 144))} B usePSLBlur 1 I csrc 0 R dark 100 B pair 1 ">` +
        `<Entry name="sclr" valueType="F"><Fill color="${effectColor(spec.color)}"/></Entry></Dict></LiveEffect>`
      );
    case 'outerGlow':
      return (
        `<LiveEffect name="Adobe Outer Glow"><Dict data="I blnd ${spec.multiply ? 1 : 0} R opac ${num(clamp(spec.opacity, 0, 100) / 100)} R blur ${num(clamp(spec.blur, 0, 144))} B usePSLBlur 1 ">` +
        `<Entry name="sclr" valueType="F"><Fill color="${effectColor(spec.color)}"/></Entry></Dict></LiveEffect>`
      );
    case 'innerGlow':
      return (
        `<LiveEffect name="Adobe Inner Glow"><Dict data="I blnd 0 I gtyp ${spec.fromEdge ? 1 : 0} R opac ${num(clamp(spec.opacity, 0, 100) / 100)} R blur ${num(clamp(spec.blur, 0, 144))} ">` +
        `<Entry name="gclr" valueType="F"><Fill color="${effectColor(spec.color)}"/></Entry></Dict></LiveEffect>`
      );
  }
}

export function fxOp(ref: Ref, spec: EffectSpec): HostOp {
  return { op: 'item.effect', ref, xml: effectXml(spec), optional: true };
}

/** Parse our own effect XML back (simulator renderer, tests). Unknown XML → null. */
export function parseEffectXml(xml: string): EffectSpec | null {
  const name = /LiveEffect name="([^"]+)"/.exec(xml)?.[1];
  const data = /Dict data="([^"]*)"/.exec(xml)?.[1] ?? '';
  const val = (k: string): number => {
    const m = new RegExp(`[RIB] ${k} (-?[0-9.]+)`).exec(data);
    return m ? Number(m[1]) : 0;
  };
  const color = (): string => {
    const m = /Fill color="5 ([0-9.]+) ([0-9.]+) ([0-9.]+)/.exec(xml);
    if (!m) return '#000000';
    return '#' + [m[1], m[2], m[3]].map((c) => Math.round(Number(c) * 255).toString(16).padStart(2, '0')).join('');
  };
  switch (name) {
    case 'Adobe PSL Gaussian Blur':
      return { kind: 'blur', radius: val('blur') };
    case 'Adobe Fuzzy Mask':
      return { kind: 'feather', radius: val('Radius') };
    case 'Adobe Drop Shadow':
      return { kind: 'dropShadow', dx: val('horz'), dy: val('vert'), blur: val('blur'), opacity: val('opac') * 100, color: color(), multiply: val('blnd') === 1 };
    case 'Adobe Outer Glow':
      return { kind: 'outerGlow', blur: val('blur'), opacity: val('opac') * 100, color: color(), multiply: val('blnd') === 1 };
    case 'Adobe Inner Glow':
      return { kind: 'innerGlow', blur: val('blur'), opacity: val('opac') * 100, color: color(), fromEdge: val('gtyp') === 1 };
    default:
      return null;
  }
}
