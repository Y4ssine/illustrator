/**
 * Design-system controls: Button, IconButton, NumberField (scrubbable),
 * Slider, Select, Toggle, Segmented, ColorField, TextField, SearchBox.
 * Every control is a function returning an element plus get/set.
 */

import { h, svg } from '../dom';
import { ICONS, type IconName } from '../icons';
import { fromPoints, parseLength, toPoints, unitPrecision, type Unit } from '../../geometry/units';
import { normalizeHex } from '../../utils/color';

export interface ButtonOpts {
  label?: string;
  icon?: IconName;
  title?: string;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  small?: boolean;
  onClick?: (e: MouseEvent) => void;
  disabled?: boolean;
}

export function Button(o: ButtonOpts): HTMLButtonElement {
  const b = h(
    'button',
    {
      type: 'button',
      class: `btn btn-${o.variant ?? 'secondary'}${o.small ? ' btn-sm' : ''}${o.icon && !o.label ? ' btn-icon' : ''}`,
      title: o.title ?? o.label ?? '',
      'aria-label': o.title ?? o.label ?? '',
      disabled: o.disabled ?? false,
    },
    o.icon ? svg(ICONS[o.icon]) : null,
    o.label ? h('span', { class: 'btn-label' }, o.label) : null,
  );
  if (o.onClick) b.addEventListener('click', o.onClick);
  return b;
}

export function IconButton(icon: IconName, title: string, onClick: (e: MouseEvent) => void, extra = ''): HTMLButtonElement {
  const b = Button({ icon, title, variant: 'quiet', onClick });
  if (extra) b.classList.add(extra);
  return b;
}

export interface Field<T> {
  el: HTMLElement;
  get(): T;
  set(v: T, silent?: boolean): void;
}

export interface NumberOpts {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** 'length' values are points and display in the current unit. */
  kind?: 'length' | 'percent' | 'degrees' | 'count' | 'plain';
  unit?: () => Unit;
  title?: string;
  onChange: (v: number) => void;
  /** Called continuously while scrubbing (defaults to onChange). */
  onInput?: (v: number) => void;
  width?: 'narrow' | 'wide';
}

/**
 * Numeric input with a scrubbable label: drag the label horizontally to
 * change the value (Shift ×10, Alt ×0.1). Arrow keys step; Enter commits.
 * Lengths accept units ("5mm", "24px").
 */
