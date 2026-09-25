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
  Transformation: Object.fromEntries(['DOCUMENTORIGIN', 'TOPLEFT', 'LEFT', 'BOTTOMLEFT', 'TOP', 'CENTER', 'BOTTOM', 'TOPRIGHT', 'RIGHT', 'BOTTOMRIGHT'].map((k) => [k, k])) as Record<string, string>,
  PointType: { SMOOTH: 'PointType.SMOOTH', CORNER: 'PointType.CORNER' },
  ParagraphDirectionType: { LEFT_TO_RIGHT_DIRECTION: 'LEFT_TO_RIGHT_DIRECTION', RIGHT_TO_LEFT_DIRECTION: 'RIGHT_TO_LEFT_DIRECTION' },
  ComposerEngineType: { latinCJKComposer: 'latinCJKComposer', optycaComposer: 'optycaComposer', adornment: 'adornment' },
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
// Affine maths (Illustrator space, Y up): x' = a x + c y + tx, y' = b x + d y + ty
// ---------------------------------------------------------------------------

export type Aff = [number, number, number, number, number, number];
export const IDENTITY: Aff = [1, 0, 0, 1, 0, 0];

export function affApply(m: Aff, p: readonly [number, number]): [number, number] {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** m2 ∘ m1 (apply m1 first). */
export function affCompose(m2: Aff, m1: Aff): Aff {
  return [
    m2[0] * m1[0] + m2[2] * m1[1],
    m2[1] * m1[0] + m2[3] * m1[1],
    m2[0] * m1[2] + m2[2] * m1[3],
    m2[1] * m1[2] + m2[3] * m1[3],
    m2[0] * m1[4] + m2[2] * m1[5] + m2[4],
    m2[1] * m1[4] + m2[3] * m1[5] + m2[5],
  ];
}

/** Linear part `lin` applied about pivot (px, py). */
function about(lin: Aff, px: number, py: number): Aff {
  return affCompose([1, 0, 0, 1, px, py], affCompose([lin[0], lin[1], lin[2], lin[3], 0, 0], [1, 0, 0, 1, -px, -py]));
}

function pivotOf(b: AIBounds, how: string | undefined): [number, number] {
  const [l, t, r, bt] = b;
  const cx = (l + r) / 2;
  const cy = (t + bt) / 2;
  switch (how) {
    case 'DOCUMENTORIGIN':
      return [0, 0];
    case 'TOPLEFT':
      return [l, t];
    case 'LEFT':
      return [l, cy];
    case 'BOTTOMLEFT':
      return [l, bt];
    case 'TOP':
      return [cx, t];
    case 'BOTTOM':
      return [cx, bt];
    case 'TOPRIGHT':
      return [r, t];
    case 'RIGHT':
      return [r, cy];
    case 'BOTTOMRIGHT':
      return [r, bt];
    default:
      return [cx, cy];
  }
}

export class MockMatrix {
  readonly typename = 'Matrix';
  mValueA = 1;
  mValueB = 0;
  mValueC = 0;
  mValueD = 1;
  mValueTX = 0;
  mValueTY = 0;
}

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
  /** Apply an affine (AI space) to the geometry (`pos`) and/or the fill gradient (`grad`). */
  abstract _affine(m: Aff, pos: boolean, grad: boolean): void;

  _translate(dx: number, dy: number): void {
    this._affine([1, 0, 0, 1, dx, dy], true, true);
  }

  translate(dx: number, dy: number): void {
    this.check();
    assertEditable(this.parent);
    this._translate(dx, dy);
  }
  resize(sx: number, sy: number, changePositions = true, _fills = true, changeGradients = true, _strokePattern = true, _lineWidths = 100, scaleAbout?: string): void {
    this.check();
    const [px, py] = pivotOf(this.boundsAI(), scaleAbout);
    this._affine(about([sx / 100, 0, 0, sy / 100, 0, 0], px, py), changePositions !== false, changeGradients !== false);
  }
  rotate(deg: number, changePositions = true, _fills = true, changeGradients = true, _strokePattern = true, rotateAbout?: string): void {
    this.check();
    const t = (deg * Math.PI) / 180;
    const [px, py] = pivotOf(this.boundsAI(), rotateAbout);
    this._affine(about([Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0], px, py), changePositions !== false, changeGradients !== false);
  }
  transform(m: MockMatrix, changePositions = true, _fills = true, changeGradients = true, _strokePattern = true, _lineWidths = 100, transformAbout?: string): void {
    this.check();
    const lin: Aff = [m.mValueA, m.mValueB, m.mValueC, m.mValueD, 0, 0];
    const [px, py] = pivotOf(this.boundsAI(), transformAbout);
    const full = affCompose([1, 0, 0, 1, m.mValueTX, m.mValueTY], about(lin, px, py));
    this._affine(full, changePositions !== false, changeGradients !== false);
  }
  applyEffect(xml: string): void {
    this.check();
    if (!this.document.app.supportsApplyEffect) throw new Error('applyEffect is not a function');
    this._effects.push(xml);
  }
  duplicate(rel?: MockItem | Container, placement?: string): MockItem {
    this.check();
    const hook = this.document.app._cloneHook;
    if (!hook) throw new Error('duplicate is not available');
    const copy = hook(this);
    const target = rel ?? this;
    const where = placement ?? EP.PLACEBEFORE;
    let parent: Container;
    let index: number;
    if (where === EP.PLACEATBEGINNING || where === EP.PLACEATEND) {
      parent = target as Container;
      index = where === EP.PLACEATBEGINNING ? 0 : parent._items.length;
    } else {
      const other = target as MockItem;
      parent = other.parent;
      const i = parent._items.indexOf(other);
      index = where === EP.PLACEBEFORE ? i : i + 1;
    }
    assertEditable(parent);
    parent._items.splice(index, 0, copy);
    copy.parent = parent;
    return copy;
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

/** Bezier point in AI space: anchor, in-handle (leftDirection), out-handle (rightDirection). */
export interface BezPt {
  a: [number, number];
  l: [number, number];
  r: [number, number];
  smooth?: boolean;
}

export type Shape =
  | { kind: 'poly'; pts: Array<[number, number]>; closed: boolean }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rot: number }
  | { kind: 'bez'; pts: BezPt[]; closed: boolean };

const KAPPA = 0.5522847498;

export function ellipseToBez(s: Extract<Shape, { kind: 'ellipse' }>): Extract<Shape, { kind: 'bez' }> {
  const t = (s.rot * Math.PI) / 180;
  const rot = (x: number, y: number): [number, number] => [s.cx + x * Math.cos(t) - y * Math.sin(t), s.cy + x * Math.sin(t) + y * Math.cos(t)];
  const { rx, ry } = s;
  const k = KAPPA;
  // Counter-clockwise from the right-most point (Y up).
  const raw: Array<[number, number, number, number, number, number]> = [
    [rx, 0, rx, -ry * k, rx, ry * k],
    [0, ry, rx * k, ry, -rx * k, ry],
    [-rx, 0, -rx, ry * k, -rx, -ry * k],
    [0, -ry, -rx * k, -ry, rx * k, -ry],
  ];
  return { kind: 'bez', closed: true, pts: raw.map(([x, y, lx, ly, ox, oy]) => ({ a: rot(x, y), l: rot(lx, ly), r: rot(ox, oy), smooth: true })) };
}

function roundedRectBez(top: number, left: number, w: number, h: number, rr: number): Extract<Shape, { kind: 'bez' }> {
  const r = Math.max(0, Math.min(rr, w / 2, h / 2));
  const k = r * (1 - KAPPA);
  const L = left;
  const R = left + w;
  const T = top;
  const B = top - h;
  const P = (ax: number, ay: number, lx: number, ly: number, ox: number, oy: number): BezPt => ({ a: [ax, ay], l: [lx, ly], r: [ox, oy] });
  return {
    kind: 'bez',
    closed: true,
    pts: [
      P(L + r, T, L + k, T, L + r, T),
      P(R - r, T, R - r, T, R - k, T),
      P(R, T - r, R, T - k, R, T - r),
      P(R, B + r, R, B + r, R, B + k),
      P(R - r, B, R - k, B, R - r, B),
      P(L + r, B, L + r, B, L + k, B),
      P(L, B + r, L, B + k, L, B + r),
      P(L, T - r, L, T - r, L, T - k),
    ],
  };
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export function bezBounds(pts: BezPt[], closed: boolean): AIBounds {
  if (pts.length === 0) return [0, 0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number): void => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (const p of pts) add(p.a[0], p.a[1]);
  for (let i = 0; i < segs; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    for (let s = 1; s < 16; s++) {
      const t = s / 16;
      add(cubicAt(a.a[0], a.r[0], b.l[0], b.a[0], t), cubicAt(a.a[1], a.r[1], b.l[1], b.a[1], t));
    }
  }
  return [minX, maxY, maxX, minY];
}

/** Is the linear part a rotation times a uniform scale? Returns [angle°, scale] or null. */
function similarity(m: Aff): [number, number] | null {
  const s1 = Math.hypot(m[0], m[1]);
  const s2 = Math.hypot(m[2], m[3]);
  if (Math.abs(s1 - s2) > 1e-6 * Math.max(1, s1)) return null;
  if (Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-6 * Math.max(1, s1 * s1)) return null;
  if (m[0] * m[3] - m[1] * m[2] < 0) return null;
  return [(Math.atan2(m[1], m[0]) * 180) / Math.PI, s1];
}

function transformShape(s: Shape, m: Aff): Shape {
  if (s.kind === 'poly') return { ...s, pts: s.pts.map((p) => affApply(m, p)) };
  if (s.kind === 'bez') return { ...s, pts: s.pts.map((p) => ({ ...p, a: affApply(m, p.a), l: affApply(m, p.l), r: affApply(m, p.r) })) };
  const [cx, cy] = affApply(m, [s.cx, s.cy]);
  const sim = similarity(m);
  if (sim) return { ...s, cx, cy, rx: s.rx * sim[1], ry: s.ry * sim[1], rot: s.rot + sim[0] };
  if (Math.abs(s.rot % 180) < 1e-9 && Math.abs(m[1]) < 1e-12 && Math.abs(m[2]) < 1e-12) {
    return { ...s, cx, cy, rx: s.rx * Math.abs(m[0]), ry: s.ry * Math.abs(m[3]) };
  }
  return transformShape(ellipseToBez(s), m);
}

export class MockPathPoint {
  readonly typename = 'PathPoint';
  constructor(
    private readonly owner: MockPathItem,
    private readonly index: number,
  ) {}
  private pt(): BezPt {
    const s = this.owner.shape;
    if (s.kind !== 'bez') throw new Error('Path point of a non-bezier shape');
    return s.pts[this.index]!;
  }
  get anchor(): [number, number] {
    return [...this.pt().a];
  }
  set anchor(v: [number, number]) {
    this.pt().a = [v[0], v[1]];
  }
  get leftDirection(): [number, number] {
    return [...this.pt().l];
  }
  set leftDirection(v: [number, number]) {
    this.pt().l = [v[0], v[1]];
  }
  get rightDirection(): [number, number] {
    return [...this.pt().r];
  }
  set rightDirection(v: [number, number]) {
    this.pt().r = [v[0], v[1]];
  }
  get pointType(): string {
    return this.pt().smooth ? ENUMS.PointType.SMOOTH : ENUMS.PointType.CORNER;
  }
  set pointType(v: string) {
    this.pt().smooth = v === ENUMS.PointType.SMOOTH;
  }
}

/** Gradient placement: maps gradient space (linear: 0→1 along x; radial: unit circle) to AI space. */
export type GradGeom = Aff;

export class MockPathItem extends MockItem {
  readonly _type = 'PathItem';
  shape: Shape = { kind: 'poly', pts: [], closed: false };
  filled = true;
  private _fill: AnyColor = new GrayColor();
  /** Where the fill gradient sits (set when a GradientColor is assigned). */
  _grad: GradGeom | null = null;
  stroked = true;
  strokeColor: AnyColor = Object.assign(new GrayColor(), { gray: 100 });
  strokeWidth = 1;
  private _guides = false;
  clipping = false;
  evenodd = false;

  get fillColor(): AnyColor {
    return this._fill;
  }
  set fillColor(c: AnyColor) {
    this._fill = c;
    if (c instanceof GradientColor) {
      // Illustrator fits a newly assigned gradient to the object's bounds
      // (a compound path's sub-path: to the compound path's bounds).
      const host = this.parent instanceof MockCompoundPathItem ? this.parent : this;
      const [l, t, r, b] = host.boundsAI();
      const w = Math.max(1e-6, r - l);
      this._grad = c.gradient?.type === ENUMS.GradientType.RADIAL ? [w / 2, 0, 0, w / 2, (l + r) / 2, (t + b) / 2] : [w, 0, 0, w, l, (t + b) / 2];
    } else this._grad = null;
  }
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
  set closed(v: boolean) {
    if (this.shape.kind !== 'ellipse') this.shape.closed = !!v;
  }
  get pathPoints(): MockPathPoint[] & { add(): MockPathPoint } {
    this.check();
    const s = this.shape;
    const n = s.kind === 'ellipse' ? 4 : s.pts.length;
    const list = Array.from({ length: n }, (_, i) => new MockPathPoint(this, i));
    return Object.assign(list, {
      add: (): MockPathPoint => {
        if (this.shape.kind === 'ellipse') this.shape = ellipseToBez(this.shape);
        if (this.shape.kind === 'poly') this.shape = { kind: 'bez', closed: this.shape.closed, pts: this.shape.pts.map((p) => ({ a: p, l: p, r: p })) };
        const sh = this.shape as Extract<Shape, { kind: 'bez' }>;
        sh.pts.push({ a: [0, 0], l: [0, 0], r: [0, 0] });
        return new MockPathPoint(this, sh.pts.length - 1);
      },
    });
  }
  setEntirePath(pts: Array<[number, number]>): void {
    this.check();
    this.shape = { kind: 'poly', pts: pts.map((p) => [p[0], p[1]] as [number, number]), closed: this.shape.kind === 'ellipse' ? true : this.shape.closed };
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
    if (s.kind === 'bez') return bezBounds(s.pts, s.closed);
    if (s.pts.length === 0) return [0, 0, 0, 0];
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
  }
  _affine(m: Aff, pos: boolean, grad: boolean): void {
    if (pos) this.shape = transformShape(this.shape, m);
    if (grad && this._grad) this._grad = affCompose(m, this._grad);
  }
}

abstract class BoxItem extends MockItem {
  box: AIBounds = [0, 0, 0, 0];
  boundsAI(): AIBounds {
    return [...this.box] as AIBounds;
  }
  _affine(m: Aff, pos: boolean): void {
    if (!pos) return;
    const [l, t, r, b] = this.box;
    const c = [affApply(m, [l, t]), affApply(m, [r, t]), affApply(m, [r, b]), affApply(m, [l, b])];
    const xs = c.map((p) => p[0]);
    const ys = c.map((p) => p[1]);
    this.box = [Math.min(...xs), Math.max(...ys), Math.max(...xs), Math.min(...ys)];
  }
}

/** Rough advance width of a string (simulator only; no font metrics). */
export function estimateTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) w += 0.28;
    else if (/[؀-ۿ]/.test(ch)) w += 0.46;
    else if (/[0-9]/.test(ch)) w += 0.56;
    else if (/[A-Z]/.test(ch)) w += 0.64;
    else if (/[a-z]/.test(ch)) w += 0.5;
    else w += 0.55;
  }
  return w * size;
}

