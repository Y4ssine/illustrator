/**
 * Toasts (with expandable technical details + copy diagnostics) and the
 * in-panel confirmation dialog. Never a raw "ERROR 13493".
 */

import { h, svg } from '../dom';
import { ICONS } from '../icons';
import { Button } from './controls';

export type ToastKind = 'success' | 'info' | 'warn' | 'error';

export interface ToastOpts {
  kind: ToastKind;
  message: string;
  warnings?: string[];
  details?: string;
  sticky?: boolean;
}

export class ToastHost {
  readonly el = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });

  show(o: ToastOpts): void {
    const detailsId = `d${Date.now().toString(36)}`;
    const details = o.details
      ? h(
          'div',
          { class: 'toast-details', id: detailsId, hidden: true },
          h('pre', null, o.details),
          Button({
            label: 'Copy diagnostics',
            icon: 'copy',
            small: true,
            variant: 'quiet',
            onClick: () => copyText(o.details!),
          }),
        )
      : null;
    const toggle = o.details
      ? Button({
          label: 'Details',
          small: true,
          variant: 'quiet',
          onClick: () => {
            details!.hidden = !details!.hidden;
          },
        })
      : null;
    const close = h('button', { type: 'button', class: 'toast-close', title: 'Dismiss' }, svg(ICONS.close));
    const t = h(
      'div',
      { class: `toast toast-${o.kind}` },
      svg(ICONS[o.kind === 'success' ? 'check' : o.kind === 'error' || o.kind === 'warn' ? 'warn' : 'info']),
      h(
        'div',
        { class: 'toast-body' },
        h('div', { class: 'toast-msg' }, o.message),
        o.warnings && o.warnings.length ? h('ul', { class: 'toast-warnings' }, ...o.warnings.map((w) => h('li', null, w))) : null,
        toggle ? h('div', { class: 'toast-actions' }, toggle) : null,
        details,
      ),
      close,
    );
    close.addEventListener('click', () => t.remove());
    this.el.prepend(t);
    while (this.el.children.length > 3) this.el.lastElementChild!.remove();
    // Errors stay until dismissed; warnings linger long enough to read.
    const sticky = o.sticky ?? o.kind === 'error';
    if (!sticky) setTimeout(() => t.remove(), (o.warnings?.length ?? 0) > 0 ? 9000 : 4500);
  }

  clear(): void {
    this.el.innerHTML = '';
  }
}

export function copyText(text: string): void {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', null, text) as HTMLTextAreaElement;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function confirmDialog(root: HTMLElement, o: { title: string; message: string; details?: string[]; destructive?: boolean; okLabel?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    const ok = Button({ label: o.okLabel ?? (o.destructive ? 'Delete' : 'Apply'), variant: o.destructive ? 'danger' : 'primary' });
    const cancel = Button({ label: 'Cancel', variant: 'secondary' });
    const box = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
      h('h2', { class: 'dialog-title' }, o.title),
      h('p', { class: 'dialog-msg' }, o.message),
      o.details && o.details.length ? h('ul', { class: 'dialog-details' }, ...o.details.slice(0, 40).map((d) => h('li', null, d)), o.details.length > 40 ? h('li', null, `…and ${o.details.length - 40} more`) : null) : null,
      h('div', { class: 'dialog-actions' }, cancel, ok),
    );
    const scrim = h('div', { class: 'scrim' }, box);
    const done = (v: boolean): void => {
      scrim.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        done(false);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        done(true);
      }
    };
    ok.addEventListener('click', () => done(true));
    cancel.addEventListener('click', () => done(false));
    document.addEventListener('keydown', onKey, true);
    root.appendChild(scrim);
    ok.focus();
  });
}

export function promptDialog(root: HTMLElement, o: { title: string; label: string; value: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', class: 'text-input', value: o.value }) as HTMLInputElement;
    const ok = Button({ label: 'OK', variant: 'primary' });
    const cancel = Button({ label: 'Cancel' });
    const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true' }, h('h2', { class: 'dialog-title' }, o.title), h('label', { class: 'field text-field' }, h('span', { class: 'field-label' }, o.label), input), h('div', { class: 'dialog-actions' }, cancel, ok));
    const scrim = h('div', { class: 'scrim' }, box);
    const done = (v: string | null): void => {
      scrim.remove();
      resolve(v);
    };
    ok.addEventListener('click', () => done(input.value));
    cancel.addEventListener('click', () => done(null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value);
      if (e.key === 'Escape') done(null);
    });
    root.appendChild(scrim);
    input.focus();
    input.select();
  });
}
