/**
 * Creative controls: tile pickers with thumbnails, the light-direction
 * compass, colour chips, text area, and the shared Preview / Apply pair.
 */

import { h, svg } from '../dom';
import { Button, type Field } from './controls';
import type { AppController } from '../app';
import type { Paint } from '../../core/protocol';
import { paintToCss } from '../../color/palette-engine';

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export interface TileItem<T extends string> {
  value: T;
  label: string;
  title?: string;
  /** SVG markup or a CSS background for the thumbnail. */
  thumb?: { svg?: string; css?: string; text?: string };
}

export function TileGrid<T extends string>(o: { items: Array<TileItem<T>>; value: T | null; columns?: number; size?: 'sm' | 'md' | 'lg'; onChange: (v: T) => void }): Field<T | null> & { setItems(items: Array<TileItem<T>>): void } {
  let value = o.value;
  const grid = h('div', { class: `tiles tiles-${o.size ?? 'md'}`, role: 'listbox', style: o.columns ? `grid-template-columns: repeat(${o.columns}, minmax(0, 1fr))` : '' });
  const render = (items: Array<TileItem<T>>): void => {
    grid.textContent = '';
    for (const it of items) {
      const thumb = h('span', { class: 'tile-thumb', style: it.thumb?.css ? `background: ${it.thumb.css}` : '' });
      if (it.thumb?.svg) thumb.appendChild(svg(it.thumb.svg, 'tile-svg'));
      if (it.thumb?.text) thumb.append(h('span', { class: 'tile-glyph' }, it.thumb.text));
      const b = h('button', { type: 'button', class: 'tile', role: 'option', title: it.title ?? it.label, 'aria-selected': String(it.value === value), dataset: { value: it.value } }, thumb, h('span', { class: 'tile-label' }, it.label));
      b.addEventListener('click', () => {
        value = it.value;
        sync();
        o.onChange(it.value);
      });
      grid.appendChild(b);
    }
  };
  const sync = (): void => grid.querySelectorAll<HTMLButtonElement>('.tile').forEach((b) => b.setAttribute('aria-selected', String(b.dataset['value'] === value)));
  render(o.items);
  return {
    el: grid,
    get: () => value,
    set: (v) => {
      value = v;
      sync();
    },
    setItems: (items) => render(items),
  };
}

export function paintThumb(p: Paint): TileItem<string>['thumb'] {
  return { css: paintToCss(p) };
}

// ---------------------------------------------------------------------------
// Compass: light direction (0 = top, clockwise), drag to set.
// ---------------------------------------------------------------------------

export function Compass(o: { label: string; value: number; color?: string; showShadow?: boolean; title?: string; onInput: (deg: number) => void; onChange: (deg: number) => void }): Field<number> & { setColor(c: string): void } {
  let value = o.value;
  let color = o.color ?? '#FFD27A';
  const size = 76;
  const c = size / 2;
  const r = c - 9;
  const host = h('div', { class: 'compass', title: o.title ?? 'Drag to set where the light comes from' });
  const readout = h('span', { class: 'compass-readout' });
  const draw = (): void => {
    const a = ((value - 90) * Math.PI) / 180;
    const lx = c + r * Math.cos(a);
    const ly = c + r * Math.sin(a);
    const sx = c - r * 0.62 * Math.cos(a);
    const sy = c - r * 0.62 * Math.sin(a);
    const ticks = Array.from({ length: 8 }, (_, i) => {
      const t = (i * Math.PI) / 4;
      return `<line x1="${c + (r - 3) * Math.cos(t)}" y1="${c + (r - 3) * Math.sin(t)}" x2="${c + (r + 2) * Math.cos(t)}" y2="${c + (r + 2) * Math.sin(t)}" class="compass-tick"/>`;
    }).join('');
    host.innerHTML =
      `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">` +
      `<circle cx="${c}" cy="${c}" r="${r}" class="compass-ring"/>${ticks}` +
      (o.showShadow !== false ? `<line x1="${c}" y1="${c}" x2="${sx}" y2="${sy}" class="compass-shadow"/>` : '') +
      `<rect x="${c - 5}" y="${c - 9}" width="10" height="14" rx="2" class="compass-subject"/>` +
      `<line x1="${lx}" y1="${ly}" x2="${c}" y2="${c}" class="compass-ray" stroke="${color}"/>` +
      `<circle cx="${lx}" cy="${ly}" r="6.5" fill="${color}" class="compass-sun"/></svg>`;
    readout.textContent = `${Math.round(value)}°`;
  };
  const setFromEvent = (e: PointerEvent): void => {
    const b = host.getBoundingClientRect();
    const x = e.clientX - b.left - b.width / 2;
    const y = e.clientY - b.top - b.height / 2;
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (e.shiftKey) deg = Math.round(deg / 45) * 45;
    value = Math.round(((deg % 360) + 360) % 360);
    draw();
  };
  host.addEventListener('pointerdown', (e) => {
    host.setPointerCapture(e.pointerId);
    setFromEvent(e);
    o.onInput(value);
    const move = (ev: PointerEvent): void => {
      setFromEvent(ev);
      o.onInput(value);
    };
    const up = (): void => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerup', up);
      o.onChange(value);
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
  });
  host.tabIndex = 0;
  host.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 45 : 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') value = (value + step) % 360;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') value = (value - step + 360) % 360;
    else return;
    e.preventDefault();
    draw();
    o.onChange(value);
  });
  draw();
  const el = h('div', { class: 'field compass-field' }, h('span', { class: 'field-label' }, o.label), host, readout);
  return {
    el,
    get: () => value,
    set: (v) => {
      value = v;
      draw();
    },
    setColor: (col) => {
      color = col;
      draw();
    },
  };
}