export class MockTextFrame extends BoxItem {
  readonly _type = 'TextFrame';
  contents = '';
  kind: string = ENUMS.TextType.POINTTEXT;
  size = 24;
  fontName = 'MyriadPro-Regular';
  justification: string = ENUMS.Justification.LEFT;
  textColor: AnyColor = Object.assign(new GrayColor(), { gray: 100 });
  textStroke: AnyColor = new NoColor();
  textStrokeWeight = 0;
  leading: number | null = null;
  tracking = 0;
  direction: string = ENUMS.ParagraphDirectionType.LEFT_TO_RIGHT_DIRECTION;
  composer: string = ENUMS.ComposerEngineType.latinCJKComposer;
  /** Point text created by textFrames.pointText(): baseline anchor (AI space). */
  anchor: [number, number] | null = null;

  get lines(): string[] {
    return this.contents.split(/\r\n|\r|\n/);
  }
  get lineHeight(): number {
    return this.leading ?? this.size * 1.2;
  }
  boundsAI(): AIBounds {
    if (!this.anchor) return [...this.box] as AIBounds;
    const w = Math.max(...this.lines.map((l) => estimateTextWidth(l, this.size)), 1);
    const [ax, ay] = this.anchor;
    const left = this.justification === ENUMS.Justification.RIGHT ? ax - w : this.justification === ENUMS.Justification.CENTER ? ax - w / 2 : ax;
    const top = ay + this.size * 0.78;
    const bottom = ay - this.size * 0.22 - (this.lines.length - 1) * this.lineHeight;
    return [left, top, left + w, bottom];
  }
  _affine(m: Aff, pos: boolean): void {
    if (!pos) return;
    if (this.anchor) {
      const sy = Math.hypot(m[2], m[3]);
      this.anchor = affApply(m, this.anchor);
      this.size *= sy;
      if (this.leading !== null) this.leading *= sy;
    } else super._affine(m, pos);
  }
  get textRange(): { characterAttributes: Record<string, unknown>; paragraphAttributes: Record<string, unknown>; contents: string } {
    this.check();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const tf = this;
    const app = this.document.app;
    const characterAttributes = {
      get size(): number {
        return tf.size;
      },
      set size(v: number) {
        tf.size = v;
      },
      get fillColor(): AnyColor {
        return tf.textColor;
      },
      set fillColor(v: AnyColor) {
        tf.textColor = v;
      },
      get strokeColor(): AnyColor {
        return tf.textStroke;
      },
      set strokeColor(v: AnyColor) {
        tf.textStroke = v;
      },
      get strokeWeight(): number {
        return tf.textStrokeWeight;
      },
      set strokeWeight(v: number) {
        tf.textStrokeWeight = v;
      },
      get textFont(): { name: string } {
        return { name: tf.fontName };
      },
      set textFont(v: { name: string }) {
        if (!v || !app.fonts.includes(v.name)) throw new Error('Invalid font');
        tf.fontName = v.name;
      },
      get autoLeading(): boolean {
        return tf.leading === null;
      },
      set autoLeading(v: boolean) {
        if (v) tf.leading = null;
        else if (tf.leading === null) tf.leading = tf.size * 1.2;
      },
      get leading(): number {
        return tf.lineHeight;
      },
      set leading(v: number) {
        tf.leading = v;
      },
      get tracking(): number {
        return tf.tracking;
      },
      set tracking(v: number) {
        tf.tracking = v;
      },
    };
    const paragraphAttributes = {
      get justification(): string {
        return tf.justification;
      },
      set justification(v: string) {
        if (!v) throw new Error('Invalid justification');
        tf.justification = v;
      },
      get paragraphDirection(): string {
        return tf.direction;
      },
      set paragraphDirection(v: string) {
        if (!v) throw new Error('Invalid direction');
        tf.direction = v;
      },
      get composerEngine(): string {
        return tf.composer;
      },
      set composerEngine(v: string) {
        if (!v) throw new Error('Invalid composer');
        tf.composer = v;
      },
    };
    return { characterAttributes, paragraphAttributes, contents: this.contents };
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
    roundedRectangle: (top, left, w, h, rh = 15) => make(roundedRectBez(top, left, w, h, rh)),
    ellipse: (top, left, w, h) => make({ kind: 'ellipse', cx: left + w / 2, cy: top - h / 2, rx: w / 2, ry: h / 2, rot: 0 }),
  };
}

