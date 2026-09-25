/**
 * AppController — glue between the UI, the command runner and the host.
 * Holds no Illustrator knowledge; everything goes through HostAdapter.
 */

import { classifySelection, type SelectionContext } from '../core/context';
import { AFError, describeUnknown } from '../core/errors';
import type { HostAdapter, TaggedScan } from '../core/host';
import { mergeSettings, DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { DocumentSnapshot, HostInfo } from '../core/snapshot';
import { History, type HistoryEntry } from '../core/commands/history';
import { CommandRegistry } from '../core/commands/registry';
import { CommandRunner } from '../core/commands/runner';
import type { AnyCommand, CommandResult, DocumentCommand } from '../core/commands/types';
import { DOCUMENT_COMMANDS } from '../core/commands/all';
import { PresetStore } from '../presets/store';
import { PRESET_KINDS } from '../presets/models';
import { debounce } from '../utils/misc';
import { confirmDialog, ToastHost } from './components/overlays';

export type TabId = 'home' | 'grid' | 'align' | 'shadow' | 'layers' | 'presets' | 'settings';

export interface AppState {
  connected: boolean;
  info: HostInfo | null;
  snapshot: DocumentSnapshot | null;
  context: SelectionContext | null;
  tab: TabId;
  busy: string | null;
  previewing: string | null;
  scan: TaggedScan | null;
  error: string | null;
  /** Bumped whenever settings or presets change so views re-read them. */
  settingsVersion: number;
}

type Listener = (s: AppState, changed: Set<keyof AppState>) => void;

export interface AppEnv {
  host: HostAdapter;
  root: HTMLElement;
  /** Remove leftovers of an interrupted preview (adapter-specific). */
  sweepPreview?: () => Promise<{ removed: number }>;
}

export class AppController {
  readonly host: HostAdapter;
  readonly presets: PresetStore;
  readonly registry = new CommandRegistry();
  readonly toasts = new ToastHost();
  readonly root: HTMLElement;
  readonly history = new History();
  settings: Settings = { ...DEFAULT_SETTINGS };
  readonly runner: CommandRunner;
  private readonly env: AppEnv;
  private state: AppState = { connected: false, info: null, snapshot: null, context: null, tab: 'home', busy: null, previewing: null, scan: null, error: null, settingsVersion: 0 };
  private listeners = new Set<Listener>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSig = '';
  private pollFailures = 0;
  /** Parameters last used per command (so views and "repeat" reuse them). */
  readonly lastParams = new Map<string, unknown>();
  /** Views register a handler to receive params from history/palette. */
  private openHandlers = new Map<string, (params: unknown) => void>();

  constructor(env: AppEnv) {
    this.env = env;
    this.host = env.host;
    this.root = env.root;
    this.presets = new PresetStore(env.host.storage);
    this.registry.register(...DOCUMENT_COMMANDS, ...this.uiCommands());
    this.presets.onChange(() => this.bumpSettings());
    this.runner = new CommandRunner({
      host: this.host,
      presets: this.presets,
      history: this.history,
      settings: () => this.settings,
      confirm: (req) => confirmDialog(this.root, req),
      onCommitted: () => void this.persistHistory(),
    });
  }

  // ---- state -----------------------------------------------------------------

  get s(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<AppState>): void {
    const changed = new Set<keyof AppState>();
    for (const k of Object.keys(patch) as Array<keyof AppState>) {
      if (this.state[k] !== patch[k]) changed.add(k);
    }
    if (changed.size === 0) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state, changed);
  }

  // ---- lifecycle ---------------------------------------------------------------

  async start(): Promise<void> {
    try {
      const info = await this.host.connect();
      this.set({ connected: true, info, error: null });
    } catch (e) {
      const err = describeUnknown(e);
      this.set({ connected: false, error: err.message });
      this.toasts.show({ kind: 'error', message: err.message, details: err.details });
      return;
    }
    await this.loadPersisted();
    this.host.on('documentChanged', () => void this.refresh(true));
    this.host.on('hostCommand', (data) => void this.handleHostCommand(data));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.refresh(true);
    });
    await this.refresh(true);
    void this.scanDocument(true);
    this.schedulePoll();
  }

  private async loadPersisted(): Promise<void> {
    try {
      const raw = await this.host.storage.read('settings');
      this.settings = mergeSettings(raw ? JSON.parse(raw) : null);
    } catch {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    try {
      const raw = await this.host.storage.read('history');
      this.history.load(raw ? JSON.parse(raw) : []);
    } catch {
      /* start with empty history */
    }
    try {
      await this.presets.loadAll(PRESET_KINDS);
    } catch (e) {
      this.toasts.show({ kind: 'warn', message: 'Your presets could not be loaded; built-in presets are available.', details: String(e) });
    }
    document.documentElement.dataset['density'] = this.settings.density;
  }

  async saveSettings(patch: Partial<Settings>): Promise<void> {
    this.settings = { ...this.settings, ...patch };
    document.documentElement.dataset['density'] = this.settings.density;
    this.bumpSettings();
    try {
      await this.host.storage.write('settings', JSON.stringify(this.settings, null, 2));
    } catch (e) {
      this.toasts.show({ kind: 'warn', message: 'Settings could not be saved to disk.', details: String(e) });
    }
  }

  bumpSettings(): void {
    this.set({ settingsVersion: this.state.settingsVersion + 1 });
  }

  private async persistHistory(): Promise<void> {
    try {
      await this.host.storage.write('history', JSON.stringify(this.history.toJSON()));
    } catch {
      /* history is a convenience */
    }
  }

  // ---- polling (Illustrator has no selection-change event for CEP panels) ----

  private schedulePoll(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    const delay = this.pollFailures > 3 ? 4000 : this.settings.pollInterval;
    this.pollTimer = setTimeout(() => void this.poll(), delay);
  }

  private async poll(): Promise<void> {
    try {
      if (document.visibilityState === 'visible' && !this.state.busy && !this.runner.isBusy) {
        const t0 = performance.now();
        const sig = await this.host.document.signature();
        const dt = performance.now() - t0;
        this.pollFailures = 0;
        if (sig !== this.lastSig) await this.refresh(false);
        // Back off if the host is slow (very large documents).
        if (dt > 150) this.pollFailures = 2;
      }
    } catch {
      this.pollFailures++;
    } finally {
      this.schedulePoll();
    }
  }

  async refresh(force = false): Promise<void> {
    try {
      const snap = await this.host.document.snapshot();
      if (!force && snap.signature === this.lastSig) return;
      const docChanged = (this.state.snapshot?.doc?.name ?? null) !== (snap.doc?.name ?? null);
      this.lastSig = snap.signature;
      this.set({ snapshot: snap, context: classifySelection(snap), connected: true, error: null });
      if (docChanged) void this.scanDocument(true);
      if (this.state.previewing && this.host.preview.active === false) this.set({ previewing: null });
    } catch (e) {
      const err = describeUnknown(e);
      this.set({ error: err.message });
    }
  }

  async scanDocument(quiet = false): Promise<void> {
    if (!this.state.snapshot?.doc && quiet) {
      this.set({ scan: null });
      return;
    }
    try {
      const scan = await this.host.document.scanTagged({ limit: 20000 });
      this.set({ scan });
    } catch (e) {
      if (!quiet) this.reportError(e);
    }
  }

  // ---- commands ------------------------------------------------------------------

  command(id: string): AnyCommand | undefined {
    return this.registry.get(id);
  }

  defaultParams(cmd: AnyCommand): unknown {
    return cmd.defaultParams({ settings: this.settings, presets: this.presets });
  }

  async run(id: string, params?: unknown, opts: { confirmed?: boolean; quiet?: boolean } = {}): Promise<CommandResult | null> {
    const cmd = this.registry.get(id);
    if (!cmd) {
      this.toasts.show({ kind: 'error', message: `Unknown command “${id}”.` });
      return null;
    }
    const p = params ?? this.lastParams.get(id) ?? this.defaultParams(cmd);
    if (cmd.kind === 'ui') {
      await cmd.run(p);
      return null;
    }
    this.set({ busy: cmd.title });
    try {
      const res = await this.runner.run(cmd, p, opts);
      this.lastParams.set(id, p);
      if (res.committed) {
        this.remember(id);
        this.set({ previewing: null });
      }
      if (!opts.quiet || res.warnings.length) {
        this.toasts.show({ kind: res.committed ? (res.warnings.length ? 'warn' : 'success') : 'info', message: res.summary || 'Done.', warnings: res.warnings });
      }
      return res;
    } catch (e) {
      this.reportError(e);
      return null;
    } finally {
      this.set({ busy: null });
      await this.refresh(true);
      if (cmd.category === 'grid' || cmd.category === 'guides' || cmd.category === 'shadow' || cmd.category === 'layers') void this.scanDocument(true);
    }
  }

  private remember(id: string): void {
    const recent = [id, ...this.settings.recent.filter((r) => r !== id)].slice(0, 12);
    void this.saveSettings({ recent });
  }

  reportError(e: unknown): void {
    const err = describeUnknown(e);
    this.toasts.show({ kind: err instanceof AFError && err.soft ? 'info' : 'error', message: err.message, details: err.details });
  }

  // ---- preview ---------------------------------------------------------------------

  private previewQueue = debounce((id: string, params: unknown) => void this.doPreview(id, params), 160);

  preview(id: string, params: unknown): void {
    this.previewQueue(id, params);
  }

  private async doPreview(id: string, params: unknown): Promise<void> {
    const cmd = this.registry.get(id);
    if (!cmd || cmd.kind !== 'document') return;
    try {
      this.set({ busy: 'Preview' });
      await this.runner.preview(cmd as DocumentCommand, params);
      this.set({ previewing: id });
    } catch (e) {
      this.reportError(e);
      await this.cancelPreview();
    } finally {
      this.set({ busy: null });
      await this.refresh(true);
    }
  }

  async cancelPreview(): Promise<void> {
    this.previewQueue.cancel();
    if (!this.state.previewing && !this.host.preview.active) return;
    try {
      await this.runner.cancelPreview();
    } catch (e) {
      this.reportError(e);
    }
    this.set({ previewing: null });
    await this.refresh(true);
  }

  // ---- views / navigation ------------------------------------------------------------

  go(tab: TabId): void {
    if (this.state.previewing && tab !== this.state.tab) void this.cancelPreview();
    this.set({ tab });
  }

  onOpen(commandPrefix: string, handler: (params: unknown) => void): void {
    this.openHandlers.set(commandPrefix, handler);
  }

  /** Open a command's view pre-filled with parameters (history click). Never runs it. */
  open(entry: Pick<HistoryEntry, 'commandId' | 'params'>): void {
    const cmd = this.registry.get(entry.commandId);
    if (!cmd) return;
    if (cmd.view) this.go(cmd.view);
    this.lastParams.set(cmd.id, entry.params);
    for (const [prefix, handler] of this.openHandlers) {
      if (cmd.id.startsWith(prefix)) handler(entry.params);
    }
  }

  async repeatLast(): Promise<void> {
    const last = this.history.last();
    if (!last) {
      this.toasts.show({ kind: 'info', message: 'Nothing to repeat yet.' });
      return;
    }
    const cmd = this.registry.get(last.commandId);
    if (!cmd || cmd.kind !== 'document') return;
    if (cmd.destructive && this.settings.safeMode) {
      const ok = await confirmDialog(this.root, { title: 'Repeat', message: `Repeat “${last.title}” on the current selection?`, destructive: true, okLabel: 'Repeat' });
      if (!ok) return;
    }
    await this.run(cmd.id, last.params, { confirmed: cmd.id !== 'layers.organize' });
  }

  toggleFavorite(id: string): void {
    const fav = this.settings.favorites.includes(id) ? this.settings.favorites.filter((f) => f !== id) : [...this.settings.favorites, id];
    void this.saveSettings({ favorites: fav });
  }

  async sweepPreviewLeftovers(): Promise<void> {
    if (!this.env.sweepPreview) return;
    const ok = await confirmDialog(this.root, {
      title: 'Remove preview leftovers',
      message: `Delete ${this.state.scan?.previewLeftovers ?? 0} preview item(s) left by an interrupted session? They are tagged by Artboard Forge; nothing else is touched.`,
      destructive: true,
      okLabel: 'Remove',
    });
    if (!ok) return;
    try {
      const r = await this.env.sweepPreview();
      this.toasts.show({ kind: 'success', message: `Removed ${r.removed} preview item(s).` });
    } catch (e) {
      this.reportError(e);
    }
    await this.refresh(true);
    await this.scanDocument();
  }

  // Scripts in /scripts-menu dispatch "com.artboardforge.command" with a command id,
  // so designers can bind F-keys to them via Actions (see docs/INSTALL.md).
  private async handleHostCommand(data: string): Promise<void> {
    const id = data.trim();
    if (id === 'repeat') return this.repeatLast();
    if (!/^[a-zA-Z][\w.-]{1,60}$/.test(id) || !this.registry.get(id)) {
      this.toasts.show({ kind: 'warn', message: `Keyboard shortcut sent an unknown command (“${id.slice(0, 40)}”).` });
      return;
    }
    await this.run(id);
  }

  openPalette: () => void = () => undefined;

  private uiCommands(): AnyCommand[] {
    const ui = (id: string, title: string, keywords: string[], description: string, run: () => void | Promise<void>): AnyCommand => ({
      kind: 'ui',
      id,
      title,
      category: 'app',
      keywords,
      description,
      defaultParams: () => ({}),
      run,
    });
    return [
      ui('app.palette', 'Command Palette', ['commands', 'search', 'find'], 'Search every Artboard Forge command.', () => this.openPalette()),
      ui('app.repeatLast', 'Repeat Last Command', ['repeat', 'again', 'last'], 'Run the last command again on the current selection.', () => this.repeatLast()),
      ui('document.scan', 'Find Artboard Forge Items', ['scan', 'recognise', 'recognize', 'find', 'tagged', 'inspect'], 'Count grids, guides and shadows created by Artboard Forge in this document.', () => this.scanDocument()),
      ui('app.settings', 'Settings', ['preferences', 'units', 'safe mode', 'rtl'], 'Units, direction, naming, Safe Mode…', () => this.go('settings')),
      ui('app.presets', 'Manage Presets', ['presets', 'import', 'export'], 'Create, rename, duplicate, import and export presets.', () => this.go('presets')),
      ui('preview.cancel', 'Cancel Preview', ['cancel', 'preview', 'escape'], 'Remove the live preview and restore the document.', () => this.cancelPreview()),
    ];
  }
}
