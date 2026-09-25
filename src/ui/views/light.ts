/**
 * LIGHT & BLEND: the scene light (direction, height, colour temperature,
 * intensity, softness) shared with the Shadow tab, one-click scene recipes,
 * and individual lighting effects with live preview.
 */

import { BLEND_MODES, type BlendMode } from '../../core/protocol';
import { EFFECT_DEFAULT_BLEND, LIGHT_EFFECTS, SCENE_RECIPES, type LightEffectId, type LightEffectParams, type SceneParams } from '../../effects/light-commands';
import { GRADES, RIG_PRESETS, lightColor, type LightRig } from '../../effects/light-engine';
import { kelvinToHex } from '../../color/color-math';
import type { AppController } from '../app';
import { h } from '../dom';
import { ColorField, Select, Slider, Toggle } from '../components/controls';
import { Note, Section } from '../components/layout';
import { Compass, PreviewApply, TileGrid } from '../components/creative';
import type { View } from './view';

export const BLEND_LABEL: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', softLight: 'Soft Light', hardLight: 'Hard Light',
  colorDodge: 'Color Dodge', colorBurn: 'Color Burn', darken: 'Darken', lighten: 'Lighten', difference: 'Difference', exclusion: 'Exclusion',
  hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity',
};

const EFFECT_GLYPH: Record<LightEffectId, string> = {
  backGlow: '<circle cx="12" cy="12" r="9" fill="url(#g)"/><rect x="9" y="7" width="6" height="11" rx="1.5" fill="currentColor"/>',
  rim: '<rect x="8" y="5" width="8" height="14" rx="2" fill="currentColor" opacity=".45"/><path d="M8.5 6v12" stroke="#FFD27A" stroke-width="2"/>',
  floorGlow: '<ellipse cx="12" cy="18" rx="9" ry="3" fill="url(#g)"/><rect x="9" y="6" width="6" height="11" rx="1.5" fill="currentColor"/>',
  neon: '<path d="M6 19V11a6 6 0 0 1 12 0v8" fill="none" stroke="#35E0B0" stroke-width="2"/><path d="M6 19V11a6 6 0 0 1 12 0v8" fill="none" stroke="#35E0B0" stroke-width="5" opacity=".25"/>',
  beams: '<path d="M3 3l7 18M3 3l12 16M3 3l17 12" stroke="#FFD27A" stroke-width="2" opacity=".8"/>',
  keySpot: '<ellipse cx="12" cy="12" rx="9" ry="7" fill="url(#g)"/>',
  leak: '<circle cx="4" cy="5" r="9" fill="#FF9A3C" opacity=".55"/><circle cx="8" cy="3" r="6" fill="#FF4F7B" opacity=".4"/>',
  bokeh: '<circle cx="6" cy="8" r="3" fill="#FFD27A" opacity=".7"/><circle cx="15" cy="6" r="2" fill="#FFD27A" opacity=".5"/><circle cx="12" cy="15" r="4" fill="#FFD27A" opacity=".35"/><circle cx="19" cy="17" r="2.5" fill="#FFD27A" opacity=".6"/>',
  haze: '<rect x="2" y="12" width="20" height="9" fill="url(#h)"/>',
  vignette: '<rect x="2" y="3" width="20" height="18" rx="2" fill="url(#v)"/>',
  grade: '<rect x="2" y="3" width="10" height="18" fill="#FF9A3C" opacity=".6"/><rect x="12" y="3" width="10" height="18" fill="#1E6F78" opacity=".6"/>',
};

const DEFS = '<defs><radialGradient id="g"><stop offset="0" stop-color="#FFE7A8"/><stop offset="1" stop-color="#FFE7A8" stop-opacity="0"/></radialGradient><linearGradient id="h" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><radialGradient id="v"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></radialGradient></defs>';
const glyph = (body: string): string => `<svg viewBox="0 0 24 24" width="24" height="24">${DEFS}${body}</svg>`;

