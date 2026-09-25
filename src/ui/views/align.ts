/**
 * ALIGN: spacing readout + spacing commands, two-object measurements and
 * artboard margins (read-only).
 */

import type { Axis } from '../../geometry/rect';
import { formatLength } from '../../geometry/units';
import { pairDistance, unionRects } from '../../geometry/rect';
import { activeArtboard } from '../../core/snapshot';
import { analyzeSelectionSpacing, partitionSelection, spacingAnchor, type SpacingParams } from '../../layout/spacing-commands';
import { itemBounds } from '../../core/commands/helpers';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, NumberField, Segmented, Select } from '../components/controls';
import { ButtonGrid, Empty, Note, Readout, Row, Section } from '../components/layout';
import { copyText } from '../components/overlays';
import type { View } from './view';

export function AlignView(app: AppController): View {
  const unit = (): typeof app.settings.units => app.settings.units;
  const fmt = (v: number): string => formatLength(v, unit());
  let axis: Axis | 'auto' = 'auto';
  let exact = 32;

  const readout = h('div', { class: 'spacing-readout' });
  const system = Select({
    label: 'System',
    value: app.settings.spacingPreset,
    options: app.presets.list('spacing').map((p) => ({ value: p.id, label: p.name })),
    onChange: (v) => void app.saveSettings({ spacingPreset: v }),
  });
  const axisSeg = Segmented<Axis | 'auto'>({
    label: 'Axis',
    value: axis,
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'x', label: '↔' , title: 'Horizontal' },
      { value: 'y', label: '↕', title: 'Vertical' },
    ],
    onChange: (v) => {
      axis = v;
      render();
    },
  });
  const dir = Segmented<'rtl' | 'ltr'>({
    label: 'Keep fixed',
    value: app.settings.direction,
    options: [
      { value: 'rtl', label: 'Right (RTL)', title: 'Arabic layouts: the right-most object stays put' },
      { value: 'ltr', label: 'Left (LTR)' },
    ],
    onChange: (v) => void app.saveSettings({ direction: v }),
  });
  const run = (id: string, params?: Partial<SpacingParams>): void => {
    const cmd = app.command(id)!;
    const base = app.defaultParams(cmd) as SpacingParams;
    void app.run(id, { ...base, ...params, axis });
  };

  const spacingSection = Section(
    { id: 'align.spacing', title: 'Spacing' },
    readout,
    system.el,
    axisSeg.el,
    dir.el,
    ButtonGrid(
      Button({ label: 'Normalize', variant: 'primary', small: true, title: 'Snap every gap to the spacing system', onClick: () => run('spacing.normalize') }),
      Button({ label: 'Distribute', small: true, title: 'Equal gaps between the outer two', onClick: () => run('spacing.distribute') }),
      Button({ label: 'Match smallest', small: true, onClick: () => run('spacing.matchSmallest') }),
      Button({ label: 'Match largest', small: true, onClick: () => run('spacing.matchLargest') }),
      Button({ label: 'Match first', small: true, onClick: () => run('spacing.matchFirst') }),
    ),
    Row(
      NumberField({ label: 'Gap', value: exact, min: -5000, max: 5000, kind: 'length', unit, onChange: (v) => (exact = v) }).el,
      Button({ label: 'Set exact gap', small: true, onClick: () => run('spacing.exact', { operation: { kind: 'exact', value: exact } }) }),
    ),
  );

  const measureBox = h('div', null);
  const measureSection = Section({ id: 'align.measure', title: 'Measure', collapsed: false }, measureBox);
  const marginBox = h('div', null);
  const marginSection = Section({ id: 'align.margins', title: 'Margins to artboard', collapsed: true }, marginBox);

  function render(): void {
    const snap = app.s.snapshot;
    if (!snap?.doc) {
      replaceChildren(readout, Empty('Open a document.'));
      replaceChildren(measureBox, Empty('—'));
      replaceChildren(marginBox, Empty('—'));
      return;
    }
    const a = analyzeSelectionSpacing(snap, app.settings, app.presets, axis);
    const followers = [...partitionSelection(snap).followers.values()].reduce((n, l) => n + l.length, 0);
    if (!a) {
      replaceChildren(readout, Empty('Select two or more objects to see their gaps.'));
    } else {
      const gaps = a.gaps.map((g) => h('span', { class: `gap${g < 0 ? ' overlap' : ''}` }, String(Math.round(g * 10) / 10)));
      replaceChildren(
        readout,
        h('div', { class: 'gap-strip', title: 'Gaps in reading order along the axis' }, ...gaps.flatMap((g, i) => (i ? [h('span', { class: 'gap-sep' }, '·'), g] : [g]))),
        Readout([
          ['Axis', a.axis === 'x' ? `Horizontal (${spacingAnchor(app.settings, 'x') === 'end' ? 'right' : 'left'} fixed)` : 'Vertical (top fixed)'],
          ['Current', a.uniform ? `${fmt(a.gaps[0]!)} (uniform)` : `${fmt(a.min!)} – ${fmt(a.max!)}`],
          ['Average', fmt(a.mean!)],
          ['Suggested', a.suggested !== null ? fmt(a.suggested) : '—'],
        ]),
        a.overlaps ? Note(`${a.overlaps} pair(s) overlap along this axis.`, 'warn') : null,
        followers ? Note(`${followers} linked shadow(s) will move with their subject.`) : null,
      );
    }

    // Measure (two objects)
    const items = snap.selection.items;
    if (items.length === 2) {
      const r1 = itemBounds(items[0]!, app.settings);
      const r2 = itemBounds(items[1]!, app.settings);
      const d = pairDistance(r1, r2);
      const rows: Array<[string, string]> = [
        ['Horizontal gap', d.gapX >= 0 ? fmt(d.gapX) : `overlap ${fmt(-d.gapX)}`],
        ['Vertical gap', d.gapY >= 0 ? fmt(d.gapY) : `overlap ${fmt(-d.gapY)}`],
        ['Edge distance', fmt(d.edge)],
        ['Centre distance', fmt(d.center)],
        ['Size A', `${fmt(r1.w)} × ${fmt(r1.h)}`],
        ['Size B', `${fmt(r2.w)} × ${fmt(r2.h)}`],
      ];
      replaceChildren(measureBox, Readout(rows), Row(Button({ label: 'Copy values', icon: 'copy', small: true, variant: 'quiet', onClick: () => copyText(rows.map(([k, v]) => `${k}: ${v}`).join('\n')) })));
    } else {
      replaceChildren(measureBox, Empty('Select exactly two objects.'));
    }

    // Margins
    const ab = activeArtboard(snap.doc);
    const u = unionRects(items.map((i) => itemBounds(i, app.settings)));
    if (ab && u) {
      const L = u.x - ab.rect.x;
      const R = ab.rect.x + ab.rect.w - (u.x + u.w);
      const T = u.y - ab.rect.y;
      const B = ab.rect.y + ab.rect.h - (u.y + u.h);
      replaceChildren(
        marginBox,
        Readout([
          ['Left', fmt(L)],
          ['Right', fmt(R)],
          ['Top', fmt(T)],
          ['Bottom', fmt(B)],
        ]),
        Math.abs(L - R) > 1 ? Note(`Left/right differ by ${fmt(Math.abs(L - R))}.`) : null,
      );
    } else replaceChildren(marginBox, Empty('Select something on the active artboard.'));
  }

  const el = h('div', { class: 'view' }, spacingSection.el, measureSection.el, marginSection.el);
  return {
    id: 'align',
    title: 'Spacing & Align',
    el,
    update(_s, ch) {
      if (ch.has('snapshot') || ch.has('settingsVersion') || ch.has('tab')) render();
      if (ch.has('settingsVersion')) {
        system.setOptions(app.presets.list('spacing').map((p) => ({ value: p.id, label: p.name })));
        system.set(app.settings.spacingPreset);
        dir.set(app.settings.direction);
      }
    },
  };
}
