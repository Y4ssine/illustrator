/**
 * Infographic engine — builds editable infographic blocks (cards, charts,
 * steps, timelines…) as ordinary Illustrator art: paths, live text and
 * groups. Arabic first: right-to-left order and alignment, Arabic-Indic
 * digits, World-Ready text (set by the host).
 *
 * Every block fits the given box, uses the active palette, and is one group
 * tagged AF_type = infographic with its data, so it can be rebuilt with new
 * numbers or colours later.
 */

import type { GradientStopSpec, Paint, Place, StrokeSpec, TagMap } from '../core/protocol';
import { shortHash, type OpRef, type OpSink } from '../core/opsink';
import type { Rect } from '../geometry/rect';
import { arcPoints, ellipsePath, mergeDuplicates, pt, roundedRectPath, type PathShape, type SubPath } from '../geometry/path';
import { mix, onColor } from '../color/color-math';
import { lightOf, seriesColors, type BrandPalette } from '../color/palette-engine';
import { clamp } from '../utils/misc';
import { iconShape, type IconId } from './icons';

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface InfoItem {
  label: string;
  value: number;
  /** Shown instead of the formatted value (e.g. "٣ ملايين", "2030"). */
  display?: string;
  note?: string;
  icon?: IconId;
}

const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export const hasArabic = (s: string): boolean => ARABIC_RE.test(s);

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Normalise any digits (Arabic-Indic, Persian) to Western for parsing. */
export function westernDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

export function localizeDigits(s: string, digits: 'western' | 'arabic'): string {
  if (digits === 'western') return westernDigits(s);
  return s
    .replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]!)
    .replace(/(\d|[٠-٩])\.(?=\d|[٠-٩])/g, '$1٫')
    .replace(/(\d|[٠-٩]),(?=\d|[٠-٩])/g, '$1٬')
    .replace(/%/g, '٪');
}