export function LightView(app: AppController): View {
  let rig: LightRig = { ...app.settings.lightRig };
  const saveRig = (): void => void app.saveSettings({ lightRig: { ...rig } });

  // ---- Scene light ------------------------------------------------------------
  const compass = Compass({
    label: 'Light from',
    value: rig.angle,
    color: lightColor(rig),
    onInput: (v) => {
      rig.angle = v;
      changed();
    },
    onChange: (v) => {
      rig.angle = v;
      saveRig();
      changed();
    },
  });
  const pct = (v: number): string => `${Math.round(v)}%`;
  const elev = Slider({ label: 'Height', value: rig.elevation, min: 5, max: 90, format: (v) => `${Math.round(v)}°`, title: 'Low (5°) = sunset, long shadows · High (90°) = overhead noon', onInput: (v) => ((rig.elevation = v), changed()), onChange: (v) => ((rig.elevation = v), saveRig(), changed()) });
  const kelvinOut = h('span', { class: 'kelvin-chip' });
  const kelvin = Slider({
    label: 'Warmth',
    value: rig.kelvin,
    min: 1500,
    max: 10000,
    step: 100,
    format: (v) => `${Math.round(v)}K`,
    title: '1900K candle · 2600K golden hour · 5200K daylight · 9000K moonlight',
    onInput: (v) => ((rig.kelvin = v), syncColor(), changed()),
    onChange: (v) => ((rig.kelvin = v), syncColor(), saveRig(), changed()),
  });
  const useColor = Toggle({ label: 'Custom light colour', value: rig.color !== null, onChange: (v) => ((rig.color = v ? (rig.color ?? '#35E0B0') : null), syncColor(), saveRig(), changed()) });
  const color = ColorField({ label: 'Colour', value: rig.color ?? '#35E0B0', onChange: (v) => ((rig.color = v), syncColor(), saveRig(), changed()) });
  const intensity = Slider({ label: 'Intensity', value: rig.intensity, min: 0, max: 100, format: pct, onInput: (v) => ((rig.intensity = v), changed()), onChange: (v) => ((rig.intensity = v), saveRig(), changed()) });
  const softness = Slider({ label: 'Softness', value: rig.softness, min: 0, max: 100, format: pct, title: '0 = hard sun · 100 = overcast / softbox', onInput: (v) => ((rig.softness = v), changed()), onChange: (v) => ((rig.softness = v), saveRig(), changed()) });
  const rigPresets = h(
    'div',
    { class: 'chips' },
    ...RIG_PRESETS.map((r) => {
      const b = h('button', { type: 'button', class: 'chip', title: r.name }, h('span', { class: 'chip-dot', style: `background:${lightColor(r.rig)}` }), r.name);
      b.addEventListener('click', () => {
        rig = { ...r.rig };
        syncRig();
        saveRig();
        changed();
      });
      return b;
    }),
  );
  function syncColor(): void {
    kelvinOut.style.background = kelvinToHex(rig.kelvin);
    compass.setColor(lightColor(rig));
    color.el.hidden = rig.color === null;
    useColor.set(rig.color !== null);
  }
  function syncRig(): void {
    compass.set(rig.angle);
    elev.set(rig.elevation);
    kelvin.set(rig.kelvin);
    intensity.set(rig.intensity);
    softness.set(rig.softness);
    if (rig.color) color.set(rig.color);
    syncColor();
  }
  kelvin.el.appendChild(kelvinOut);
  const rigSection = Section(
    { id: 'light.rig', title: 'Scene light', hint: 'One light drives every glow, ray, rim and shadow so they agree. The Shadow tab uses the same light.' },
    rigPresets,
    h('div', { class: 'rig-row' }, compass.el, h('div', { class: 'rig-sliders' }, elev.el, intensity.el, softness.el)),
    kelvin.el,
    useColor.el,
    color.el,
  );

  // ---- Scene recipes ----------------------------------------------------------------
  const scene: SceneParams = { recipeId: 'hero-glow', intensity: 100, seed: 7 };
  const sceneTiles = TileGrid({
    items: SCENE_RECIPES.map((r) => ({ value: r.id, label: r.name, title: r.hint, thumb: { css: sceneCss(r.id) } })),
    value: scene.recipeId,
    columns: 3,
    onChange: (v) => {
      scene.recipeId = v;
      sceneHint.textContent = SCENE_RECIPES.find((r) => r.id === v)?.hint ?? '';
      scenePA.changed();
    },
  });
  const sceneHint = h('p', { class: 'hint' }, SCENE_RECIPES[0]!.hint);
  const sceneAmount = Slider({ label: 'Amount', value: 100, min: 20, max: 150, format: pct, onInput: (v) => ((scene.intensity = v), scenePA.changed()), onChange: (v) => ((scene.intensity = v), scenePA.changed()) });
  const sceneSeed = Slider({ label: 'Variation', value: scene.seed, min: 1, max: 99, onChange: (v) => ((scene.seed = v), scenePA.changed()) });
  const scenePA = PreviewApply(app, { commandId: () => 'light.scene', params: () => scene, label: 'Light the Scene', icon: 'play' });
  const sceneSection = Section({ id: 'light.scene', title: 'One-click scenes', hint: 'Select your subject (product, person, logo, frame) first. Each scene is one undo step.' }, sceneTiles.el, sceneHint, sceneAmount.el, sceneSeed.el, scenePA.el);

  // ---- Effects -----------------------------------------------------------------------
  const fx: LightEffectParams = { effect: 'backGlow', rig, amount: 60, blend: EFFECT_DEFAULT_BLEND.backGlow, gradeId: 'golden', color: null, seed: 7 };
  const fxParams = (): LightEffectParams => ({ ...fx, rig: { ...rig } });
  const fxTiles = TileGrid({
    items: LIGHT_EFFECTS.map((e) => ({ value: e.id, label: e.name, title: e.hint, thumb: { svg: glyph(EFFECT_GLYPH[e.id]) } })),
    value: fx.effect,
    columns: 4,
    size: 'sm',
    onChange: (v) => {
      fx.effect = v;
      fx.blend = EFFECT_DEFAULT_BLEND[v];
      blend.set(fx.blend);
      fxHint.textContent = LIGHT_EFFECTS.find((e) => e.id === v)?.hint ?? '';
      gradeSel.el.hidden = v !== 'grade';
      fxPA.setLabel(`Add ${LIGHT_EFFECTS.find((e) => e.id === v)?.name ?? 'Effect'}`);
      fxPA.changed();
    },
  });
  const fxHint = h('p', { class: 'hint' }, LIGHT_EFFECTS[0]!.hint);
  const amount = Slider({ label: 'Amount', value: fx.amount, min: 0, max: 100, format: pct, onInput: (v) => ((fx.amount = v), fxPA.changed()), onChange: (v) => ((fx.amount = v), fxPA.changed()) });
  const blend = Select<BlendMode>({ label: 'Blend', value: fx.blend, options: BLEND_MODES.map((b) => ({ value: b, label: BLEND_LABEL[b] })), onChange: (v) => ((fx.blend = v), fxPA.changed()) });
  const gradeSel = Select({ label: 'Grade', value: fx.gradeId, options: GRADES.map((g) => ({ value: g.id, label: g.name })), onChange: (v) => ((fx.gradeId = v), fxPA.changed()) });
  gradeSel.el.hidden = true;
  const fxSeed = Slider({ label: 'Variation', value: fx.seed, min: 1, max: 99, onChange: (v) => ((fx.seed = v), fxPA.changed()) });
  const fxPA = PreviewApply(app, { commandId: () => 'light.effect', params: fxParams, label: 'Add Back glow', icon: 'play' });
  const fxSection = Section({ id: 'light.effects', title: 'Effects' }, fxTiles.el, fxHint, amount.el, blend.el, gradeSel.el, fxSeed.el, fxPA.el);

  const notes = Section(
    { id: 'light.notes', title: 'How the light is built', collapsed: true },
    Note('Everything is editable vector art: gradient shapes with blend modes (Screen for light, Multiply for shadow, Soft Light for grading) and optional Gaussian Blur live effects. Nothing is rasterised unless you rasterise it.'),
    Note('Area effects go on the LIGHTING layer, clipped to the artboard. Glows and shadows go directly behind the subject; rim light directly above it.'),
    Note('Images cannot be recoloured by a script, so rim light on a photo follows its bounds. For cut-out photos use Back glow + Floor glow.'),
  );

  function changed(): void {
    scenePA.changed();
    fxPA.changed();
  }
  syncRig();
  const el = h('div', { class: 'view' }, rigSection.el, sceneSection.el, fxSection.el, notes.el);
  return {
    id: 'light',
    title: 'Light & Blend',
    el,
    update(s, ch) {
      if (ch.has('settingsVersion')) {
        const r = app.settings.lightRig;
        if (JSON.stringify(r) !== JSON.stringify(rig)) {
          rig = { ...r };
          syncRig();
        }
      }
      if (ch.has('previewing') && !s.previewing?.startsWith('light.')) {
        scenePA.stop();
        fxPA.stop();
      }
      const busy = !!s.busy && s.busy !== 'Preview';
      scenePA.applyBtn.disabled = busy;
      fxPA.applyBtn.disabled = busy;
    },
  };
}

function sceneCss(id: string): string {
  switch (id) {
    case 'hero-glow':
      return 'radial-gradient(circle at 50% 45%, #fff3c4 0, #e7b75a 18%, #6b3d12 45%, #120a05 80%)';
    case 'golden-rays':
      return 'linear-gradient(135deg, rgba(255,214,140,.9) 0, rgba(255,214,140,0) 55%), linear-gradient(180deg, #5b3413, #1b0f06)';
    case 'studio-product':
      return 'radial-gradient(ellipse at 40% 30%, #ffffff 0, #d5dbe3 35%, #7d8794 80%)';
    case 'night-neon':
      return 'radial-gradient(circle at 50% 50%, rgba(53,224,176,.9) 0, rgba(53,224,176,0) 40%), linear-gradient(#07121f, #020409)';
    case 'lantern-warmth':
      return 'radial-gradient(circle at 60% 40%, #ffd08a 0, #b8641f 30%, #2b1206 75%)';
    case 'emerald-luxury':
      return 'radial-gradient(circle at 50% 45%, #e9d08a 0, #0e7a4b 35%, #03170f 80%)';
    default:
      return '#333';
  }
}
