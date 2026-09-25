/**
 * Quick guides: edges, centres, thirds, quarters, golden sections, offsets
 * around a selection and safe-area rectangles. Pure functions.
 */

import { GOLDEN_RATIO } from '../geometry/ratio';
import type { Margins, Rect } from '../geometry/rect';
import { dedupeLines, type GuideLine, type GuideRole } from './grid-engine';

export type QuickGuideKind =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'edges'
  | 'centerV'
  | 'centerH'
  | 'center'
  | 'thirds'
  | 'quarters'
  | 'golden';

export const QUICK_GUIDE_LABELS: Record<QuickGuideKind, string> = {
  left: 'Left edge',
  right: 'Right edge',
  top: 'Top edge',
  bottom: 'Bottom edge',
  edges: 'All edges',
  centerV: 'Vertical centre',
  centerH: 'Horizontal centre',
  center: 'Centre (both)',
  thirds: 'Thirds',
  quarters: 'Quarters',
  golden: 'Golden sections',
};

/**
 * @param area what the guides are computed from (selection or artboard)
 * @param span extent the guides are drawn across (usually the artboard)
 */
export function quickGuides(area: Rect, kinds: readonly QuickGuideKind[], span: Rect, extend = 0): GuideLine[] {
  const v = (x: number, role: GuideRole): GuideLine => ({ x1: x, y1: span.y - extend, x2: x, y2: span.y + span.h + extend, role });
  const h = (y: number, role: GuideRole): GuideLine => ({ x1: span.x - extend, y1: y, x2: span.x + span.w + extend, y2: y, role });
  const L = area.x;
  const R = area.x + area.w;
  const T = area.y;
  const B = area.y + area.h;
  const lines: GuideLine[] = [];
  for (const k of kinds) {
    switch (k) {
      case 'left':
        lines.push(v(L, 'edge'));
        break;
      case 'right':
        lines.push(v(R, 'edge'));
        break;
      case 'top':
        lines.push(h(T, 'edge'));
        break;
      case 'bottom':
        lines.push(h(B, 'edge'));
        break;
      case 'edges':
        lines.push(v(L, 'edge'), v(R, 'edge'), h(T, 'edge'), h(B, 'edge'));
        break;
      case 'centerV':
        lines.push(v(L + area.w / 2, 'center'));
        break;
      case 'centerH':
        lines.push(h(T + area.h / 2, 'center'));
        break;
      case 'center':
        lines.push(v(L + area.w / 2, 'center'), h(T + area.h / 2, 'center'));
        break;
      case 'thirds':
        for (const f of [1 / 3, 2 / 3]) lines.push(v(L + area.w * f, 'thirds'), h(T + area.h * f, 'thirds'));
        break;
      case 'quarters':
        for (const f of [0.25, 0.5, 0.75]) lines.push(v(L + area.w * f, 'quarter'), h(T + area.h * f, 'quarter'));
        break;
      case 'golden': {
        const a = 1 / (GOLDEN_RATIO * GOLDEN_RATIO);
        const b = 1 / GOLDEN_RATIO;
        for (const f of [a, b]) lines.push(v(L + area.w * f, 'golden'), h(T + area.h * f, 'golden'));
        break;
      }
    }
  }
  return dedupeLines(lines);
}

/**
 * Guides offset outward (positive) or inward (negative) from each edge of
 * `area`, e.g. offsets [8, 16] around a selection.
 */
export function offsetGuides(area: Rect, offsets: readonly number[], span: Rect, extend = 0): GuideLine[] {
  const lines: GuideLine[] = [];
  for (const o of offsets) {
    const L = area.x - o;
    const R = area.x + area.w + o;
    const T = area.y - o;
    const B = area.y + area.h + o;
    if (R <= L || B <= T) continue;
    lines.push(
      { x1: L, y1: span.y - extend, x2: L, y2: span.y + span.h + extend, role: 'offset' },
      { x1: R, y1: span.y - extend, x2: R, y2: span.y + span.h + extend, role: 'offset' },
      { x1: span.x - extend, y1: T, x2: span.x + span.w + extend, y2: T, role: 'offset' },
      { x1: span.x - extend, y1: B, x2: span.x + span.w + extend, y2: B, role: 'offset' },
    );
  }
  return dedupeLines(lines);
}

/** Guides tracing the inset rectangle of a safe zone, spanning the artboard. */
export function safeAreaGuides(artboard: Rect, inset: Margins): GuideLine[] {
  const L = artboard.x + inset.left;
  const R = artboard.x + artboard.w - inset.right;
  const T = artboard.y + inset.top;
  const B = artboard.y + artboard.h - inset.bottom;
  const lines: GuideLine[] = [];
  if (inset.left > 0) lines.push({ x1: L, y1: artboard.y, x2: L, y2: artboard.y + artboard.h, role: 'safe' });
  if (inset.right > 0) lines.push({ x1: R, y1: artboard.y, x2: R, y2: artboard.y + artboard.h, role: 'safe' });
  if (inset.top > 0) lines.push({ x1: artboard.x, y1: T, x2: artboard.x + artboard.w, y2: T, role: 'safe' });
  if (inset.bottom > 0) lines.push({ x1: artboard.x, y1: B, x2: artboard.x + artboard.w, y2: B, role: 'safe' });
  return lines;
}