export function NumberField(o: NumberOpts): Field<number> {
  let value = o.value;
  const kind = o.kind ?? 'plain';
  const unit = (): Unit => (o.unit ? o.unit() : 'px');
  const suffix = (): string => (kind === 'length' ? unit() : kind === 'percent' ? '%' : kind === 'degrees' ? '°' : '');
  const clampV = (v: number): number => Math.min(o.max ?? Infinity, Math.max(o.min ?? -Infinity, v));
  const display = (v: number): string => {
    if (kind === 'length') {
      const p = unitPrecision(unit());
      return String(Math.round(fromPoints(v, unit()) * 10 ** p) / 10 ** p);
    }
    if (kind === 'count') return String(Math.round(v));
    return String(Math.round(v * 100) / 100);
  };
  const input = h('input', { class: 'num-input', type: 'text', inputmode: 'decimal', spellcheck: 'false', value: display(value), 'aria-label': o.label });
  const sfx = h('span', { class: 'num-suffix' }, suffix());
  const label = h('span', { class: 'num-label scrub', title: `${o.title ?? o.label} — drag to adjust` }, o.label);
  const el = h('label', { class: `field num-field${o.width === 'narrow' ? ' narrow' : ''}`, title: o.title ?? '' }, label, h('span', { class: 'num-box' }, input, sfx));

  const commit = (v: number, live = false): void => {
    const nv = clampV(kind === 'count' ? Math.round(v) : v);
    value = nv;
    input.value = display(nv);
    if (live) (o.onInput ?? o.onChange)(nv);
    else o.onChange(nv);
  };
  const parse = (): number | null => {
    const txt = input.value.trim();
    if (kind === 'length') return parseLength(txt, unit());
    const n = parseFloat(txt.replace(/[%°]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  input.addEventListener('keydown', (e) => {
    const step = (o.step ?? 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
    const stepPts = kind === 'length' ? toPoints(step, unit()) : step;
    if (e.key === 'Enter') {
      const p = parse();
      if (p !== null) commit(p);
      input.select();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      commit(value + stepPts);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      commit(value - stepPts);
    } else if (e.key === 'Escape') {
      input.value = display(value);
      input.blur();
    }
  });
  input.addEventListener('blur', () => {
    const p = parse();
    if (p !== null && Math.abs(p - value) > 1e-9) commit(p);
    else input.value = display(value);
  });
  input.addEventListener('focus', () => input.select());

  // Scrubbing
  label.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startV = value;
    label.setPointerCapture(e.pointerId);
    el.classList.add('scrubbing');
    const move = (ev: PointerEvent): void => {
      const mult = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
      const step = (o.step ?? 1) * mult;
      const stepPts = kind === 'length' ? toPoints(step, unit()) : step;
      commit(startV + Math.round((ev.clientX - startX) / 3) * stepPts, true);
    };
    const up = (): void => {
      label.removeEventListener('pointermove', move);
      label.removeEventListener('pointerup', up);
      el.classList.remove('scrubbing');
      if (value !== startV) o.onChange(value);
    };
    label.addEventListener('pointermove', move);
    label.addEventListener('pointerup', up);
  });

  return {
    el,
    get: () => value,
    set: (v, silent = true) => {
      value = v;
      input.value = display(v);
      sfx.textContent = suffix();
      if (!silent) o.onChange(v);
    },
  };
}

export interface SliderOpts {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  title?: string;
  onChange: (v: number) => void;
  onInput?: (v: number) => void;
}

export function Slider(o: SliderOpts): Field<number> {
  let value = o.value;
  const fmt = o.format ?? ((v: number) => String(Math.round(v)));
  const out = h('span', { class: 'slider-value' }, fmt(value));
  const range = h('input', { type: 'range', min: String(o.min), max: String(o.max), step: String(o.step ?? 1), value: String(value), 'aria-label': o.label }) as HTMLInputElement;
  range.addEventListener('input', () => {
    value = parseFloat(range.value);
    out.textContent = fmt(value);
    (o.onInput ?? o.onChange)(value);
  });
  range.addEventListener('change', () => {
    value = parseFloat(range.value);
    o.onChange(value);
  });
  range.addEventListener('dblclick', () => range.blur());
  const el = h('label', { class: 'field slider-field', title: o.title ?? '' }, h('span', { class: 'field-label' }, o.label), range, out);
  return {
    el,
    get: () => value,
    set: (v) => {
      value = v;
      range.value = String(v);
      out.textContent = fmt(v);
    },
  };
}

export interface SelectOpts<T extends string> {
  label?: string;
  value: T;
  options: Array<{ value: T; label: string; group?: string }>;
  title?: string;
  onChange: (v: T) => void;
}

export function Select<T extends string>(o: SelectOpts<T>): Field<T> & { setOptions(opts: Array<{ value: T; label: string; group?: string }>): void } {
  const sel = h('select', { class: 'select', 'aria-label': o.label ?? o.title ?? '' }) as HTMLSelectElement;
  const fill = (opts: Array<{ value: T; label: string; group?: string }>): void => {
    sel.innerHTML = '';
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const op of opts) {
      const opt = h('option', { value: op.value }, op.label);
      if (op.group) {
        let g = groups.get(op.group);
        if (!g) {
          g = h('optgroup', { label: op.group });
          groups.set(op.group, g);
          sel.appendChild(g);
        }
        g.appendChild(opt);
      } else sel.appendChild(opt);
    }
  };
  fill(o.options);
  sel.value = o.value;
  sel.addEventListener('change', () => o.onChange(sel.value as T));
  const el = o.label ? h('label', { class: 'field select-field', title: o.title ?? '' }, h('span', { class: 'field-label' }, o.label), sel) : h('span', { class: 'select-wrap', title: o.title ?? '' }, sel);
  return {
    el,
    get: () => sel.value as T,
    set: (v) => {
      sel.value = v;
    },
    setOptions: (opts) => {
      const cur = sel.value;
      fill(opts);
      sel.value = opts.some((x) => x.value === cur) ? cur : (opts[0]?.value ?? '');
    },
  };
}

export function Toggle(o: { label: string; value: boolean; title?: string; onChange: (v: boolean) => void }): Field<boolean> {
  const input = h('input', { type: 'checkbox', checked: o.value }) as HTMLInputElement;
  input.addEventListener('change', () => o.onChange(input.checked));
  const el = h('label', { class: 'toggle', title: o.title ?? '' }, input, h('span', { class: 'toggle-track' }, h('span', { class: 'toggle-thumb' })), h('span', { class: 'toggle-label' }, o.label));
  return {
    el,
    get: () => input.checked,
    set: (v) => {
      input.checked = v;
    },
  };
}

export function Segmented<T extends string>(o: { label?: string; value: T; options: Array<{ value: T; label: string; title?: string }>; onChange: (v: T) => void }): Field<T> {
  let value = o.value;
  const btns = o.options.map((op) => {
    const b = h('button', { type: 'button', class: 'seg-btn', title: op.title ?? op.label, 'aria-pressed': String(op.value === value) }, op.label);
    b.addEventListener('click', () => {
      value = op.value;
      sync();
      o.onChange(value);
    });
    return { b, v: op.value };
  });
  const sync = (): void => btns.forEach(({ b, v }) => b.setAttribute('aria-pressed', String(v === value)));
  const group = h('div', { class: 'segmented', role: 'group' }, btns.map((x) => x.b));
  const el = o.label ? h('div', { class: 'field seg-field' }, h('span', { class: 'field-label' }, o.label), group) : group;
  return {
    el,
    get: () => value,
    set: (v) => {
      value = v;
      sync();
    },
  };
}

export function ColorField(o: { label: string; value: string; onChange: (hex: string) => void }): Field<string> {
  let value = normalizeHex(o.value) ?? '#000000';
  const picker = h('input', { type: 'color', class: 'color-swatch', value: value.toLowerCase(), 'aria-label': `${o.label} colour` }) as HTMLInputElement;
  const text = h('input', { type: 'text', class: 'color-hex', value, spellcheck: 'false', maxlength: '7' }) as HTMLInputElement;
  const commit = (v: string): void => {
    const n = normalizeHex(v);
    if (!n) {
      text.value = value;
      return;
    }
    value = n;
    text.value = n;
    picker.value = n.toLowerCase();
    o.onChange(n);
  };
  picker.addEventListener('input', () => commit(picker.value));
  text.addEventListener('change', () => commit(text.value));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(text.value);
  });
  const el = h('label', { class: 'field color-field' }, h('span', { class: 'field-label' }, o.label), h('span', { class: 'color-box' }, picker, text));
  return {
    el,
    get: () => value,
    set: (v) => {
      const n = normalizeHex(v);
      if (!n) return;
      value = n;
      text.value = n;
      picker.value = n.toLowerCase();
    },
  };
}

export function TextField(o: { label: string; value: string; placeholder?: string; title?: string; onChange: (v: string) => void }): Field<string> {
  const input = h('input', { type: 'text', class: 'text-input', value: o.value, placeholder: o.placeholder ?? '', spellcheck: 'false' }) as HTMLInputElement;
  input.addEventListener('change', () => o.onChange(input.value));
  const el = h('label', { class: 'field text-field', title: o.title ?? '' }, h('span', { class: 'field-label' }, o.label), input);
  return {
    el,
    get: () => input.value,
    set: (v) => {
      input.value = v;
    },
  };
}

export function SearchBox(o: { placeholder: string; onInput: (q: string) => void; onKey?: (e: KeyboardEvent) => void }): { el: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'search', class: 'search-input', placeholder: o.placeholder, spellcheck: 'false', autocomplete: 'off' }) as HTMLInputElement;
  input.addEventListener('input', () => o.onInput(input.value));
  if (o.onKey) input.addEventListener('keydown', o.onKey);
  return { el: h('div', { class: 'search-box' }, svg(ICONS.search), input), input };
}
