/**
 * Command runner: validate → plan → (confirm) → commit → history.
 * Also drives live preview through the host PreviewController.
 */

import { AFError, fromHostError } from '../errors';
import type { HostAdapter } from '../host';
import type { BatchResult } from '../protocol';
import type { Settings } from '../settings';
import type { PresetStore } from '../../presets/store';
import type { History } from './history';
import type { AnyCommand, CommandPlan, CommandResult, DocumentCommand, PlanContext } from './types';

export interface ConfirmRequest {
  title: string;
  message: string;
  details?: string[];
  destructive?: boolean;
}

export interface RunnerDeps {
  host: HostAdapter;
  presets: PresetStore;
  history: History;
  settings: () => Settings;
  confirm: (req: ConfirmRequest) => Promise<boolean>;
  onCommitted?: (cmd: AnyCommand, params: unknown, result: CommandResult) => void;
}

export interface RunOptions {
  /** The caller already showed its own preview/confirmation. */
  confirmed?: boolean;
}

export class CommandRunner {
  private readonly deps: RunnerDeps;
  private previewing: { commandId: string } | null = null;
  private busy = false;

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  get previewCommandId(): string | null {
    return this.previewing?.commandId ?? null;
  }

  private async context(maxItems = 500): Promise<PlanContext> {
    const snap = await this.deps.host.document.snapshot({ maxItems });
    return { host: this.deps.host, snapshot: snap, settings: this.deps.settings(), presets: this.deps.presets };
  }

  private validate(cmd: DocumentCommand, ctx: PlanContext, params: unknown): void {
    const reason = cmd.validate(ctx.snapshot, params, ctx.settings);
    if (reason) throw new AFError('INVALID', reason, { soft: true });
  }

  async run(cmd: AnyCommand, params: unknown, opts: RunOptions = {}): Promise<CommandResult> {
    if (cmd.kind === 'ui') {
      await cmd.run(params);
      return { summary: '', warnings: [], committed: false };
    }
    if (this.busy) throw new AFError('BUSY', 'Another Artboard Forge command is still running.', { soft: true });
    this.busy = true;
    try {
      // Plan against the document WITHOUT the preview: a preview may have
      // created layers or items the final plan must not rely on.
      if (this.previewing || this.deps.host.preview.active) await this.cancelPreview();
      const ctx = await this.context(cmd.maxSelection);
      this.validate(cmd, ctx, params);
      let plan = await cmd.plan(ctx, params);
      if (plan.nothing) {
        return { summary: plan.nothing, warnings: plan.warnings, committed: false };
      }
      if (!opts.confirmed) {
        const needs = plan.confirm ?? (cmd.destructive && ctx.settings.safeMode ? { title: cmd.title, message: `${cmd.title}: ${plan.summary}` } : null);
        if (needs) {
          const ok = await this.deps.confirm({ ...needs, destructive: !!cmd.destructive });
          if (!ok) return { summary: 'Cancelled.', warnings: [], committed: false };
        }
      }
      const warnings: string[] = [...plan.warnings];
      const first = await this.commit(plan);
      warnings.push(...first.warnings);
      let summary = plan.summary;
      // Multi-stage commands (e.g. create a document, then build inside it).
      let guard = 0;
      while (plan.next && guard++ < 4) {
        const ctx2 = await this.context(cmd.maxSelection);
        plan = await plan.next(ctx2);
        if (plan.nothing) break;
        const r = await this.commit(plan);
        warnings.push(...plan.warnings, ...r.warnings);
        summary = `${summary} ${plan.summary}`.trim();
      }
      const result: CommandResult = { summary, warnings: dedupe(warnings), committed: true };
      this.deps.history.push({ commandId: cmd.id, title: cmd.title, summary, params });
      this.deps.onCommitted?.(cmd, params, result);
      return result;
    } finally {
      this.busy = false;
    }
  }

  private async commit(plan: CommandPlan): Promise<Extract<BatchResult, { ok: true }>> {
    const res: BatchResult = await this.deps.host.run(plan.batch);
    if (!res.ok) throw fromHostError(res.error);
    return res;
  }

  /** Show (or refresh) a live preview. */
  async preview(cmd: DocumentCommand, params: unknown): Promise<{ summary: string; warnings: string[] }> {
    if (!cmd.supportsPreview) throw new AFError('NO_PREVIEW', `${cmd.title} has no live preview.`, { soft: true });
    if (this.busy) return { summary: '', warnings: [] };
    this.busy = true;
    try {
      const ctx = await this.context(cmd.maxSelection);
      this.validate(cmd, ctx, params);
      const plan = await cmd.plan(ctx, previewParams(params));
      if (plan.nothing) return { summary: plan.nothing, warnings: plan.warnings };
      const res = await this.deps.host.preview.show(plan.batch);
      if (!res.ok) throw fromHostError(res.error);
      this.previewing = { commandId: cmd.id };
      return { summary: plan.summary, warnings: dedupe([...plan.warnings, ...res.warnings]) };
    } finally {
      this.busy = false;
    }
  }

  async cancelPreview(): Promise<void> {
    if (!this.previewing && !this.deps.host.preview.active) return;
    this.previewing = null;
    await this.deps.host.preview.cancel();
  }
}

/** Previews must be purely additive so they can always be reverted exactly. */
function previewParams(params: unknown): unknown {
  if (params && typeof params === 'object' && 'replaceExisting' in params) {
    return { ...(params as Record<string, unknown>), replaceExisting: false };
  }
  return params;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))];
}
