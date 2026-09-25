/**
 * Renders a mock document to SVG for the development simulator. Approximate
 * by design (no real font shaping, no real images): it exists to SEE what the
 * host did — shapes, gradients, blend modes, blur/glow effects, clipping,
 * text, guides, stacking — not to reproduce Illustrator pixel for pixel.
 *
 * Blend modes: Illustrator does not isolate blending inside clipping groups,
 * but an SVG clip-path does. Clip paths are therefore pushed down onto the
 * leaves (each leaf carries its own blend mode on the outermost wrapper).
 */

import { parseEffectXml } from '../../effects/effect-xml';
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
  ENUMS,
  type AIBounds,
  type AnyColor,
  type Shape,
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
const n = (v: number): string => String(Math.round(v * 100) / 100);

function rgbOf(c: AnyColor | undefined): [number, number, number] | null {
  if (!c) return null;
  if (c instanceof RGBColor) return [c.red, c.green, c.blue];
  if (c instanceof CMYKColor) {
    const k = 1 - c.black / 100;
    return [255 * (1 - c.cyan / 100) * k, 255 * (1 - c.magenta / 100) * k, 255 * (1 - c.yellow / 100) * k];
  }
  if (c instanceof GrayColor) {
    const v = 255 * (1 - c.gray / 100);
    return [v, v, v];
  }
  return null;
}

function css(c: AnyColor | undefined): string {
  const rgb = rgbOf(c);
  return rgb ? `rgb(${rgb.map((v) => Math.round(v)).join(',')})` : 'none';
}

/** SVG path data for a shape (AI space → SVG, Y flipped). */
export function shapeD(s: Shape): string {
  const P = (p: readonly [number, number]): string => `${n(p[0])} ${n(-p[1])}`;
  if (s.kind === 'ellipse') {
    const t = (s.rot * Math.PI) / 180;
    const pt = (a: number): [number, number] => [s.cx + s.rx * Math.cos(a) * Math.cos(t) - s.ry * Math.sin(a) * Math.sin(t), s.cy + s.rx * Math.cos(a) * Math.sin(t) + s.ry * Math.sin(a) * Math.cos(t)];
    const a0 = pt(0);
    const a1 = pt(Math.PI);
    return `M${P(a0)}A${n(s.rx)} ${n(s.ry)} ${n(-s.rot)} 1 0 ${P(a1)}A${n(s.rx)} ${n(s.ry)} ${n(-s.rot)} 1 0 ${P(a0)}Z`;
  }
  if (s.kind === 'poly') {
    if (s.pts.length === 0) return '';
    return s.pts.map((p, k) => `${k ? 'L' : 'M'}${P(p)}`).join('') + (s.closed ? 'Z' : '');
  }
  if (s.pts.length === 0) return '';
  let d = `M${P(s.pts[0]!.a)}`;
  const count = s.closed ? s.pts.length : s.pts.length - 1;
  for (let i = 0; i < count; i++) {
    const a = s.pts[i]!;
    const b = s.pts[(i + 1) % s.pts.length]!;
    d += `C${P(a.r)} ${P(b.l)} ${P(b.a)}`;
  }
  return d + (s.closed ? 'Z' : '');
}

