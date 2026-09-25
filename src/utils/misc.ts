export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export function pad(n: number, width: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  return (n < 0 ? '-' : '') + (s.length >= width ? s : '0'.repeat(width - s.length) + s);
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, ms);
  };
  wrapped.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/** Short, collision-resistant id for tagging generated artwork (not crypto). */
export function makeId(prefix = 'af', rand: () => number = Math.random): string {
  const t = Date.now().toString(36).slice(-6);
  let r = '';
  for (let i = 0; i < 6; i++) r += Math.floor(rand() * 36).toString(36);
  return `${prefix}${t}${r}`;
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Remove duplicate numbers within a tolerance, returning a sorted copy. */
export function dedupeSorted(values: readonly number[], tolerance = 0.01): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(v - out[out.length - 1]!) > tolerance) out.push(v);
  }
  return out;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
