/**
 * Colour helpers. The core describes colours as sRGB hex strings; the host
 * adapter converts them into the document colour space (RGB or CMYK) at the
 * last moment. The CMYK conversion here is a naive, profile-less fallback and
 * is labelled as such in the UI; when Illustrator exposes
 * `app.convertSampleColor` the host prefers it.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/(.)/g, '$1$1');
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return `#${s.toUpperCase()}`;
}

export function hexToRgb(hex: string): RGB {
  const n = normalizeHex(hex);
  if (!n) throw new Error(`Invalid colour: ${hex}`);
  const v = parseInt(n.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const h = (x: number): string => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** Naive device conversion (no ICC profile). Percentages 0–100. */
export function rgbToCmykNaive({ r, g, b }: RGB): CMYK {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = (1 - rr - k) / (1 - k);
  const m = (1 - gg - k) / (1 - k);
  const y = (1 - bb - k) / (1 - k);
  const p = (v: number): number => Math.round(v * 1000) / 10;
  return { c: p(c), m: p(m), y: p(y), k: p(k) };
}

/** Relative luminance (WCAG), 0–1. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
