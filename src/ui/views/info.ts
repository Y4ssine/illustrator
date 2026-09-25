/**
 * INFOGRAPHIC: pick a block, paste data ("label | value | note" per line),
 * choose the look, preview and add. Arabic RTL and Arabic-Indic digits.
 */

import { INFO_BLOCKS, type CardStyle, type InfoBlockId } from '../../infographic/info-engine';
import { SAMPLE_DATA, defaultInfoParams, type InfoParams } from '../../infographic/info-commands';
import { ICONS as GLYPHS, type IconId } from '../../infographic/icons';
import type { AppController } from '../app';
import { h } from '../dom';
import { Button, Segmented, Select, Slider, TextField, Toggle } from '../components/controls';
import { Note, Row, Section } from '../components/layout';
import { PreviewApply, TextArea, TileGrid } from '../components/creative';
import type { View } from './view';

const BLOCK_GLYPH: Record<InfoBlockId, string> = {
  statCards: '<rect x="2" y="5" width="9" height="14" rx="2"/><rect x="13" y="5" width="9" height="14" rx="2"/>',
  barH: '<rect x="3" y="4" width="18" height="3" rx="1.5"/><rect x="3" y="10" width="12" height="3" rx="1.5"/><rect x="3" y="16" width="7" height="3" rx="1.5"/>',
  barV: '<rect x="3" y="13" width="4" height="8" rx="1"/><rect x="10" y="8" width="4" height="13" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>',
  donut: '<path d="M12 3a9 9 0 1 1-9 9h4a5 5 0 1 0 5-5Z"/>',
  pie: '<path d="M12 3a9 9 0 1 1-9 9h9Z"/>',
  progress: '<rect x="3" y="6" width="18" height="3" rx="1.5" opacity=".35"/><rect x="3" y="6" width="13" height="3" rx="1.5"/><rect x="3" y="14" width="18" height="3" rx="1.5" opacity=".35"/><rect x="3" y="14" width="8" height="3" rx="1.5"/>',
  rings: '<path d="M12 4a8 8 0 1 1-8 8" fill="none" stroke="currentColor" stroke-width="3"/>',
  steps: '<circle cx="5" cy="12" r="3"/><circle cx="12" cy="12" r="3"/><circle cx="19" cy="12" r="3"/><rect x="5" y="11.3" width="14" height="1.4"/>',
  timelineV: '<rect x="7" y="3" width="1.5" height="18"/><circle cx="7.7" cy="6" r="2.2"/><circle cx="7.7" cy="12" r="2.2"/><circle cx="7.7" cy="18" r="2.2"/><rect x="11" y="5" width="9" height="2"/><rect x="11" y="11" width="7" height="2"/><rect x="11" y="17" width="8" height="2"/>',
  timelineH: '<rect x="3" y="11.3" width="18" height="1.4"/><circle cx="6" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="18" cy="12" r="2.2"/>',
  comparison: '<rect x="3" y="5" width="8" height="3" rx="1.5"/><rect x="13" y="5" width="6" height="3" rx="1.5"/><rect x="5" y="11" width="6" height="3" rx="1.5"/><rect x="13" y="11" width="8" height="3" rx="1.5"/><rect x="2" y="17" width="9" height="3" rx="1.5"/><rect x="13" y="17" width="4" height="3" rx="1.5"/>',
  pictogram: '<circle cx="5" cy="8" r="2"/><rect x="3" y="11" width="4" height="7" rx="2"/><circle cx="12" cy="8" r="2"/><rect x="10" y="11" width="4" height="7" rx="2"/><circle cx="19" cy="8" r="2" opacity=".35"/><rect x="17" y="11" width="4" height="7" rx="2" opacity=".35"/>',
  iconList: '<circle cx="5" cy="6" r="2.5"/><rect x="10" y="5" width="11" height="2"/><circle cx="5" cy="12" r="2.5"/><rect x="10" y="11" width="9" height="2"/><circle cx="5" cy="18" r="2.5"/><rect x="10" y="17" width="10" height="2"/>',
  header: '<rect x="3" y="5" width="18" height="4" rx="1"/><rect x="3" y="11" width="6" height="1.5" rx=".75"/><rect x="3" y="15" width="14" height="2" rx="1" opacity=".5"/>',
};

const glyph = (body: string): string => `<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">${body}</svg>`;

