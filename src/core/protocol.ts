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
      /**
       * Gradient angle in degrees, Illustrator convention: 0 = left → right,
       * 90 = bottom → top (counter-clockwise positive). The host rotates only
       * the fill gradient, not the object.
       */
      angle?: number;
      /** Radial only: scale the gradient to the object's aspect (elliptical falloff). */
      fit?: 'circle' | 'ellipse';
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

export type GradientPaint = Extract<Paint, { t: 'radial' | 'linear' }>;

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
  | { op: 'af.removeTagged'; types: string[]; scope: 'document' | { artboard: number } }
  /** Bezier path(s). One subpath → PathItem; several → CompoundPathItem (holes by direction). */
  | ({ op: 'shape.path'; paths: Array<{ closed: boolean; pts: number[][] }> } & CommonShapeProps)
  /** Point text; (x, y) is the baseline anchor. `align` also sets which side the anchor is on. */
  | ({ op: 'text.point'; x: number; y: number } & TextProps)
  /** Area text inside the rectangle (wraps; Arabic needs the World-Ready composer, set by the host). */
  | ({ op: 'text.area'; x: number; y: number; w: number; h: number } & TextProps)
  | { op: 'item.duplicate'; ref: Ref; to: Place; name?: string; tags?: TagMap }
  /** Restyle an item (recursively for groups/compound paths/text). */
  | { op: 'item.restyle'; ref: Ref; fill?: Paint; stroke?: StrokeSpec | null; opacity?: number; blend?: BlendMode; recursive: boolean }
  /**
   * Affine transform in design space: x' = a·x + c·y + tx, y' = b·x + d·y + ty.
   * The host converts to Illustrator's Y-up matrix and corrects for the pivot.
   */
  | { op: 'item.transform'; ref: Ref; m: [number, number, number, number, number, number]; gradients: boolean }
  /** Rotate (Illustrator convention: + = counter-clockwise) about a bounding-box anchor. */
  | { op: 'item.rotate'; ref: Ref; angle: number; about: PivotAnchor; gradients: boolean }
  /** Turn a group into a clipping group: its top-most item becomes the mask. */
  | { op: 'group.clip'; ref: Ref }
  | { op: 'swatch.group'; name: string; colors: Array<{ name: string; c: string }> };

export type PivotAnchor = 'center' | 'left' | 'right' | 'top' | 'bottom' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface TextProps {
  into: Place;
  contents: string;
  size: number;
  color: string;
  /**
   * Candidate fonts (PostScript names), first installed one wins. None
   * installed → Illustrator's default font and a warning.
   */
  fonts?: string[];
  /** Bold/semibold hint used only by the simulator renderer (the real weight comes from the font name). */
  weight?: number;
  align: 'left' | 'center' | 'right';
  rtl: boolean;
  /** Leading in pt (auto when omitted). */
  leading?: number;
  /** Tracking in 1/1000 em. */
  tracking?: number;
  opacity?: number;
  name?: string;
  tags?: TagMap;
}

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
