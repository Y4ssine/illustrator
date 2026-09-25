/**
 * PRESETS: browse, duplicate, rename, delete, edit (JSON, validated), import
 * and export presets of every kind.
 */

import { PRESET_KIND_LABEL, PRESET_KINDS, type PresetKind } from '../../presets/models';
import { validatePreset } from '../../presets/serialize';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, Select } from '../components/controls';
import { Badge, Empty, Note, Row, Section } from '../components/layout';
import { confirmDialog, promptDialog } from '../components/overlays';
import type { View } from './view';

export function PresetsView(app: AppController): View {
  let kind: PresetKind = 'shadow';
  let editing: string | null = null;
  const list = h('ul', { class: 'preset-list' });
  const editor = h('div', { class: 'preset-editor' });

  const kindSel = Select<PresetKind>({
    label: 'Kind',
    value: kind,
    options: PRESET_KINDS.map((k) => ({ value: k, label: PRESET_KIND_LABEL[k] })),
    onChange: (v) => {
      kind = v;
      editing = null;
      render();
    },
  });

  async function act(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      app.reportError(e);
    }
    render();
  }

  function openEditor(id: string): void {
    const preset = app.presets.get(kind, id);
    if (!preset || preset.builtin) return;
    editing = id;
    const { id: _id, name: _name, builtin: _b, ...data } = preset as unknown as Record<string, unknown>;
    const ta = h('textarea', { class: 'json-editor', spellcheck: 'false', rows: '14' }, JSON.stringify(data, null, 2)) as HTMLTextAreaElement;
    const err = h('div', { class: 'note note-warn', hidden: true });
    replaceChildren(
      editor,
      h('div', { class: 'subhead' }, `Edit “${preset.name}” (JSON)`),
      ta,
      err,
      Row(
        Button({ label: 'Cancel', small: true, onClick: () => { editing = null; replaceChildren(editor); } }),
        Button({
          label: 'Save',
          small: true,
          variant: 'primary',
          onClick: () =>
            void act(async () => {
              let data2: unknown;
              try {
                data2 = JSON.parse(ta.value);
              } catch (e) {
                err.hidden = false;
                err.textContent = `Not valid JSON: ${(e as Error).message}`;
                throw new Error('Fix the JSON first.');
              }
              const candidate = { ...(data2 as object), id: preset.id, name: preset.name };
              const v = validatePreset(kind, candidate);
              if (typeof v === 'string') {
                err.hidden = false;
                err.textContent = v;
                throw new Error(`Preset is invalid: ${v}`);
              }
              await app.presets.save(kind, v as never);
              editing = null;
              replaceChildren(editor);
              app.toasts.show({ kind: 'success', message: `Saved “${preset.name}”.` });
            }),
        }),
      ),
    );
  }

  function render(): void {
    const presets = app.presets.list(kind);
    replaceChildren(
      list,
      ...(presets.length
        ? presets.map((p) => {
            const actions = h(
              'span',
              { class: 'preset-actions' },
              Button({ label: 'Duplicate', small: true, variant: 'quiet', onClick: () => void act(() => app.presets.duplicate(kind, p.id)) }),
              p.builtin
                ? null
                : Button({
                    label: 'Rename',
                    small: true,
                    variant: 'quiet',
                    onClick: () =>
                      void act(async () => {
                        const name = await promptDialog(app.root, { title: 'Rename preset', label: 'Name', value: p.name });
                        if (name) await app.presets.rename(kind, p.id, name);
                      }),
                  }),
              p.builtin ? null : Button({ label: 'Edit', small: true, variant: 'quiet', onClick: () => openEditor(p.id) }),
              p.builtin
                ? null
                : Button({
                    label: 'Delete',
                    small: true,
                    variant: 'quiet',
                    onClick: () =>
                      void act(async () => {
                        if (await confirmDialog(app.root, { title: 'Delete preset', message: `Delete “${p.name}”?`, destructive: true })) await app.presets.remove(kind, p.id);
                      }),
                  }),
            );
            return h('li', { class: editing === p.id ? 'editing' : '' }, h('span', { class: 'preset-name' }, p.name), p.builtin ? Badge('built-in') : Badge('mine', 'good'), p.notes ? h('div', { class: 'preset-notes' }, p.notes) : null, actions);
          })
        : [Empty(`No ${PRESET_KIND_LABEL[kind].toLowerCase()} presets yet${['pattern', 'lighting', 'export'].includes(kind) ? ' — this module is planned for a later phase; presets can already be stored.' : '.'}`)]),
    );
  }

  const section = Section(
    { id: 'presets.list', title: 'Presets' },
    kindSel.el,
    list,
    editor,
    Row(
      Button({
        label: 'Import…',
        small: true,
        onClick: () =>
          void act(async () => {
            const f = await app.host.storage.importFile('Import Artboard Forge presets');
            if (!f) return;
            const r = await app.presets.importText(f.text);
            if (r.kind) kind = r.kind;
            kindSel.set(kind);
            app.toasts.show({ kind: r.errors.length ? 'warn' : 'success', message: `Imported ${r.added} preset(s) from ${f.name}.`, warnings: r.errors });
          }),
      }),
      Button({
        label: 'Export…',
        small: true,
        onClick: () =>
          void act(async () => {
            const path = await app.host.storage.exportFile('Export presets', `artboard-forge-${kind}-presets.json`, app.presets.exportText(kind));
            if (path) app.toasts.show({ kind: 'success', message: `Exported to ${path}` });
          }),
      }),
    ),
    Note('Presets are JSON files in your Adobe user-data folder (ArtboardForge). Built-in presets are read-only; duplicate one to customise it.'),
  );
  render();
  const el = h('div', { class: 'view' }, section.el);
  return {
    id: 'presets',
    title: 'Presets',
    el,
    update(_s, ch) {
      if (ch.has('settingsVersion') && !editing) render();
    },
  };
}