export function InfoView(app: AppController): View {
  let p: InfoParams = defaultInfoParams('statCards', app.settings);

  const blockTiles = TileGrid<InfoBlockId>({
    items: INFO_BLOCKS.map((b) => ({ value: b.id, label: b.name, thumb: { svg: glyph(BLOCK_GLYPH[b.id]) } })),
    value: p.block,
    columns: 4,
    size: 'sm',
    onChange: (v) => {
      const keep = { card: p.card, theme: p.theme, roundness: p.roundness, direction: p.direction, digits: p.digits, fitSelection: p.fitSelection };
      p = { ...defaultInfoParams(v, app.settings), ...keep };
      syncAll();
      pa.changed();
    },
  });

  const data = TextArea({ label: 'Data', value: p.data, rows: 5, placeholder: 'label | value | note', title: 'One item per line: label | value | note. Also “label: value”. Arabic-Indic digits, % and thousands separators are understood.', onChange: (v) => ((p.data = v), pa.changed()) });
  const sampleAr = Button({ label: 'Arabic sample', small: true, variant: 'quiet', onClick: () => ((p.data = SAMPLE_DATA[p.block].ar), data.set(p.data), pa.changed()) });
  const sampleEn = Button({ label: 'English sample', small: true, variant: 'quiet', onClick: () => ((p.data = SAMPLE_DATA[p.block].en), data.set(p.data), pa.changed()) });

  // Block options
  const columns = Slider({ label: 'Columns', value: p.columns, min: 1, max: 6, onChange: (v) => ((p.columns = v), pa.changed()) });
  const suffix = TextField({ label: 'Suffix', value: p.suffix, placeholder: '% , +, K, ريال', onChange: (v) => ((p.suffix = v), pa.changed()) });
  const icons = Toggle({ label: 'Icons', value: p.icons, onChange: (v) => ((p.icons = v), pa.changed()) });
  const showValues = Toggle({ label: 'Show values', value: p.showValues, onChange: (v) => ((p.showValues = v), pa.changed()) });
  const thickness = Slider({ label: 'Thickness', value: p.thickness, min: 5, max: 95, format: (v) => `${Math.round(v)}%`, onChange: (v) => ((p.thickness = v), pa.changed()) });
  const center = TextField({ label: 'Centre text', value: p.center, onChange: (v) => ((p.center = v), pa.changed()) });
  const legend = Toggle({ label: 'Legend', value: p.legend, onChange: (v) => ((p.legend = v), pa.changed()) });
  const badge = Segmented<'circle' | 'hexagon' | 'square'>({ label: 'Badge', value: p.badge, options: [{ value: 'circle', label: 'Circle' }, { value: 'hexagon', label: 'Hexagon' }, { value: 'square', label: 'Square' }], onChange: (v) => ((p.badge = v), pa.changed()) });
  const numbered = Toggle({ label: 'Numbers (off = icons)', value: p.numbered, onChange: (v) => ((p.numbered = v), pa.changed()) });
  const titleA = TextField({ label: 'Side A', value: p.titleA, onChange: (v) => ((p.titleA = v), pa.changed()) });
  const titleB = TextField({ label: 'Side B', value: p.titleB, onChange: (v) => ((p.titleB = v), pa.changed()) });
  const total = Slider({ label: 'Total icons', value: p.total, min: 2, max: 100, onChange: (v) => ((p.total = v), pa.changed()) });
  const perRow = Slider({ label: 'Per row', value: p.perRow, min: 1, max: 20, onChange: (v) => ((p.perRow = v), pa.changed()) });
  const iconSel = Select<IconId>({ label: 'Icon', value: p.icon, options: GLYPHS.map((g) => ({ value: g.id, label: g.name })), onChange: (v) => ((p.icon = v), pa.changed()) });
  const caption = TextField({ label: 'Caption', value: p.caption, onChange: (v) => ((p.caption = v), pa.changed()) });
  const title = TextField({ label: 'Title', value: p.title, onChange: (v) => ((p.title = v), pa.changed()) });
  const subtitle = TextField({ label: 'Subtitle', value: p.subtitle, onChange: (v) => ((p.subtitle = v), pa.changed()) });
  const kicker = TextField({ label: 'Kicker', value: p.kicker, onChange: (v) => ((p.kicker = v), pa.changed()) });

  // Look
  const card = Select<CardStyle>({ label: 'Cards', value: p.card, options: [{ value: 'soft', label: 'Soft tint' }, { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'outline', label: 'Outline' }, { value: 'glass', label: 'Glass' }], onChange: (v) => ((p.card = v), pa.changed()) });
  const theme = Segmented<'light' | 'dark'>({ label: 'On', value: p.theme, options: [{ value: 'light', label: 'Light bg' }, { value: 'dark', label: 'Dark bg' }], onChange: (v) => ((p.theme = v), pa.changed()) });
  const round = Slider({ label: 'Roundness', value: p.roundness * 100, min: 0, max: 50, format: (v) => `${Math.round(v)}%`, onChange: (v) => ((p.roundness = v / 100), pa.changed()) });
  const dir = Segmented<'auto' | 'rtl' | 'ltr'>({ label: 'Direction', value: p.direction, options: [{ value: 'auto', label: 'Auto' }, { value: 'rtl', label: 'RTL' }, { value: 'ltr', label: 'LTR' }], onChange: (v) => ((p.direction = v), pa.changed()) });
  const digits = Segmented<'auto' | 'western' | 'arabic'>({ label: 'Digits', value: p.digits, options: [{ value: 'auto', label: 'Auto' }, { value: 'western', label: '123' }, { value: 'arabic', label: '١٢٣' }], onChange: (v) => ((p.digits = v), pa.changed()) });
  const fit = Toggle({ label: 'Fit to the selected placeholder', value: p.fitSelection, onChange: (v) => ((p.fitSelection = v), pa.changed()) });

  const pa = PreviewApply(app, { commandId: () => 'info.block', params: () => p, label: 'Add Infographic', icon: 'check' });

  const optionBox = h('div', { class: 'sub' });
  const show = (els: HTMLElement[]): void => {
    optionBox.textContent = '';
    for (const e of els) optionBox.appendChild(e);
    optionBox.hidden = els.length === 0;
  };
  function syncAll(): void {
    blockTiles.set(p.block);
    data.set(p.data);
    columns.set(p.columns);
    suffix.set(p.suffix);
    icons.set(p.icons);
    showValues.set(p.showValues);
    thickness.set(p.thickness);
    center.set(p.center);
    legend.set(p.legend);
    badge.set(p.badge);
    numbered.set(p.numbered);
    titleA.set(p.titleA);
    titleB.set(p.titleB);
    total.set(p.total);
    perRow.set(p.perRow);
    iconSel.set(p.icon);
    caption.set(p.caption);
    title.set(p.title);
    subtitle.set(p.subtitle);
    kicker.set(p.kicker);
    card.set(p.card);
    theme.set(p.theme);
    round.set(p.roundness * 100);
    dir.set(p.direction);
    digits.set(p.digits);
    fit.set(p.fitSelection);
    const hideData = p.block === 'header';
    data.el.hidden = hideData;
    sampleRow.hidden = hideData;
    switch (p.block) {
      case 'statCards':
        show([columns.el, suffix.el, icons.el]);
        break;
      case 'barH':
      case 'barV':
        show([suffix.el, showValues.el]);
        break;
      case 'donut':
        show([thickness.el, center.el, legend.el]);
        break;
      case 'pie':
        show([legend.el]);
        break;
      case 'progress':
      case 'rings':
        show([thickness.el, suffix.el]);
        break;
      case 'steps':
        show([badge.el, numbered.el]);
        break;
      case 'comparison':
        show([titleA.el, titleB.el, suffix.el]);
        break;
      case 'pictogram':
        show([iconSel.el, total.el, perRow.el, caption.el]);
        break;
      case 'iconList':
        show([icons.el]);
        break;
      case 'header':
        show([title.el, subtitle.el, kicker.el]);
        break;
      default:
        show([]);
    }
  }
  const sampleRow = Row(sampleAr, sampleEn);

  const main = Section(
    { id: 'info.block', title: 'Infographic blocks', hint: 'Select a placeholder rectangle to fit the block into it, or leave nothing selected to place it on the artboard.' },
    blockTiles.el,
    data.el,
    sampleRow,
    optionBox,
    h('div', { class: 'subhead' }, 'Look'),
    card.el,
    theme.el,
    round.el,
    dir.el,
    digits.el,
    fit.el,
    pa.el,
  );
  const notes = Section(
    { id: 'info.notes', title: 'Notes', collapsed: true },
    Note('Everything is live, editable art: text stays text (World-Ready composer, right-to-left for Arabic), charts are exact vector paths. Colours come from the palette in the Colour tab.'),
    Note('Fonts: the first installed font from Settings › Fonts is used (Tajawal, Cairo, Almarai, DIN Next Arabic…). Missing fonts fall back to Illustrator’s default with a warning.'),
    Note('To change numbers later, select the block and add it again with new data; the old group can be deleted (it is tagged “INFOGRAPHIC — …”).'),
  );

  syncAll();
  const el = h('div', { class: 'view' }, main.el, notes.el);
  return {
    id: 'info',
    title: 'Infographic',
    el,
    update(s, ch) {
      if (ch.has('previewing') && !s.previewing?.startsWith('info.')) pa.stop();
      pa.applyBtn.disabled = !!s.busy && s.busy !== 'Preview';
    },
  };
}
