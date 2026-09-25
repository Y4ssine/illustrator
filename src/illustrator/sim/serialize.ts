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
  text?: { contents: string; kind: string; size: number; font: string; just: string };
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
    return { ...base, box: i.box, text: { contents: i.contents, kind: i.kind, size: i.size, font: i.fontName, just: i.justification } };
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
  doc._layers = j.layers.map((l) => layerFromJSON(l, doc, doc, keepUuid));
  doc._activeLayer = j.activeLayer ? (doc._layers.find((l) => l.name === j.activeLayer) ?? null) : null;
}