function fontCss(ps: string): { family: string; weight: number } {
  const [fam, style = 'Regular'] = ps.split('-');
  const weights: Record<string, number> = { Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, BoldMT: 700, ExtraBold: 800, Black: 900, Heavy: 900 };
  const family = (fam ?? 'Myriad').replace(/MT$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
  return { family, weight: weights[style] ?? 400 };
}

export interface RenderOptions {
  showGuides?: boolean;
  showSelection?: boolean;
  padding?: number;
  /** Only render this artboard (index) — used for clean screenshots. */
  artboard?: number;
}

interface LeafStyle {
  opacity: number;
  blend: string | undefined;
  filter: string | null;
}

export function renderDocument(doc: MockDocument, opts: RenderOptions = {}): { svg: string; viewBox: [number, number, number, number] } {
  const pad = opts.padding ?? 80;
  const defs: string[] = [];
  let gid = 0;
  const abs = (opts.artboard !== undefined ? [doc._artboards[opts.artboard]!] : doc._artboards).map((a) => a.artboardRect);
  const minX = Math.min(...abs.map((r) => r[0])) - pad;
  const minY = Math.min(...abs.map((r) => -r[1])) - pad;
  const maxX = Math.max(...abs.map((r) => r[2])) + pad;
  const maxY = Math.max(...abs.map((r) => -r[3])) + pad;
  const vb: [number, number, number, number] = [minX, minY, maxX - minX, maxY - minY];

  const gradientFill = (f: GradientColor, geom: MockPathItem['_grad'], box: AIBounds): string => {
    const g = f.gradient!;
    const id = `g${gid++}`;
    const sorted = [...g._stops].sort((a, b) => a.rampPoint - b.rampPoint);
    const parts: string[] = [];
    sorted.forEach((s, i) => {
      parts.push(`<stop offset="${n(s.rampPoint)}%" stop-color="${css(s.color)}" stop-opacity="${n(s.opacity / 100)}"/>`);
      const nx = sorted[i + 1];
      if (nx && Math.abs(nx.midPoint - 50) > 0.5) {
        // Illustrator's midpoint: where the two colours are mixed 50/50.
        const a = rgbOf(s.color) ?? [0, 0, 0];
        const b = rgbOf(nx.color) ?? [0, 0, 0];
        const off = s.rampPoint + ((nx.rampPoint - s.rampPoint) * s.midPoint) / 100;
        parts.push(`<stop offset="${n(off)}%" stop-color="rgb(${a.map((v, k) => Math.round((v + b[k]!) / 2)).join(',')})" stop-opacity="${n((s.opacity + nx.opacity) / 200)}"/>`);
      }
    });
    const radial = g.type === ENUMS.GradientType.RADIAL;
    if (geom) {
      const [a, b, c, d, tx, ty] = geom;
      const tf = `gradientTransform="matrix(${[a, -b, c, -d, tx, -ty].map(n).join(' ')})" gradientUnits="userSpaceOnUse"`;
      defs.push(radial ? `<radialGradient id="${id}" cx="0" cy="0" r="1" ${tf}>${parts.join('')}</radialGradient>` : `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" ${tf}>${parts.join('')}</linearGradient>`);
    } else {
      void box;
      defs.push(radial ? `<radialGradient id="${id}" cx="50%" cy="50%" r="50%">${parts.join('')}</radialGradient>` : `<linearGradient id="${id}">${parts.join('')}</linearGradient>`);
    }
    return `url(#${id})`;
  };

  const paint = (p: MockPathItem, box: AIBounds): string => {
    if (!p.filled) return 'none';
    const f = p.fillColor;
    if (f instanceof GradientColor && f.gradient) return gradientFill(f, p._grad, box);
    return css(f);
  };

  const strokeAttr = (p: MockPathItem): string => (p.stroked && p.strokeWidth > 0 ? ` stroke="${css(p.strokeColor)}" stroke-width="${n(p.strokeWidth)}" stroke-linejoin="round"` : '');

  const filterFor = (i: MockItem): string | null => {
    if (i._effects.length === 0) return null;
    const specs = i._effects.map(parseEffectXml).filter((x): x is NonNullable<typeof x> => !!x);
    if (specs.length === 0) return null;
    const [l, t, r, b] = i.boundsAI();
    let margin = 0;
    const prims: string[] = [];
    let src = 'SourceGraphic';
    let k = 0;
    const under: string[] = [];
    for (const s of specs) {
      if (s.kind === 'blur' || s.kind === 'feather') {
        const sd = Math.max(0.1, s.radius * (s.kind === 'blur' ? 0.9 : 0.5));
        margin = Math.max(margin, sd * 3);
        prims.push(`<feGaussianBlur in="${src}" stdDeviation="${n(sd)}" result="r${k}"/>`);
        src = `r${k++}`;
      } else if (s.kind === 'dropShadow' || s.kind === 'outerGlow') {
        const sd = Math.max(0.1, s.blur * 0.5);
        const dx = s.kind === 'dropShadow' ? s.dx : 0;
        const dy = s.kind === 'dropShadow' ? s.dy : 0;
        margin = Math.max(margin, sd * 3 + Math.hypot(dx, dy) + (s.kind === 'outerGlow' ? s.blur : 0));
        prims.push(
          `<feMorphology in="SourceAlpha" operator="dilate" radius="${n(s.kind === 'outerGlow' ? s.blur * 0.15 : 0)}" result="m${k}"/>` +
            `<feGaussianBlur in="m${k}" stdDeviation="${n(sd)}" result="b${k}"/><feOffset in="b${k}" dx="${n(dx)}" dy="${n(dy)}" result="o${k}"/>` +
            `<feFlood flood-color="${s.color}" flood-opacity="${n(s.opacity / 100)}"/><feComposite in2="o${k}" operator="in" result="sh${k}"/>`,
        );
        under.push(`sh${k++}`);
      }
    }
    if (prims.length === 0) return null;
    const id = `f${gid++}`;
    const merge = under.length ? `<feMerge>${under.map((u) => `<feMergeNode in="${u}"/>`).join('')}<feMergeNode in="${src}"/></feMerge>` : '';
    defs.push(
      `<filter id="${id}" filterUnits="userSpaceOnUse" x="${n(l - margin)}" y="${n(-t - margin)}" width="${n(r - l + 2 * margin)}" height="${n(t - b + 2 * margin)}" color-interpolation-filters="sRGB">${prims.join('')}${merge}</filter>`,
    );
    return `url(#${id})`;
  };

  const leafStyle = (i: MockItem): LeafStyle => ({ opacity: i.opacity, blend: BLEND_CSS[i.blendingMode], filter: filterFor(i) });

  const styleAttr = (st: LeafStyle): string => {
    const parts: string[] = [];
    if (st.opacity !== 100) parts.push(`opacity:${n(st.opacity / 100)}`);
    if (st.blend) parts.push(`mix-blend-mode:${st.blend}`);
    return (parts.length ? ` style="${parts.join(';')}"` : '') + (st.filter ? ` filter="${st.filter}"` : '');
  };

  /** Wraps a leaf's markup in its clip stack; the leaf's own style goes on the outermost element. */
  const wrap = (markup: string, st: LeafStyle, clips: string[]): string => {
    if (clips.length === 0) {
      return markup.replace(/^<(\w+)/, (m) => `${m}${styleAttr(st)}`);
    }
    let out = markup;
    for (let c = clips.length - 1; c >= 1; c--) out = `<g clip-path="url(#${clips[c]})">${out}</g>`;
    return `<g clip-path="url(#${clips[0]})"${styleAttr(st)}>${out}</g>`;
  };

  const guides: string[] = [];

  const maskPath = (g: MockGroupItem): { d: string; evenodd: boolean } | null => {
    for (const c of g._items) {
      if (c instanceof MockPathItem && c.clipping) return { d: shapeD(c.shape), evenodd: c.evenodd };
      if (c instanceof MockCompoundPathItem) {
        const first = c._items[0];
        if (first instanceof MockPathItem && first.clipping) {
          return { d: c._items.filter((x): x is MockPathItem => x instanceof MockPathItem).map((x) => shapeD(x.shape)).join(''), evenodd: true };
        }
      }
    }
    return null;
  };

  const textMarkup = (tf: MockTextFrame): string => {
    const f = fontCss(tf.fontName);
    const color = css(tf.textColor);
    const rtl = tf.direction === ENUMS.ParagraphDirectionType.RIGHT_TO_LEFT_DIRECTION || /[؀-ۿ]/.test(tf.contents);
    const family = `'${f.family}','Tajawal','Cairo','Noto Sans Arabic','DejaVu Sans',sans-serif`;
    const stroke = rgbOf(tf.textStroke) && tf.textStrokeWeight > 0 ? ` stroke="${css(tf.textStroke)}" stroke-width="${n(tf.textStrokeWeight)}"` : '';
    const just = tf.justification;
    if (tf.anchor) {
      const [ax, ay] = tf.anchor;
      const anchorCss = just === ENUMS.Justification.CENTER ? 'middle' : (just === ENUMS.Justification.RIGHT) !== rtl ? 'end' : 'start';
      const spans = tf.lines.map((line, k) => `<tspan x="${n(ax)}" ${k ? `dy="${n(tf.lineHeight)}"` : ''}>${esc(line)}</tspan>`).join('');
      const ls = !rtl && tf.tracking ? ` letter-spacing="${n((tf.tracking / 1000) * tf.size)}"` : '';
      return `<text x="${n(ax)}" y="${n(-ay)}" font-size="${n(tf.size)}" font-family="${esc(family)}" font-weight="${f.weight}" fill="${color}"${stroke} text-anchor="${anchorCss}" direction="${rtl ? 'rtl' : 'ltr'}"${ls}>${spans}</text>`;
    }
    const [l, t, r, b] = tf.box;
    const align = just === ENUMS.Justification.CENTER ? 'center' : just === ENUMS.Justification.RIGHT ? 'right' : just === ENUMS.Justification.LEFT ? 'left' : 'justify';
    const lh = tf.leading ? `${n(tf.leading)}px` : '1.2';
    const ls = !rtl && tf.tracking ? `letter-spacing:${n((tf.tracking / 1000) * tf.size)}px;` : '';
    const paras = tf.lines.map((line) => `<div>${esc(line) || '&#160;'}</div>`).join('');
    return (
      `<foreignObject x="${n(l)}" y="${n(-t)}" width="${n(r - l)}" height="${n(t - b)}">` +
      `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${n(tf.size)}px;line-height:${lh};font-family:${esc(family)};font-weight:${f.weight};color:${color};text-align:${align};direction:${rtl ? 'rtl' : 'ltr'};${ls}overflow:hidden;width:100%;height:100%">${paras}</div></foreignObject>`
    );
  };

  const item = (i: MockItem, clips: string[]): string => {
    if (i.hidden) return '';
    if (i instanceof MockPathItem) {
      if (i.guides) {
        if (opts.showGuides !== false && i.shape.kind === 'poly' && i.shape.pts.length >= 2) {
          const [a, b] = [i.shape.pts[0]!, i.shape.pts[i.shape.pts.length - 1]!];
          guides.push(`<line x1="${n(a[0])}" y1="${n(-a[1])}" x2="${n(b[0])}" y2="${n(-b[1])}" class="sim-guide"/>`);
        }
        return '';
      }
      if (i.clipping) return '';
      const d = shapeD(i.shape);
      if (!d) return '';
      const fill = i.closed || i.shape.kind === 'ellipse' ? paint(i, i.boundsAI()) : i.filled ? paint(i, i.boundsAI()) : 'none';
      return wrap(`<path d="${d}" fill="${fill}"${strokeAttr(i)}${i.evenodd ? ' fill-rule="evenodd"' : ''}/>`, leafStyle(i), clips);
    }
    if (i instanceof MockCompoundPathItem) {
      const subs = i._items.filter((x): x is MockPathItem => x instanceof MockPathItem);
      const first = subs[0];
      if (!first || first.clipping) return '';
      const d = subs.map((x) => shapeD(x.shape)).join('');
      return wrap(`<path d="${d}" fill="${paint(first, i.boundsAI())}"${strokeAttr(first)} fill-rule="evenodd"/>`, leafStyle(i), clips);
    }
    if (i instanceof MockGroupItem) {
      let inner = clips;
      if (i.clipped) {
        const mask = maskPath(i);
        if (mask) {
          const id = `c${gid++}`;
          defs.push(`<clipPath id="${id}"><path d="${mask.d}"${mask.evenodd ? ' clip-rule="evenodd"' : ''}/></clipPath>`);
          inner = [...clips, id];
        }
      }
      const st = leafStyle(i);
      const kids = [...i._items].reverse().map((k) => item(k, st.opacity !== 100 || st.blend || st.filter ? [] : inner)).join('');
      if (st.opacity !== 100 || st.blend || st.filter) {
        // Group opacity/blend/effects isolate the group (as in Illustrator); apply the clip to the group itself.
        return wrap(`<g>${kids}</g>`, st, inner);
      }
      return `<g>${kids}</g>`;
    }
    if (i instanceof MockTextFrame) return wrap(textMarkup(i), leafStyle(i), clips);
    if (i instanceof MockPlacedItem || i instanceof MockRasterItem) {
      const [l, t, r, b] = i.box;
      const id = `p${gid++}`;
      defs.push(`<pattern id="${id}" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="16" height="16" fill="#8a7a66"/><rect width="8" height="16" fill="#9a8a74"/></pattern>`);
      return wrap(
        `<g><rect x="${n(l)}" y="${n(-t)}" width="${n(r - l)}" height="${n(t - b)}" fill="url(#${id})"/><text x="${n((l + r) / 2)}" y="${n(-(t + b) / 2)}" class="sim-img-label" text-anchor="middle">${esc(i._name || (i instanceof MockRasterItem ? 'embedded image' : 'placed image'))}</text></g>`,
        leafStyle(i),
        clips,
      );
    }
    return '';
  };

  const layer = (l: MockLayer): string => {
    if (!l.visible) return '';
    return `<g data-layer="${esc(l.name)}">${[...l._sublayers].reverse().map(layer).join('')}${[...l._items].reverse().map((i) => item(i, [])).join('')}</g>`;
  };

  const boardList = opts.artboard !== undefined ? [doc._artboards[opts.artboard]!] : doc._artboards;
  const boards = boardList
    .map((a, i) => {
      const [l, t, r, b] = a.artboardRect;
      return `<rect x="${n(l)}" y="${n(-t)}" width="${n(r - l)}" height="${n(t - b)}" class="sim-artboard${i === doc._active ? ' active' : ''}"/><text x="${n(l)}" y="${n(-t - 12)}" class="sim-ab-label">${esc(a.name)}</text>`;
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
            return `<rect x="${n(l)}" y="${n(-t)}" width="${n(r - l)}" height="${n(t - b)}" class="sim-sel"/>`;
          })
          .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.map(n).join(' ')}" class="sim-svg"><defs>${defs.join('')}</defs><rect x="${n(vb[0])}" y="${n(vb[1])}" width="${n(vb[2])}" height="${n(vb[3])}" class="sim-pasteboard"/>${boards}<g class="sim-art" style="isolation:isolate">${body}</g>${guides.join('')}${sel}</svg>`;
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
