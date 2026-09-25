/**
 * PresetDropdown with Save as / Rename / Duplicate / Delete. Built-in presets
 * are read-only (Duplicate makes an editable copy).
 */

import type { PresetKind, PresetKindMap } from '../../presets/models';
import type { AppController } from '../app';
import { h } from '../dom';
import { Button, Select } from './controls';
import { confirmDialog, promptDialog } from './overlays';

export interface PresetBarHandle {
  el: HTMLElement;
  value(): string;
  set(id: string): void;
  refresh(): void;
}

export function PresetBar<K extends PresetKind>(
  app: AppController,
  kind: K,
  o: {
    label?: string;
    value: string;
    onSelect: (preset: PresetKindMap[K]) => void;
    /** Current editor state, used by "Save as new". */
    capture: () => Omit<PresetKindMap[K], 'id' | 'name' | 'builtin'>;
  },
): PresetBarHandle {
  const options = (): Array<{ value: string; label: string; group: string }> =>
    app.presets.list(kind).map((p) => ({ value: p.id, label: p.name, group: p.builtin ? 'Built-in' : 'Mine' }));
  const sel = Select({
    label: o.label ?? 'Preset',
    value: o.value,
    options: options(),
    onChange: (id) => {
      const p = app.presets.get(kind, id);
      if (p) o.onSelect(p);
      sync();
    },
  });
  const current = (): PresetKindMap[K] | undefined => app.presets.get(kind, sel.get());
  const saveAs = Button({
    icon: 'presets',
    title: 'Save current settings as a new preset',
    variant: 'quiet',
    onClick: async () => {
      const name = await promptDialog(app.root, { title: 'Save preset', label: 'Name', value: `${current()?.name ?? 'Preset'} (custom)` });
      if (!name) return;
      try {
        const p = await app.presets.create(kind, name, o.capture());
        sel.setOptions(options());
        sel.set(p.id);
        sync();
        app.toasts.show({ kind: 'success', message: `Saved preset “${p.name}”.` });
      } catch (e) {
        app.reportError(e);
      }
    },
  });
  const more = h('select', { class: 'select preset-menu', title: 'Preset actions', 'aria-label': 'Preset actions' }) as HTMLSelectElement;
  const fillMenu = (): void => {
    const p = current();
    const own = !!p && !p.builtin;
    more.innerHTML = '';
    more.append(
      h('option', { value: '' }, '⋯'),
      h('option', { value: 'update', disabled: !own }, 'Update with current settings'),
      h('option', { value: 'duplicate' }, 'Duplicate'),
      h('option', { value: 'rename', disabled: !own }, 'Rename…'),
      h('option', { value: 'delete', disabled: !own }, 'Delete…'),
    );
  };
  more.addEventListener('change', async () => {
    const action = more.value;
    more.value = '';
    const p = current();
    if (!p) return;
    try {
      if (action === 'duplicate') {
        const copy = await app.presets.duplicate(kind, p.id);
        sel.setOptions(options());
        sel.set(copy.id);
      } else if (action === 'update') {
        await app.presets.save(kind, { ...(o.capture() as object), id: p.id, name: p.name } as PresetKindMap[K]);
        app.toasts.show({ kind: 'success', message: `Updated “${p.name}”.` });
      } else if (action === 'rename') {
        const name = await promptDialog(app.root, { title: 'Rename preset', label: 'Name', value: p.name });
        if (name) await app.presets.rename(kind, p.id, name);
        sel.setOptions(options());
      } else if (action === 'delete') {
        if (await confirmDialog(app.root, { title: 'Delete preset', message: `Delete “${p.name}”? This cannot be undone.`, destructive: true })) {
          await app.presets.remove(kind, p.id);
          sel.setOptions(options());
          const first = app.presets.list(kind)[0];
          if (first) o.onSelect(first);
        }
      }
    } catch (e) {
      app.reportError(e);
    }
    sync();
  });
  const sync = (): void => fillMenu();
  fillMenu();
  const el = h('div', { class: 'preset-bar' }, sel.el, saveAs, more);
  return {
    el,
    value: () => sel.get(),
    set: (id) => {
      sel.set(id);
      sync();
    },
    refresh: () => {
      sel.setOptions(options());
      sync();
    },
  };
}
