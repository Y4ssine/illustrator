/**
 * GRID: Smart Grid editor with live preview, quick guides, offsets, safe
 * areas and plugin-guide management.
 */

import type { GridParams, GridTarget } from '../../guides/grid-commands';
import { GRID_TARGET_LABEL } from '../../guides/grid-commands';
import type { GridSpec, TrackSpec } from '../../guides/grid-engine';
import { QUICK_GUIDE_LABELS, type QuickGuideKind } from '../../guides/guide-generator';
import { SAFE_ZONES } from '../../guides/safe-zones';
import { parseRatioList } from '../../geometry/ratio';
import { deepClone } from '../../utils/misc';
import type { GridPreset } from '../../presets/models';
import type { AppController } from '../app';
import { h } from '../dom';
import { Button, NumberField, Segmented, Select, TextField, Toggle } from '../components/controls';
import { ButtonGrid, Grid2, Note, Row, Section } from '../components/layout';
import { PresetBar } from '../components/preset-bar';
import type { View } from './view';

const MODES = ['columns', 'rows', 'baseline', 'thirds', 'golden', 'center'] as const;
type ModeKey = (typeof MODES)[number];

export function GridView(app: AppController): View {
  const unit = (): typeof app.settings.units => app.settings.units;
  const first = app.presets.get('grid', app.settings.gridPreset) ?? app.presets.list('grid')[0]!;
  const p: GridParams = { presetId: first.id, presetName: first.name, spec: deepClone(first.spec), target: 'activeArtboard', custom: null, replaceExisting: true };
  let previewOn = false;
  let linkedMargins = true;

  const changed = (fromPreset = false): void => {
    if (!fromPreset && p.presetId) {
      p.presetName = `${p.presetName.replace(/ \(edited\)$/, '')} (edited)`;
      p.presetId = null;
    }
    if (previewOn) app.preview('grid.build', p);
  };

  const cols = (): TrackSpec => (p.spec.columns ??= { count: 6, gutter: 24 });
  const rows = (): TrackSpec => (p.spec.rows ??= { count: 8, gutter: 24 });

  // ---- controls -----------------------------------------------------------
  const presetBar = PresetBar(app, 'grid', {
    value: p.presetId ?? first.id,
    onSelect: (preset: GridPreset) => {
      p.presetId = preset.id;
      p.presetName = preset.name;
      p.spec = deepClone(preset.spec);
      syncFields();
      changed(true);
    },
    capture: () => ({ spec: deepClone(p.spec) }),
  });

  const target = Select<GridTarget>({
    label: 'Target',
    value: p.target,
    options: (Object.keys(GRID_TARGET_LABEL) as GridTarget[]).filter((t) => t !== 'custom').map((t) => ({ value: t, label: GRID_TARGET_LABEL[t] })),
    onChange: (v) => {
      p.target = v;
      if (previewOn) app.preview('grid.build', p);
    },
  });

  const modeToggles = {} as Record<ModeKey, ReturnType<typeof Toggle>>;
  const modeLabels: Record<ModeKey, string> = { columns: 'Columns', rows: 'Rows', baseline: 'Baseline', thirds: 'Thirds', golden: 'Golden', center: 'Centre axes' };
  const modeOn = (k: ModeKey): boolean => (k === 'columns' ? !!p.spec.columns : k === 'rows' ? !!p.spec.rows : k === 'baseline' ? !!p.spec.baseline : !!p.spec[k]);
  for (const k of MODES) {
    modeToggles[k] = Toggle({
      label: modeLabels[k],
      value: modeOn(k),
      onChange: (v) => {
        if (k === 'columns') p.spec.columns = v ? { count: 6, gutter: 24 } : null;
        else if (k === 'rows') p.spec.rows = v ? { count: 8, gutter: 24 } : null;
        else if (k === 'baseline') p.spec.baseline = v ? { increment: 12, offset: 0 } : null;
        else p.spec[k] = v;
        syncFields();
        changed();
      },
    });
  }
  const diag = Select<'none' | 'corners' | 'fortyFive'>({
    label: 'Diagonals',
    value: p.spec.diagonals ?? 'none',
    options: [
      { value: 'none', label: 'None' },
      { value: 'corners', label: 'Corner to corner' },
      { value: 'fortyFive', label: '45° from corners' },
    ],
    onChange: (v) => {
      p.spec.diagonals = v;
      changed();
    },
  });
  const spokes = NumberField({ label: 'Radial', value: p.spec.radial?.spokes ?? 0, min: 0, max: 360, kind: 'count', width: 'narrow', title: 'Radial spokes from the centre (0 = off)', onChange: (v) => { p.spec.radial = v > 0 ? { spokes: v } : null; changed(); } });

  const colCount = NumberField({ label: 'Cols', value: cols().count, min: 1, max: 48, kind: 'count', onChange: (v) => { cols().count = v; cols().ratios = null; colRatios.set(''); changed(); } });
  const colGutter = NumberField({ label: 'Gutter', value: cols().gutter, min: 0, max: 1000, kind: 'length', unit, onChange: (v) => { cols().gutter = v; changed(); } });
  const colRatios = TextField({ label: 'Ratios', value: '', placeholder: 'e.g. 1:2:1', title: 'Custom column proportions (sets the column count)', onChange: (v) => { const r = parseRatioList(v); if (r) { cols().ratios = r; cols().count = r.length; colCount.set(r.length); } else cols().ratios = null; changed(); } });
  const rowCount = NumberField({ label: 'Rows', value: rows().count, min: 1, max: 48, kind: 'count', onChange: (v) => { rows().count = v; rows().ratios = null; rowRatios.set(''); changed(); } });
  const rowGutter = NumberField({ label: 'Gutter', value: rows().gutter, min: 0, max: 1000, kind: 'length', unit, onChange: (v) => { rows().gutter = v; changed(); } });
  const rowRatios = TextField({ label: 'Ratios', value: '', placeholder: 'e.g. 2:3:2', onChange: (v) => { const r = parseRatioList(v); if (r) { rows().ratios = r; rows().count = r.length; rowCount.set(r.length); } else rows().ratios = null; changed(); } });
  if (!first.spec.columns) p.spec.columns = null;
  if (!first.spec.rows) p.spec.rows = null;

  const baseInc = NumberField({ label: 'Baseline', value: p.spec.baseline?.increment ?? 12, min: 1, max: 500, kind: 'length', unit, onChange: (v) => { p.spec.baseline = { increment: v, offset: p.spec.baseline?.offset ?? 0 }; changed(); } });
  const baseOff = NumberField({ label: 'Offset', value: p.spec.baseline?.offset ?? 0, min: 0, max: 1000, kind: 'length', unit, onChange: (v) => { p.spec.baseline = { increment: p.spec.baseline?.increment ?? 12, offset: v }; changed(); } });

  const marginFields = (['top', 'right', 'bottom', 'left'] as const).map((side) =>
    NumberField({
      label: side === 'top' ? 'Top' : side === 'right' ? 'Right' : side === 'bottom' ? 'Bottom' : 'Left',
      value: p.spec.margins[side],
      min: 0,
      max: 5000,
      kind: 'length',
      unit,
      onChange: (v) => {
        if (linkedMargins) {
          p.spec.margins = { top: v, right: v, bottom: v, left: v };
          marginFields.forEach((f) => f.set(v));
        } else p.spec.margins[side] = v;
        changed();
      },
    }),
  );
  const link = Toggle({ label: 'Same on all sides', value: linkedMargins, onChange: (v) => (linkedMargins = v) });
  const marginGuides = Toggle({ label: 'Margin guides', value: p.spec.marginGuides ?? true, onChange: (v) => { p.spec.marginGuides = v; changed(); } });
  const spanArea = Toggle({ label: 'Column guides span full height', value: p.spec.spanArea ?? true, onChange: (v) => { p.spec.spanArea = v; changed(); } });
  const pixelSnap = Toggle({ label: 'Snap to whole pixels', value: p.spec.pixelSnap ?? false, onChange: (v) => { p.spec.pixelSnap = v; changed(); } });
  const replace = Toggle({ label: 'Replace earlier plugin grid on the artboard', value: p.replaceExisting, onChange: (v) => (p.replaceExisting = v) });
  const compOn = Segmented<'area' | 'content'>({ label: 'Helpers on', value: p.spec.compositionOn ?? 'area', options: [{ value: 'area', label: 'Area' }, { value: 'content', label: 'Content box' }], onChange: (v) => { p.spec.compositionOn = v; changed(); } });

  const previewBtn = Button({ label: 'Preview', icon: 'eye', onClick: () => togglePreview() });
  const buildBtn = Button({ label: 'Build Grid', icon: 'grid', variant: 'primary', onClick: () => void build() });

  function togglePreview(force?: boolean): void {
    previewOn = force ?? !previewOn;
    previewBtn.classList.toggle('on', previewOn);
    previewBtn.setAttribute('aria-pressed', String(previewOn));
    if (previewOn) app.preview('grid.build', p);
    else void app.cancelPreview();
  }

  async function build(): Promise<void> {
    await app.run('grid.build', { ...p, spec: deepClone(p.spec) });
    togglePreview(false);
  }

  function syncFields(): void {
    for (const k of MODES) modeToggles[k].set(modeOn(k));
    colsBox.hidden = !p.spec.columns;
    rowsBox.hidden = !p.spec.rows;
    baseBox.hidden = !p.spec.baseline;
    if (p.spec.columns) {
      colCount.set(p.spec.columns.count);
      colGutter.set(p.spec.columns.gutter);
      colRatios.set(p.spec.columns.ratios?.join(':') ?? '');
    }
    if (p.spec.rows) {
      rowCount.set(p.spec.rows.count);
      rowGutter.set(p.spec.rows.gutter);
      rowRatios.set(p.spec.rows.ratios?.join(':') ?? '');
    }
    if (p.spec.baseline) {
      baseInc.set(p.spec.baseline.increment);
      baseOff.set(p.spec.baseline.offset);
    }
    const m = p.spec.margins;
    marginFields[0]!.set(m.top);
    marginFields[1]!.set(m.right);
    marginFields[2]!.set(m.bottom);
    marginFields[3]!.set(m.left);
    diag.set(p.spec.diagonals ?? 'none');
    spokes.set(p.spec.radial?.spokes ?? 0);
    marginGuides.set(p.spec.marginGuides ?? true);
    spanArea.set(p.spec.spanArea ?? true);
    pixelSnap.set(p.spec.pixelSnap ?? false);
    compOn.set(p.spec.compositionOn ?? 'area');
  }

  const colsBox = h('div', { class: 'sub' }, Grid2(colCount.el, colGutter.el), colRatios.el);
  const rowsBox = h('div', { class: 'sub' }, Grid2(rowCount.el, rowGutter.el), rowRatios.el);
  const baseBox = h('div', { class: 'sub' }, Grid2(baseInc.el, baseOff.el));

  const gridSection = Section(
    { id: 'grid.smart', title: 'Smart Grid' },
    presetBar.el,
    target.el,
    h('div', { class: 'subhead' }, 'Structure'),
    h('div', { class: 'toggle-grid' }, ...MODES.map((k) => modeToggles[k].el)),
    colsBox,
    rowsBox,
    baseBox,
    Grid2(diag.el, spokes.el),
    h('div', { class: 'subhead' }, 'Margins'),
    Grid2(...marginFields.map((f) => f.el)),
    link.el,
    h('div', { class: 'subhead' }, 'Options'),
    marginGuides.el,
    spanArea.el,
    pixelSnap.el,
    replace.el,
    compOn.el,
    Row(previewBtn, buildBtn),
  );

  // ---- quick guides ---------------------------------------------------------
  let source: 'selection' | 'artboard' = 'selection';
  const quickKinds: QuickGuideKind[] = ['left', 'right', 'top', 'bottom', 'centerV', 'centerH', 'thirds', 'quarters', 'golden'];
  const quickSection = Section(
    { id: 'grid.quick', title: 'Guides' },
    Segmented<'selection' | 'artboard'>({ label: 'From', value: source, options: [{ value: 'selection', label: 'Selection' }, { value: 'artboard', label: 'Artboard' }], onChange: (v) => (source = v) }).el,
    ButtonGrid(...quickKinds.map((k) => Button({ label: QUICK_GUIDE_LABELS[k], small: true, onClick: () => void app.run('guides.quick', { kinds: [k], source }) }))),
    h('div', { class: 'subhead' }, 'Around selection'),
    (() => {
      let custom = 40;
      return h(
        'div',
        null,
        ButtonGrid(...[8, 16, 24, 32].map((o) => Button({ label: `+${o}`, small: true, onClick: () => void app.run('guides.offset', { offsets: [o] }) }))),
        Row(NumberField({ label: 'Custom', value: custom, min: -2000, max: 2000, kind: 'length', unit, onChange: (v) => (custom = v) }).el, Button({ label: 'Add', small: true, onClick: () => void app.run('guides.offset', { offsets: [custom] }) })),
      );
    })(),
  );

  // ---- safe areas ------------------------------------------------------------
  let zone = SAFE_ZONES[0]!.id;
  const zoneNote = Note(SAFE_ZONES[0]!.note);
  const safeSection = Section(
    { id: 'grid.safe', title: 'Safe areas', collapsed: true },
    Select({
      label: 'Zone',
      value: zone,
      options: SAFE_ZONES.map((z) => ({ value: z.id, label: z.name })),
      onChange: (v) => {
        zone = v;
        zoneNote.querySelector('span')!.textContent = SAFE_ZONES.find((z) => z.id === v)!.note;
      },
    }).el,
    zoneNote,
    Row(Button({ label: 'Add safe-area guides', onClick: () => void app.run('guides.safeZone', { zoneId: zone }) })),
  );

  // ---- manage ------------------------------------------------------------------
  const manageSection = Section(
    { id: 'grid.manage', title: 'Manage plugin guides', collapsed: true },
    ButtonGrid(
      Button({ label: 'Hide', small: true, onClick: () => void app.run('guides.hide') }),
      Button({ label: 'Show', small: true, onClick: () => void app.run('guides.show') }),
      Button({ label: 'Lock', small: true, onClick: () => void app.run('guides.lock') }),
      Button({ label: 'Unlock', small: true, onClick: () => void app.run('guides.unlock') }),
    ),
    ButtonGrid(
      Button({ label: 'Delete on artboard', small: true, variant: 'danger', onClick: () => void app.run('guides.deletePlugin', { scope: 'activeArtboard' }) }),
      Button({ label: 'Delete in document', small: true, variant: 'danger', onClick: () => void app.run('guides.deletePlugin', { scope: 'document' }) }),
    ),
    Note('Only grids and guides created by Artboard Forge are affected. Guides you drew yourself are never touched.'),
  );

  syncFields();
  app.onOpen('grid.', (params) => {
    const gp = params as GridParams;
    if (!gp?.spec) return;
    Object.assign(p, deepClone(gp));
    if (p.presetId) presetBar.set(p.presetId);
    target.set(p.target);
    syncFields();
  });

  const el = h('div', { class: 'view' }, gridSection.el, quickSection.el, safeSection.el, manageSection.el);
  return {
    id: 'grid',
    title: 'Grid',
    el,
    update(s, ch) {
      if (ch.has('settingsVersion')) {
        presetBar.refresh();
        syncFields();
      }
      if (ch.has('previewing') && s.previewing !== 'grid.build' && previewOn) togglePreview(false);
      buildBtn.disabled = !!s.busy && s.busy !== 'Preview';
    },
  };
}

export type { GridSpec };
