/**
 * Mock document (de)serialisation — used for simulated undo/redo and for
 * simulated save/close/reopen (tags must survive; uuids are regenerated on
 * reopen so nothing may rely on them persisting).
 */

import {
  CMYKColor,
  GradientColor,
  GrayColor,
  MockArtboard,
  MockCompoundPathItem,
  MockDocument,
  MockGradient,
  MockGradientStop,
  MockGroupItem,
  MockItem,
  MockLayer,
  MockPathItem,
  MockPlacedItem,
  MockRasterItem,
  MockSwatch,
  MockSwatchGroup,
  MockTag,
  MockTextFrame,
  NoColor,
  RGBColor,
  allLayerItems,
  type AIBounds,
  type AnyColor,
} from './mock-dom';

type ColorJSON = { t: 'rgb'; r: number; g: number; b: number } | { t: 'cmyk'; c: number; m: number; y: number; k: number } | { t: 'gray'; g: number } | { t: 'none' } | { t: 'grad'; name: string };

interface ItemJSON {
  type: string;
  name: string;
  hidden: boolean;
  locked: boolean;
  opacity: number;
  blend: string;
  uuid: string;
  selected?: boolean;
  tags: Array<[string, string]>;
  effects: string[];
  shape?: MockPathItem['shape'];
  grad?: MockPathItem['_grad'];
  evenodd?: boolean;
  fill?: ColorJSON;
  filled?: boolean;
  stroke?: ColorJSON;
  stroked?: boolean;
  strokeWidth?: number;
  guides?: boolean;
  clipping?: boolean;
  clipped?: boolean;
  items?: ItemJSON[];
  box?: AIBounds;
  text?: {
    contents: string;
    kind: string;
    size: number;
    font: string;
    just: string;
    anchor?: [number, number] | null;
    color?: ColorJSON;
    stroke?: ColorJSON;
    strokeWeight?: number;
    leading?: number | null;
    tracking?: number;
    dir?: string;
    composer?: string;
  };
  file?: string;
}

interface LayerJSON {
  name: string;
  visible: boolean;
  locked: boolean;
  printable: boolean;
  items: ItemJSON[];
  sublayers: LayerJSON[];
}

export interface DocJSON {
  name: string;
  cs: string;
  saved: boolean;
  active: number;
  artboards: Array<{ name: string; rect: AIBounds }>;
  gradients: Array<{ name: string; type: string; stops: Array<{ p: number; m: number; o: number; c: ColorJSON }> }>;
  swatches?: Array<{ name: string; c: ColorJSON }>;
  swatchGroups?: Array<{ name: string; swatches: string[] }>;
  layers: LayerJSON[];
  activeLayer: string | null;
}

function colorToJSON(c: AnyColor | undefined): ColorJSON {
  if (!c) return { t: 'none' };
  if (c instanceof RGBColor) return { t: 'rgb', r: c.red, g: c.green, b: c.blue };
  if (c instanceof CMYKColor) return { t: 'cmyk', c: c.cyan, m: c.magenta, y: c.yellow, k: c.black };
  if (c instanceof GrayColor) return { t: 'gray', g: c.gray };
  if (c instanceof GradientColor) return { t: 'grad', name: c.gradient?.name ?? '' };
  return { t: 'none' };
}

function colorFromJSON(j: ColorJSON | undefined, doc: MockDocument): AnyColor {
  if (!j) return new NoColor();
  switch (j.t) {
    case 'rgb':
      return Object.assign(new RGBColor(), { red: j.r, green: j.g, blue: j.b });
    case 'cmyk':
      return Object.assign(new CMYKColor(), { cyan: j.c, magenta: j.m, yellow: j.y, black: j.k });
    case 'gray':
      return Object.assign(new GrayColor(), { gray: j.g });
    case 'grad': {
      const gc = new GradientColor();
      gc.gradient = doc._gradients.find((g) => g.name === j.name) ?? null;
      return gc;
    }
    default:
      return new NoColor();
  }
}

