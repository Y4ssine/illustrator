/**
 * Simulated ExtendScript runtime: loads the real host script into a scope
 * that exposes the mock DOM as globals, and evaluates strings exactly like
 * CEP's evalScript (string in, string out, "EvalScript error." on exceptions).
 *
 * Undo model: every evaluation that changes the active document records one
 * undo step (Illustrator records a script run as one step). Selection-only
 * changes do not create steps. app.undo()/redo() inside a script move the
 * baseline so the rest of that script becomes its own step.
 */

import * as dom from './mock-dom';
import { cloneItem, restoreDoc, serializeDoc, type DocJSON } from './serialize';

export interface SimFileSystem {
  files: Map<string, string>;
  folders: Set<string>;
  /** Answer for File.openDialog / saveDlg (null = user cancelled). */
  openDialogResult: string | null;
  saveDialogResult: string | null;
}

export interface RuntimeOptions extends dom.MockAppOptions {
  fs?: Partial<SimFileSystem>;
  /** Persist storage writes (e.g. to localStorage in the browser). */
  onWrite?: (path: string, text: string) => void;
}

export class SimRuntime {
  readonly app: dom.MockApp;
  readonly fs: SimFileSystem;
  readonly log: string[] = [];
  private readonly evalInScope: (code: string) => unknown;
  private baseline: string | null = null;
  private baselineDoc: dom.MockDocument | null = null;
  private readonly onWrite: ((path: string, text: string) => void) | undefined;

  constructor(hostSource: string, opts: RuntimeOptions = {}) {
    this.app = new dom.MockApp(opts);
    this.onWrite = opts.onWrite;
    this.fs = {
      files: opts.fs?.files ?? new Map(),
      folders: opts.fs?.folders ?? new Set(['/sim/userData', '/sim/Documents', '/sim/tmp']),
      openDialogResult: opts.fs?.openDialogResult ?? null,
      saveDialogResult: opts.fs?.saveDialogResult ?? null,
    };
    this.app._undoHook = (dir) => this.undoRedo(dir);
    this.app._cloneHook = (item) => cloneItem(item);
    this.app._saveHook = (doc, path) => {
      const json = serializeDoc(doc, false);
      json.saved = true;
      this.fs.files.set(path, JSON.stringify(json));
    };
    this.app._openHook = (path) => {
      const raw = this.fs.files.get(path);
      if (!raw) throw new Error(`File not found: ${path}`);
      const json = JSON.parse(raw) as DocJSON;
      const d = dom.createDocument(this.app, path.split('/').pop() ?? json.name, json.cs, 10, 10);
      restoreDoc(d, { ...json, name: path.split('/').pop() ?? json.name }, false);
      this.app._activeIndex = this.app._docs.indexOf(d);
      return d;
    };
    const globals = this.globals();
    const names = Object.keys(globals);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(...names, `${hostSource}\n;return function (__code) { return eval(__code); };`) as (...args: unknown[]) => (code: string) => unknown;
    this.evalInScope = factory(...names.map((n) => globals[n]));
  }

  /** CEP-compatible evalScript. */
  evalScript(code: string): string {
    const doc = this.activeDoc();
    this.baselineDoc = doc;
    this.baseline = doc ? stateKey(doc) : null;
    const before = doc ? serializeDoc(doc) : null;
    let result: string;
    try {
      const r = this.evalInScope(code);
      result = r === undefined ? 'undefined' : String(r);
    } catch (e) {
      this.log.push(`EvalScript error: ${(e as Error).message}`);
      result = 'EvalScript error.';
    }
    // Record an undo step if the (same) document changed.
    const after = this.baselineDoc && this.activeDoc() === this.baselineDoc ? stateKey(this.baselineDoc) : null;
    if (this.baselineDoc && after !== null && this.baseline !== null && after !== this.baseline) {
      this.baselineDoc._undo.push(this.baselineSnapshot ?? JSON.stringify(before));
      this.baselineDoc._redo = [];
    }
    this.baselineSnapshot = null;
    return result;
  }

  private baselineSnapshot: string | null = null;

  private activeDoc(): dom.MockDocument | null {
    return this.app._docs[this.app._activeIndex] ?? null;
  }

