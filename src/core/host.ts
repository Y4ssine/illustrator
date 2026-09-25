/**
 * Host adapter interfaces.
 *
 * The core and UI depend ONLY on these interfaces. Today they are implemented
 * by the CEP/ExtendScript adapter (src/illustrator/cep-adapter.ts) and by the
 * browser simulator used for development and tests. A future UXP adapter
 * implements the same interfaces; nothing above this layer changes.
 *
 * Reads are async queries. Writes are recorded into a HostTransaction whose
 * facets mirror the adapter names from the architecture document
 * (LayerAdapter, GuideAdapter, ...). `commit()` sends every recorded op to the
 * host in one call, which Illustrator records as one undo step.
 */

import type { Rect } from '../geometry/rect';
import type {
  Batch,
  BatchResult,
  BlendMode,
  HostOp,
  LayerAnchor,
  Paint,
  Place,
  Ref,
  StrokeSpec,
  TagMap,
} from './protocol';
import type { DocumentSnapshot, HostInfo, ItemDescriptor, LayerInfo } from './snapshot';

export interface TaggedScan {
  /** Counts by AF_type across the document (bounded scan). */
  counts: Record<string, number>;
  scanned: number;
  truncated: boolean;
  previewLeftovers: number;
}

export interface ColorSampling {
  samples: Array<{ hex: string; weight: number }>;
  items: number;
  /** Placed/embedded images in the selection (cannot be sampled from a script). */
  images: number;
  other: number;
  truncated: boolean;
}

export interface DocumentAdapter {
  snapshot(opts?: { maxItems?: number }): Promise<DocumentSnapshot>;
  /** Cheap string that changes when the document/selection changes. */
  signature(): Promise<string>;
  layers(): Promise<LayerInfo[]>;
  scanTagged(opts?: { limit?: number }): Promise<TaggedScan>;
  /** Find the item carrying AF_id == id, searching near `near` first. */
  findByAfId(id: string, near?: Ref): Promise<ItemDescriptor | null>;
  /** Colours painted by the selected artwork, weighted by area (vector art only). */
  sampleColors(opts?: { limit?: number }): Promise<ColorSampling>;
}

export interface SelectionAdapter {
  current(opts?: { maxItems?: number }): Promise<DocumentSnapshot['selection']>;
}

export interface StorageAdapter {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  /** Ask the user for a file and return its text (null if cancelled). */
  importFile(title: string): Promise<{ name: string; text: string } | null>;
  /** Ask the user where to save `text` (returns the saved path, or null if cancelled). */
  exportFile(title: string, suggestedName: string, text: string): Promise<string | null>;
}

export type HostEventType = 'documentChanged' | 'hostCommand' | 'themeChanged';

export interface PreviewController {
  /** Replace the current preview with this batch (host reverts the previous one first). */
  show(batch: Batch): Promise<BatchResult>;
  /** Remove the preview and restore the document exactly. */
  cancel(): Promise<void>;
  /** Remove the preview and run the final batch as one undo step. */
  apply(batch: Batch): Promise<BatchResult>;
  readonly active: boolean;
}

export interface HostAdapter {
  readonly kind: 'cep' | 'simulator' | 'uxp';
  connect(): Promise<HostInfo>;
  readonly info: HostInfo | null;
  readonly document: DocumentAdapter;
  readonly selection: SelectionAdapter;
  readonly storage: StorageAdapter;
  readonly preview: PreviewController;
  begin(label: string): HostTransaction;
  /** Low-level: run a prepared batch (used by transactions and the self-test generator). */
  run(batch: Batch): Promise<BatchResult>;
  on(type: HostEventType, handler: (data: string) => void): () => void;
}

// ---------------------------------------------------------------------------
// Transaction facets
// ---------------------------------------------------------------------------

export type OpRef = Extract<Ref, { k: 'op' }>;

export interface LayerAdapter {
  ensure(name: string, opts?: { anchor?: LayerAnchor; printable?: boolean; locked?: boolean; visible?: boolean }): void;
  rename(from: string, to: string): void;
  move(name: string, anchor: LayerAnchor): void;
  setProps(name: string, props: { printable?: boolean; locked?: boolean; visible?: boolean }): void;
}

export interface GuideAdapter {
  /** Straight guides; returns nothing (guides live inside `into`). */
  lines(into: Place, lines: Array<[number, number, number, number]>): void;
}

export interface ShapeAdapter {
  group(into: Place, opts?: { name?: string; tags?: TagMap }): OpRef;
  rect(r: Rect, into: Place, style: ShapeStyle & { radius?: number; guide?: boolean }): OpRef;
  ellipse(g: { cx: number; cy: number; w: number; h: number; rotation?: number }, into: Place, style: ShapeStyle): OpRef;
}

export interface ShapeStyle {
  fill: Paint;
  stroke?: StrokeSpec;
  opacity?: number;
  blend?: BlendMode;
  name?: string;
  tags?: TagMap;
}

export interface TransformAdapter {
  translate(ref: Ref, dx: number, dy: number): void;
  place(ref: Ref, to: Place): void;
  toLayer(refs: Ref[], layer: string, at?: 'top' | 'bottom'): void;
}

export interface AppearanceAdapter {
  set(ref: Ref, props: { opacity?: number; blend?: BlendMode }): void;
  /** Live effect by XML. `optional` → skipped with a warning if the host cannot apply it. */
  effect(ref: Ref, xml: string, optional?: boolean): void;
}

export interface ColorAdapter {
  solid(hex: string): Paint;
  none(): Paint;
}

export interface MetaAdapter {
  tag(ref: Ref, tags: TagMap): void;
  rename(ref: Ref, name: string): void;
  /** Delete an item. With requireTag the host refuses items without AF tags. */
  remove(ref: Ref, requireTag?: boolean): void;
  removeTagged(types: string[], scope: 'document' | { artboard: number }): void;
}

export interface ArtboardAdapter {
  add(r: Rect, name: string): OpRef;
  update(index: number, props: { rect?: Rect; name?: string }): void;
  activate(index: number): void;
  createDocument(w: number, h: number, colorSpace: 'RGB' | 'CMYK', artboardName?: string): void;
}

export interface HostTransaction {
  readonly label: string;
  readonly layers: LayerAdapter;
  readonly guides: GuideAdapter;
  readonly shapes: ShapeAdapter;
  readonly transform: TransformAdapter;
  readonly appearance: AppearanceAdapter;
  readonly color: ColorAdapter;
  readonly meta: MetaAdapter;
  readonly artboards: ArtboardAdapter;
  selectRefs(refs: Ref[]): void;
  /** Record any op and get a reference to its result. */
  push(op: HostOp): OpRef;
  /** Append pre-built ops (from an engine). Returns the index of the first appended op. */
  append(ops: HostOp[]): number;
  readonly ops: readonly HostOp[];
  toBatch(opts?: { keepSelection?: boolean }): Batch;
  commit(opts?: { keepSelection?: boolean }): Promise<BatchResult>;
}
