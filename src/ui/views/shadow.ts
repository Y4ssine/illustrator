/**
 * SHADOW (v2): studio ground, light-driven cast, true silhouette, contact,
 * floating and long shadows with live preview, presets, the shared scene
 * light, and "Edit existing shadow" when a plugin shadow is selected.
 */

import { BLEND_MODES, type BlendMode } from '../../core/protocol';
import { AF_TYPE_LABEL } from '../../core/tags';
import { sanitizeShadowParams, SHADOW_COLORS, SHADOW_STYLES, SUBJECT_KINDS, type Footprint, type ShadowParams, type ShadowStyle, type SubjectKind } from '../../effects/shadow-engine';
import { selectedShadows, storedShadowParams, type ShadowCommandParams } from '../../effects/shadow-commands';
import { lightColor } from '../../effects/light-engine';
import { deepClone } from '../../utils/misc';
import type { ShadowPreset } from '../../presets/models';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, ColorField, Segmented, Select, Slider, Toggle } from '../components/controls';
import { Badge, Note, Row, Section } from '../components/layout';
import { PresetBar } from '../components/preset-bar';
import { Chips, Compass, TileGrid } from '../components/creative';
import { BLEND_LABEL } from './light';
import type { View } from './view';

const STYLE_GLYPH: Record<ShadowStyle, string> = {
  ground: '<rect x="9" y="4" width="6" height="12" rx="1.5" fill="currentColor"/><ellipse cx="12" cy="17.5" rx="8" ry="2.2" fill="#000" opacity=".25"/><ellipse cx="12" cy="17" rx="4" ry="1" fill="#000" opacity=".6"/>',
  cast: '<rect x="6" y="4" width="5" height="12" rx="1.5" fill="currentColor"/><path d="M6 16h5l11 5H13Z" fill="#000" opacity=".45"/>',
  silhouette: '<circle cx="9" cy="6" r="2.2" fill="currentColor"/><rect x="6.5" y="9" width="5" height="7" rx="2" fill="currentColor"/><path d="M6.5 16h5l9 4h-6Z" fill="#000" opacity=".45"/>',
  contact: '<rect x="9" y="4" width="6" height="12" rx="1.5" fill="currentColor"/><ellipse cx="12" cy="16.8" rx="4.5" ry=".9" fill="#000" opacity=".7"/>',
  floating: '<rect x="5" y="5" width="14" height="9" rx="2" fill="currentColor"/><rect x="6" y="9" width="12" height="9" rx="2" fill="#000" opacity=".22"/>',
  long: '<circle cx="9" cy="9" r="5" fill="currentColor"/><path d="M5.5 12.5 14 21h8V14L12.5 5.5Z" fill="#000" opacity=".3"/>',
};

