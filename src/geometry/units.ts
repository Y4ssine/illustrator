/**
 * Unit conversion. Illustrator's scripting DOM always speaks points.
 * In RGB/web documents Illustrator treats 1 px == 1 pt, so "px" here means
 * Illustrator pixels, not device pixels.
 */

export type Unit = 'px' | 'pt' | 'mm' | 'cm' | 'in';

export const UNITS: readonly Unit[] = ['px', 'pt', 'mm', 'cm', 'in'];

const POINTS_PER: Record<Unit, number> = {
  px: 1,
  pt: 1,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
};

export function toPoints(value: number, unit: Unit): number {
  return value * POINTS_PER[unit];
}

export function fromPoints(points: number, unit: Unit): number {
  return points / POINTS_PER[unit];
}

/** Sensible display precision per unit. */
export function unitPrecision(unit: Unit): number {
  switch (unit) {
    case 'px':
    case 'pt':
      return 1;
    case 'mm':
      return 1;
    case 'cm':
      return 2;
    case 'in':
      return 3;
  }
}

export function formatLength(points: number, unit: Unit, precision = unitPrecision(unit)): string {
  const v = fromPoints(points, unit);
  const f = 10 ** precision;
  const rounded = Math.round(v * f) / f;
  return `${Object.is(rounded, -0) ? 0 : rounded} ${unit}`;
}

/**
 * Parse a user-typed length such as "24", "24px", "5 mm", "1.5in".
 * A bare number is interpreted in `defaultUnit`. Returns points, or null.
 */
export function parseLength(input: string, defaultUnit: Unit): number | null {
  const m = /^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(px|pt|mm|cm|in)?\s*$/i.exec(input);
  if (!m) return null;
  const value = parseFloat(m[1]!);
  const unit = (m[2]?.toLowerCase() as Unit | undefined) ?? defaultUnit;
  return toPoints(value, unit);
}