function itemToJSON(i: MockItem, withSelection: boolean): ItemJSON {
  const base: ItemJSON = {
    type: i._type,
    name: i._name,
    hidden: i.hidden,
    locked: i.locked,
    opacity: i.opacity,
    blend: i.blendingMode,
    uuid: i.uuid,
    tags: i._tags.map((t) => [t.name, t.value]),
    effects: [...i._effects],
  };
  if (withSelection && i._selected) base.selected = true;
  if (i instanceof MockPathItem) {
    return {
      ...base,
      shape: JSON.parse(JSON.stringify(i.shape)),
      grad: i._grad ? [...i._grad] : null,
      evenodd: i.evenodd,
      fill: colorToJSON(i.fillColor),
      filled: i.filled,
      stroke: colorToJSON(i.strokeColor),
      stroked: i.stroked,
      strokeWidth: i.strokeWidth,
      guides: i.guides,
      clipping: i.clipping,
    };
  }
  if (i instanceof MockGroupItem) return { ...base, clipped: i.clipped, items: i._items.map((c) => itemToJSON(c, withSelection)) };
  if (i instanceof MockCompoundPathItem) return { ...base, items: i._items.map((c) => itemToJSON(c, withSelection)) };
  if (i instanceof MockTextFrame) {
    return {
      ...base,
      box: i.box,
      text: {
        contents: i.contents,
        kind: i.kind,
        size: i.size,
        font: i.fontName,
        just: i.justification,
        anchor: i.anchor ? [...i.anchor] : null,
        color: colorToJSON(i.textColor),
        stroke: colorToJSON(i.textStroke),
        strokeWeight: i.textStrokeWeight,
        leading: i.leading,
        tracking: i.tracking,
        dir: i.direction,
        composer: i.composer,
      },
    };
  }
  if (i instanceof MockPlacedItem || i instanceof MockRasterItem) return { ...base, box: (i as MockPlacedItem).box, file: (i as MockPlacedItem).file };
  return base;
}

function layerToJSON(l: MockLayer, withSelection: boolean): LayerJSON {
  return {
    name: l.name,
    visible: l.visible,
    locked: l.locked,
    printable: l.printable,
    items: l._items.map((i) => itemToJSON(i, withSelection)),
    sublayers: l._sublayers.map((s) => layerToJSON(s, withSelection)),
  };
}

export function serializeDoc(d: MockDocument, withSelection = true): DocJSON {
  return {
    name: d.name,
    cs: d.documentColorSpace,
    saved: d.saved,
    active: d._active,
    artboards: d._artboards.map((a) => ({ name: a.name, rect: a.artboardRect })),
    gradients: d._gradients.map((g) => ({
      name: g.name,
      type: g.type,
      stops: g._stops.map((s) => ({ p: s.rampPoint, m: s.midPoint, o: s.opacity, c: colorToJSON(s.color) })),
    })),
    swatches: d._swatches.map((sw) => ({ name: sw.name, c: colorToJSON(sw.color) })),
    swatchGroups: d._swatchGroups.map((g) => ({ name: g.name, swatches: g._swatches.map((sw) => sw.name) })),
    layers: d._layers.map((l) => layerToJSON(l, withSelection)),
    activeLayer: d._activeLayer && !d._activeLayer._dead ? d._activeLayer.name : null,
  };
}

