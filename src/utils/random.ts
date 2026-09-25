/**
 * Deterministic pseudo-random numbers. Same seed => same sequence, on every
 * machine and every Illustrator version, because nothing here touches
 * Math.random(). Used by the (Phase 2) randomizer, scatter and packing engines.
 *
 * Algorithm: mulberry32 (public-domain, 32-bit state). Seeds given as strings
 * are hashed with FNV-1a so designers can type memorable seeds ("founding-day").
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Symmetric jitter in [-amount, +amount] shaped by a distribution. */
  jitter(amount: number, distribution?: Distribution): number;
}

export type Distribution = 'uniform' | 'gaussian' | 'centered' | 'edge';

export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string | number): Rng {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    jitter: (amount, distribution = 'uniform') => amount * shaped(next, distribution),
  };
  return rng;
}

/** Returns a value in [-1, 1] with the requested shape. */
function shaped(next: () => number, d: Distribution): number {
  switch (d) {
    case 'uniform':
      return next() * 2 - 1;
    case 'gaussian': {
      // Irwin–Hall approximation (sum of 4 uniforms), scaled to [-1, 1].
      const s = next() + next() + next() + next();
      return (s - 2) / 2;
    }
    case 'centered': {
      // Triangular distribution peaking at 0.
      return next() - next();
    }
    case 'edge': {
      // Mass pushed toward ±1.
      const u = next() * 2 - 1;
      return Math.sign(u) * Math.sqrt(Math.abs(u));
    }
  }
}
