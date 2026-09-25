/**
 * Host protocol — the ONLY contract between the core (TypeScript, runs in the
 * panel) and a host executor (ExtendScript today, UXP later).
 *
 * A command never calls Illustrator directly. It records a list of primitive
 * operations ("ops") in a transaction; the adapter ships the whole list to the
 * host in ONE call. Illustrator records one script evaluation as one undo step,
 * so one command == one Ctrl+Z.
 *
 * Everything in this file is plain JSON so that it can cross the CEP
 * evalScript boundary and be embedded in the in-Illustrator self-test.
 *
 * Coordinates are design space (points, Y down). The host flips Y.
 */

/** Reference to a page item. */
export type Ref =
  /** PageItem.uuid (Illustrator 24+). Valid for the current session. */
  | { k: 'uuid'; v: string }
  /** Index into the selection captured when the batch starts, with a bounds fingerprint to detect a changed selection. */
  | { k: 'sel'; i: number; fp?: string }
  /** The item produced by an earlier op in the same batch. */
  | { k: 'op'; i: number }
  /** An item carrying the persistent AF_id tag (survives save/reopen). `near` narrows the search. */
  | { k: 'af'; id: string; near?: Ref };

/** Where a new or moved item goes. */
export type Place =
  | { k: 'layer'; name: string; at: 'top' | 'bottom' }
  | { k: 'below'; ref: Ref }
  | { k: 'above'; ref: Ref }
  | { k: 'inside'; ref: Ref; at: 'top' | 'bottom' }
  /** Take the stacking slot, name and AF_id of an existing item, then remove it. */
  | { k: 'replace'; ref: Ref };

export type LayerAnchor = 'top' | 'bottom' | { name: string; place: 'above' | 'below' };

export interface GradientStopSpec {
  /** Ramp position 0–100. */
  p: number;
  /** sRGB hex. */
  c: string;
  /** Stop opacity 0–100. */
  o: number;
  /** Midpoint 13–87 (Illustrator's allowed range). */
  m?: number;
}

export type Paint =
  | { t: 'none' }
  | { t: 'solid'; c: string }
  | {
      t: 'radial' | 'linear';
      stops: GradientStopSpec[];
      /** Linear gradient angle in degrees (0 = left→right). */
      angle?: number;
      /**
       * Name of the document gradient to create or reuse. Reusing by name keeps
       * the Swatches panel from filling up with one gradient per object.
       */
      name: string;
      /**
       * Fallback when the host cannot set stop opacity: fade to white and rely
       * on Multiply. Only valid for shadows (dark-over-light).
       */
      fallback?: 'fadeToWhiteMultiply';
    };

export interface StrokeSpec {
  c: string;
  w: number;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'colorDodge'
  | 'colorBurn'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: readonly BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'softLight',
  'hardLight',
  'colorDodge',
  'colorBurn',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
];

/** Tags are string → string. Names must match /^[A-Za-z_][A-Za-z0-9_]*$/ (Illustrator rejects spaces). */
export type TagMap = Record<string, string>;

export interface CommonShapeProps {
  into: Place;
  fill: Paint;
  stroke?: StrokeSpec;
  /** 0–100 */
  opacity?: number;
  blend?: BlendMode;
  name?: string;
  tags?: TagMap;
}

export type HostOp =
  | {
      op: 'layer.ensure';
      name: string;
      anchor?: LayerAnchor;
      printable?: boolean;
      locked?: boolean;
      visible?: boolean;
    }
  | { op: 'layer.rename'; from: string; to: string }
  | { op: 'layer.move'; name: string; anchor: LayerAnchor }
  | { op: 'layer.props'; name: string; printable?: boolean; locked?: boolean; visible?: boolean }
  | { op: 'group.create'; into: Place; name?: string; tags?: TagMap }
  | {
      op: 'guides.lines';
      into: Place;
      /** [x1, y1, x2, y2] per line. */
      lines: Array<[number, number, number, number]>;
    }
  | ({ op: 'shape.rect'; x: number; y: number; w: number; h: number; radius?: number; guide?: boolean } & CommonShapeProps)
  | ({ op: 'shape.ellipse'; cx: number; cy: number; w: number; h: number; rotation?: number } & CommonShapeProps)
  | { op: 'item.translate'; ref: Ref; dx: number; dy: number }
  | { op: 'item.place'; ref: Ref; to: Place }
  /**
   * Move items to another layer, keeping their relative stacking. Plugin
   * shadows linked to a moved item (AF_src == its AF_id, found among its
   * siblings) travel with it and stay directly below it.
   */
  | { op: 'items.toLayer'; refs: Ref[]; layer: string; at: 'top' | 'bottom'; withLinked: boolean }
  | { op: 'item.remove'; ref: Ref; requireTag: boolean }
  | { op: 'item.rename'; ref: Ref; name: string }
  | { op: 'item.tag'; ref: Ref; tags: TagMap }
  | { op: 'item.appearance'; ref: Ref; opacity?: number; blend?: BlendMode }
  | { op: 'item.effect'; ref: Ref; xml: string; optional: boolean }
  /** Adds an artboard and makes it the active one. */
  | { op: 'artboard.add'; x: number; y: number; w: number; h: number; name: string }
  | { op: 'artboard.update'; index: number; x?: number; y?: number; w?: number; h?: number; name?: string }
  | { op: 'artboard.activate'; index: number }
  | { op: 'selection.set'; refs: Ref[] }
  | { op: 'doc.create'; w: number; h: number; colorSpace: 'RGB' | 'CMYK'; artboardName?: string }
  | { op: 'af.removeTagged'; types: string[]; scope: 'document' | { artboard: number } };

export type HostOpName = HostOp['op'];

export interface Batch {
  label: string;
  ops: HostOp[];
  /** Restore the selection that existed when the batch started (default true). */
  keepSelection?: boolean;
}

/** What the host returns for each op. */
export interface OpResult {
  /** Created / resolved item, when the op produced one. */
  item?: { uuid?: string; name: string; bounds?: [number, number, number, number] };
  layer?: string;
  artboard?: number;
  count?: number;
  skipped?: string;
}

export interface HostError {
  code: HostErrorCode;
  message: string;
  opIndex?: number;
  op?: string;
  line?: number;
  rolledBack?: 'full' | 'partial' | 'none';
  details?: string;
}

export type HostErrorCode =
  | 'NO_DOCUMENT'
  | 'TEXT_EDITING'
  | 'SELECTION_CHANGED'
  | 'REF_NOT_FOUND'
  | 'LAYER_LOCKED'
  | 'LAYER_NOT_FOUND'
  | 'NOT_TAGGED'
  | 'UNSUPPORTED'
  | 'BAD_OP'
  | 'HOST_EXCEPTION'
  | 'BRIDGE'
  | 'TIMEOUT';

export type BatchResult =
  | { ok: true; results: OpResult[]; warnings: string[]; ms: number }
  | { ok: false; error: HostError; warnings: string[]; ms: number };

/** Metadata tag names written by Artboard Forge. */
export const TAG = {
  type: 'AF_type',
  version: 'AF_ver',
  id: 'AF_id',
  source: 'AF_src',
  params: 'AF_params',
  preview: 'AF_preview',
} as const;

export const TAG_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Prefix given to preview artwork so a sweep can always find leftovers. */
export const PREVIEW_NAME_PREFIX = '⟡ AF PREVIEW';
