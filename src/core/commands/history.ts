/**
 * Plugin operation history (separate from Illustrator's Undo). Clicking an
 * entry re-opens the command with the same parameters; it never re-runs a
 * destructive operation blindly.
 */

export interface HistoryEntry {
  id: string;
  commandId: string;
  title: string;
  summary: string;
  params: unknown;
  at: number;
}

export const HISTORY_LIMIT = 10;

export class History {
  private entries: HistoryEntry[] = [];

  constructor(initial: readonly HistoryEntry[] = []) {
    this.entries = initial.slice(0, HISTORY_LIMIT);
  }

  push(e: Omit<HistoryEntry, 'id' | 'at'> & { at?: number }): HistoryEntry {
    const entry: HistoryEntry = { ...e, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: e.at ?? Date.now() };
    this.entries = [entry, ...this.entries].slice(0, HISTORY_LIMIT);
    return entry;
  }

  list(): readonly HistoryEntry[] {
    return this.entries;
  }

  last(): HistoryEntry | undefined {
    return this.entries[0];
  }

  clear(): void {
    this.entries = [];
  }

  /** Replace the contents (e.g. with entries loaded from disk). */
  load(raw: unknown): void {
    this.entries = History.fromJSON(raw).entries;
  }

  toJSON(): HistoryEntry[] {
    return this.entries;
  }

  static fromJSON(raw: unknown): History {
    if (!Array.isArray(raw)) return new History();
    const ok = raw.filter(
      (e): e is HistoryEntry =>
        !!e && typeof e === 'object' && typeof (e as HistoryEntry).commandId === 'string' && typeof (e as HistoryEntry).title === 'string',
    );
    return new History(ok);
  }
}
