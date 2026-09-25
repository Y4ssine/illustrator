/**
 * Command architecture.
 *
 *   validate()  — cheap, synchronous check against the latest snapshot
 *   plan()      — build the host batch (no side effects). Used for preview AND execute
 *   execute     — the runner commits the plan's batch in one host call (one undo step)
 *   preview     — the runner shows the plan's batch through the PreviewController
 *   cancel      — PreviewController.cancel() restores the document
 *   serialize   — params are plain JSON (stored in history / presets)
 */

import type { HostAdapter } from '../host';
import type { Batch } from '../protocol';
import type { Settings } from '../settings';
import type { DocumentSnapshot } from '../snapshot';
import type { PresetStore } from '../../presets/store';

export type CommandCategory = 'artboards' | 'grid' | 'guides' | 'align' | 'shadow' | 'light' | 'color' | 'create' | 'info' | 'layers' | 'document' | 'app';

export const CATEGORY_LABEL: Record<CommandCategory, string> = {
  artboards: 'Artboards',
  light: 'Light & Blend',
  color: 'Colour',
  create: 'Create',
  info: 'Infographic',
  grid: 'Grid',
  guides: 'Guides',
  align: 'Spacing & Align',
  shadow: 'Shadow',
  layers: 'Layers',
  document: 'Document',
  app: 'Artboard Forge',
};

export interface PlanContext {
  host: HostAdapter;
  snapshot: DocumentSnapshot;
  settings: Settings;
  presets: PresetStore;
}

export interface CommandPlan {
  batch: Batch;
  summary: string;
  warnings: string[];
  /** Ask the user before committing (always, regardless of Safe Mode). */
  confirm?: { title: string; message: string; details?: string[] };
  /** Nothing to do: the runner reports this message and commits nothing. */
  nothing?: string;
  /**
   * Second stage planned against a fresh snapshot after this batch commits.
   * Used when the first stage creates the document the rest depends on
   * (a new document's artboard coordinates are only known after creation).
   */
  next?: (ctx: PlanContext) => Promise<CommandPlan>;
}

export interface CommandResult {
  summary: string;
  warnings: string[];
  committed: boolean;
}

export type ViewId = 'home' | 'create' | 'light' | 'shadow' | 'color' | 'info' | 'grid' | 'align' | 'layers' | 'presets' | 'settings';

interface CommandBase<P> {
  id: string;
  title: string;
  category: CommandCategory;
  keywords: readonly string[];
  description: string;
  /** Tab the command's detailed controls live on. */
  view?: ViewId;
  defaultParams(ctx: { settings: Settings; presets: PresetStore }): P;
}

export interface DocumentCommand<P = unknown> extends CommandBase<P> {
  kind: 'document';
  /** Removes or restructures artwork; Safe Mode asks for confirmation. */
  destructive?: boolean;
  /** Can run without an open document (e.g. creates one). */
  worksWithoutDocument?: boolean;
  supportsPreview?: boolean;
  /** How many selected items the snapshot must describe (default 500). */
  maxSelection?: number;
  /** null when runnable, otherwise a plain-language reason. */
  validate(snapshot: DocumentSnapshot, params: P, settings: Settings): string | null;
  plan(ctx: PlanContext, params: P): Promise<CommandPlan>;
}

export interface UiCommand<P = unknown> extends CommandBase<P> {
  kind: 'ui';
  run(params: P): void | Promise<void>;
}

export type CommandDef<P = unknown> = DocumentCommand<P> | UiCommand<P>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = CommandDef<any>;
