/**
 * Minimal op recorder used by the creative engines, so they can be unit-tested
 * without a host and appended to any transaction.
 */

import type { HostOp, Ref } from './protocol';

export type OpRef = Extract<Ref, { k: 'op' }>;

export interface OpSink {
  push(op: HostOp): OpRef;
}

export class ArraySink implements OpSink {
  readonly ops: HostOp[] = [];
  constructor(private readonly base = 0) {}
  push(op: HostOp): OpRef {
    this.ops.push(op);
    return { k: 'op', i: this.base + this.ops.length - 1 };
  }
}

/** Short stable hash (FNV-1a) used to name reusable gradients. */
export function shortHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