  private undoRedo(dir: 'undo' | 'redo'): void {
    const doc = this.activeDoc();
    if (!doc) return;
    const from = dir === 'undo' ? doc._undo : doc._redo;
    const to = dir === 'undo' ? doc._redo : doc._undo;
    const state = from.pop();
    if (!state) return;
    to.push(JSON.stringify(serializeDoc(doc)));
    restoreDoc(doc, JSON.parse(state) as DocJSON);
    // Changes made after this point in the current script form a new step.
    if (doc === this.baselineDoc) {
      this.baseline = stateKey(doc);
      this.baselineSnapshot = JSON.stringify(serializeDoc(doc));
    }
  }

  /** Simulate File › Save As, Close and Open (uuids are regenerated on open). */
  saveCloseReopen(doc: dom.MockDocument = this.activeDoc()!): dom.MockDocument {
    const json = serializeDoc(doc, false);
    json.saved = true;
    doc.close();
    const reopened = dom.createDocument(this.app, json.name, json.cs, 10, 10);
    restoreDoc(reopened, json, false);
    this.app._activeIndex = this.app._docs.indexOf(reopened);
    return reopened;
  }

  private globals(): Record<string, unknown> {
    const rt = this;
    const fs = this.fs;
    class File {
      fsName: string;
      name: string;
      encoding = 'UTF-8';
      lineFeed = 'Unix';
      private mode: string | null = null;
      private buffer = '';
      constructor(path: string) {
        this.fsName = String(path);
        this.name = this.fsName.split('/').pop() ?? '';
      }
      get exists(): boolean {
        return fs.files.has(this.fsName);
      }
      open(mode: string): boolean {
        this.mode = mode;
        this.buffer = mode === 'r' ? (fs.files.get(this.fsName) ?? '') : '';
        return mode !== 'r' || fs.files.has(this.fsName);
      }
      read(): string {
        return this.buffer;
      }
      write(s: string): boolean {
        this.buffer += s;
        return true;
      }
      close(): boolean {
        if (this.mode === 'w') {
          fs.files.set(this.fsName, this.buffer);
          rt.onWrite?.(this.fsName, this.buffer);
        }
        this.mode = null;
        return true;
      }
      remove(): boolean {
        return fs.files.delete(this.fsName);
      }
      rename(newName: string): boolean {
        const dir = this.fsName.slice(0, this.fsName.lastIndexOf('/'));
        const dest = `${dir}/${newName}`;
        const data = fs.files.get(this.fsName);
        if (data === undefined) return false;
        fs.files.delete(this.fsName);
        fs.files.set(dest, data);
        rt.onWrite?.(dest, data);
        this.fsName = dest;
        this.name = newName;
        return true;
      }
      saveDlg(): File | null {
        return fs.saveDialogResult ? new File(fs.saveDialogResult) : null;
      }
      static openDialog(): File | null {
        return fs.openDialogResult ? new File(fs.openDialogResult) : null;
      }
    }
    class Folder {
      fsName: string;
      static userData = '/sim/userData';
      static myDocuments = new Folder('/sim/Documents');
      static temp = new Folder('/sim/tmp');
      static desktop = new Folder('/sim/Desktop');
      constructor(path: string | Folder) {
        this.fsName = typeof path === 'string' ? path : path.fsName;
      }
      get exists(): boolean {
        return fs.folders.has(this.fsName);
      }
      create(): boolean {
        fs.folders.add(this.fsName);
        return true;
      }
      toString(): string {
        return this.fsName;
      }
    }
    // Folder.userData is a Folder object in ExtendScript; string concatenation uses its path.
    (Folder as unknown as { userData: unknown }).userData = new Folder('/sim/userData');
    return {
      app: this.app,
      $: { os: 'Macintosh OS 14.0 (simulated)', writeln: (s: string) => rt.log.push(String(s)), global: {} },
      File,
      Folder,
      RGBColor: dom.RGBColor,
      CMYKColor: dom.CMYKColor,
      GrayColor: dom.GrayColor,
      NoColor: dom.NoColor,
      GradientColor: dom.GradientColor,
      IllustratorSaveOptions: dom.IllustratorSaveOptions,
      alert: (s: string) => rt.app.alerts.push(String(s)),
      confirm: () => true,
      ...dom.ENUMS,
    };
  }
}

/** Document state without selection flags (selection changes are not undo steps). */
function stateKey(doc: dom.MockDocument): string {
  return JSON.stringify(serializeDoc(doc, false));
}
