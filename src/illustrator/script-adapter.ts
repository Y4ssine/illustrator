/**
 * HostAdapter implementation for any transport that can evaluate an
 * ExtendScript string and return a string: CEP's evalScript today, the
 * in-browser simulator for development and tests. The payload is embedded as
 * an ES3 object literal (JSON with every non-ASCII character escaped).
 */

import { AFError, fromHostError } from '../core/errors';
import type {
  ColorSampling,
  DocumentAdapter,
  HostAdapter,
  HostEventType,
  HostTransaction,
  PreviewController,
  SelectionAdapter,
  StorageAdapter,
  TaggedScan,
} from '../core/host';
import type { Batch, BatchResult, HostError, Ref } from '../core/protocol';
import { normalizeItem, normalizeSnapshot, type HostInfo, type ItemDescriptor, type LayerInfo, type WireItem, type WireSnapshot } from '../core/snapshot';
import { OpBuffer } from '../core/transaction';

export type EvalTransport = (script: string) => Promise<string>;

/** JSON → ES3-safe literal: escapes non-ASCII and U+2028/2029 (illegal in ES3 string literals). */
export function toScriptLiteral(value: unknown): string {
  const json = JSON.stringify(value ?? null);
  return json.replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

export function hostCall(method: string, payload?: unknown): string {
  return `AFHost.call(${toScriptLiteral(method)}, ${toScriptLiteral(payload ?? {})})`;
}

type Envelope<T> = { ok: true; value: T } | { ok: false; error: HostError };

export class ScriptHostAdapter implements HostAdapter {
  readonly kind: 'cep' | 'simulator';
  info: HostInfo | null = null;
  private readonly transport: EvalTransport;
  private readonly listeners = new Map<HostEventType, Set<(data: string) => void>>();
  private previewActive = false;

  constructor(kind: 'cep' | 'simulator', transport: EvalTransport) {
    this.kind = kind;
    this.transport = transport;
  }

  /** Raw call; parses the JSON the host returns. */
  async raw<T>(method: string, payload?: unknown): Promise<T> {
    let text: string;
    try {
      text = await this.transport(hostCall(method, payload));
    } catch (e) {
      throw new AFError('BRIDGE', 'Could not talk to Illustrator.', { details: String(e) });
    }
    if (text === 'EvalScript error.' || text === undefined || text === null || text === '') {
      throw new AFError('BRIDGE', 'The Illustrator host script is not loaded or failed to run. Close and reopen the panel.', {
        details: `method: ${method}\nhost returned: ${String(text)}`,
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AFError('BRIDGE', 'Illustrator returned an unreadable answer.', { details: `method: ${method}\n${text.slice(0, 500)}` });
    }
  }

  private async query<T>(method: string, payload?: unknown): Promise<T> {
    const env = await this.raw<Envelope<T>>(method, payload);
    if (!env.ok) throw fromHostError(env.error);
    return env.value;
  }

  async connect(): Promise<HostInfo> {
    const v = await this.query<HostInfo & { hostScript: string; protocol: number }>('ping');
    this.info = { host: this.kind === 'simulator' ? 'simulator' : 'illustrator', version: v.version, capabilities: v.capabilities };
    return this.info;
  }

  private get uuidOk(): boolean {
    return this.info?.capabilities.uuid ?? false;
  }

  readonly document: DocumentAdapter = {
    snapshot: async (opts) => normalizeSnapshot(await this.query<WireSnapshot>('snapshot', { maxItems: opts?.maxItems ?? 500 }), this.uuidOk),
    signature: () => this.query<string>('signature'),
    layers: async () => {
      const raw = await this.query<Array<{ n: string; v: boolean; l: boolean; p: boolean; c: number; s: number }>>('layers');
      return raw.map((l): LayerInfo => ({ name: l.n, visible: l.v, locked: l.l, printable: l.p, items: l.c, sublayers: l.s }));
    },
    scanTagged: (opts) => this.query<TaggedScan>('scanTagged', { limit: opts?.limit ?? 20000 }),
    findByAfId: async (id: string, near?: Ref): Promise<ItemDescriptor | null> => {
      const w = await this.query<WireItem | null>('findByAfId', { id, near: near ?? null });
      return w ? normalizeItem(w, this.uuidOk) : null;
    },
    sampleColors: (opts) => this.query<ColorSampling>('colors', { limit: opts?.limit ?? 4000 }),
  };

  readonly selection: SelectionAdapter = {
    current: async (opts) => (await this.document.snapshot(opts)).selection,
  };

  readonly storage: StorageAdapter = {
    read: (key) => this.query<string | null>('storage.read', { key }),
    write: async (key, value) => {
      await this.query<boolean>('storage.write', { key, text: value });
    },
    importFile: (title) => this.query<{ name: string; text: string } | null>('storage.import', { title }),
    exportFile: (title, name, text) => this.query<string | null>('storage.export', { title, name, text }),
  };

  readonly preview: PreviewController = ((): PreviewController => {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      async show(batch: Batch) {
        const r = await self.raw<BatchResult>('preview.show', batch);
        self.previewActive = r.ok;
        return r;
      },
      async cancel() {
        self.previewActive = false;
        await self.query<{ reverted: string }>('preview.cancel');
      },
      apply(batch: Batch) {
        self.previewActive = false;
        return self.raw<BatchResult>('preview.apply', batch);
      },
      get active(): boolean {
        return self.previewActive;
      },
    };
  })();

  /** Removes AF preview items left behind by a crashed session. */
  sweepPreview(): Promise<{ removed: number }> {
    return this.query<{ removed: number }>('preview.sweep');
  }

  begin(label: string): HostTransaction {
    return new OpBuffer(label, (b) => this.run(b));
  }

  run(batch: Batch): Promise<BatchResult> {
    return this.raw<BatchResult>('run', batch);
  }

  on(type: HostEventType, handler: (data: string) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  emit(type: HostEventType, data = ''): void {
    for (const h of this.listeners.get(type) ?? []) h(data);
  }
}
