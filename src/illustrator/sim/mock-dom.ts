/**
 * A small, deliberately partial model of Illustrator's scripting DOM.
 *
 * PURPOSE: run the real ExtendScript host (src/illustrator/jsx) in Node tests
 * and in the browser simulator. It models the objects/methods the host uses,
 * with Illustrator's conventions: Y-up coordinates, collections indexed front
 * (0) to back, `doc.selection` being a TextRange while editing text, clipping
 * groups reporting the bounds of ALL their content, tags with name rules,
 * deleted objects throwing on access, per-script undo steps.
 *
 * LIMITS: it is written from the same understanding of the DOM as the host,
 * so it cannot prove the host is right about Illustrator. That is what
 * tests/illustrator/af-selftest.jsx (run inside real Illustrator) is for.
 */

export type AIBounds = [number, number, number, number];

let uuidSeq = 1000;
const nextUuid = (): string => String(++uuidSeq);

export class DeadObjectError extends Error {
  constructor() {
    super('No such element');
  }
}

export const ENUMS = {
  ElementPlacement: { PLACEATBEGINNING: 'PLACEATBEGINNING', PLACEATEND: 'PLACEATEND', PLACEBEFORE: 'PLACEBEFORE', PLACEAFTER: 'PLACEAFTER', INSIDE: 'INSIDE' },
  BlendModes: Object.fromEntries(
    ['NORMAL', 'MULTIPLY', 'SCREEN', 'OVERLAY', 'SOFTLIGHT', 'HARDLIGHT', 'COLORDODGE', 'COLORBURN', 'DARKEN', 'LIGHTEN', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATIONBLEND', 'COLORBLEND', 'LUMINOSITY'].map((k) => [k, k]),
  ),
  GradientType: { LINEAR: 'LINEAR', RADIAL: 'RADIAL' },
  Transformation: { CENTER: 'CENTER', DOCUMENTORIGIN: 'DOCUMENTORIGIN', TOPLEFT: 'TOPLEFT', BOTTOM: 'BOTTOM' },
  CoordinateSystem: { DOCUMENTCOORDINATESYSTEM: 'DOCUMENTCOORDINATESYSTEM', ARTBOARDCOORDINATESYSTEM: 'ARTBOARDCOORDINATESYSTEM' },
  UserInteractionLevel: { DONTDISPLAYALERTS: 'DONTDISPLAYALERTS', DISPLAYALERTS: 'DISPLAYALERTS' },
  DocumentColorSpace: { RGB: 'RGB', CMYK: 'CMYK' },
  ZOrderMethod: { BRINGTOFRONT: 'BRINGTOFRONT', BRINGFORWARD: 'BRINGFORWARD', SENDBACKWARD: 'SENDBACKWARD', SENDTOBACK: 'SENDTOBACK' },
  TextType: { POINTTEXT: 'POINTTEXT', AREATEXT: 'AREATEXT', PATHTEXT: 'PATHTEXT' },
  SaveOptions: { DONOTSAVECHANGES: 'DONOTSAVECHANGES', SAVECHANGES: 'SAVECHANGES', PROMPTTOSAVECHANGES: 'PROMPTTOSAVECHANGES' },
  Justification: { LEFT: 'Justification.LEFT', RIGHT: 'Justification.RIGHT', CENTER: 'Justification.CENTER', FULLJUSTIFY: 'Justification.FULLJUSTIFY' },
} as const;

const EP = ENUMS.ElementPlacement;

// ---------------------------------------------------------------------------
// Colours & gradients
// ---------------------------------------------------------------------------

export class RGBColor {
  readonly typename = 'RGBColor';
  red = 0;
  green = 0;
  blue = 0;
}
export class CMYKColor {
  readonly typename = 'CMYKColor';
  cyan = 0;
  magenta = 0;
  yellow = 0;
  black = 0;
}
export class GrayColor {
  readonly typename = 'GrayColor';
  gray = 0;
}
export class NoColor {
  readonly typename = 'NoColor';
}
export class GradientColor {
  readonly typename = 'GradientColor';
  gradient: MockGradient | null = null;
  angle = 0;
}
export type AnyColor = RGBColor | CMYKColor | GrayColor | NoColor | GradientColor;

export class MockGradientStop {
  readonly typename = 'GradientStop';
  rampPoint = 0;
  midPoint = 50;
  color: AnyColor = new GrayColor();
  private _opacity = 100;
  constructor(private readonly owner: MockGradient) {}
  get opacity(): number {
    return this._opacity;
  }
  set opacity(v: number) {
    if (!this.owner.doc.app.supportsStopOpacity) throw new Error('opacity is read-only');
    this._opacity = v;
  }
}

export class MockGradient {
  readonly typename = 'Gradient';
  name = '';
  type: string = ENUMS.GradientType.LINEAR;
  _stops: MockGradientStop[] = [];
  _dead = false;
  constructor(readonly doc: MockDocument) {
    const a = new MockGradientStop(this);
    const b = new MockGradientStop(this);
    b.rampPoint = 100;
    this._stops.push(a, b);
  }
  get gradientStops(): MockGradientStop[] & { add(): MockGradientStop } {
    return Object.assign(this._stops.slice(), {
      add: (): MockGradientStop => {
        const s = new MockGradientStop(this);
        s.rampPoint = 100;
        this._stops.push(s);
        return s;
      },
    });
  }
  remove(): void {
    this.doc._gradients = this.doc._gradients.filter((g) => g !== this);
    this._dead = true;
  }
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export class MockTag {
  readonly typename = 'Tag';
  private _name = '';
  value = '';
  constructor(private readonly owner: MockItem) {}
  get name(): string {
    return this._name;
  }
  set name(v: string) {
    // Illustrator rejects names with spaces; restrict to identifier-like names.
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) throw new Error(`Invalid tag name: ${v}`);
    this._name = v;
  }
  remove(): void {
    this.owner._tags = this.owner._tags.filter((t) => t !== this);
  }
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

type Container = MockLayer | MockGroupItem | MockCompoundPathItem;

export abstract class MockItem {
  abstract readonly _type: string;
  _dead = false;
  _name = '';
  hidden = false;
  locked = false;
  opacity = 100;
  blendingMode: string = 'NORMAL';
  note = '';
  _selected = false;
  _tags: MockTag[] = [];
  _effects: string[] = [];
  uuid: string = nextUuid();
  parent!: Container;

  protected check(): void {
    if (this._dead) throw new DeadObjectError();
  }
  get typename(): string {
    this.check();
    return this._type;
  }
  get name(): string {
    this.check();
    return this._name;
  }
  set name(v: string) {
    this.check();
    this._name = String(v);
  }
  get selected(): boolean {
    return this._selected;
  }
  set selected(v: boolean) {
    this._selected = v;
  }
  get tags(): MockTag[] & { add(): MockTag; getByName(n: string): MockTag } {
    this.check();
    return Object.assign(this._tags.slice(), {
      add: (): MockTag => {
        const t = new MockTag(this);
        this._tags.push(t);
        return t;
      },
      getByName: (n: string): MockTag => {
        const t = this._tags.find((x) => x.name === n);
        if (!t) throw new Error('No such element');
        return t;
      },
    });
  }
  get layer(): MockLayer {
    let c: Container | MockDocument = this.parent;
    while (c && !(c instanceof MockLayer)) c = (c as MockItem).parent;
    return c as MockLayer;
  }
  get document(): MockDocument {
    return this.layer.document;
  }
  abstract boundsAI(): AIBounds;
  get geometricBounds(): AIBounds {
    this.check();
    return this.boundsAI();
  }
  get visibleBounds(): AIBounds {
    this.check();
    const b = this.boundsAI();
    const sw = this.strokeInset();
    return [b[0] - sw, b[1] + sw, b[2] + sw, b[3] - sw];
  }
  protected strokeInset(): number {
    return 0;
  }
  get position(): [number, number] {
    const b = this.geometricBounds;
    return [b[0], b[1]];
  }
  get width(): number {
    const b = this.geometricBounds;
    return b[2] - b[0];
  }
  get height(): number {
    const b = this.geometricBounds;
    return b[1] - b[3];
  }
  abstract _translate(dx: number, dy: number): void;
  abstract _scale(sx: number, sy: number, cx: number, cy: number): void;
  abstract _rotate(deg: number, cx: number, cy: number): void;

  translate(dx: number, dy: number): void {
    this.check();
    assertEditable(this.parent);
    this._translate(dx, dy);
  }
  resize(sx: number, sy: number, ..._rest: unknown[]): void {
    this.check();
    const b = this.boundsAI();
    this._scale(sx / 100, sy / 100, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  }
  rotate(deg: number, ..._rest: unknown[]): void {
    this.check();
    const b = this.boundsAI();
    this._rotate(deg, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
  }
  applyEffect(xml: string): void {
    this.check();
    if (!this.document.app.supportsApplyEffect) throw new Error('applyEffect is not a function');
    this._effects.push(xml);
  }
  move(rel: MockItem | Container, placement: string): this {
    this.check();
    let target: Container;
    let index: number;
    if (placement === EP.PLACEATBEGINNING || placement === EP.PLACEATEND) {
      target = rel as Container;
      assertEditable(target);
      detach(this);
      index = placement === EP.PLACEATBEGINNING ? 0 : target._items.length;
    } else if (placement === EP.PLACEBEFORE || placement === EP.PLACEAFTER) {
      const other = rel as MockItem;
      if (other === this) return this;
      target = other.parent;
      assertEditable(target);
      detach(this);
      const i = target._items.indexOf(other);
      index = placement === EP.PLACEBEFORE ? i : i + 1;
    } else {
      throw new Error(`Unsupported placement ${placement}`);
    }
    target._items.splice(index, 0, this);
    this.parent = target;
    return this;
  }
  remove(): void {
    this.check();
    detach(this);
    kill(this);
  }
}

function assertEditable(c: Container): void {
  let cur: Container | MockDocument = c;
  while (cur && !(cur instanceof MockDocument)) {
    if (cur instanceof MockLayer && (cur.locked || !cur.visible)) {
      throw new Error(`Target layer cannot be modified (“${cur.name}” is locked or hidden)`);
    }
    cur = (cur as MockItem | MockLayer).parent as Container | MockDocument;
  }
}

function detach(item: MockItem): void {
  const p = item.parent;
  if (p) p._items = p._items.filter((x) => x !== item);
}

function kill(item: MockItem): void {
  item._dead = true;
  if (item instanceof MockGroupItem || item instanceof MockCompoundPathItem) item._items.forEach(kill);
}

type Shape =
  | { kind: 'poly'; pts: Array<[number, number]>; closed: boolean; radius?: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number };

export class MockPathItem extends MockItem {
  readonly _type = 'PathItem';
  shape: Shape = { kind: 'poly', pts: [], closed: false };
  filled = true;
  fillColor: AnyColor = new GrayColor();
  stroked = true;
  strokeColor: AnyColor = Object.assign(new GrayColor(), { gray: 100 });
  strokeWidth = 1;
  private _guides = false;
  clipping = false;

  get guides(): boolean {
    this.check();
    return this._guides;
  }
  set guides(v: boolean) {
    this.check();
    this._guides = v;
  }
  get closed(): boolean {
    return this.shape.kind === 'ellipse' || this.shape.closed;
  }
  setEntirePath(pts: Array<[number, number]>): void {
    this.check();
    this.shape = { kind: 'poly', pts: pts.map((p) => [p[0], p[1]] as [number, number]), closed: false };
  }
  protected strokeInset(): number {
    return this.stroked && !this._guides ? this.strokeWidth / 2 : 0;
  }
  boundsAI(): AIBounds {
    const s = this.shape;
    if (s.kind === 'ellipse') {
      const t = (s.rot * Math.PI) / 180;
      const hw = Math.sqrt((s.rx * Math.cos(t)) ** 2 + (s.ry * Math.sin(t)) ** 2);
      const hh = Math.sqrt((s.rx * Math.sin(t)) ** 2 + (s.ry * Math.cos(t)) ** 2);
      return [s.cx - hw, s.cy + hh, s.cx + hw, s.cy - hh];
    }
    if (s.pts.length === 0) return [0, 0, 0, 0];
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
  }
  _translate(dx: number, dy: number): void {
    const s = this.shape;
    if (s.kind === 'ellipse') {
      s.cx += dx;
      s.cy += dy;
    } else s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
  }
  _scale(sx: number, sy: number, cx: number, cy: number): void {
    const s = this.shape;
    if (s.kind === 'ellipse') {
      // Approximation for rotated ellipses; exact when rot == 0 (how the host uses it).
      s.rx *= sx;
      s.ry *= sy;
      s.cx = cx + (s.cx - cx) * sx;
      s.cy = cy + (s.cy - cy) * sy;
    } else s.pts = s.pts.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
  }
  _rotate(deg: number, cx: number, cy: number): void {
    const s = this.shape;
    if (s.kind === 'ellipse') {
      s.rot += deg;
      return;
    }
    const t = (deg * Math.PI) / 180;
    s.pts = s.pts.map(([x, y]) => [cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t)]);
  }
}

abstract class BoxItem extends MockItem {
  box: AIBounds = [0, 0, 0, 0];
  boundsAI(): AIBounds {
    return [...this.box] as AIBounds;
  }
  _translate(dx: number, dy: number): void {
    this.box = [this.box[0] + dx, this.box[1] + dy, this.box[2] + dx, this.box[3] + dy];
  }
  _scale(sx: number, sy: number, cx: number, cy: number): void {
    const b = this.box;
    this.box = [cx + (b[0] - cx) * sx, cy + (b[1] - cy) * sy, cx + (b[2] - cx) * sx, cy + (b[3] - cy) * sy];
  }
  _rotate(): void {
    /* not modelled */
  }
}

export class MockTextFrame extends BoxItem {
  readonly _type = 'TextFrame';
  contents = '';
  kind: string = ENUMS.TextType.POINTTEXT;
  size = 24;
  fontName = 'MyriadPro-Regular';
  justification: string = ENUMS.Justification.LEFT;
  get textRange(): unknown {
    return {
      characterAttributes: { size: this.size, textFont: { name: this.fontName } },
      paragraphAttributes: { justification: this.justification },
    };
  }
}

export class MockPlacedItem extends BoxItem {
  readonly _type: string = 'PlacedItem';
  file = '/images/photo.jpg';
}

export class MockRasterItem extends BoxItem {
  readonly _type = 'RasterItem';
  embedded = true;
}

function unionBounds(items: MockItem[]): AIBounds {
  if (items.length === 0) return [0, 0, 0, 0];
  const bs = items.map((i) => i.boundsAI());
  return [Math.min(...bs.map((b) => b[0])), Math.max(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.min(...bs.map((b) => b[3]))];
}

function pathCreators(owner: Container): {
  add(): MockPathItem;
  rectangle(top: number, left: number, w: number, h: number): MockPathItem;
  roundedRectangle(top: number, left: number, w: number, h: number, rh?: number, rv?: number): MockPathItem;
  ellipse(top: number, left: number, w: number, h: number): MockPathItem;
} {
  const make = (shape: Shape): MockPathItem => {
    assertEditable(owner);
    const p = new MockPathItem();
    p.shape = shape;
    p.parent = owner;
    owner._items.unshift(p);
    return p;
  };
  const rectPts = (top: number, left: number, w: number, h: number): Array<[number, number]> => [
    [left, top],
    [left + w, top],
    [left + w, top - h],
    [left, top - h],
  ];
  return {
    add: () => make({ kind: 'poly', pts: [], closed: false }),
    rectangle: (top, left, w, h) => make({ kind: 'poly', pts: rectPts(top, left, w, h), closed: true }),
    roundedRectangle: (top, left, w, h, rh = 15) => make({ kind: 'poly', pts: rectPts(top, left, w, h), closed: true, radius: rh }),
    ellipse: (top, left, w, h) => make({ kind: 'ellipse', cx: left + w / 2, cy: top - h / 2, rx: w / 2, ry: h / 2, rot: 0 }),
  };
}

abstract class ContainerItem extends MockItem {
  _items: MockItem[] = [];
  get pageItems(): MockItem[] {
    this.check();
    return this._items.slice();
  }
  get pathItems(): MockPathItem[] & ReturnType<typeof pathCreators> {
    this.check();
    return Object.assign(this._items.filter((i): i is MockPathItem => i instanceof MockPathItem), pathCreators(this as unknown as Container));
  }
  get groupItems(): MockGroupItem[] & { add(): MockGroupItem } {
    this.check();
    return Object.assign(this._items.filter((i): i is MockGroupItem => i instanceof MockGroupItem), {
      add: (): MockGroupItem => {
        assertEditable(this as unknown as Container);
        const g = new MockGroupItem();
        g.parent = this as unknown as Container;
        this._items.unshift(g);
        return g;
      },
    });
  }
  boundsAI(): AIBounds {
    return unionBounds(this._items);
  }
  _translate(dx: number, dy: number): void {
    this._items.forEach((i) => i._translate(dx, dy));
  }
  _scale(sx: number, sy: number, cx: number, cy: number): void {
    this._items.forEach((i) => i._scale(sx, sy, cx, cy));
  }
  _rotate(deg: number, cx: number, cy: number): void {
    this._items.forEach((i) => i._rotate(deg, cx, cy));
  }
}

export class MockGroupItem extends ContainerItem {
  readonly _type = 'GroupItem';
  clipped = false;
}

export class MockCompoundPathItem extends ContainerItem {
  readonly _type = 'CompoundPathItem';
}

// ---------------------------------------------------------------------------
// Layers, artboards, documents
// ---------------------------------------------------------------------------

export class MockLayer {
  readonly typename = 'Layer';
  _dead = false;
  private _name = 'Layer';
  visible = true;
  locked = false;
  printable = true;
  color = 'LIGHTBLUE';
  _items: MockItem[] = [];
  _sublayers: MockLayer[] = [];
  parent: MockDocument | MockLayer;

  constructor(parent: MockDocument | MockLayer, name: string) {
    this.parent = parent;
    this._name = name;
  }
  get document(): MockDocument {
    let p: MockDocument | MockLayer = this.parent;
    while (p instanceof MockLayer) p = p.parent;
    return p;
  }
  get name(): string {
    if (this._dead) throw new DeadObjectError();
    return this._name;
  }
  set name(v: string) {
    this._name = String(v);
  }
  private siblings(): MockLayer[] {
    return this.parent instanceof MockDocument ? this.parent._layers : this.parent._sublayers;
  }
  private setSiblings(list: MockLayer[]): void {
    if (this.parent instanceof MockDocument) this.parent._layers = list;
    else this.parent._sublayers = list;
  }
  get pageItems(): MockItem[] {
    return this._items.slice();
  }
  get pathItems(): MockPathItem[] & ReturnType<typeof pathCreators> {
    return Object.assign(this._items.filter((i): i is MockPathItem => i instanceof MockPathItem), pathCreators(this));
  }
  get groupItems(): MockGroupItem[] & { add(): MockGroupItem } {
    return Object.assign(this._items.filter((i): i is MockGroupItem => i instanceof MockGroupItem), {
      add: (): MockGroupItem => {
        assertEditable(this);
        const g = new MockGroupItem();
        g.parent = this;
        this._items.unshift(g);
        return g;
      },
    });
  }
  get textFrames(): MockTextFrame[] & { add(): MockTextFrame } {
    return Object.assign(
      this._items.filter((i): i is MockTextFrame => i instanceof MockTextFrame),
      {
        add: (): MockTextFrame => {
          assertEditable(this);
          const t = new MockTextFrame();
          t.box = [0, 0, 200, -30];
          t.parent = this;
          this._items.unshift(t);
          return t;
        },
      },
    );
  }
  get layers(): MockLayer[] & { add(): MockLayer } {
    return Object.assign(this._sublayers.slice(), {
      add: (): MockLayer => {
        const l = new MockLayer(this, `Layer ${this._sublayers.length + 1}`);
        this._sublayers.unshift(l);
        return l;
      },
    });
  }
  get hasSelectedArtwork(): boolean {
    return allItems(this._items).some((i) => i._selected);
  }
  move(rel: MockLayer, placement: string): this {
    const list = this.siblings().filter((l) => l !== this);
    const i = list.indexOf(rel);
    if (i < 0) throw new Error('Relative layer must be a sibling');
    list.splice(placement === EP.PLACEBEFORE ? i : i + 1, 0, this);
    this.setSiblings(list);
    return this;
  }
  zOrder(method: string): void {
    const list = this.siblings().filter((l) => l !== this);
    if (method === ENUMS.ZOrderMethod.BRINGTOFRONT) list.unshift(this);
    else if (method === ENUMS.ZOrderMethod.SENDTOBACK) list.push(this);
    else throw new Error(`zOrder ${method} not modelled`);
    this.setSiblings(list);
  }
  remove(): void {
    this.setSiblings(this.siblings().filter((l) => l !== this));
    this._dead = true;
    allItems(this._items).forEach((i) => (i._dead = true));
  }
}

export class MockArtboard {
  readonly typename = 'Artboard';
  name = 'Artboard 1';
  private _rect: AIBounds = [0, 0, 100, -100];
  get artboardRect(): AIBounds {
    return [...this._rect] as AIBounds;
  }
  set artboardRect(r: AIBounds) {
    if (!(r[2] > r[0] && r[1] > r[3])) throw new Error('Invalid artboard rect');
    this._rect = [r[0], r[1], r[2], r[3]];
  }
}

export function allItems(items: MockItem[]): MockItem[] {
  const out: MockItem[] = [];
  const walk = (list: MockItem[]): void => {
    for (const i of list) {
      out.push(i);
      if (i instanceof MockGroupItem || i instanceof MockCompoundPathItem) walk(i._items);
    }
  };
  walk(items);
  return out;
}

export function allLayerItems(layers: MockLayer[]): MockItem[] {
  const out: MockItem[] = [];
  for (const l of layers) {
    out.push(...allItems(l._items));
    out.push(...allLayerItems(l._sublayers));
  }
  return out;
}

export class MockDocument {
  readonly typename = 'Document';
  name: string;
  saved = false;
  fullName = '';
  documentColorSpace: string;
  _layers: MockLayer[] = [];
  _artboards: MockArtboard[] = [];
  _active = 0;
  _gradients: MockGradient[] = [];
  _activeLayer: MockLayer | null = null;
  _undo: string[] = [];
  _redo: string[] = [];
  constructor(
    readonly app: MockApp,
    name: string,
    colorSpace: string,
  ) {
    this.name = name;
    this.documentColorSpace = colorSpace;
  }
  get layers(): MockLayer[] & { add(): MockLayer; getByName(n: string): MockLayer } {
    return Object.assign(this._layers.slice(), {
      add: (): MockLayer => {
        const l = new MockLayer(this, `Layer ${this._layers.length + 1}`);
        this._layers.unshift(l);
        this._activeLayer = l;
        return l;
      },
      getByName: (n: string): MockLayer => {
        const l = this._layers.find((x) => x.name === n);
        if (!l) throw new Error('No such element');
        return l;
      },
    });
  }
  get activeLayer(): MockLayer {
    return this._activeLayer && !this._activeLayer._dead ? this._activeLayer : this._layers[0]!;
  }
  set activeLayer(l: MockLayer) {
    this._activeLayer = l;
  }
  get artboards(): MockArtboard[] & {
    add(r: AIBounds): MockArtboard;
    remove(i: number): void;
    getActiveArtboardIndex(): number;
    setActiveArtboardIndex(i: number): void;
  } {
    return Object.assign(this._artboards.slice(), {
      add: (r: AIBounds): MockArtboard => {
        const a = new MockArtboard();
        a.artboardRect = r;
        a.name = `Artboard ${this._artboards.length + 1}`;
        this._artboards.push(a);
        return a;
      },
      remove: (i: number): void => {
        if (this._artboards.length <= 1) throw new Error('Cannot remove the last artboard');
        this._artboards.splice(i, 1);
        this._active = Math.min(this._active, this._artboards.length - 1);
      },
      getActiveArtboardIndex: (): number => this._active,
      setActiveArtboardIndex: (i: number): void => {
        if (i < 0 || i >= this._artboards.length) throw new Error('Artboard index out of range');
        this._active = i;
      },
    });
  }
  get pageItems(): MockItem[] {
    return allLayerItems(this._layers);
  }
  get pathItems(): MockPathItem[] & ReturnType<typeof pathCreators> {
    return Object.assign(
      this.pageItems.filter((i): i is MockPathItem => i instanceof MockPathItem),
      pathCreators(this.activeLayer),
    );
  }
  get groupItems(): MockGroupItem[] {
    return this.pageItems.filter((i): i is MockGroupItem => i instanceof MockGroupItem);
  }
  get textFrames(): MockTextFrame[] {
    return this.pageItems.filter((i): i is MockTextFrame => i instanceof MockTextFrame);
  }
  get placedItems(): MockPlacedItem[] {
    return this.pageItems.filter((i): i is MockPlacedItem => i instanceof MockPlacedItem);
  }
  get gradients(): MockGradient[] & { add(): MockGradient; getByName(n: string): MockGradient } {
    return Object.assign(this._gradients.slice(), {
      add: (): MockGradient => {
        const g = new MockGradient(this);
        g.name = `Gradient ${this._gradients.length + 1}`;
        this._gradients.push(g);
        return g;
      },
      getByName: (n: string): MockGradient => {
        const g = this._gradients.find((x) => x.name === n);
        if (!g) throw new Error('No such element');
        return g;
      },
    });
  }
  get selection(): unknown {
    if (this.app._textEditing) return { typename: 'TextRange', length: 0 };
    return this.pageItems.filter((i) => i._selected);
  }
  set selection(v: unknown) {
    this.pageItems.forEach((i) => (i._selected = false));
    if (Array.isArray(v)) {
      for (const it of v as MockItem[]) {
        if (it._dead) throw new DeadObjectError();
        if (it.locked || it.hidden) throw new Error('Cannot select locked or hidden art');
        it._selected = true;
      }
    }
  }
  getPageItemFromUuid(u: string): MockItem {
    const it = this.pageItems.find((i) => i.uuid === u);
    if (!it) throw new Error('No such element');
    return it;
  }
  close(_opt?: string): void {
    this.app._docs = this.app._docs.filter((d) => d !== this);
    this.app._activeIndex = Math.max(0, this.app._docs.length - 1);
  }
  /** Installed by the runtime (needs the serialiser and the virtual file system). */
  saveAs(file: { fsName: string }, _opts?: unknown): void {
    this.app._saveHook?.(this, file.fsName);
    this.saved = true;
    this.fullName = file.fsName;
  }
}

export interface MockAppOptions {
  version?: string;
  supportsStopOpacity?: boolean;
  supportsApplyEffect?: boolean;
}

export class MockApp {
  readonly typename = 'Application';
  version: string;
  supportsStopOpacity: boolean;
  supportsApplyEffect: boolean;
  coordinateSystem: string = ENUMS.CoordinateSystem.ARTBOARDCOORDINATESYSTEM;
  userInteractionLevel: string = ENUMS.UserInteractionLevel.DISPLAYALERTS;
  _docs: MockDocument[] = [];
  _activeIndex = 0;
  _textEditing = false;
  /** Installed by the runtime to implement undo/redo. */
  _undoHook: ((dir: 'undo' | 'redo') => void) | null = null;
  _saveHook: ((doc: MockDocument, path: string) => void) | null = null;
  _openHook: ((path: string) => MockDocument) | null = null;
  alerts: string[] = [];
  menuCommands: string[] = [];

  constructor(opts: MockAppOptions = {}) {
    this.version = opts.version ?? '29.0.0';
    this.supportsStopOpacity = opts.supportsStopOpacity ?? true;
    this.supportsApplyEffect = opts.supportsApplyEffect ?? true;
  }
  get documents(): MockDocument[] & { add(cs?: string, w?: number, h?: number): MockDocument } {
    return Object.assign(this._docs.slice(), {
      add: (cs = ENUMS.DocumentColorSpace.RGB, w = 612, h = 792): MockDocument => {
        const d = createDocument(this, `Untitled-${this._docs.length + 1}`, cs, w, h);
        this._activeIndex = this._docs.length - 1;
        return d;
      },
    });
  }
  get activeDocument(): MockDocument {
    const d = this._docs[this._activeIndex];
    if (!d) throw new Error('No such element');
    return d;
  }
  set activeDocument(d: MockDocument) {
    this._activeIndex = this._docs.indexOf(d);
  }
  undo(): void {
    this._undoHook?.('undo');
  }
  redo(): void {
    this._undoHook?.('redo');
  }
  redraw(): void {
    /* no-op */
  }
  executeMenuCommand(cmd: string): void {
    this.menuCommands.push(cmd);
    if (cmd === 'selectall') {
      const d = this._docs[this._activeIndex];
      if (d) d.selection = d.pageItems.filter((i) => !i.locked && !i.hidden && !(i instanceof MockPathItem && i.guides) && i.parent instanceof MockLayer);
    }
  }
  open(file: { fsName: string }): MockDocument {
    if (!this._openHook) throw new Error('open is not available');
    return this._openHook(file.fsName);
  }
}

export class IllustratorSaveOptions {
  readonly typename = 'IllustratorSaveOptions';
}

/** New document: one artboard at the origin (Y-up: top 0, bottom -h), one layer. */
export function createDocument(app: MockApp, name: string, cs: string, w: number, h: number): MockDocument {
  const d = new MockDocument(app, name, cs);
  const ab = new MockArtboard();
  ab.artboardRect = [0, 0, w, -h];
  ab.name = 'Artboard 1';
  d._artboards.push(ab);
  d._layers.push(new MockLayer(d, 'Layer 1'));
  app._docs.push(d);
  return d;
}