function textCreators(owner: MockLayer | MockGroupItem): {
  add(): MockTextFrame;
  pointText(anchor: [number, number]): MockTextFrame;
  areaText(path: MockPathItem): MockTextFrame;
} {
  const make = (): MockTextFrame => {
    assertEditable(owner);
    const t = new MockTextFrame();
    t.parent = owner;
    owner._items.unshift(t);
    return t;
  };
  return {
    add: () => {
      const t = make();
      t.box = [0, 0, 200, -30];
      return t;
    },
    pointText: (anchor) => {
      const t = make();
      t.anchor = [anchor[0], anchor[1]];
      return t;
    },
    areaText: (path) => {
      const t = make();
      t.kind = ENUMS.TextType.AREATEXT;
      t.box = path.boundsAI();
      // The path becomes the text frame's container.
      path.remove();
      return t;
    },
  };
}

function compoundCreators(owner: MockLayer | MockGroupItem): { add(): MockCompoundPathItem } {
  return {
    add: () => {
      assertEditable(owner);
      const c = new MockCompoundPathItem();
      c.parent = owner;
      owner._items.unshift(c);
      return c;
    },
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
  get textFrames(): MockTextFrame[] & ReturnType<typeof textCreators> {
    this.check();
    return Object.assign(this._items.filter((i): i is MockTextFrame => i instanceof MockTextFrame), textCreators(this as unknown as MockGroupItem));
  }
  get compoundPathItems(): MockCompoundPathItem[] & ReturnType<typeof compoundCreators> {
    this.check();
    return Object.assign(this._items.filter((i): i is MockCompoundPathItem => i instanceof MockCompoundPathItem), compoundCreators(this as unknown as MockGroupItem));
  }
  boundsAI(): AIBounds {
    return unionBounds(this._items);
  }
  _affine(m: Aff, pos: boolean, grad: boolean): void {
    this._items.forEach((i) => i._affine(m, pos, grad));
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
  get textFrames(): MockTextFrame[] & ReturnType<typeof textCreators> {
    return Object.assign(this._items.filter((i): i is MockTextFrame => i instanceof MockTextFrame), textCreators(this));
  }
  get compoundPathItems(): MockCompoundPathItem[] & ReturnType<typeof compoundCreators> {
    return Object.assign(this._items.filter((i): i is MockCompoundPathItem => i instanceof MockCompoundPathItem), compoundCreators(this));
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

export class MockSwatch {
  readonly typename = 'Swatch';
  name = 'Swatch';
  color: AnyColor = new GrayColor();
  _dead = false;
  constructor(readonly doc: MockDocument) {}
  remove(): void {
    this.doc._swatches = this.doc._swatches.filter((x) => x !== this);
    for (const g of this.doc._swatchGroups) g._swatches = g._swatches.filter((x) => x !== this);
    this._dead = true;
  }
}

export class MockSwatchGroup {
  readonly typename = 'SwatchGroup';
  name = 'Group';
  _swatches: MockSwatch[] = [];
  _dead = false;
  constructor(readonly doc: MockDocument) {}
  addSwatch(sw: MockSwatch): void {
    if (!this._swatches.includes(sw)) this._swatches.push(sw);
  }
  getAllSwatches(): MockSwatch[] {
    return this._swatches.slice();
  }
  remove(): void {
    this.doc._swatchGroups = this.doc._swatchGroups.filter((x) => x !== this);
    this._dead = true;
  }
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
  _swatches: MockSwatch[] = [];
  _swatchGroups: MockSwatchGroup[] = [];
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
  get compoundPathItems(): MockCompoundPathItem[] {
    return this.pageItems.filter((i): i is MockCompoundPathItem => i instanceof MockCompoundPathItem);
  }
  get swatches(): MockSwatch[] & { add(): MockSwatch; getByName(n: string): MockSwatch } {
    return Object.assign(this._swatches.slice(), {
      add: (): MockSwatch => {
        const sw = new MockSwatch(this);
        this._swatches.push(sw);
        return sw;
      },
      getByName: (n: string): MockSwatch => {
        const sw = this._swatches.find((x) => x.name === n);
        if (!sw) throw new Error('No such element');
        return sw;
      },
    });
  }
  get swatchGroups(): MockSwatchGroup[] & { add(): MockSwatchGroup; getByName(n: string): MockSwatchGroup } {
    return Object.assign(this._swatchGroups.slice(), {
      add: (): MockSwatchGroup => {
        const g = new MockSwatchGroup(this);
        this._swatchGroups.push(g);
        return g;
      },
      getByName: (n: string): MockSwatchGroup => {
        const g = this._swatchGroups.find((x) => x.name === n);
        if (!g) throw new Error('No such element');
        return g;
      },
    });
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
  /** Installed by the runtime: deep copy of an item (new uuid), not yet attached. */
  _cloneHook: ((item: MockItem) => MockItem) | null = null;
  /** Installed fonts (PostScript names). */
  fonts: string[] = ['MyriadPro-Regular', 'MyriadPro-Bold', 'ArialMT', 'Arial-BoldMT', 'Tajawal-Regular', 'Tajawal-Bold', 'Tajawal-ExtraBold', 'Cairo-Regular', 'Cairo-Bold'];
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
  get textFonts(): Array<{ name: string }> & { getByName(n: string): { typename: string; name: string; family: string; style: string } } {
    return Object.assign(
      this.fonts.map((name) => ({ name })),
      {
        getByName: (n: string) => {
          if (!this.fonts.includes(n)) throw new Error('No such element');
          const [family, style] = n.split('-');
          return { typename: 'TextFont', name: n, family: family ?? n, style: style ?? 'Regular' };
        },
      },
    );
  }
  getIdentityMatrix(): MockMatrix {
    return new MockMatrix();
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
