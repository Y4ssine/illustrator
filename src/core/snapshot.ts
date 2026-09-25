/**
 * Read-side model: what the host reports about the document and selection.
 * Produced by the host `snapshot` query, normalised by `normalizeSnapshot`.
 */

import type { Rect } from '../geometry/rect';
import type { Ref } from './protocol';
import { decodeMeta, type AfMeta } from './tags';

export type ItemKind =
  | 'path'
  | 'compound'
  | 'group'
  | 'clipGroup'
  | 'text'
  | 'placed'
  | 'raster'
  | 'symbol'
  | 'mesh'
  | 'plugin'
  | 'guide'
  | 'other';

export interface TextInfo {
  kind: 'point' | 'area' | 'path';
  size: number | null;
  font: string | null;
  /** Paragraph justification of the first paragraph. */
  justification: string | null;
  length: number;
  /** True when the text contains Arabic-script characters. */
  arabic: boolean;
}

export interface ItemDescriptor {
  ref: Ref;
  /** Position in the captured selection. */
  index: number;
  uuid: string | null;
  kind: ItemKind;
  typename: string;
  name: string;
  layer: string;
  /** True when the item's direct parent is a layer (not a group). */
  topLevel: boolean;
  geometric: Rect;
  visible: Rect;
  /** For clipping groups: bounds of the clipping path (what the viewer sees). */
  clip: Rect | null;
  hidden: boolean;
  locked: boolean;
  af: AfMeta | null;
  text: TextInfo | null;
}

export interface ArtboardInfo {
  index: number;
  name: string;
  rect: Rect;
}

export interface LayerInfo {
  name: string;
  visible: boolean;
  locked: boolean;
  printable: boolean;
  /** Number of direct page items (not recursive). */
  items: number;
  sublayers: number;
}

export interface DocumentInfo {
  name: string;
  saved: boolean;
  colorSpace: 'RGB' | 'CMYK';
  artboards: ArtboardInfo[];
  activeArtboard: number;
  layers: LayerInfo[];
}

export interface SelectionInfo {
  /** 'items' normal; 'text-editing' when the Type tool is active inside a frame. */
  mode: 'none' | 'items' | 'text-editing';
  count: number;
  truncated: boolean;
  items: ItemDescriptor[];
}

export interface HostInfo {
  host: 'illustrator' | 'simulator';
  version: string;
  capabilities: HostCapabilities;
}

export interface HostCapabilities {
  uuid: boolean;
  applyEffect: boolean;
  exportForScreens: boolean;
  gradientStopOpacity: boolean;
  undo: boolean;
}

export interface DocumentSnapshot {
  doc: DocumentInfo | null;
  selection: SelectionInfo;
  /** Cheap signature used by the poller to decide whether to refresh. */
  signature: string;
}

// ---------------------------------------------------------------------------
// Wire format (compact keys to keep evalScript payloads small).
// ---------------------------------------------------------------------------

type WireRect = [number, number, number, number];

export interface WireItem {
  i: number;
  id: string | null;
  t: string;
  k: ItemKind;
  n: string;
  ly: string;
  top: boolean;
  gb: WireRect;
  vb: WireRect;
  cb?: WireRect | null;
  hd: boolean;
  lk: boolean;
  fp: string;
  tg?: Record<string, string>;
  tx?: { kind: TextInfo['kind']; size: number | null; font: string | null; just: string | null; len: number; ar: boolean };
}

export interface WireSnapshot {
  doc: null | {
    name: string;
    saved: boolean;
    cs: 'RGB' | 'CMYK';
    abs: Array<{ i: number; n: string; r: WireRect }>;
    ab: number;
    layers: Array<{ n: string; v: boolean; l: boolean; p: boolean; c: number; s: number }>;
  };
  sel: { mode: SelectionInfo['mode']; count: number; truncated: boolean; items: WireItem[] };
  sig: string;
}

const toRect = (r: WireRect): Rect => ({ x: r[0], y: r[1], w: r[2], h: r[3] });

export function normalizeItem(w: WireItem, uuidCapable: boolean): ItemDescriptor {
  const ref: Ref = uuidCapable && w.id ? { k: 'uuid', v: w.id } : { k: 'sel', i: w.i, fp: w.fp };
  return {
    ref,
    index: w.i,
    uuid: w.id,
    kind: w.k,
    typename: w.t,
    name: w.n,
    layer: w.ly,
    topLevel: w.top,
    geometric: toRect(w.gb),
    visible: toRect(w.vb),
    clip: w.cb ? toRect(w.cb) : null,
    hidden: w.hd,
    locked: w.lk,
    af: w.tg ? decodeMeta(w.tg) : null,
    text: w.tx
      ? { kind: w.tx.kind, size: w.tx.size, font: w.tx.font, justification: w.tx.just, length: w.tx.len, arabic: w.tx.ar }
      : null,
  };
}

export function normalizeSnapshot(w: WireSnapshot, uuidCapable: boolean): DocumentSnapshot {
  return {
    doc: w.doc
      ? {
          name: w.doc.name,
          saved: w.doc.saved,
          colorSpace: w.doc.cs,
          artboards: w.doc.abs.map((a) => ({ index: a.i, name: a.n, rect: toRect(a.r) })),
          activeArtboard: w.doc.ab,
          layers: w.doc.layers.map((l) => ({ name: l.n, visible: l.v, locked: l.l, printable: l.p, items: l.c, sublayers: l.s })),
        }
      : null,
    selection: {
      mode: w.sel.mode,
      count: w.sel.count,
      truncated: w.sel.truncated,
      items: w.sel.items.map((it) => normalizeItem(it, uuidCapable)),
    },
    signature: w.sig,
  };
}

export type BoundsMode = 'visible' | 'geometric';

/**
 * The rectangle a designer perceives for an item: clip bounds for clipping
 * groups (Illustrator reports the *unclipped* content for those), otherwise
 * visible (stroke-inclusive) or geometric bounds.
 */
export function perceivedBounds(item: ItemDescriptor, mode: BoundsMode): Rect {
  if (item.clip) return item.clip;
  return mode === 'visible' ? item.visible : item.geometric;
}

export function activeArtboard(doc: DocumentInfo): ArtboardInfo | null {
  return doc.artboards.find((a) => a.index === doc.activeArtboard) ?? doc.artboards[0] ?? null;
}