function itemFromJSON(j: ItemJSON, parent: MockLayer | MockGroupItem | MockCompoundPathItem, doc: MockDocument, keepUuid: boolean): MockItem {
  let it: MockItem;
  switch (j.type) {
    case 'PathItem': {
      const p = new MockPathItem();
      p.shape = JSON.parse(JSON.stringify(j.shape));
      p.fillColor = colorFromJSON(j.fill, doc);
      p._grad = j.grad ? ([...j.grad] as NonNullable<MockPathItem['_grad']>) : null;
      p.evenodd = !!j.evenodd;
      p.filled = !!j.filled;
      p.strokeColor = colorFromJSON(j.stroke, doc);
      p.stroked = !!j.stroked;
      p.strokeWidth = j.strokeWidth ?? 1;
      p.guides = !!j.guides;
      p.clipping = !!j.clipping;
      it = p;
      break;
    }
    case 'GroupItem': {
      const g = new MockGroupItem();
      g.clipped = !!j.clipped;
      g._items = (j.items ?? []).map((c) => itemFromJSON(c, g, doc, keepUuid));
      it = g;
      break;
    }
    case 'CompoundPathItem': {
      const c = new MockCompoundPathItem();
      c._items = (j.items ?? []).map((x) => itemFromJSON(x, c, doc, keepUuid));
      it = c;
      break;
    }
    case 'TextFrame': {
      const t = new MockTextFrame();
      t.box = j.box!;
      t.contents = j.text!.contents;
      t.kind = j.text!.kind;
      t.size = j.text!.size;
      t.fontName = j.text!.font;
      t.justification = j.text!.just;
      t.anchor = j.text!.anchor ? [...j.text!.anchor] : null;
      if (j.text!.color) t.textColor = colorFromJSON(j.text!.color, doc);
      if (j.text!.stroke) t.textStroke = colorFromJSON(j.text!.stroke, doc);
      t.textStrokeWeight = j.text!.strokeWeight ?? 0;
      t.leading = j.text!.leading ?? null;
      t.tracking = j.text!.tracking ?? 0;
      if (j.text!.dir) t.direction = j.text!.dir;
      if (j.text!.composer) t.composer = j.text!.composer;
      it = t;
      break;
    }
    case 'RasterItem': {
      const r = new MockRasterItem();
      r.box = j.box!;
      it = r;
      break;
    }
    default: {
      const p = new MockPlacedItem();
      p.box = j.box!;
      p.file = j.file ?? '';
      it = p;
    }
  }
  it._name = j.name;
  it.hidden = j.hidden;
  it.locked = j.locked;
  it.opacity = j.opacity;
  it.blendingMode = j.blend;
  if (keepUuid) it.uuid = j.uuid;
  it._selected = !!j.selected;
  it._effects = [...j.effects];
  it._tags = j.tags.map(([n, v]) => {
    const t = new MockTag(it);
    t.name = n;
    t.value = v;
    return t;
  });
  it.parent = parent;
  return it;
}

function layerFromJSON(j: LayerJSON, parent: MockDocument | MockLayer, doc: MockDocument, keepUuid: boolean): MockLayer {
  const l = new MockLayer(parent, j.name);
  l.visible = j.visible;
  l.locked = j.locked;
  l.printable = j.printable;
  l._items = j.items.map((i) => itemFromJSON(i, l, doc, keepUuid));
  l._sublayers = j.sublayers.map((s) => layerFromJSON(s, l, doc, keepUuid));
  return l;
}

/** Replace the content of `doc` in place (old objects become dead, like after an undo). */
export function restoreDoc(doc: MockDocument, j: DocJSON, keepUuid = true): void {
  for (const i of allLayerItems(doc._layers)) i._dead = true;
  for (const l of doc._layers) l._dead = true;
  for (const g of doc._gradients) g._dead = true;
  doc.name = j.name;
  doc.documentColorSpace = j.cs;
  doc.saved = j.saved;
  doc._artboards = j.artboards.map((a) => {
    const ab = new MockArtboard();
    ab.artboardRect = a.rect;
    ab.name = a.name;
    return ab;
  });
  doc._active = j.active;
  doc._gradients = j.gradients.map((g) => {
    const mg = new MockGradient(doc);
    mg.name = g.name;
    mg.type = g.type;
    mg._stops = g.stops.map((s) => {
      const st = new MockGradientStop(mg);
      st.rampPoint = s.p;
      st.midPoint = s.m;
      st.color = colorFromJSON(s.c, doc);
      (st as unknown as { _opacity: number })._opacity = s.o;
      return st;
    });
    return mg;
  });
  doc._swatches = (j.swatches ?? []).map((sj) => {
    const sw = new MockSwatch(doc);
    sw.name = sj.name;
    sw.color = colorFromJSON(sj.c, doc);
    return sw;
  });
  doc._swatchGroups = (j.swatchGroups ?? []).map((gj) => {
    const g = new MockSwatchGroup(doc);
    g.name = gj.name;
    g._swatches = gj.swatches.map((n) => doc._swatches.find((sw) => sw.name === n)).filter((x): x is MockSwatch => !!x);
    return g;
  });
  doc._layers = j.layers.map((l) => layerFromJSON(l, doc, doc, keepUuid));
  doc._activeLayer = j.activeLayer ? (doc._layers.find((l) => l.name === j.activeLayer) ?? null) : null;
}

/** Deep copy of an item for PageItem.duplicate() (new uuids, not attached to a parent). */
export function cloneItem(item: MockItem): MockItem {
  const json = itemToJSON(item, false);
  return itemFromJSON(json, item.parent, item.document, false);
}
