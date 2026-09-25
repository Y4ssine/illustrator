/**
 * Generic HostTransaction: records ops; the adapter supplies `send`.
 * Shared by every adapter so op construction is identical everywhere (and
 * unit-testable without a host).
 */

import type { Rect } from '../geometry/rect';
import type { ArtboardAdapter, AppearanceAdapter, ColorAdapter, GuideAdapter, HostTransaction, LayerAdapter, MetaAdapter, OpRef, ShapeAdapter, TransformAdapter } from './host';
import type { Batch, BatchResult, HostOp, Ref } from './protocol';

export class OpBuffer implements HostTransaction {
  readonly label: string;
  private readonly list: HostOp[] = [];
  private readonly send: (batch: Batch) => Promise<BatchResult>;

  constructor(label: string, send: (batch: Batch) => Promise<BatchResult>) {
    this.label = label;
    this.send = send;
  }

  get ops(): readonly HostOp[] {
    return this.list;
  }

  private push(op: HostOp): OpRef {
    this.list.push(op);
    return { k: 'op', i: this.list.length - 1 };
  }

  append(ops: HostOp[]): number {
    const first = this.list.length;
    this.list.push(...ops);
    return first;
  }

  readonly layers: LayerAdapter = {
    ensure: (name, opts = {}) => {
      this.push({ op: 'layer.ensure', name, ...opts });
    },
    rename: (from, to) => {
      this.push({ op: 'layer.rename', from, to });
    },
    move: (name, anchor) => {
      this.push({ op: 'layer.move', name, anchor });
    },
    setProps: (name, props) => {
      this.push({ op: 'layer.props', name, ...props });
    },
  };

  readonly guides: GuideAdapter = {
    lines: (into, lines) => {
      if (lines.length) this.push({ op: 'guides.lines', into, lines });
    },
  };

  readonly shapes: ShapeAdapter = {
    group: (into, opts = {}) => this.push({ op: 'group.create', into, ...opts }),
    rect: (r: Rect, into, style) => this.push({ op: 'shape.rect', x: r.x, y: r.y, w: r.w, h: r.h, into, ...style }),
    ellipse: (g, into, style) => this.push({ op: 'shape.ellipse', ...g, into, ...style }),
  };

  readonly transform: TransformAdapter = {
    translate: (ref, dx, dy) => {
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) this.push({ op: 'item.translate', ref, dx, dy });
    },
    place: (ref, to) => {
      this.push({ op: 'item.place', ref, to });
    },
    toLayer: (refs, layer, at = 'top') => {
      if (refs.length) this.push({ op: 'items.toLayer', refs, layer, at, withLinked: true });
    },
  };

  readonly appearance: AppearanceAdapter = {
    set: (ref, props) => {
      this.push({ op: 'item.appearance', ref, ...props });
    },
    effect: (ref, xml, optional = true) => {
      this.push({ op: 'item.effect', ref, xml, optional });
    },
  };

  readonly color: ColorAdapter = {
    solid: (hex) => ({ t: 'solid', c: hex }),
    none: () => ({ t: 'none' }),
  };

  readonly meta: MetaAdapter = {
    tag: (ref, tags) => {
      this.push({ op: 'item.tag', ref, tags });
    },
    rename: (ref, name) => {
      this.push({ op: 'item.rename', ref, name });
    },
    remove: (ref, requireTag = true) => {
      this.push({ op: 'item.remove', ref, requireTag });
    },
    removeTagged: (types, scope) => {
      this.push({ op: 'af.removeTagged', types, scope });
    },
  };

  readonly artboards: ArtboardAdapter = {
    add: (r, name) => this.push({ op: 'artboard.add', x: r.x, y: r.y, w: r.w, h: r.h, name }),
    update: (index, props) => {
      this.push({ op: 'artboard.update', index, ...(props.rect ? { x: props.rect.x, y: props.rect.y, w: props.rect.w, h: props.rect.h } : {}), ...(props.name ? { name: props.name } : {}) });
    },
    activate: (index) => {
      this.push({ op: 'artboard.activate', index });
    },
    createDocument: (w, h, colorSpace, artboardName) => {
      this.push({ op: 'doc.create', w, h, colorSpace, ...(artboardName ? { artboardName } : {}) });
    },
  };

  selectRefs(refs: Ref[]): void {
    this.push({ op: 'selection.set', refs });
  }

  toBatch(opts: { keepSelection?: boolean } = {}): Batch {
    return { label: this.label, ops: [...this.list], keepSelection: opts.keepSelection ?? true };
  }

  commit(opts: { keepSelection?: boolean } = {}): Promise<BatchResult> {
    return this.send(this.toBatch(opts));
  }
}