// ---------------------------------------------------------------------------
// Colour chips
// ---------------------------------------------------------------------------

export function Chips(o: { colors: string[]; value?: string | null; onPick?: (hex: string) => void; title?: (hex: string) => string }): { el: HTMLElement; set(colors: string[], value?: string | null): void } {
  const el = h('div', { class: 'swatch-row' });
  const render = (colors: string[], value?: string | null): void => {
    el.textContent = '';
    for (const c of colors) {
      const b = h('button', { type: 'button', class: 'chip-swatch', style: `background:${c}`, title: o.title ? o.title(c) : c, 'aria-pressed': String(c === value) });
      if (o.onPick) b.addEventListener('click', () => o.onPick!(c));
      else b.disabled = true;
      el.appendChild(b);
    }
  };
  render(o.colors, o.value);
  return { el, set: render };
}

export function TextArea(o: { label: string; value: string; rows?: number; placeholder?: string; dir?: 'auto' | 'rtl' | 'ltr'; title?: string; onChange: (v: string) => void }): Field<string> {
  const ta = h('textarea', { class: 'text-area', rows: String(o.rows ?? 5), placeholder: o.placeholder ?? '', spellcheck: 'false', dir: o.dir ?? 'auto' }) as HTMLTextAreaElement;
  ta.value = o.value;
  ta.addEventListener('input', () => o.onChange(ta.value));
  const el = h('label', { class: 'field textarea-field', title: o.title ?? '' }, h('span', { class: 'field-label' }, o.label), ta);
  return {
    el,
    get: () => ta.value,
    set: (v) => {
      ta.value = v;
    },
  };
}

// ---------------------------------------------------------------------------
// Preview / Apply pair
// ---------------------------------------------------------------------------

/**
 * Standard "Preview" toggle + primary action for a command. `changed()`
 * refreshes the live preview (debounced by the app) when it is on.
 */
export function PreviewApply(app: AppController, o: { commandId: () => string; params: () => unknown; label: string; icon?: Parameters<typeof Button>[0]['icon']; canPreview?: () => boolean }): {
  el: HTMLElement;
  previewBtn: HTMLButtonElement;
  applyBtn: HTMLButtonElement;
  changed(): void;
  stop(): void;
  isOn(): boolean;
  setLabel(t: string): void;
} {
  let on = false;
  const previewBtn = Button({ label: 'Preview', icon: 'eye', title: 'Live preview in the document (Esc cancels)', onClick: () => toggle() });
  const applyBtn = Button({ label: o.label, icon: o.icon ?? 'check', variant: 'primary', onClick: () => void apply() });
  const toggle = (force?: boolean): void => {
    on = force ?? !on;
    previewBtn.classList.toggle('on', on);
    previewBtn.setAttribute('aria-pressed', String(on));
    if (on) app.preview(o.commandId(), o.params());
    else void app.cancelPreview();
  };
  const apply = async (): Promise<void> => {
    await app.run(o.commandId(), JSON.parse(JSON.stringify(o.params())));
    if (on) {
      on = false;
      previewBtn.classList.remove('on');
      previewBtn.setAttribute('aria-pressed', 'false');
    }
  };
  return {
    el: h('div', { class: 'row actions' }, previewBtn, applyBtn),
    previewBtn,
    applyBtn,
    changed: () => {
      if (on && (o.canPreview?.() ?? true)) app.preview(o.commandId(), o.params());
    },
    stop: () => {
      if (on) toggle(false);
    },
    isOn: () => on,
    setLabel: (t) => {
      applyBtn.querySelector('.btn-label')!.textContent = t;
    },
  };
}
