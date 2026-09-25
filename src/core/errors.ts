/**
 * User-facing errors. Every failure shown in the panel has a plain-language
 * message; technical details are kept separately and are copyable.
 */

import type { HostError, HostErrorCode } from './protocol';

export class AFError extends Error {
  readonly code: string;
  readonly details: string | undefined;
  /** When true the message is advisory (e.g. "nothing to do"), not a failure. */
  readonly soft: boolean;

  constructor(code: string, message: string, opts: { details?: string; soft?: boolean } = {}) {
    super(message);
    this.name = 'AFError';
    this.code = code;
    this.details = opts.details;
    this.soft = opts.soft ?? false;
  }
}

const HOST_MESSAGES: Record<HostErrorCode, string> = {
  NO_DOCUMENT: 'Open or create a document first.',
  TEXT_EDITING: 'You are editing text. Press Esc to leave the text, then try again.',
  SELECTION_CHANGED: 'The selection changed while the command was running. Please try again.',
  REF_NOT_FOUND: 'An object this command needs no longer exists (it may have been deleted or undone).',
  LAYER_LOCKED: 'The target layer is locked. Unlock it in the Layers panel and try again.',
  LAYER_NOT_FOUND: 'The target layer could not be found.',
  NOT_TAGGED: 'Refused to delete an object that Artboard Forge did not create.',
  UNSUPPORTED: 'This Illustrator version does not support that operation.',
  BAD_OP: 'Internal error: the panel sent an operation the host does not understand.',
  HOST_EXCEPTION: 'Illustrator reported an error while running the command.',
  BRIDGE: 'Could not talk to Illustrator. Close and reopen the panel; if it persists, restart Illustrator.',
  TIMEOUT: 'Illustrator did not answer in time. It may be busy or showing a dialog.',
};

export function fromHostError(e: HostError): AFError {
  const base = HOST_MESSAGES[e.code] ?? HOST_MESSAGES.HOST_EXCEPTION;
  const rollback =
    e.rolledBack === 'partial'
      ? ' Some changes could not be reverted automatically — use Edit › Undo.'
      : e.rolledBack === 'full'
        ? ' No changes were made.'
        : '';
  const details = [
    `code: ${e.code}`,
    e.op ? `op: ${e.op}${e.opIndex !== undefined ? ` (#${e.opIndex})` : ''}` : null,
    e.line !== undefined ? `line: ${e.line}` : null,
    `host message: ${e.message}`,
    e.details ? `details: ${e.details}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  return new AFError(e.code, base + rollback, { details });
}

export function describeUnknown(err: unknown): AFError {
  if (err instanceof AFError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error && err.stack ? err.stack : undefined;
  return new AFError('UNEXPECTED', 'Something unexpected went wrong.', { details: stack ?? msg });
}
