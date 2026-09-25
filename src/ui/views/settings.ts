/**
 * Settings, diagnostics and privacy statement.
 */

import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import { UNITS, type Unit } from '../../geometry/units';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, NumberField, Segmented, Select, TextField, Toggle } from '../components/controls';
import { Note, Readout, Row, Section } from '../components/layout';
import { confirmDialog, copyText } from '../components/overlays';
import type { View } from './view';

export function SettingsView(app: AppController): View {
  const body = h('div', null);
  const diag = h('div', null);
  const save = (patch: Partial<Settings>): void => void app.saveSettings(patch);

  function render(): void {
    const s = app.settings;
    replaceChildren(
      body,
      Segmented<Unit>({ label: 'Units', value: s.units, options: UNITS.map((u) => ({ value: u, label: u })), onChange: (v) => save({ units: v }) }).el,
      Segmented<'compact' | 'comfortable'>({ label: 'Density', value: s.density, options: [{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }], onChange: (v) => save({ density: v }) }).el,
      Segmented<'rtl' | 'ltr'>({ label: 'Direction', value: s.direction, options: [{ value: 'rtl', label: 'RTL (Arabic)' }, { value: 'ltr', label: 'LTR' }], onChange: (v) => save({ direction: v }) }).el,
      Segmented<'visible' | 'geometric'>({ label: 'Bounds', value: s.boundsMode, options: [{ value: 'visible', label: 'Visible (incl. stroke)' }, { value: 'geometric', label: 'Geometric' }], onChange: (v) => save({ boundsMode: v }) }).el,
      Select({ label: 'Spacing system', value: s.spacingPreset, options: app.presets.list('spacing').map((p) => ({ value: p.id, label: p.name })), onChange: (v) => save({ spacingPreset: v }) }).el,
      Select({ label: 'Default shadow', value: s.shadowPreset, options: app.presets.list('shadow').map((p) => ({ value: p.id, label: p.name })), onChange: (v) => save({ shadowPreset: v }) }).el,
      Select({ label: 'Default grid', value: s.gridPreset, options: app.presets.list('grid').map((p) => ({ value: p.id, label: p.name })), onChange: (v) => save({ gridPreset: v }) }).el,
      TextField({ label: 'Guide layer', value: s.guideLayerName, title: 'Name used when a guides layer has to be created', onChange: (v) => save({ guideLayerName: v.trim() || '_GUIDES' }) }).el,
      TextField({ label: 'Artboard names', value: s.artboardNamePattern, title: 'Tokens: {CODE}, {name}, {n}, {nn}, {nnn}', onChange: (v) => save({ artboardNamePattern: v || '{CODE}_{nn}' }) }).el,
      NumberField({ label: 'Artboard gap', value: s.artboardSpacing, min: 0, max: 2000, kind: 'length', unit: () => app.settings.units, onChange: (v) => save({ artboardSpacing: v }) }).el,
      Toggle({ label: 'Safe Mode — confirm destructive operations', value: s.safeMode, onChange: (v) => save({ safeMode: v }) }).el,
      NumberField({ label: 'Poll (ms)', value: s.pollInterval, min: 300, max: 5000, step: 50, kind: 'count', title: 'How often the panel checks the selection (Illustrator has no selection-change event for panels).', onChange: (v) => save({ pollInterval: v }) }).el,
      Row(
        Button({
          label: 'Reset settings',
          small: true,
          variant: 'quiet',
          onClick: async () => {
            if (await confirmDialog(app.root, { title: 'Reset settings', message: 'Restore all settings to their defaults? Presets are not affected.' })) save({ ...DEFAULT_SETTINGS });
          },
        }),
      ),
    );
    const info = app.s.info;
    const lines: Array<[string, string]> = [
      ['Host', info ? `${info.host} ${info.version}` : 'not connected'],
      ['UUID refs', info?.capabilities.uuid ? 'yes' : 'no (selection index fallback)'],
      ['Stop opacity', info?.capabilities.gradientStopOpacity ? 'yes' : 'fallback'],
      ['Live effects', info?.capabilities.applyEffect ? 'yes' : 'no'],
      ['Panel', '0.1.0'],
    ];
    replaceChildren(
      diag,
      Readout(lines),
      Row(
        Button({
          label: 'Copy diagnostics',
          icon: 'copy',
          small: true,
          variant: 'quiet',
          onClick: () => copyText(JSON.stringify({ info, settings: app.settings, ua: navigator.userAgent, history: app.history.list().map((h2) => h2.commandId) }, null, 2)),
        }),
      ),
    );
  }

  const el = h(
    'div',
    { class: 'view' },
    Section({ id: 'settings.main', title: 'Settings' }, body).el,
    Section({ id: 'settings.diag', title: 'Diagnostics', collapsed: true }, diag).el,
    Section(
      { id: 'settings.privacy', title: 'Privacy', collapsed: true },
      Note('Artboard Forge works offline. It has no telemetry, uploads nothing and needs no account. Presets, settings and history are local JSON files.'),
    ).el,
  );
  render();
  return {
    id: 'settings',
    title: 'Settings',
    el,
    update(_s, ch) {
      if (ch.has('settingsVersion') || ch.has('info')) render();
    },
  };
}
