/**
 * Layout components: collapsible Section, rows, readouts, badges, progress.
 * Section collapse state persists per panel (localStorage, a per-viewer
 * convenience — failures are ignored).
 */

import { h, svg } from '../dom';
import { ICONS } from '../icons';

function loadCollapsed(id: string): boolean | null {
  try {
    const v = localStorage.getItem(`af.section.${id}`);
    return v === null ? null : v === '1';
  } catch {
    return null;
  }
}

function saveCollapsed(id: string, v: boolean): void {
  try {
    localStorage.setItem(`af.section.${id}`, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export interface SectionOpts {
  id: string;
  title: string;
  collapsed?: boolean;
  actions?: HTMLElement[];
  hint?: string;
}

export function Section(o: SectionOpts, ...body: Array<HTMLElement | null | false>): { el: HTMLElement; body: HTMLElement; setTitle(t: string): void } {
  const collapsed = loadCollapsed(o.id) ?? o.collapsed ?? false;
  const titleEl = h('span', { class: 'section-title' }, o.title);
  const header = h(
    'div',
    { class: 'section-header' },
    h('button', { type: 'button', class: 'section-toggle', 'aria-expanded': String(!collapsed), title: 'Collapse / expand' }, svg(ICONS.chevron, 'icon chevron'), titleEl),
    o.hint ? h('span', { class: 'section-hint', title: o.hint }, svg(ICONS.info)) : null,
    h('span', { class: 'section-actions' }, ...(o.actions ?? [])),
  );
  const content = h('div', { class: 'section-body' }, ...body.filter(Boolean) as HTMLElement[]);
  const el = h('section', { class: `section${collapsed ? ' collapsed' : ''}`, dataset: { section: o.id } }, header, content);
  header.querySelector('.section-toggle')!.addEventListener('click', () => {
    const now = !el.classList.contains('collapsed');
    el.classList.toggle('collapsed', now);
    header.querySelector('.section-toggle')!.setAttribute('aria-expanded', String(!now));
    saveCollapsed(o.id, now);
  });
  return { el, body: content, setTitle: (t) => (titleEl.textContent = t) };
}

export const Row = (...children: Array<HTMLElement | null | false>): HTMLElement => h('div', { class: 'row' }, ...(children.filter(Boolean) as HTMLElement[]));
export const Grid2 = (...children: Array<HTMLElement | null | false>): HTMLElement => h('div', { class: 'grid2' }, ...(children.filter(Boolean) as HTMLElement[]));
export const ButtonGrid = (...children: Array<HTMLElement | null | false>): HTMLElement => h('div', { class: 'btn-grid' }, ...(children.filter(Boolean) as HTMLElement[]));
export const Note = (text: string, kind: 'info' | 'warn' = 'info'): HTMLElement => h('p', { class: `note note-${kind}` }, svg(ICONS[kind === 'warn' ? 'warn' : 'info']), h('span', null, text));

export function Readout(pairs: Array<[string, string]>): HTMLElement {
  return h('dl', { class: 'readout' }, ...pairs.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)]));
}

export function Badge(text: string, kind: 'neutral' | 'good' | 'warn' | 'af' = 'neutral'): HTMLElement {
  return h('span', { class: `badge badge-${kind}` }, text);
}

export function ProgressBar(): { el: HTMLElement; start(label?: string): void; stop(): void; set(fraction: number): void } {
  const bar = h('div', { class: 'progress-bar' });
  const el = h('div', { class: 'progress', role: 'progressbar', 'aria-hidden': 'true' }, bar);
  return {
    el,
    start: (label) => {
      el.classList.add('active', 'indeterminate');
      el.setAttribute('aria-hidden', 'false');
      if (label) el.setAttribute('aria-label', label);
    },
    stop: () => {
      el.classList.remove('active', 'indeterminate');
      el.setAttribute('aria-hidden', 'true');
      bar.style.width = '';
    },
    set: (f) => {
      el.classList.add('active');
      el.classList.remove('indeterminate');
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;
    },
  };
}

export function Empty(text: string): HTMLElement {
  return h('p', { class: 'empty' }, text);
}
