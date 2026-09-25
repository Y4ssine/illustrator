/**
 * LAYERS: template-driven organizer with a full preview (layer actions and
 * per-item moves with confidence and reasons) before anything changes.
 */

import { previewOrganize, type OrganizeParams } from '../../layers/layer-commands';
import { describeAction, DEFAULT_ORGANIZE_OPTIONS } from '../../layers/organizer';
import { NAMING_FORMATS, type NamingFormat } from '../../layers/naming';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, Select, Toggle } from '../components/controls';
import { Badge, Empty, Note, Row, Section } from '../components/layout';
import type { View } from './view';

export function LayersView(app: AppController): View {
  const p: OrganizeParams = { templateId: app.settings.layerTemplate, options: { ...DEFAULT_ORGANIZE_OPTIONS }, sortSelection: true, accepted: null };
  const unchecked = new Set<number>();

  const template = Select({
    label: 'Template',
    value: p.templateId,
    options: app.presets.list('layerTemplate').map((t) => ({ value: t.id, label: t.name, group: t.builtin ? 'Built-in' : 'Mine' })),
    onChange: (v) => {
      p.templateId = v;
      void app.saveSettings({ layerTemplate: v });
    },
  });
  const naming = Select<NamingFormat | 'template'>({
    label: 'Naming',
    value: app.settings.namingFormat ?? 'template',
    options: [{ value: 'template', label: 'As template' }, ...(Object.keys(NAMING_FORMATS) as NamingFormat[]).map((f) => ({ value: f, label: NAMING_FORMATS[f].label }))],
    onChange: (v) => void app.saveSettings({ namingFormat: v === 'template' ? null : v }),
  });
  const opt = (label: string, key: keyof OrganizeParams['options'], title: string): HTMLElement =>
    Toggle({ label, value: p.options[key], title, onChange: (v) => { p.options[key] = v; render(); } }).el;

  const preview = h('div', { class: 'organize-preview' });
  const applyBtn = Button({ label: 'Organize Layers', icon: 'layers', variant: 'primary', onClick: () => void apply() });

  async function apply(): Promise<void> {
    const snap = app.s.snapshot;
    if (!snap?.doc) return;
    const { proposals } = previewOrganize({ snapshot: snap, settings: app.settings, presets: app.presets }, p);
    const accepted = proposals.filter((x) => !x.blocked && x.selected && !unchecked.has(x.itemIndex)).map((x) => x.itemIndex);
    await app.run('layers.organize', { ...p, accepted }, { confirmed: true });
    unchecked.clear();
  }

  function render(): void {
    const snap = app.s.snapshot;
    if (!snap?.doc) {
      replaceChildren(preview, Empty('Open a document.'));
      applyBtn.disabled = true;
      return;
    }
    const { plan, proposals, template: t } = previewOrganize({ snapshot: snap, settings: app.settings, presets: app.presets }, p);
    const changes = plan.actions.filter((a) => a.kind !== 'keep');
    const kept = plan.actions.filter((a) => a.kind === 'keep');
    const movable = proposals.filter((x) => !x.blocked);
    applyBtn.disabled = changes.length === 0 && movable.length === 0;
    const itemRows = proposals.map((pr) => {
      const box = h('input', { type: 'checkbox', checked: pr.selected && !unchecked.has(pr.itemIndex), disabled: pr.blocked }) as HTMLInputElement;
      box.addEventListener('change', () => {
        if (box.checked) unchecked.delete(pr.itemIndex);
        else unchecked.add(pr.itemIndex);
      });
      return h(
        'li',
        { class: `proposal${pr.blocked ? ' blocked' : ''}` },
        h('label', null, box, h('span', { class: 'proposal-item' }, pr.itemLabel)),
        pr.targetLayer && !pr.blocked ? h('span', { class: 'proposal-target' }, `→ ${pr.targetLayer}`) : null,
        Badge(pr.confidence, pr.confidence === 'high' ? 'good' : pr.confidence === 'medium' ? 'neutral' : 'warn'),
        h('div', { class: 'proposal-reason' }, pr.reason),
      );
    });
    replaceChildren(
      preview,
      h('div', { class: 'subhead' }, `Layers — ${t.name}`),
      changes.length ? h('ul', { class: 'plan-list' }, ...changes.map((a) => h('li', { class: `plan-${a.kind}` }, describeAction(a)))) : Empty('Layer structure already matches.'),
      kept.length ? h('div', { class: 'muted small' }, `Recognised: ${kept.map((a) => a.name).join(', ')}`) : null,
      plan.unmatched.length ? h('div', { class: 'muted small' }, `Left untouched: ${plan.unmatched.join(', ')}`) : null,
      ...plan.warnings.map((w) => Note(w, 'warn')),
      p.sortSelection ? h('div', { class: 'subhead' }, `Selected items (${proposals.length})`) : null,
      p.sortSelection ? (proposals.length ? h('ul', { class: 'proposals' }, ...itemRows) : Empty('Select objects to sort them onto layers. Nothing outside the selection is moved.')) : null,
    );
  }

  const section = Section(
    { id: 'layers.organizer', title: 'Layer Organizer' },
    template.el,
    naming.el,
    opt('Rename recognised layers', 'renameMatched', 'e.g. “_GUIDES” → “00 — GUIDES”'),
    opt('Create missing layers', 'createMissing', 'Adds the template layers that do not exist yet'),
    opt('Reorder existing layers', 'reorderExisting', 'Off by default: moving layers with artwork changes what appears in front'),
    Toggle({ label: 'Sort selected items by rules', value: p.sortSelection, onChange: (v) => { p.sortSelection = v; render(); } }).el,
    preview,
    Row(applyBtn),
    Note('Layers are never deleted or merged. One Undo reverts the whole operation.'),
  );

  const el = h('div', { class: 'view' }, section.el);
  return {
    id: 'layers',
    title: 'Layers',
    el,
    update(_s, ch) {
      if (ch.has('settingsVersion')) {
        template.setOptions(app.presets.list('layerTemplate').map((t) => ({ value: t.id, label: t.name, group: t.builtin ? 'Built-in' : 'Mine' })));
        template.set(app.settings.layerTemplate);
        p.templateId = app.settings.layerTemplate;
        naming.set(app.settings.namingFormat ?? 'template');
      }
      if (ch.has('snapshot') || ch.has('settingsVersion') || ch.has('tab')) render();
    },
  };
}
