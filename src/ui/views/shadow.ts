/**
 * SHADOW LAB: Ground / Contact / Contact + Ambient with live preview, presets
 * and "Edit existing shadow" when a plugin shadow is selected.
 */

import { BLEND_MODES, type BlendMode } from '../../core/protocol';
import { AF_TYPE_LABEL } from '../../core/tags';
import { sanitizeShadowParams, SHADOW_KIND_LABEL, type ShadowKind, type ShadowParams } from '../../effects/shadow-engine';
import { selectedShadows, storedShadowParams, type ShadowCommandParams } from '../../effects/shadow-commands';
import { deepClone } from '../../utils/misc';
import type { ShadowPreset } from '../../presets/models';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, ColorField, NumberField, Segmented, Select, Slider } from '../components/controls';
import { Badge, Note, Row, Section } from '../components/layout';
import { PresetBar } from '../components/preset-bar';
import type { View } from './view';

const BLEND_LABEL: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', softLight: 'Soft Light', hardLight: 'Hard Light',
  colorDodge: 'Color Dodge', colorBurn: 'Color Burn', darken: 'Darken', lighten: 'Lighten', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

export function ShadowView(app: AppController): View {
  const initial = app.presets.get('shadow', app.settings.shadowPreset) ?? app.presets.list('shadow')[0]!;
  let params: ShadowParams = deepClone(initial.params);
  let presetId: string | null = initial.id;
  let editMode = false;
  let previewOn = false;

  const pct = (v: number): string => `${Math.round(v)}%`;
  const commandId = (): string => (editMode ? 'shadow.edit' : `shadow.${params.kind}`);
  const cmdParams = (): unknown => (editMode ? { params, refit: false } : ({ presetId, params } satisfies ShadowCommandParams));

  const changed = (): void => {
    presetId = null;
    if (previewOn && !editMode) app.preview(commandId(), cmdParams());
  };

  const presetBar = PresetBar(app, 'shadow', {
    value: initial.id,
    onSelect: (p: ShadowPreset) => {
      params = deepClone(p.params);
      presetId = p.id;
      sync();
      if (previewOn && !editMode) app.preview(commandId(), cmdParams());
    },
    capture: () => ({ params: deepClone(params) }),
  });

  const kind = Segmented<ShadowKind>({
    value: params.kind,
    options: (Object.keys(SHADOW_KIND_LABEL) as ShadowKind[]).map((k) => ({ value: k, label: SHADOW_KIND_LABEL[k] })),
    onChange: (k) => {
      params = sanitizeShadowParams({ ...params, kind: k });
      sync();
      changed();
    },
  });

  const slider = (label: string, key: keyof Pick<ShadowParams, 'widthScale' | 'flatness' | 'softness' | 'opacity'>, scale: number, min: number, max: number, title: string): ReturnType<typeof Slider> =>
    Slider({
      label,
      value: params[key] * scale,
      min,
      max,
      title,
      format: pct,
      onInput: (v) => {
        params[key] = v / scale;
        changed();
      },
      onChange: (v) => {
        params[key] = v / scale;
        changed();
      },
    });
  const width = slider('Width', 'widthScale', 100, 10, 300, 'Shadow width relative to the object');
  const flat = slider('Height', 'flatness', 100, 1, 60, 'Shadow height relative to its width (camera angle)');
  const soft = slider('Softness', 'softness', 100, 0, 100, 'Edge falloff: 0 = hard, 100 = very soft');
  const opacity = slider('Opacity', 'opacity', 1, 0, 100, 'Overall opacity');
  const offX = NumberField({ label: 'Offset X', value: params.offsetX, min: -200, max: 200, kind: 'percent', title: '% of the object width', onChange: (v) => { params.offsetX = v; changed(); } });
  const offY = NumberField({ label: 'Offset Y', value: params.offsetY, min: -100, max: 100, kind: 'percent', title: '% of the object height (0 = centred on the bottom edge)', onChange: (v) => { params.offsetY = v; changed(); } });
  const rot = NumberField({ label: 'Rotate', value: params.rotation, min: -180, max: 180, kind: 'degrees', onChange: (v) => { params.rotation = v; changed(); } });
  const blur = NumberField({ label: 'Live blur', value: params.liveBlur, min: 0, max: 250, kind: 'length', unit: () => 'px', title: 'Optional Gaussian Blur live effect (raster). 0 = off — the vector falloff is usually enough.', onChange: (v) => { params.liveBlur = v; changed(); } });
  const color = ColorField({ label: 'Colour', value: params.color, onChange: (v) => { params.color = v; changed(); } });
  const blend = Select<BlendMode>({ label: 'Blend', value: params.blend, options: BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] })), onChange: (v) => { params.blend = v; changed(); } });

  const ambSlider = (label: string, key: 'widthScale' | 'flatness' | 'softness' | 'opacity', scale: number, min: number, max: number): ReturnType<typeof Slider> =>
    Slider({ label, value: params.ambient[key] * scale, min, max, format: pct, onInput: (v) => { params.ambient[key] = v / scale; changed(); }, onChange: (v) => { params.ambient[key] = v / scale; changed(); } });
  const aW = ambSlider('Width', 'widthScale', 100, 10, 300);
  const aF = ambSlider('Height', 'flatness', 100, 1, 60);
  const aS = ambSlider('Softness', 'softness', 100, 0, 100);
  const aO = ambSlider('Opacity', 'opacity', 1, 0, 100);
  const ambientBox = h('div', { class: 'sub' }, h('div', { class: 'subhead' }, 'Ambient pool'), aW.el, aF.el, aS.el, aO.el);

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
  const refitBtn = Button({ label: 'Re-fit to object', small: true, title: 'Recompute size and position from the object’s current bounds', onClick: () => void app.run('shadow.edit', { params, refit: true }) });

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
    kind.set(params.kind);
    width.set(params.widthScale * 100);
    flat.set(params.flatness * 100);
    soft.set(params.softness * 100);
    opacity.set(params.opacity);
    offX.set(params.offsetX);
    offY.set(params.offsetY);
    rot.set(params.rotation);
    blur.set(params.liveBlur);
    color.set(params.color);
    blend.set(params.blend);
    aW.set(params.ambient.widthScale * 100);
    aF.set(params.ambient.flatness * 100);
    aS.set(params.ambient.softness * 100);
    aO.set(params.ambient.opacity);
    ambientBox.hidden = params.kind !== 'contactAmbient';
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
    refitBtn.hidden = !editMode;
    applyBtn.querySelector('.btn-label')!.textContent = editMode ? (shadows.length > 1 ? `Update ${shadows.length} Shadows` : 'Update Shadow') : `Add ${SHADOW_KIND_LABEL[params.kind]} Shadow`;
    if (editMode) {
      const s0 = shadows[0]!;
      replaceChildren(status, Badge(`Editing ${AF_TYPE_LABEL[s0.af!.type!]}`, 'af'), h('span', { class: 'muted' }, shadows.length > 1 ? ` ${shadows.length} selected` : ` “${s0.name}”`));
    } else {
      const n = snap?.selection.count ?? 0;
      replaceChildren(status, n ? h('span', { class: 'muted' }, `${n} object(s) selected`) : Note('Select the object(s) that need a shadow.'));
    }
  }

  const section = Section(
    { id: 'shadow.lab', title: 'Shadow Lab' },
    status,
    presetBar.el,
    kind.el,
    width.el,
    flat.el,
    soft.el,
    opacity.el,
    h('div', { class: 'grid2' }, offX.el, offY.el, rot.el, blur.el),
    color.el,
    blend.el,
    ambientBox,
    placement.el,
    Row(previewBtn, applyBtn, refitBtn),
  );
  const noteSection = Section(
    { id: 'shadow.notes', title: 'How these shadows are built', collapsed: true },
    Note('Each shadow is one vector ellipse with a radial gradient whose stop opacities follow a smooth falloff — no rasterising, editable in the Gradient panel. Contact + Ambient is a named group of two ellipses.'),
    Note('Shadows are tagged so the panel recognises them later (even after reopening the file). Select one to edit it.'),
    Note('Cast, long, perspective and inner shadows are planned for Phase 2.'),
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
      }
      if (ch.has('previewing') && !s.previewing?.startsWith('shadow.') && previewOn) togglePreview(false);
      applyBtn.disabled = !!s.busy && s.busy !== 'Preview';
    },
  };
}