export function ShadowView(app: AppController): View {
  const initial = app.presets.get('shadow', app.settings.shadowPreset) ?? app.presets.list('shadow')[0]!;
  let params: ShadowParams = sanitizeShadowParams({ ...initial.params, lightAngle: app.settings.lightRig.angle, elevation: app.settings.lightRig.elevation });
  let presetId: string | null = initial.id;
  let editMode = false;
  let previewOn = false;
  let linkLight = true;

  const pct = (v: number): string => `${Math.round(v)}%`;
  const commandId = (): string => (editMode ? 'shadow.edit' : 'shadow.create');
  const cmdParams = (): unknown => (editMode ? { params } : ({ presetId, params } satisfies ShadowCommandParams));

  const changed = (fromPreset = false): void => {
    if (!fromPreset) presetId = null;
    if (previewOn && !editMode) app.preview(commandId(), cmdParams());
  };

  const presetBar = PresetBar(app, 'shadow', {
    value: initial.id,
    onSelect: (p: ShadowPreset) => {
      params = sanitizeShadowParams({ ...deepClone(p.params), ...(linkLight ? { lightAngle: app.settings.lightRig.angle, elevation: app.settings.lightRig.elevation } : {}) });
      presetId = p.id;
      sync();
      changed(true);
    },
    capture: () => ({ params: deepClone(params) }),
  });

  const styleTiles = TileGrid<ShadowStyle>({
    items: SHADOW_STYLES.map((s) => ({ value: s.id, label: s.name, title: s.hint, thumb: { svg: `<svg viewBox="0 0 24 24" width="24" height="24">${STYLE_GLYPH[s.id]}</svg>` } })),
    value: params.style,
    columns: 3,
    size: 'sm',
    onChange: (v) => {
      params.style = v;
      sync();
      changed();
    },
  });
  const styleHint = h('p', { class: 'hint' });
  const subject = Select<SubjectKind>({ label: 'Subject', value: params.subject, options: SUBJECT_KINDS.map((s) => ({ value: s.id, label: s.name })), title: 'Shapes the footprint and, for cast shadows of images, the silhouette.', onChange: (v) => ((params.subject = v), changed()) });

  // Light
  const compass = Compass({
    label: 'Light from',
    value: params.lightAngle,
    color: lightColor(app.settings.lightRig),
    onInput: (v) => ((params.lightAngle = v), changed()),
    onChange: (v) => {
      params.lightAngle = v;
      if (linkLight) void app.saveSettings({ lightRig: { ...app.settings.lightRig, angle: v } });
      changed();
    },
  });
  const elevation = Slider({
    label: 'Light height',
    value: params.elevation,
    min: 5,
    max: 90,
    format: (v) => `${Math.round(v)}°`,
    title: 'Low = long shadows (sunset) · high = short shadows (noon)',
    onInput: (v) => ((params.elevation = v), changed()),
    onChange: (v) => {
      params.elevation = v;
      if (linkLight) void app.saveSettings({ lightRig: { ...app.settings.lightRig, elevation: v } });
      changed();
    },
  });
  const link = Toggle({ label: 'Use the scene light (Light tab)', value: linkLight, onChange: (v) => {
    linkLight = v;
    if (v) {
      params.lightAngle = app.settings.lightRig.angle;
      params.elevation = app.settings.lightRig.elevation;
      sync();
      changed();
    }
  } });

  // Look
  const strength = Slider({ label: 'Strength', value: params.strength, min: 0, max: 100, format: pct, onInput: (v) => ((params.strength = v), changed()), onChange: (v) => ((params.strength = v), changed()) });
  const softness = Slider({ label: 'Softness', value: params.softness, min: 0, max: 100, format: pct, onInput: (v) => ((params.softness = v), changed()), onChange: (v) => ((params.softness = v), changed()) });
  const length = Slider({ label: 'Length', value: params.length, min: 10, max: 300, format: pct, title: 'Scales the physical shadow length', onInput: (v) => ((params.length = v), changed()), onChange: (v) => ((params.length = v), changed()) });
  const spread = Slider({ label: 'Width', value: params.spread, min: 30, max: 250, format: pct, onInput: (v) => ((params.spread = v), changed()), onChange: (v) => ((params.spread = v), changed()) });
  const colorChips = Chips({ colors: SHADOW_COLORS.map((c) => c.hex), value: params.color, title: (hex) => SHADOW_COLORS.find((c) => c.hex === hex)?.name ?? hex, onPick: (hex) => ((params.color = hex), color.set(hex), colorChips.set(SHADOW_COLORS.map((c) => c.hex), hex), changed()) });
  const color = ColorField({ label: 'Colour', value: params.color, onChange: (v) => ((params.color = v), colorChips.set(SHADOW_COLORS.map((c) => c.hex), v), changed()) });
  const blend = Select<BlendMode>({ label: 'Blend', value: params.blend, options: BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] })), onChange: (v) => ((params.blend = v), changed()) });
  const blur = Toggle({ label: 'Photographic blur (live effect)', value: params.blur, onChange: (v) => ((params.blur = v), changed()) });
  const contact = Toggle({ label: 'Contact shadow at the base', value: params.contact, onChange: (v) => ((params.contact = v), changed()) });

  // Style-specific
  const lift = Slider({ label: 'Lift', value: params.lift, min: 0, max: 100, format: pct, onInput: (v) => ((params.lift = v), changed()), onChange: (v) => ((params.lift = v), changed()) });
  const floatMode = Segmented<'card' | 'hover'>({ label: 'Floating', value: params.floatMode, options: [{ value: 'card', label: 'Card / UI', title: 'Elevation shadow behind the object' }, { value: 'hover', label: 'Hovering', title: 'Object above the floor; shadow on the floor' }], onChange: (v) => ((params.floatMode = v), changed()) });
  const footprint = Segmented<Footprint>({ label: 'Footprint', value: params.footprint, options: [{ value: 'rect', label: 'Box' }, { value: 'round', label: 'Rounded' }, { value: 'ellipse', label: 'Round' }], onChange: (v) => ((params.footprint = v), changed()) });
  const floatBox = h('div', { class: 'sub' }, lift.el, floatMode.el);
  const longBox = h('div', { class: 'sub' }, footprint.el);

  const placement = Segmented<'belowSubject' | 'shadowLayer'>({
    label: 'Place',
    value: app.settings.shadowPlacement,
    options: [
      { value: 'belowSubject', label: 'Below object', title: 'Directly below each object on its own layer (always composites correctly)' },
      { value: 'shadowLayer', label: 'Shadows layer', title: 'On the SHADOWS layer of the active template' },
    ],
    onChange: (v) => void app.saveSettings({ shadowPlacement: v }),
  });

  const status = h('div', { class: 'shadow-status' });
  const previewBtn = Button({ label: 'Preview', icon: 'eye', onClick: () => togglePreview() });
  const applyBtn = Button({ label: 'Add Shadow', icon: 'shadow', variant: 'primary', onClick: () => void apply() });

  function togglePreview(force?: boolean): void {
    previewOn = force ?? !previewOn;
    previewBtn.classList.toggle('on', previewOn);
    previewBtn.setAttribute('aria-pressed', String(previewOn));
    if (previewOn) app.preview(commandId(), cmdParams());
    else void app.cancelPreview();
  }

  async function apply(): Promise<void> {
    await app.run(commandId(), deepClone(cmdParams()));
    togglePreview(false);
  }

  function sync(): void {
    styleTiles.set(params.style);
    styleHint.textContent = SHADOW_STYLES.find((s) => s.id === params.style)?.hint ?? '';
    subject.set(params.subject);
    compass.set(params.lightAngle);
    elevation.set(params.elevation);
    strength.set(params.strength);
    softness.set(params.softness);
    length.set(params.length);
    spread.set(params.spread);
    color.set(params.color);
    colorChips.set(SHADOW_COLORS.map((c) => c.hex), params.color);
    blend.set(params.blend);
    blur.set(params.blur);
    contact.set(params.contact);
    lift.set(params.lift);
    floatMode.set(params.floatMode);
    footprint.set(params.footprint);
    const s = params.style;
    length.el.hidden = !(s === 'cast' || s === 'silhouette' || s === 'long');
    contact.el.hidden = !(s === 'cast' || s === 'silhouette');
    floatBox.hidden = s !== 'floating';
    longBox.hidden = s !== 'long';
    elevation.el.hidden = s === 'long';
  }

  function renderMode(): void {
    const snap = app.s.snapshot;
    const shadows = snap ? selectedShadows(snap) : [];
    const nowEdit = shadows.length > 0 && shadows.length === (snap?.selection.count ?? 0);
    if (nowEdit !== editMode) {
      editMode = nowEdit;
      if (previewOn) togglePreview(false);
      if (editMode) {
        const stored = storedShadowParams(shadows[0]!);
        if (stored) {
          const { presetId: _p, subjectRect: _r, ...rest } = stored;
          params = sanitizeShadowParams(rest);
          sync();
        }
      }
    }
    previewBtn.hidden = editMode;
    applyBtn.querySelector('.btn-label')!.textContent = editMode ? (shadows.length > 1 ? `Update ${shadows.length} Shadows` : 'Update Shadow') : 'Add Shadow';
    if (editMode) {
      const s0 = shadows[0]!;
      replaceChildren(status, Badge(`Editing ${AF_TYPE_LABEL[s0.af!.type!]}`, 'af'), h('span', { class: 'muted' }, shadows.length > 1 ? ` ${shadows.length} selected` : ` “${s0.name}”`));
    } else {
      const n = snap?.selection.count ?? 0;
      replaceChildren(status, n ? h('span', { class: 'muted' }, `${n} object(s) selected`) : Note('Select the object(s) that need a shadow.'));
    }
  }

  const section = Section(
    { id: 'shadow.lab', title: 'Shadow Studio' },
    status,
    presetBar.el,
    styleTiles.el,
    styleHint,
    subject.el,
    link.el,
    h('div', { class: 'rig-row' }, compass.el, h('div', { class: 'rig-sliders' }, elevation.el, strength.el, softness.el)),
    length.el,
    spread.el,
    floatBox,
    longBox,
    h('div', { class: 'subhead' }, 'Colour'),
    colorChips.el,
    color.el,
    blend.el,
    blur.el,
    contact.el,
    placement.el,
    Row(previewBtn, applyBtn),
  );
  const noteSection = Section(
    { id: 'shadow.notes', title: 'How these shadows are built', collapsed: true },
    Note('Each shadow is a named group of editable vector shapes: radial/linear gradients whose opacity falls off smoothly, Multiply blending, and optional Gaussian Blur live effects for a photographic edge.'),
    Note('Cast shadows follow the light: direction from the compass, length from the light height (cot of the angle). “True silhouette” projects a recoloured copy of your vector art or live text onto the floor.'),
    Note('Shadows are tagged with their settings and subject, so selecting one lets you edit it later — even after reopening the file. Shadows from version 0.1 are upgraded when edited.'),
  );
  sync();
  renderMode();

  const el = h('div', { class: 'view' }, section.el, noteSection.el);
  return {
    id: 'shadow',
    title: 'Shadow',
    el,
    update(s, ch) {
      if (ch.has('snapshot')) renderMode();
      if (ch.has('settingsVersion')) {
        presetBar.refresh();
        placement.set(app.settings.shadowPlacement);
        compass.setColor(lightColor(app.settings.lightRig));
        if (linkLight && !editMode && (params.lightAngle !== app.settings.lightRig.angle || params.elevation !== app.settings.lightRig.elevation)) {
          params.lightAngle = app.settings.lightRig.angle;
          params.elevation = app.settings.lightRig.elevation;
          compass.set(params.lightAngle);
          elevation.set(params.elevation);
        }
      }
      if (ch.has('previewing') && !s.previewing?.startsWith('shadow.') && previewOn) togglePreview(false);
      applyBtn.disabled = !!s.busy && s.busy !== 'Preview';
    },
  };
}
