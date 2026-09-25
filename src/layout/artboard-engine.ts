/**
 * Artboard planning — decides what "Instagram Portrait" should do in the
 * current document, where new artboards go and how they are named.
 */

import { pad } from '../utils/misc';
import type { Rect } from '../geometry/rect';
import type { DocumentInfo } from '../core/snapshot';
import type { ArtboardPreset } from './artboard-presets';

export type ArtboardMode = 'auto' | 'add' | 'resizeActive';

export type ArtboardPlan =
  | { kind: 'createDocument'; w: number; h: number; colorSpace: 'RGB' | 'CMYK'; name: string }
  | { kind: 'alreadyMatches'; index: number; message: string }
  | { kind: 'add'; rect: Rect; name: string }
  | { kind: 'resize'; index: number; rect: Rect; name: string };

export function sizeMatches(r: Rect, w: number, h: number, tolerance = 0.5): boolean {
  return Math.abs(r.w - w) <= tolerance && Math.abs(r.h - h) <= tolerance;
}

/** Place a new artboard to the right of the right-most artboard, top-aligned with it. */
export function placeNextTo(existing: readonly Rect[], w: number, h: number, spacing: number): Rect {
  if (existing.length === 0) return { x: 0, y: 0, w, h };
  let rightMost = existing[0]!;
  for (const r of existing) if (r.x + r.w > rightMost.x + rightMost.w) rightMost = r;
  return { x: rightMost.x + rightMost.w + spacing, y: rightMost.y, w, h };
}

/**
 * Format an artboard name. Tokens:
 *   {nn} 2-digit index, {nnn} 3-digit, {n} plain, {CODE} preset code, {name} preset name
 */
export function formatArtboardName(pattern: string, index: number, preset?: Pick<ArtboardPreset, 'code' | 'name'>): string {
  return pattern
    .replace(/\{nnn\}/g, pad(index, 3))
    .replace(/\{nn\}/g, pad(index, 2))
    .replace(/\{n\}/g, String(index))
    .replace(/\{CODE\}/g, preset?.code ?? 'ARTBOARD')
    .replace(/\{name\}/g, preset?.name ?? 'Artboard');
}

/** Next free number for names built from `pattern` among existing names. */
export function nextArtboardNumber(existingNames: readonly string[], pattern: string, preset?: Pick<ArtboardPreset, 'code' | 'name'>): number {
  let n = 1;
  const taken = new Set(existingNames);
  while (taken.has(formatArtboardName(pattern, n, preset)) && n < 9999) n++;
  return n;
}

export function planSocialArtboard(
  doc: DocumentInfo | null,
  preset: Pick<ArtboardPreset, 'w' | 'h' | 'code' | 'name' | 'colorSpace'>,
  opts: { mode: ArtboardMode; spacing: number; namePattern: string },
): ArtboardPlan {
  if (!doc) {
    return {
      kind: 'createDocument',
      w: preset.w,
      h: preset.h,
      colorSpace: preset.colorSpace,
      name: formatArtboardName(opts.namePattern, 1, preset),
    };
  }
  const active = doc.artboards.find((a) => a.index === doc.activeArtboard) ?? doc.artboards[0];
  const names = doc.artboards.map((a) => a.name);
  const name = formatArtboardName(opts.namePattern, nextArtboardNumber(names, opts.namePattern, preset), preset);

  if (opts.mode === 'auto' && active && sizeMatches(active.rect, preset.w, preset.h)) {
    return {
      kind: 'alreadyMatches',
      index: active.index,
      message: `The active artboard is already ${preset.w} × ${preset.h}.`,
    };
  }

  const docIsEmpty = doc.layers.every((l) => l.items === 0 && l.sublayers === 0);
  const resize = opts.mode === 'resizeActive' || (opts.mode === 'auto' && doc.artboards.length === 1 && docIsEmpty);
  if (resize && active) {
    // Keep the top-left corner fixed; artwork is never moved.
    return { kind: 'resize', index: active.index, rect: { x: active.rect.x, y: active.rect.y, w: preset.w, h: preset.h }, name };
  }
  const rect = placeNextTo(
    doc.artboards.map((a) => a.rect),
    preset.w,
    preset.h,
    opts.spacing,
  );
  // Illustrator's canvas is finite (227 in). Its origin is not exposed to
  // scripts, so an out-of-canvas rect is reported by the host as an error
  // rather than guessed here.
  return { kind: 'add', rect, name };
}

/** Side-by-side slides for a carousel. spacing 0 = continuous (seamless) carousel. */
export function planCarousel(
  existing: readonly Rect[],
  preset: Pick<ArtboardPreset, 'w' | 'h' | 'code' | 'name'>,
  count: number,
  spacing: number,
  namePattern: string,
): Array<{ rect: Rect; name: string }> {
  const n = Math.floor(count);
  if (n < 1 || n > 100) throw new Error('Carousel slide count must be between 1 and 100.');
  const first = placeNextTo(existing, preset.w, preset.h, existing.length ? Math.max(spacing, 100) : 0);
  const out: Array<{ rect: Rect; name: string }> = [];
  for (let i = 0; i < n; i++) {
    out.push({
      rect: { x: first.x + i * (preset.w + spacing), y: first.y, w: preset.w, h: preset.h },
      name: formatArtboardName(namePattern, i + 1, preset),
    });
  }
  return out;
}