export function formatNumber(v: number, opts: { decimals?: number; suffix?: string; prefix?: string } = {}): string {
  const d = opts.decimals ?? (Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0);
  const fixed = Math.abs(v).toFixed(d);
  const [int, frac] = fixed.split('.');
  const grouped = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${v < 0 ? '-' : ''}${opts.prefix ?? ''}${grouped}${frac ? `.${frac}` : ''}${opts.suffix ?? ''}`;
}

/**
 * Parse "label | value | note" lines. Also accepts "label: value",
 * "label، value", tab-separated, or a line that ends/starts with a number.
 * Values may use Arabic-Indic digits, %, thousands separators.
 */
export function parseInfoData(text: string): InfoItem[] {
  const out: InfoItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let parts = line.split(/\s*[|\t]\s*/);
    if (parts.length === 1) parts = line.split(/\s*[:：،]\s*/);
    let label = '';
    let valueText = '';
    let note: string | undefined;
    if (parts.length >= 2) {
      label = parts[0]!;
      valueText = parts[1]!;
      if (parts.length >= 3) note = parts.slice(2).join(' | ');
    } else {
      const m = /^(.*?)[\s]*([-+]?[\d٠-٩۰-۹][\d٠-٩۰-۹.,٫٬]*\s*[%٪]?)$/.exec(line) ?? /^([-+]?[\d٠-٩۰-۹][\d٠-٩۰-۹.,٫٬]*\s*[%٪]?)\s*(.*)$/.exec(line);
      if (m) {
        const numFirst = /^[-+]?[\d٠-٩۰-۹]/.test(line);
        label = (numFirst ? m[2] : m[1])!.trim();
        valueText = (numFirst ? m[1] : m[2])!.trim();
      } else label = line;
    }
    const w = westernDigits(valueText).replace(/[,\s]/g, '');
    const num = /[-+]?\d+(\.\d+)?/.exec(w);
    const item: InfoItem = { label: label.trim(), value: num ? Number(num[0]) : 0 };
    if (valueText && !/^[-+]?[\d٠-٩۰-۹.,٫٬\s]*[%٪]?$/.test(valueText)) item.display = valueText;
    else if (/[%٪]/.test(valueText)) item.display = `${formatNumber(item.value)}%`;
    if (note) item.note = note;
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

export type CardStyle = 'soft' | 'solid' | 'outline' | 'glass' | 'gradient';

export interface InfoStyle {
  palette: BrandPalette;
  rtl: boolean;
  digits: 'western' | 'arabic';
  /** Font candidates (PostScript names), bold first. */
  fontsBold: string[];
  fontsRegular: string[];
  theme: 'light' | 'dark';
  card: CardStyle;
  /** Corner radius as a fraction of the smaller card side (0–0.5). */
  roundness: number;
}

export interface InfoContext {
  sink: OpSink;
  into: Place;
  box: Rect;
  style: InfoStyle;
}

export function regularFonts(bold: readonly string[]): string[] {
  const reg = bold.map((f) => f.replace(/-(ExtraBold|Black|Heavy|SemiBold|Bold|Medium)(MT)?$/, (_m, _w, mt) => (mt ? '' : '-Regular')));
  return [...new Set([...reg, ...bold])];
}

interface Tone {
  cardFill: Paint;
  cardStroke?: StrokeSpec;
  cardOpacity: number;
  title: string;
  body: string;
  muted: string;
  accent: string;
  track: string;
}

function tone(st: InfoStyle): Tone {
  const p = st.palette;
  const dark = st.theme === 'dark';
  const ink = dark ? '#FFFFFF' : mix(p.dark, '#101014', 0.5);
  switch (st.card) {
    case 'solid':
      return { cardFill: { t: 'solid', c: p.primary }, cardOpacity: 100, title: onColor(p.primary), body: onColor(p.primary), muted: mix(onColor(p.primary), p.primary, 0.3), accent: onColor(p.primary) === '#FFFFFF' ? lightOf(p.accent) : p.dark, track: mix(p.primary, onColor(p.primary), 0.22) };
    case 'gradient': {
      const stops: GradientStopSpec[] = [
        { p: 0, c: p.primary, o: 100 },
        { p: 100, c: mix(p.primary, p.secondary, 0.7), o: 100 },
      ];
      const fg = onColor(p.primary);
      return { cardFill: { t: 'linear', stops, angle: 315, name: `AF Card ${shortHash(stops)}` }, cardOpacity: 100, title: fg, body: fg, muted: mix(fg, p.primary, 0.3), accent: fg === '#FFFFFF' ? lightOf(p.accent) : p.dark, track: mix(p.primary, fg, 0.22) };
    }
    case 'outline':
      return { cardFill: { t: 'solid', c: dark ? mix(p.dark, '#000000', 0.3) : '#FFFFFF' }, cardStroke: { c: mix(p.primary, dark ? '#000000' : '#FFFFFF', 0.55), w: 1.5 }, cardOpacity: 100, title: dark ? '#FFFFFF' : p.primary, body: ink, muted: mix(ink, dark ? '#000000' : '#FFFFFF', 0.4), accent: p.primary, track: mix(p.primary, dark ? '#000000' : '#FFFFFF', 0.82) };
    case 'glass':
      return { cardFill: { t: 'solid', c: '#FFFFFF' }, cardStroke: { c: '#FFFFFF', w: 1 }, cardOpacity: dark ? 12 : 55, title: dark ? '#FFFFFF' : p.primary, body: ink, muted: mix(ink, dark ? '#000000' : '#FFFFFF', 0.35), accent: dark ? lightOf(p.accent) : p.primary, track: dark ? mix(p.dark, '#FFFFFF', 0.2) : mix(p.primary, '#FFFFFF', 0.82) };
    default:
      return {
        cardFill: { t: 'solid', c: dark ? mix(p.dark, '#FFFFFF', 0.07) : mix(lightOf(p.primary), '#FFFFFF', 0.45) },
        cardOpacity: 100,
        title: dark ? lightOf(p.primary) : p.primary,
        body: ink,
        muted: mix(ink, dark ? p.dark : '#FFFFFF', 0.42),
        accent: p.primary,
        track: dark ? mix(p.dark, '#FFFFFF', 0.14) : mix(lightOf(p.primary), p.primary, 0.12),
      };
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const inside = (ref: OpRef, at: 'top' | 'bottom' = 'top'): Place => ({ k: 'inside', ref, at });

function group(ctx: InfoContext, into: Place, name: string, tags?: TagMap): OpRef {
  return ctx.sink.push({ op: 'group.create', into, name, ...(tags ? { tags } : {}) });
}

type Align = 'start' | 'center' | 'end';

/** Point text. `y` is the TOP of the line; `x` is the start/centre/end edge in reading direction. */
function label(ctx: InfoContext, into: Place, x: number, y: number, contents: string, size: number, color: string, align: Align, bold: boolean, name: string): OpRef {
  const st = ctx.style;
  const text = localizeDigits(contents, st.digits);
  const rtl = st.rtl;
  const a = align === 'center' ? 'center' : (align === 'start') !== rtl ? 'left' : 'right';
  const baseline = y + size * (hasArabic(text) ? 0.86 : 0.8);
  return ctx.sink.push({
    op: 'text.point',
    x,
    y: baseline,
    contents: text,
    size: Math.round(size * 10) / 10,
    color,
    fonts: bold ? st.fontsBold : st.fontsRegular,
    weight: bold ? 700 : 400,
    align: a,
    rtl: rtl || hasArabic(text),
    into,
    name,
  });
}

/** Wrapped text in a box (notes, descriptions). */
function paragraph(ctx: InfoContext, into: Place, r: Rect, contents: string, size: number, color: string, align: Align, name: string): OpRef {
  const st = ctx.style;
  const text = localizeDigits(contents, st.digits);
  const a = align === 'center' ? 'center' : (align === 'start') !== st.rtl ? 'left' : 'right';
  return ctx.sink.push({ op: 'text.area', x: r.x, y: r.y, w: r.w, h: r.h, contents: text, size, color, fonts: st.fontsRegular, weight: 400, align: a, rtl: st.rtl || hasArabic(text), leading: size * 1.45, into, name });
}

function card(ctx: InfoContext, into: Place, r: Rect, t: Tone, name = 'Card'): OpRef {
  const rad = Math.min(r.w, r.h) * clamp(ctx.style.roundness, 0, 0.5);
  return ctx.sink.push({ op: 'shape.path', paths: [roundedRectPath(r, rad)], into, fill: t.cardFill, ...(t.cardStroke ? { stroke: t.cardStroke } : {}), opacity: t.cardOpacity, name });
}

function shape(ctx: InfoContext, into: Place, paths: PathShape, fill: Paint, name: string, opacity = 100): OpRef {
  return ctx.sink.push({ op: 'shape.path', paths, into, fill, opacity, name });
}

function iconBadge(ctx: InfoContext, into: Place, cx: number, cy: number, d: number, icon: IconId, bg: string, fg: string, name: string): void {
  shape(ctx, into, [ellipsePath(cx, cy, d / 2, d / 2)], { t: 'solid', c: bg }, `${name} badge`);
  const s = d * 0.54;
  shape(ctx, into, iconShape(icon, { x: cx - s / 2, y: cy - s / 2, w: s, h: s }), { t: 'solid', c: fg }, `${name} icon`);
}

/** Cells of a grid, filled in reading order (right-to-left rows in RTL). */
export function gridCells(box: Rect, n: number, cols: number, gap: number): Rect[] {
  const c = Math.max(1, Math.min(cols, n));
  const rows = Math.ceil(n / c);
  const w = (box.w - gap * (c - 1)) / c;
  const h = (box.h - gap * (rows - 1)) / rows;
  const out: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / c);
    const col = i % c;
    out.push({ x: box.x + col * (w + gap), y: box.y + r * (h + gap), w, h });
  }
  return out;
}

/** x of the reading-start edge of a rect. */
const startX = (ctx: InfoContext, r: Rect): number => (ctx.style.rtl ? r.x + r.w : r.x);
const endX = (ctx: InfoContext, r: Rect): number => (ctx.style.rtl ? r.x : r.x + r.w);
/** Move `d` along the reading direction. */
const fwd = (ctx: InfoContext, d: number): number => (ctx.style.rtl ? -d : d);

/** Mirror columns for RTL so item 0 sits on the right. */
function readingCells(ctx: InfoContext, cells: Rect[], box: Rect): Rect[] {
  if (!ctx.style.rtl) return cells;
  return cells.map((c) => ({ ...c, x: box.x + box.w - (c.x - box.x) - c.w }));
}

function display(it: InfoItem, suffix = ''): string {
  return it.display ?? formatNumber(it.value, { suffix });
}

function ringBand(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): SubPath {
  const outer = arcPoints(cx, cy, r1, r1, a0, a1);
  const inner = r0 > 0.5 ? arcPoints(cx, cy, r0, r0, a1, a0) : [pt(cx, cy)];
  return mergeDuplicates({ closed: true, pts: [...outer, ...inner] });
}

export interface InfoResult {
  top: OpRef;
  summary: string;
}

function root(ctx: InfoContext, kind: string, name: string, params: Record<string, unknown>): OpRef {
  return group(ctx, ctx.into, `INFOGRAPHIC — ${name}`, { AF_type: 'infographic', AF_ver: '1', AF_info: kind, AF_params: JSON.stringify(params) });
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export function statCards(ctx: InfoContext, items: InfoItem[], opts: { columns: number; icons: boolean; suffix: string }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'statCards', 'Stat cards', { items, opts });
  const gap = Math.min(box.w, box.h) * 0.04;
  const cells = readingCells(ctx, gridCells(box, items.length, opts.columns, gap), box);
  items.forEach((it, i) => {
    const r = cells[i]!;
    const g = group(ctx, inside(top, 'bottom'), `Card ${i + 1}`);
    card(ctx, inside(g, 'bottom'), r, t);
    const pad = Math.min(r.w, r.h) * 0.12;
    const unit = Math.min(r.h, r.w * 0.9);
    let y = r.y + pad;
    if (opts.icons) {
      const d = unit * 0.26;
      const cx = startX(ctx, r) + fwd(ctx, pad + d / 2);
      iconBadge(ctx, inside(g), cx, y + d / 2, d, it.icon ?? 'star', ctx.style.card === 'solid' || ctx.style.card === 'gradient' ? mix(t.accent, t.cardFill.t === 'solid' ? t.cardFill.c : ctx.style.palette.primary, 0.75) : t.accent, ctx.style.card === 'solid' || ctx.style.card === 'gradient' ? t.title : onColor(t.accent), `Card ${i + 1}`);
      y += d + pad * 0.6;
    }
    const numSize = Math.min(unit * 0.26, (r.w - 2 * pad) / Math.max(3, display(it, opts.suffix).length * 0.62));
    label(ctx, inside(g), startX(ctx, r) + fwd(ctx, pad), y, display(it, opts.suffix), numSize, t.title, 'start', true, 'Value');
    y += numSize * 1.15;
    const labSize = Math.max(8, Math.min(unit * 0.095, numSize * 0.55));
    label(ctx, inside(g), startX(ctx, r) + fwd(ctx, pad), y, it.label, labSize, t.body, 'start', true, 'Label');
    y += labSize * 1.5;
    if (it.note && y < r.y + r.h - pad - labSize) {
      paragraph(ctx, inside(g), { x: r.x + pad, y, w: r.w - 2 * pad, h: r.y + r.h - pad - y }, it.note, labSize * 0.82, t.muted, 'start', 'Note');
    }
  });
  return { top, summary: `${items.length} stat cards added.` };
}

export function barChart(ctx: InfoContext, items: InfoItem[], opts: { orientation: 'horizontal' | 'vertical'; showValues: boolean; suffix: string; maxValue?: number }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'barChart', opts.orientation === 'horizontal' ? 'Bar chart' : 'Column chart', { items, opts });
  const colors = seriesColors(ctx.style.palette, items.length);
  const max = opts.maxValue ?? Math.max(...items.map((i) => i.value), 1);
  const n = items.length;
  if (opts.orientation === 'horizontal') {
    const rowH = box.h / n;
    const barH = rowH * 0.46;
    const labelW = box.w * 0.3;
    const valueW = opts.showValues ? box.w * 0.14 : 0;
    const trackW = box.w - labelW - valueW;
    const size = clamp(rowH * 0.3, 8, 40);
    items.forEach((it, i) => {
      const y = box.y + i * rowH + (rowH - barH) / 2;
      const g = group(ctx, inside(top, 'bottom'), `Bar ${i + 1}`);
      // Label column at the reading start; bars grow in the reading direction.
      label(ctx, inside(g), startX(ctx, box), y + barH / 2 - size * 0.55, it.label, size, t.body, 'start', true, 'Label');
      const trackStart = startX(ctx, box) + fwd(ctx, labelW);
      const trackRect = { x: ctx.style.rtl ? trackStart - trackW : trackStart, y, w: trackW, h: barH };
      shape(ctx, inside(g, 'bottom'), [roundedRectPath(trackRect, barH / 2)], { t: 'solid', c: t.track }, 'Track');
      const w = Math.max(barH, (trackW * clamp(it.value, 0, max)) / max);
      const barRect = { x: ctx.style.rtl ? trackStart - w : trackStart, y, w, h: barH };
      shape(ctx, inside(g), [roundedRectPath(barRect, barH / 2)], { t: 'solid', c: colors[i]! }, 'Bar');
      if (opts.showValues) label(ctx, inside(g), trackStart + fwd(ctx, trackW + valueW * 0.12), y + barH / 2 - size * 0.55, display(it, opts.suffix), size, t.title, 'start', true, 'Value');
    });
  } else {
    const labelH = box.h * 0.14;
    const valueH = opts.showValues ? box.h * 0.1 : 0;
    const plotH = box.h - labelH - valueH;
    const colW = box.w / n;
    const barW = colW * 0.56;
    const size = clamp(Math.min(colW * 0.16, labelH * 0.42), 8, 36);
    const baseY = box.y + valueH + plotH;
    shape(ctx, inside(top, 'bottom'), [roundedRectPath({ x: box.x, y: baseY, w: box.w, h: Math.max(1, box.h * 0.006) }, 0)], { t: 'solid', c: t.track }, 'Baseline');
    items.forEach((it, i) => {
      const col = ctx.style.rtl ? n - 1 - i : i;
      const cx = box.x + col * colW + colW / 2;
      const h = Math.max(barW * 0.2, (plotH * clamp(it.value, 0, max)) / max);
      const g = group(ctx, inside(top), `Column ${i + 1}`);
      const r = Math.min(barW * 0.22, h / 2);
      shape(ctx, inside(g), [roundedRectPath({ x: cx - barW / 2, y: baseY - h, w: barW, h }, [r, r, 0, 0])], { t: 'solid', c: colors[i]! }, 'Column');
      if (opts.showValues) label(ctx, inside(g), cx, baseY - h - size * 1.45, display(it, opts.suffix), size, t.title, 'center', true, 'Value');
      label(ctx, inside(g), cx, baseY + labelH * 0.22, it.label, size * 0.92, t.body, 'center', false, 'Label');
    });
  }
  return { top, summary: `${opts.orientation === 'horizontal' ? 'Bar' : 'Column'} chart with ${n} values added.` };
}

export function donutChart(ctx: InfoContext, items: InfoItem[], opts: { thickness: number; center: string; legend: boolean; gapDeg: number }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'donut', opts.thickness >= 100 ? 'Pie chart' : 'Donut chart', { items, opts });
  const colors = seriesColors(ctx.style.palette, items.length);
  const legendW = opts.legend ? box.w * 0.42 : 0;
  const chartBox: Rect = opts.legend ? { x: ctx.style.rtl ? box.x + legendW : box.x, y: box.y, w: box.w - legendW, h: box.h } : box;
  const R = Math.min(chartBox.w, chartBox.h) / 2;
  const cx = chartBox.x + chartBox.w / 2;
  const cy = chartBox.y + chartBox.h / 2;
  const r0 = opts.thickness >= 100 ? 0 : R * (1 - clamp(opts.thickness, 5, 95) / 100);
  const total = items.reduce((s, i) => s + Math.max(0, i.value), 0) || 1;
  const gap = ((items.length > 1 ? opts.gapDeg : 0) * Math.PI) / 180;
  // Start at 12 o'clock; RTL runs counter-clockwise so the first slice reads from the right.
  let a = -Math.PI / 2;
  const dir = ctx.style.rtl ? -1 : 1;
  const chart = group(ctx, inside(top), 'Chart');
  items.forEach((it, i) => {
    const sweep = (Math.max(0, it.value) / total) * Math.PI * 2;
    if (sweep <= 0) return;
    const a0 = a + dir * gap / 2;
    const a1 = a + dir * (sweep - gap / 2);
    shape(ctx, inside(chart, 'bottom'), [ringBand(cx, cy, r0, R, a0, a1)], { t: 'solid', c: colors[i]! }, `Slice ${i + 1} — ${it.label}`);
    a += dir * sweep;
  });
  if (r0 > R * 0.35 && opts.center) {
    const size = r0 * 0.5;
    label(ctx, inside(chart), cx, cy - size * 0.62, opts.center, size, t.title, 'center', true, 'Centre value');
  }
  if (opts.legend) {
    const lx: Rect = { x: ctx.style.rtl ? box.x : box.x + box.w - legendW, y: box.y, w: legendW, h: box.h };
    const rowH = Math.min(lx.h / items.length, R * 0.42);
    const y0 = cy - (rowH * items.length) / 2;
    const size = rowH * 0.36;
    const leg = group(ctx, inside(top), 'Legend');
    items.forEach((it, i) => {
      const y = y0 + i * rowH;
      const dot = size * 0.9;
      const sx = startX(ctx, lx);
      shape(ctx, inside(leg), [roundedRectPath({ x: ctx.style.rtl ? sx - dot : sx, y: y + rowH / 2 - dot / 2, w: dot, h: dot }, dot * 0.3)], { t: 'solid', c: colors[i]! }, 'Key');
      const pct = `${formatNumber((Math.max(0, it.value) / total) * 100, { decimals: 0 })}%`;
      label(ctx, inside(leg), sx + fwd(ctx, dot * 1.7), y + rowH / 2 - size * 0.58, it.label, size, t.body, 'start', false, 'Legend label');
      label(ctx, inside(leg), endX(ctx, lx), y + rowH / 2 - size * 0.58, it.display ?? pct, size, t.title, 'end', true, 'Legend value');
    });
  }
  return { top, summary: `${opts.thickness >= 100 ? 'Pie' : 'Donut'} chart with ${items.length} slices added.` };
}

export function progressBars(ctx: InfoContext, items: InfoItem[], opts: { suffix: string; thickness: number }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'progress', 'Progress bars', { items, opts });
  const colors = seriesColors(ctx.style.palette, items.length);
  const rowH = box.h / items.length;
  const size = clamp(rowH * 0.24, 8, 34);
  const barH = clamp(rowH * (opts.thickness / 100), 2, rowH * 0.4);
  items.forEach((it, i) => {
    const y = box.y + i * rowH + rowH * 0.12;
    const g = group(ctx, inside(top, 'bottom'), `Progress ${i + 1}`);
    label(ctx, inside(g), startX(ctx, box), y, it.label, size, t.body, 'start', true, 'Label');
    label(ctx, inside(g), endX(ctx, box), y, display(it, opts.suffix || '%'), size, t.title, 'end', true, 'Value');
    const by = y + size * 1.6;
    shape(ctx, inside(g, 'bottom'), [roundedRectPath({ x: box.x, y: by, w: box.w, h: barH }, barH / 2)], { t: 'solid', c: t.track }, 'Track');
    const w = Math.max(barH, (box.w * clamp(it.value, 0, 100)) / 100);
    shape(ctx, inside(g), [roundedRectPath({ x: ctx.style.rtl ? box.x + box.w - w : box.x, y: by, w, h: barH }, barH / 2)], { t: 'solid', c: colors[i]! }, 'Fill');
  });
  return { top, summary: `${items.length} progress bars added.` };
}

export function progressRings(ctx: InfoContext, items: InfoItem[], opts: { suffix: string; thickness: number }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'rings', 'Progress rings', { items, opts });
  const colors = seriesColors(ctx.style.palette, items.length);
  const gap = box.w * 0.04;
  const cells = readingCells(ctx, gridCells(box, items.length, items.length, gap), box);
  items.forEach((it, i) => {
    const c = cells[i]!;
    const labelH = c.h * 0.22;
    const R = Math.min(c.w, c.h - labelH) / 2 * 0.92;
    const cx = c.x + c.w / 2;
    const cy = c.y + R / 0.92;
    const th = R * clamp(opts.thickness, 4, 50) / 100;
    const g = group(ctx, inside(top, 'bottom'), `Ring ${i + 1}`);
    shape(ctx, inside(g, 'bottom'), [ellipsePath(cx, cy, R, R), ellipsePath(cx, cy, R - th, R - th)], { t: 'solid', c: t.track }, 'Track');
    const v = clamp(it.value, 0, 100) / 100;
    if (v > 0) {
      const dir = ctx.style.rtl ? -1 : 1;
      const a0 = -Math.PI / 2;
      const a1 = a0 + dir * Math.max(0.02, v * Math.PI * 2 - 1e-3);
      shape(ctx, inside(g), [ringBand(cx, cy, R - th, R, a0, a1)], { t: 'solid', c: colors[i]! }, 'Arc');
    }
    const size = (R - th) * 0.62;
    label(ctx, inside(g), cx, cy - size * 0.6, display(it, opts.suffix || '%'), size, t.title, 'center', true, 'Value');
    label(ctx, inside(g), cx, cy + R + labelH * 0.2, it.label, Math.min(labelH * 0.5, R * 0.34), t.body, 'center', true, 'Label');
  });
  return { top, summary: `${items.length} progress rings added.` };
}

export function processSteps(ctx: InfoContext, items: InfoItem[], opts: { badge: 'circle' | 'hexagon' | 'square'; numbered: boolean; icons: boolean }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'steps', 'Process steps', { items, opts });
  const n = items.length;
  const colW = box.w / n;
  const d = Math.min(colW * 0.5, box.h * 0.34);
  const cy = box.y + d / 2 + box.h * 0.04;
  const lineH = Math.max(1.5, d * 0.05);
  // Connector behind the badges, first to last centre.
  const xs = items.map((_, i) => box.x + (ctx.style.rtl ? n - 1 - i : i) * colW + colW / 2);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  if (n > 1) shape(ctx, inside(top, 'bottom'), [roundedRectPath({ x: x0, y: cy - lineH / 2, w: x1 - x0, h: lineH }, lineH / 2)], { t: 'solid', c: t.track }, 'Connector');
  const colors = seriesColors(ctx.style.palette, n);
  items.forEach((it, i) => {
    const cx = xs[i]!;
    const g = group(ctx, inside(top), `Step ${i + 1}`);
    const fill = colors[i]!;
    let badge: SubPath;
    if (opts.badge === 'hexagon') {
      const pts = Array.from({ length: 6 }, (_, k) => ({ x: cx + (d / 2) * Math.cos(-Math.PI / 2 + (k * Math.PI) / 3), y: cy + (d / 2) * Math.sin(-Math.PI / 2 + (k * Math.PI) / 3) }));
      badge = { closed: true, pts: pts.map((p) => pt(p.x, p.y)) };
    } else if (opts.badge === 'square') badge = roundedRectPath({ x: cx - d / 2, y: cy - d / 2, w: d, h: d }, d * 0.22);
    else badge = ellipsePath(cx, cy, d / 2, d / 2);
    // White ring separates the badge from the connector.
    shape(ctx, inside(g, 'bottom'), [ellipsePath(cx, cy, d * 0.58, d * 0.58)], { t: 'solid', c: ctx.style.theme === 'dark' ? ctx.style.palette.dark : '#FFFFFF' }, 'Halo');
    shape(ctx, inside(g), [badge], { t: 'solid', c: fill }, 'Badge');
    const fg = onColor(fill);
    if (opts.icons && it.icon) {
      const s = d * 0.5;
      shape(ctx, inside(g), iconShape(it.icon, { x: cx - s / 2, y: cy - s / 2, w: s, h: s }), { t: 'solid', c: fg }, 'Icon');
    } else if (opts.numbered) {
      const size = d * 0.42;
      label(ctx, inside(g), cx, cy - size * 0.58, String(i + 1), size, fg, 'center', true, 'Number');
    }
    const ts = clamp(colW * 0.1, 8, d * 0.34);
    label(ctx, inside(g), cx, cy + d * 0.75, it.label, ts, t.title, 'center', true, 'Title');
    if (it.note) paragraph(ctx, inside(g), { x: cx - colW * 0.44, y: cy + d * 0.75 + ts * 1.6, w: colW * 0.88, h: box.y + box.h - (cy + d * 0.75 + ts * 1.6) }, it.note, ts * 0.72, t.muted, 'center', 'Note');
  });
  return { top, summary: `${n}-step process added.` };
}

export function timeline(ctx: InfoContext, items: InfoItem[], opts: { orientation: 'vertical' | 'horizontal' }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'timeline', 'Timeline', { items, opts });
  const n = items.length;
  const accent = ctx.style.palette.primary;
  if (opts.orientation === 'vertical') {
    const axisX = startX(ctx, box) + fwd(ctx, box.w * 0.22);
    const rowH = box.h / n;
    const lw = Math.max(1.5, box.w * 0.006);
    shape(ctx, inside(top, 'bottom'), [roundedRectPath({ x: axisX - lw / 2, y: box.y + rowH * 0.2, w: lw, h: box.h - rowH * 0.4 }, lw / 2)], { t: 'solid', c: t.track }, 'Axis');
    items.forEach((it, i) => {
      const cy = box.y + i * rowH + rowH * 0.3;
      const g = group(ctx, inside(top), `Event ${i + 1}`);
      const d = clamp(rowH * 0.2, 6, 40);
      shape(ctx, inside(g), [ellipsePath(axisX, cy, d / 2, d / 2)], { t: 'solid', c: accent }, 'Dot');
      shape(ctx, inside(g, 'bottom'), [ellipsePath(axisX, cy, d, d)], { t: 'solid', c: accent }, 'Dot halo', 18);
      const size = clamp(rowH * 0.2, 8, 44);
      // Year / date on the reading-start side of the axis, text after it.
      label(ctx, inside(g), axisX - fwd(ctx, d * 1.4), cy - size * 0.55, it.display ?? formatNumber(it.value, { decimals: 0 }).replace(/,/g, ''), size, accent, 'end', true, 'Date');
      label(ctx, inside(g), axisX + fwd(ctx, d * 1.4), cy - size * 0.55, it.label, size * 0.8, t.title, 'start', true, 'Title');
      if (it.note) {
        const nx = axisX + fwd(ctx, d * 1.4);
        const w = Math.abs(endX(ctx, box) - nx);
        paragraph(ctx, inside(g), { x: ctx.style.rtl ? nx - w : nx, y: cy + size * 0.55, w, h: rowH - size * 1.2 }, it.note, size * 0.6, t.muted, 'start', 'Note');
      }
    });
  } else {
    const axisY = box.y + box.h * 0.45;
    const colW = box.w / n;
    const lw = Math.max(1.5, box.h * 0.01);
    shape(ctx, inside(top, 'bottom'), [roundedRectPath({ x: box.x, y: axisY - lw / 2, w: box.w, h: lw }, lw / 2)], { t: 'solid', c: t.track }, 'Axis');
    items.forEach((it, i) => {
      const cx = box.x + (ctx.style.rtl ? n - 1 - i : i) * colW + colW / 2;
      const g = group(ctx, inside(top), `Event ${i + 1}`);
      const d = clamp(colW * 0.1, 6, 36);
      shape(ctx, inside(g), [ellipsePath(cx, axisY, d / 2, d / 2)], { t: 'solid', c: accent }, 'Dot');
      const size = clamp(colW * 0.13, 8, 40);
      const up = i % 2 === 0;
      const dateY = up ? axisY - d - size * 1.3 : axisY + d * 0.9;
      label(ctx, inside(g), cx, dateY, it.display ?? formatNumber(it.value, { decimals: 0 }).replace(/,/g, ''), size, accent, 'center', true, 'Date');
      label(ctx, inside(g), cx, up ? axisY + d * 0.9 : axisY - d - size * 1.2, it.label, size * 0.7, t.title, 'center', true, 'Title');
      if (it.note) paragraph(ctx, inside(g), { x: cx - colW * 0.45, y: up ? axisY + d * 0.9 + size * 1.1 : axisY + d * 0.9 + size * 1.2, w: colW * 0.9, h: box.h * 0.4 }, it.note, size * 0.5, t.muted, 'center', 'Note');
    });
  }
  return { top, summary: `Timeline with ${n} events added.` };
}

/** Mirrored ("butterfly") comparison: labels in the middle, A bars one side, B the other. */
export function comparison(ctx: InfoContext, rows: Array<{ label: string; a: number; b: number }>, opts: { titleA: string; titleB: string; suffix: string }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'comparison', 'Comparison', { rows, opts });
  const p = ctx.style.palette;
  const colA = p.primary;
  const colB = p.accent;
  const headH = box.h * 0.14;
  const rowH = (box.h - headH) / rows.length;
  const midW = box.w * 0.26;
  const sideW = (box.w - midW) / 2;
  const max = Math.max(...rows.flatMap((r) => [r.a, r.b]), 1);
  const size = clamp(rowH * 0.26, 8, 34);
  // In RTL, side A (the first) is on the right.
  const aRight = ctx.style.rtl;
  const xMidL = box.x + sideW;
  const xMidR = box.x + sideW + midW;
  const head = group(ctx, inside(top), 'Header');
  label(ctx, inside(head), aRight ? xMidR + sideW / 2 : xMidL - sideW / 2, box.y, opts.titleA, headH * 0.42, colA, 'center', true, 'Title A');
  label(ctx, inside(head), aRight ? xMidL - sideW / 2 : xMidR + sideW / 2, box.y, opts.titleB, headH * 0.42, colB, 'center', true, 'Title B');
  rows.forEach((r, i) => {
    const y = box.y + headH + i * rowH;
    const barH = rowH * 0.42;
    const by = y + (rowH - barH) / 2;
    const g = group(ctx, inside(top, 'bottom'), `Row ${i + 1}`);
    label(ctx, inside(g), box.x + box.w / 2, by + barH / 2 - size * 0.55, r.label, size, t.body, 'center', true, 'Label');
    const wa = Math.max(barH, (sideW * 0.8 * r.a) / max);
    const wb = Math.max(barH, (sideW * 0.8 * r.b) / max);
    const aRect = aRight ? { x: xMidR, y: by, w: wa, h: barH } : { x: xMidL - wa, y: by, w: wa, h: barH };
    const bRect = aRight ? { x: xMidL - wb, y: by, w: wb, h: barH } : { x: xMidR, y: by, w: wb, h: barH };
    shape(ctx, inside(g), [roundedRectPath(aRect, barH / 2)], { t: 'solid', c: colA }, 'Bar A');
    shape(ctx, inside(g), [roundedRectPath(bRect, barH / 2)], { t: 'solid', c: colB }, 'Bar B');
    const va = formatNumber(r.a, { suffix: opts.suffix });
    const vb = formatNumber(r.b, { suffix: opts.suffix });
    const vs = size * 0.9;
    label(ctx, inside(g), aRight ? aRect.x + aRect.w + vs * 0.4 : aRect.x - vs * 0.4, by + barH / 2 - vs * 0.55, va, vs, colA, aRight ? (ctx.style.rtl ? 'end' : 'start') : ctx.style.rtl ? 'start' : 'end', true, 'Value A');
    label(ctx, inside(g), aRight ? bRect.x - vs * 0.4 : bRect.x + bRect.w + vs * 0.4, by + barH / 2 - vs * 0.55, vb, vs, colB, aRight ? (ctx.style.rtl ? 'start' : 'end') : ctx.style.rtl ? 'end' : 'start', true, 'Value B');
  });
  void t;
  return { top, summary: `Comparison with ${rows.length} rows added.` };
}

export function pictogram(ctx: InfoContext, opts: { value: number; total: number; icon: IconId; perRow: number; caption: string }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'pictogram', 'Pictogram', { opts });
  const total = Math.max(1, Math.round(opts.total));
  const filled = clamp(Math.round(opts.value), 0, total);
  const perRow = Math.max(1, Math.min(total, Math.round(opts.perRow)));
  const rows = Math.ceil(total / perRow);
  const capH = opts.caption ? box.h * 0.2 : 0;
  const cell = Math.min(box.w / perRow, (box.h - capH) / rows);
  const s = cell * 0.82;
  const on = group(ctx, inside(top), 'Highlighted');
  const off = group(ctx, inside(top), 'Rest');
  for (let i = 0; i < total; i++) {
    const r = Math.floor(i / perRow);
    const c = i % perRow;
    const col = ctx.style.rtl ? perRow - 1 - c : c;
    const x = box.x + (box.w - perRow * cell) / 2 + col * cell + (cell - s) / 2;
    const y = box.y + r * cell + (cell - s) / 2;
    const hot = i < filled;
    shape(ctx, inside(hot ? on : off), iconShape(opts.icon, { x, y, w: s, h: s }), { t: 'solid', c: hot ? ctx.style.palette.primary : t.track }, `Icon ${i + 1}`);
  }
  if (opts.caption) {
    const size = capH * 0.36;
    label(ctx, inside(top), box.x + box.w / 2, box.y + rows * cell + capH * 0.25, opts.caption, size, t.title, 'center', true, 'Caption');
  }
  return { top, summary: `Pictogram ${filled}/${total} added.` };
}

export function iconList(ctx: InfoContext, items: InfoItem[], opts: { icons: boolean }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'iconList', 'Icon list', { items, opts });
  const rowH = box.h / items.length;
  const d = Math.min(rowH * 0.62, box.w * 0.16);
  items.forEach((it, i) => {
    const y = box.y + i * rowH + (rowH - d) / 2;
    const g = group(ctx, inside(top), `Item ${i + 1}`);
    const cx = startX(ctx, box) + fwd(ctx, d / 2);
    if (opts.icons) iconBadge(ctx, inside(g), cx, y + d / 2, d, it.icon ?? 'check', t.accent, onColor(t.accent), `Item ${i + 1}`);
    const tx = startX(ctx, box) + fwd(ctx, opts.icons ? d * 1.35 : 0);
    const size = d * 0.36;
    label(ctx, inside(g), tx, y + (it.note ? 0 : d / 2 - size * 0.58), it.label, size, t.title, 'start', true, 'Title');
    if (it.note) {
      const w = box.w - (opts.icons ? d * 1.35 : 0);
      paragraph(ctx, inside(g), { x: ctx.style.rtl ? box.x : tx, y: y + size * 1.35, w, h: rowH - size * 1.4 }, it.note, size * 0.74, t.muted, 'start', 'Note');
    }
  });
  return { top, summary: `${items.length} list items added.` };
}

export function sectionHeader(ctx: InfoContext, opts: { title: string; subtitle: string; kicker: string }): InfoResult {
  const { box } = ctx;
  const t = tone(ctx.style);
  const top = root(ctx, 'header', 'Header', { opts });
  const p = ctx.style.palette;
  let y = box.y;
  const x = startX(ctx, box);
  if (opts.kicker) {
    const ks = box.h * 0.13;
    const kw = Math.min(box.w, (opts.kicker.length * ks * 0.62 + ks * 1.6));
    const kr = { x: ctx.style.rtl ? x - kw : x, y, w: kw, h: ks * 1.7 };
    shape(ctx, inside(top), [roundedRectPath(kr, kr.h / 2)], { t: 'solid', c: p.accent }, 'Kicker pill');
    label(ctx, inside(top), kr.x + kr.w / 2, y + ks * 0.3, opts.kicker, ks, onColor(p.accent), 'center', true, 'Kicker');
    y += kr.h + ks * 0.7;
  }
  const ts = box.h * 0.3;
  label(ctx, inside(top), x, y, opts.title, ts, ctx.style.theme === 'dark' ? '#FFFFFF' : p.dark, 'start', true, 'Title');
  y += ts * 1.3;
  const bar = { x: ctx.style.rtl ? x - box.w * 0.12 : x, y, w: box.w * 0.12, h: Math.max(3, ts * 0.12) };
  const stops: GradientStopSpec[] = [
    { p: 0, c: p.primary, o: 100 },
    { p: 100, c: p.accent, o: 100 },
  ];
  shape(ctx, inside(top), [roundedRectPath(bar, bar.h / 2)], { t: 'linear', stops, name: `AF Accent ${shortHash(stops)}`, angle: ctx.style.rtl ? 180 : 0 }, 'Accent bar');
  y += bar.h + ts * 0.35;
  if (opts.subtitle) paragraph(ctx, inside(top), { x: box.x, y, w: box.w, h: box.y + box.h - y }, opts.subtitle, ts * 0.42, t.muted, 'start', 'Subtitle');
  return { top, summary: 'Header added.' };
}

export const INFO_BLOCKS = [
  { id: 'statCards', name: 'Stat cards' },
  { id: 'barH', name: 'Bar chart' },
  { id: 'barV', name: 'Column chart' },
  { id: 'donut', name: 'Donut' },
  { id: 'pie', name: 'Pie' },
  { id: 'progress', name: 'Progress bars' },
  { id: 'rings', name: 'Progress rings' },
  { id: 'steps', name: 'Process steps' },
  { id: 'timelineV', name: 'Timeline (vertical)' },
  { id: 'timelineH', name: 'Timeline (horizontal)' },
  { id: 'comparison', name: 'Comparison' },
  { id: 'pictogram', name: 'Pictogram' },
  { id: 'iconList', name: 'Icon list' },
  { id: 'header', name: 'Title header' },
] as const;

export type InfoBlockId = (typeof INFO_BLOCKS)[number]['id'];
