/**
 * Colour maths for palettes, gradients and lighting: sRGB ↔ HSL ↔ linear ↔
 * OKLab (perceptual distance and mixing), colour temperature, contrast.
 */

import { hexToRgb, rgbToHex, type RGB } from '../utils/color';
import { clamp } from '../utils/misc';

export interface HSL {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

export interface OKLab {
  L: number;
  a: number;
  b: number;
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hh = (((h % 360) + 360) % 360) / 360;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number): number => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return { r: f(hh + 1 / 3) * 255, g: f(hh) * 255, b: f(hh - 1 / 3) * 255 };
}

export const hexToHsl = (hex: string): HSL => rgbToHsl(hexToRgb(hex));
export const hslToHex = (hsl: HSL): string => rgbToHex(hslToRgb(hsl));

const toLin = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

export function rgbToOklab({ r, g, b }: RGB): OKLab {
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

export function oklabToRgb({ L, a, b }: OKLab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const enc = (v: number): number => clamp(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055), 0, 255);
  return { r: enc(R), g: enc(G), b: enc(B) };
}


/** Perceptual distance (ΔE in OKLab, ≈0.02 = just noticeable). */
export function deltaE(a: string, b: string): number {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return Math.hypot(A.L - B.L, A.a - B.a, A.b - B.b);
}

/** Perceptual mix (OKLab) — avoids the muddy middle of RGB blends. */
export function mix(a: string, b: string, t: number): string {
  const A = rgbToOklab(hexToRgb(a));
  const B = rgbToOklab(hexToRgb(b));
  return rgbToHex(oklabToRgb({ L: A.L + (B.L - A.L) * t, a: A.a + (B.a - A.a) * t, b: A.b + (B.b - A.b) * t }));
}

export function lighten(hex: string, amount: number): string {
  const c = rgbToOklab(hexToRgb(hex));
  return rgbToHex(oklabToRgb({ ...c, L: clamp(c.L + amount, 0, 1) }));
}

export function saturate(hex: string, factor: number): string {
  const c = rgbToOklab(hexToRgb(hex));
  return rgbToHex(oklabToRgb({ L: c.L, a: c.a * factor, b: c.b * factor }));
}

export function rotateHue(hex: string, deg: number): string {
  const h = hexToHsl(hex);
  return hslToHex({ ...h, h: h.h + deg });
}

/** Chroma (colourfulness) in OKLab. */
export function chroma(hex: string): number {
  const c = rgbToOklab(hexToRgb(hex));
  return Math.hypot(c.a, c.b);
}

export function lightness(hex: string): number {
  return rgbToOklab(hexToRgb(hex)).L;
}

/**
 * Colour of a black body at `kelvin` (1000–40000 K), Tanner Helland's fit.
 * 2000 K candle/sunset · 3200 K tungsten · 5500 K daylight · 7500 K+ shade/moon.
 */
export function kelvinToHex(kelvin: number): string {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  return rgbToHex({ r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) });
}

export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const { r, g, b: bb } = hexToRgb(hex);
    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(bb);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** Readable text colour (near-black or white) for a background. */
export function onColor(bg: string, dark = '#141414', light = '#FFFFFF'): string {
  return contrastRatio(bg, dark) >= contrastRatio(bg, light) ? dark : light;
}
