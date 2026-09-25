/**
 * Renders a mock document to SVG for the development simulator. Approximate
 * by design (no text shaping, no real images): it exists to SEE what the host
 * did — guides, shadows, stacking, layers — not to reproduce Illustrator.
 */

import {
  CMYKColor,
  GradientColor,
  GrayColor,
  MockCompoundPathItem,
  MockDocument,
  MockGroupItem,
  MockItem,
  MockLayer,
  MockPathItem,
  MockPlacedItem,
  MockRasterItem,
  MockTextFrame,
  RGBColor,
  type AIBounds,
  type AnyColor,
} from './mock-dom';

const BLEND_CSS: Record<string, string> = {
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  SOFTLIGHT: 'soft-light',
  HARDLIGHT: 'hard-light',
  COLORDODGE: 'color-dodge',
  COLORBURN: 'color-burn',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATIONBLEND: 'saturation',
  COLORBLEND: 'color',
  LUMINOSITY: 'luminosity',
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

function css(c: AnyColor | undefined): string {
  if (!c) return 'none';
  if (c instanceof RGBColor) return `rgb(${Math.round(c.red)},${Math.round(c.green)},${Math.round(c.blue)})`;
  if (c instanceof CMYKColor) {
    const k = 1 - c.black / 100;
    return `rgb(${Math.round(255 * (1 - c.cyan / 100) * k)},${Math.round(255 * (1 - c.magenta / 100) * k)},${Math.round(255 * (1 - c.yellow / 100) * k)})`;
  }
  if (c instanceof GrayColor) {
    const v = Math.round(255 * (1 - c.gray / 100));
    return `rgb(${v},${v},${v})`;
  }
  return 'none';
}

export interface RenderOptions {
  showGuides?: boolean;
  showSelection?: boolean;
  padding?: number;
}

export function renderDocument(doc: MockDocument, opts: RenderOptions = {}): { svg: string; viewBox: [number, number, number, number] } {
  const pad = opts.padding ?? 80;
  const defs: string[] = [];
  let gid = 0;
  const abs = doc._artboards.map((a) => a.artboardRect);
  const minX = Math.min(...abs.map((r) => r[0])) - pad;
  const minY = Math.min(...abs.map((r) => -r[1])) - pad;
  const maxX = Math.max(...abs.map((r) => r[2])) + pad;
  const maxY = Math.max(...abs.map((r) => -r[3])) + pad;
  const vb: [number, number, number, number] = [minX, minY, maxX - minX, maxY - minY];

  const fillOf = (item: MockPathItem, box: AIBounds): string => {
    if (!item.filled) return 'none';
    const f = item.fillColor;
    if (f instanceof GradientColor && f.gradient) {
      const id = `g${gid++}`;
      const stops = f.gradient._stops
        .map((s) => `<stop offset="${s.rampPoint}%" stop-color="${css(s.color)}" stop-opacity="${s.opacity / 100}"/>`)
        .join('');
      const tag = f.gradient.type === 'RADIAL' ? 'radialGradient' : 'linearGradient';
      defs.push(`<${tag} id="${id}" ${tag === 'radialGradient' ? 'cx="50%" cy="50%" r="50%"' : ''}>${stops}</${tag}>`);
      void box;
      return `url(#${id})`;
    }
    return css(f);
  };

  const style = (i: MockItem): string => {
    const parts: string[] = [];
    if (i.opacity !== 100) parts.push(`opacity:${i.opacity / 100}`);
    const b = BLEND_CSS[i.blendingMode];
    if (b) parts.push(`mix-blend-mode:${b}`);
    return parts.length ? ` style="${parts.join(';')}"` : '';
  };

  const guides: string[] = [];

  const item = (i: MockItem): string => {
    if (i.hidden) return '';
    if (i instanceof MockPathItem) {
      if (i.guides) {
        if (opts.showGuides !== false && i.shape.kind === 'poly' && i.shape.pts.length >= 2) {
          const [a, b] = [i.shape.pts[0]!, i.shape.pts[i.shape.pts.length - 1]!];
          guides.push(`<line x1="${a[0]}" y1="${-a[1]}" x2="${b[0]}" y2="${-b[1]}" class="sim-guide"/>`);
        }
        return '';
      }
      if (i.clipping) return '';
      const s = i.shape;
      const stroke = i.stroked ? ` stroke="${css(i.strokeColor)}" stroke-width="${i.strokeWidth}"` : '';
      const box = i.boundsAI();
      if (s.kind === 'ellipse') {
        return `<ellipse cx="${s.cx}" cy="${-s.cy}" rx="${s.rx}" ry="${s.ry}" transform="rotate(${-s.rot} ${s.cx} ${-s.cy})" fill="${fillOf(i, box)}"${stroke}${style(i)}/>`;
      }
      if (s.pts.length < 2) return '';
      const d = s.pts.map((p, k) => `${k ? 'L' : 'M'}${p[0]} ${-p[1]}`).join('') + (s.closed ? 'Z' : '');
      if (s.radius && s.pts.length === 4) {
        const [l, t, r, b] = box;
        return `<rect x="${l}" y="${-t}" width="${r - l}" height="${t - b}" rx="${s.radius}" fill="${fillOf(i, box)}"${stroke}${style(i)}/>`;
      }
      return `<path d="${d}" fill="${s.closed ? fillOf(i, box) : 'none'}"${stroke}${style(i)}/>`;
    }
    if (i instanceof MockGroupItem || i instanceof MockCompoundPathItem) {
      const kids = [...i._items].reverse();
      let clip = '';
      if (i instanceof MockGroupItem && i.clipped) {
        const mask = i._items.find((c) => c instanceof MockPathItem && c.clipping) as MockPathItem | undefined;
        if (mask) {
          const id = `c${gid++}`;
          const [l, t, r, b] = mask.boundsAI();
          defs.push(`<clipPath id="${id}"><rect x="${l}" y="${-t}" width="${r - l}" height="${t - b}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
      }
      return `<g${clip}${style(i)}>${kids.map(item).join('')}</g>`;
    }
    if (i instanceof MockTextFrame) {
      const [l, t, r, b] = i.box;
      const rtl = /[؀-ۿ]/.test(i.contents);
      const x = rtl ? r : l;
      // With direction="rtl", text-anchor "start" is the right-hand edge.
      return `<text x="${x}" y="${-t + (t - b) * 0.78}" font-size="${i.size}" text-anchor="start" direction="${rtl ? 'rtl' : 'ltr'}" class="sim-text"${style(i)}>${esc(i.contents)}</text>`;
    }
    if (i instanceof MockPlacedItem || i instanceof MockRasterItem) {
      const [l, t, r, b] = i.box;
      const id = `p${gid++}`;
      defs.push(`<pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="16" fill="#8a7a66"/><rect width="8" height="16" fill="#9a8a74"/></pattern>`);
      return `<g${style(i)}><rect x="${l}" y="${-t}" width="${r - l}" height="${t - b}" fill="url(#${id})"/><text x="${(l + r) / 2}" y="${-(t + b) / 2}" class="sim-img-label" text-anchor="middle">${esc(i._name || (i instanceof MockRasterItem ? 'embedded image' : 'placed image'))}</text></g>`;
    }
    return '';
  };

  const layer = (l: MockLayer): string => {
    if (!l.visible) return '';
    return `<g data-layer="${esc(l.name)}">${[...l._sublayers].reverse().map(layer).join('')}${[...l._items].reverse().map(item).join('')}</g>`;
  };

  const boards = doc._artboards
    .map((a, i) => {
      const [l, t, r, b] = a.artboardRect;
      return `<rect x="${l}" y="${-t}" width="${r - l}" height="${t - b}" class="sim-artboard${i === doc._active ? ' active' : ''}"/><text x="${l}" y="${-t - 12}" class="sim-ab-label">${esc(a.name)}</text>`;
    })
    .join('');
  const body = [...doc._layers].reverse().map(layer).join('');
  const sel =
    opts.showSelection === false
      ? ''
      : doc.pageItems
          .filter((i) => i._selected)
          .map((i) => {
            const [l, t, r, b] = i.geometricBounds;
            return `<rect x="${l}" y="${-t}" width="${r - l}" height="${t - b}" class="sim-sel"/>`;
          })
          .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" class="sim-svg"><defs>${defs.join('')}</defs><rect x="${vb[0]}" y="${vb[1]}" width="${vb[2]}" height="${vb[3]}" class="sim-pasteboard"/>${boards}<g class="sim-art" style="isolation:isolate">${body}</g>${guides.join('')}${sel}</svg>`;
  return { svg, viewBox: vb };
}

/** Front-most visible item under a design-space point (for click-to-select in the simulator). */
export function hitTest(doc: MockDocument, x: number, y: number): MockItem | null {
  const ay = -y;
  for (const l of doc._layers) {
    if (!l.visible || l.locked) continue;
    for (const it of l._items) {
      if (it.hidden || it.locked) continue;
      if (it instanceof MockPathItem && it.guides) continue;
      const [L, T, R, B] = it.geometricBounds;
      if (x >= L && x <= R && ay <= T && ay >= B) return it;
    }
  }
  return null;
}
