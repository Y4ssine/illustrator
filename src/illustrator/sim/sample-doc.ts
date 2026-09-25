/**
 * Sample documents for the simulator and the automated tests (spec §89):
 * shapes, Latin + Arabic text, a clipping mask, placed/embedded images,
 * groups, nested groups and multiple artboards. Coordinates below are design
 * space (Y down) and converted to Illustrator's Y-up space on construction.
 */

import {
  MockDocument,
  MockGroupItem,
  MockItem,
  MockLayer,
  MockPathItem,
  MockPlacedItem,
  MockRasterItem,
  MockTextFrame,
  RGBColor,
  createDocument,
  ENUMS,
  type MockApp,
} from './mock-dom';

type Parent = MockLayer | MockGroupItem;

function rgb(hex: string): RGBColor {
  const n = parseInt(hex.replace('#', ''), 16);
  return Object.assign(new RGBColor(), { red: (n >> 16) & 255, green: (n >> 8) & 255, blue: n & 255 });
}

function add<T extends MockItem>(parent: Parent, item: T, name: string): T {
  item._name = name;
  item.parent = parent;
  parent._items.push(item); // push = further back; build lists front-to-back
  return item;
}

export function rectItem(parent: Parent, name: string, x: number, y: number, w: number, h: number, fill: string, stroke = false): MockPathItem {
  const p = new MockPathItem();
  p.shape = { kind: 'poly', closed: true, pts: [[x, -y], [x + w, -y], [x + w, -(y + h)], [x, -(y + h)]] };
  p.fillColor = rgb(fill);
  p.stroked = stroke;
  return add(parent, p, name);
}

export function ellipseItem(parent: Parent, name: string, cx: number, cy: number, w: number, h: number, fill: string): MockPathItem {
  const p = new MockPathItem();
  p.shape = { kind: 'ellipse', cx, cy: -cy, rx: w / 2, ry: h / 2, rot: 0 };
  p.fillColor = rgb(fill);
  p.stroked = false;
  return add(parent, p, name);
}

export function starItem(parent: Parent, name: string, cx: number, cy: number, r: number, fill: string): MockPathItem {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    pts.push([cx + rr * Math.cos(a), -(cy + rr * Math.sin(a))]);
  }
  const p = new MockPathItem();
  p.shape = { kind: 'poly', closed: true, pts };
  p.fillColor = rgb(fill);
  p.stroked = false;
  return add(parent, p, name);
}

export function textItem(parent: Parent, name: string, contents: string, x: number, y: number, w: number, h: number, size: number, rtl = false): MockTextFrame {
  const t = new MockTextFrame();
  t.contents = contents;
  t.box = [x, -y, x + w, -(y + h)];
  t.size = size;
  t.fontName = rtl ? 'NotoKufiArabic-Bold' : 'Inter-SemiBold';
  t.justification = rtl ? ENUMS.Justification.RIGHT : ENUMS.Justification.LEFT;
  return add(parent, t, name);
}

export function placedItem(parent: Parent, name: string, x: number, y: number, w: number, h: number): MockPlacedItem {
  const p = new MockPlacedItem();
  p.box = [x, -y, x + w, -(y + h)];
  p.file = `/images/${name || 'image'}.png`;
  return add(parent, p, name);
}

export function groupItem(parent: Parent, name: string): MockGroupItem {
  return add(parent, new MockGroupItem(), name);
}

/** A fresh, empty document like File › New (Letter, RGB). */
export function seedEmpty(app: MockApp): MockDocument {
  return createDocument(app, 'Untitled-1', ENUMS.DocumentColorSpace.RGB, 612, 792);
}

/** Campaign-style sample with two 1080×1350 artboards. */
export function seedSample(app: MockApp): MockDocument {
  const doc = createDocument(app, 'Founding-Day-Campaign.ai', ENUMS.DocumentColorSpace.RGB, 1080, 1350);
  doc._artboards[0]!.name = 'IG_PORTRAIT_01';
  doc.artboards.add([1180, 0, 2260, -1350]).name = 'IG_PORTRAIT_02';
  const layer = doc._layers[0]!;

  textItem(layer, 'headline', 'يوم التأسيس ٢٠٢٦', 180, 150, 720, 96, 84, true);
  textItem(layer, 'subtitle', 'A day to remember our roots', 240, 262, 600, 40, 30);
  placedItem(layer, 'hero', 390, 540, 300, 620);

  const clip = groupItem(layer, 'Photo frame');
  clip.clipped = true;
  const mask = rectItem(clip, '', 110, 820, 220, 300, '#FFFFFF');
  mask.clipping = true;
  mask.filled = false;
  placedItem(clip, 'palace-photo', 40, 760, 420, 460);

  const motifs = groupItem(layer, 'motifs');
  const inner = groupItem(motifs, 'stars');
  starItem(inner, 'star', 860, 600, 26, '#B08D4A');
  starItem(inner, 'star', 930, 660, 18, '#B08D4A');
  starItem(inner, 'star', 880, 720, 12, '#B08D4A');
  ellipseItem(motifs, 'sun', 880, 660, 180, 180, '#EFE3CF');

  rectItem(layer, 'BG sand', 0, 0, 1080, 1350, '#D8C3A0');

  // Second artboard
  textItem(layer, 'title-2', 'هويتنا', 1480, 180, 480, 90, 80, true);
  const logoGroup = groupItem(layer, 'logo placeholder');
  rectItem(logoGroup, '', 2060, 1200, 120, 80, '#0B6B3A');
  const raster = new MockRasterItem();
  raster.box = [1280, -500, 2160, -1100];
  add(layer, raster, '');
  rectItem(layer, 'BG green', 1180, 0, 1080, 1350, '#063D24');

  return doc;
}

/** Select items by name (all matches), for tests and the simulator. */
export function selectByName(doc: MockDocument, ...names: string[]): MockItem[] {
  const hits = doc.pageItems.filter((i) => names.includes(i._name));
  doc.selection = hits;
  return hits;
}
