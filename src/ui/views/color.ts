/**
 * COLOUR: brand palette (extract from a selected vector logo, edit,
 * harmonies), gradient & fade styles applied to the selection, swatches,
 * generated backgrounds and fade overlays.
 */

import { extractPalette, gradientStyles, harmony, paintToCss, describeHsl, type Harmony } from '../../color/palette-engine';
import { activePalette, DEFAULT_PALETTE_HEXES } from '../../core/commands/creative';
import { BACKGROUND_STYLES, SOLID_STYLES, fillFor, type BackgroundParams, type FadeEdge, type FadeParams, type FillStyleId } from '../../color/color-commands';
import type { AppController } from '../app';
import { h } from '../dom';
import { Button, ColorField, Segmented, Select, Slider } from '../components/controls';
import { Note, Row, Section } from '../components/layout';
import { Chips, PreviewApply, TileGrid } from '../components/creative';
import type { View } from './view';

export function ColorView(app: AppController): View {
  // ---- Palette -------------------------------------------------------------------
  const roles = h('div', { class: 'palette-roles' });
  const chips = Chips({ colors: [], title: (hex) => `${hex} · ${describeHsl(hex)} — click to copy`, onPick: (hex) => void navigator.clipboard?.writeText(hex).catch(() => undefined) });
  const status = h('p', { class: 'hint' });
  const extractBtn = Button({ label: 'Extract from selected logo', icon: 'search', variant: 'primary', title: 'Reads the fill, stroke and gradient colours of the selected vector art (weighted by area).', onClick: () => void extract() });
  const resetBtn = Button({ label: 'Default', small: true, variant: 'quiet', title: 'Back to the built-in palette', onClick: () => void app.saveSettings({ palette: null }) });
  const edit = ColorField({ label: 'Add colour', value: '#0E7A4B', onChange: (v) => void app.saveSettings({ palette: [...(app.settings.palette ?? DEFAULT_PALETTE_HEXES), v] }) });
  let harm: Harmony = 'analogous';
  const harmonySel = Select<Harmony>({ label: 'Harmony', value: harm, options: [
    { value: 'analogous', label: 'Analogous' },
    { value: 'complementary', label: 'Complementary' },
    { value: 'split', label: 'Split complementary' },
    { value: 'triadic', label: 'Triadic' },
    { value: 'tetradic', label: 'Tetradic' },
    { value: 'monochrome', label: 'Monochrome ramp' },
  ], onChange: (v) => ((harm = v), renderHarmony()) });
  const harmChips = Chips({ colors: [] });
  const useHarmony = Button({ label: 'Use as palette', small: true, onClick: () => {
    const pal = activePalette(app.settings);
    void app.saveSettings({ palette: [...harmony(pal.primary, harm), pal.dark, pal.light] });
  } });

  async function extract(): Promise<void> {
    try {
      app.set({ busy: 'Reading colours' });
      const res = await app.host.document.sampleColors();
      if (res.samples.length === 0) {
        app.toasts.show({ kind: 'warn', message: res.images > 0 ? 'The selection is an image: colours cannot be read from pixels by a script. Use Image Trace (or select the vector logo) and try again.' : 'Select a vector logo (or any coloured artwork) first.' });
        return;
      }
      const pal = extractPalette(res.samples, 8);
      await app.saveSettings({ palette: pal.colors.map((c) => c.hex) });
      const notes: string[] = [];
      if (res.images > 0) notes.push(`${res.images} image(s) in the selection were ignored (no pixel access).`);
      if (res.truncated) notes.push('Very large selection: only the first 4000 objects were read.');
      app.toasts.show({ kind: notes.length ? 'warn' : 'success', message: `Palette extracted: ${pal.colors.length} colours from ${res.items} objects.`, warnings: notes });
    } catch (e) {
      app.reportError(e);
    } finally {
      app.set({ busy: null });
    }
  }

  function renderPalette(): void {
    const pal = activePalette(app.settings);
    roles.textContent = '';
    for (const [role, hex] of [['Primary', pal.primary], ['Secondary', pal.secondary], ['Accent', pal.accent], ['Dark', pal.dark], ['Light', pal.light]] as const) {
      roles.appendChild(h('div', { class: 'role', title: `${hex} · ${describeHsl(hex)}` }, h('span', { class: 'role-swatch', style: `background:${hex}` }), h('span', { class: 'role-name' }, role), h('code', null, hex)));
    }
    chips.set(pal.colors.map((c) => c.hex));
    status.textContent = app.settings.palette ? 'Brand palette active — every recipe, shape, chart and background uses it.' : 'Built-in palette. Select your logo and extract its colours.';
    gradTiles.setItems(gradientItems());
    renderHarmony();
  }

  function renderHarmony(): void {
    const pal = activePalette(app.settings);
    harmChips.set(harmony(pal.primary, harm));
  }

  // ---- Gradient & colour styles --------------------------------------------------------
  let style: FillStyleId = 'brand';
  const gradientItems = (): Array<{ value: FillStyleId; label: string; title: string; thumb: { css: string } }> => {
    const pal = activePalette(app.settings);
    return [
      ...gradientStyles(pal).map((g) => ({ value: g.id as FillStyleId, label: g.name, title: g.description, thumb: { css: paintToCss(g.paint) } })),
      ...SOLID_STYLES.map((s) => ({ value: s.id, label: s.name, title: `${s.name} colour`, thumb: { css: paintToCss(fillFor(pal, s.id)) } })),
    ];
  };
  const gradTiles = TileGrid<FillStyleId>({ items: [], value: style, columns: 5, size: 'sm', onChange: (v) => (style = v) });
  const applyStyleBtn = Button({ label: 'Apply to selection', icon: 'check', variant: 'primary', onClick: () => void app.run('color.apply', { style }) });
  const swatchBtn = Button({ label: 'Add to Swatches', icon: 'presets', onClick: () => void app.run('color.swatches', { name: 'Brand', tints: true }) });

  // ---- Backgrounds -------------------------------------------------------------------------
  const bg: BackgroundParams = { style: 'aurora', dark: true, seed: 11 };
  const bgTiles = TileGrid({
    items: BACKGROUND_STYLES.map((b) => ({ value: b.id, label: b.name, title: b.hint, thumb: { css: bgCss(b.id) } })),
    value: bg.style,
    columns: 3,
    size: 'sm',
    onChange: (v) => ((bg.style = v), bgPA.changed()),
  });
  const bgMood = Segmented<'dark' | 'light'>({ label: 'Mood', value: 'dark', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], onChange: (v) => ((bg.dark = v === 'dark'), bgPA.changed()) });
  const bgSeed = Slider({ label: 'Variation', value: bg.seed, min: 1, max: 99, onChange: (v) => ((bg.seed = v), bgPA.changed()) });
  const bgPA = PreviewApply(app, { commandId: () => 'color.background', params: () => bg, label: 'Add Background', icon: 'check' });

  // ---- Fades ------------------------------------------------------------------------------------
  const fade: FadeParams = { edge: 'bottom', color: 'dark', length: 55, strength: 90, target: 'selection' };
  const fadeEdge = Segmented<FadeEdge>({ label: 'From', value: fade.edge, options: [
    { value: 'bottom', label: '↑', title: 'Fade up from the bottom edge' },
    { value: 'top', label: '↓', title: 'Fade down from the top edge' },
    { value: 'right', label: '←', title: 'Fade from the right edge' },
    { value: 'left', label: '→', title: 'Fade from the left edge' },
    { value: 'radial', label: '◎', title: 'Radial: fade the edges all around' },
  ], onChange: (v) => ((fade.edge = v), fadePA.changed()) });
  const fadeColor = Select({ label: 'Into', value: fade.color, options: [
    { value: 'dark', label: 'Dark (palette)' },
    { value: 'primary', label: 'Primary' },
    { value: 'accent', label: 'Accent' },
    { value: 'light', label: 'Light' },
    { value: '#000000', label: 'Black' },
    { value: '#FFFFFF', label: 'White' },
  ], onChange: (v) => ((fade.color = v), fadePA.changed()) });
  const fadeLen = Slider({ label: 'Reach', value: fade.length, min: 5, max: 100, format: (v) => `${Math.round(v)}%`, onInput: (v) => ((fade.length = v), fadePA.changed()), onChange: (v) => ((fade.length = v), fadePA.changed()) });
  const fadeStr = Slider({ label: 'Strength', value: fade.strength, min: 5, max: 100, format: (v) => `${Math.round(v)}%`, onInput: (v) => ((fade.strength = v), fadePA.changed()), onChange: (v) => ((fade.strength = v), fadePA.changed()) });
  const fadeTarget = Segmented<'selection' | 'artboard'>({ label: 'On', value: fade.target, options: [{ value: 'selection', label: 'Selection', title: 'Over each selected image/object' }, { value: 'artboard', label: 'Artboard', title: 'Across the whole artboard (ATMOSPHERE layer)' }], onChange: (v) => ((fade.target = v), fadePA.changed()) });
  const fadePA = PreviewApply(app, { commandId: () => 'color.fade', params: () => fade, label: 'Add Fade', icon: 'check' });

  const paletteSection = Section(
    { id: 'color.palette', title: 'Brand palette', actions: [resetBtn] },
    status,
    Row(extractBtn),
    roles,
    chips.el,
    edit.el,
    h('div', { class: 'subhead' }, 'Harmonies of the primary'),
    harmonySel.el,
    Row(harmChips.el, useHarmony),
  );
  const styleSection = Section({ id: 'color.styles', title: 'Gradients & fills', hint: 'Styles built from your palette. Apply to vector art and live text.' }, gradTiles.el, Row(applyStyleBtn, swatchBtn));
  const bgSection = Section({ id: 'color.bg', title: 'Backgrounds' }, bgTiles.el, bgMood.el, bgSeed.el, bgPA.el);
  const fadeSection = Section({ id: 'color.fade', title: 'Fades', hint: 'Fade a photo into the background colour, or add a legibility fade behind text. Gradient opacity, fully editable.' }, fadeEdge.el, fadeColor.el, fadeLen.el, fadeStr.el, fadeTarget.el, fadePA.el);
  const notes = Section(
    { id: 'color.notes', title: 'Notes', collapsed: true },
    Note('Colour extraction reads vector art only (fills, strokes, gradient stops, spot colours, text). Pixels of placed images are not accessible to scripts — trace the logo or select its vector version.'),
    Note('Colours are clustered perceptually (OKLab) and weighted by area, so the dominant brand colour becomes Primary.'),
  );

  renderPalette();
  const el = h('div', { class: 'view' }, paletteSection.el, styleSection.el, bgSection.el, fadeSection.el, notes.el);
  return {
    id: 'color',
    title: 'Colour',
    el,
    update(s, ch) {
      if (ch.has('settingsVersion')) renderPalette();
      if (ch.has('previewing') && !s.previewing?.startsWith('color.')) {
        bgPA.stop();
        fadePA.stop();
      }
      const busy = !!s.busy && s.busy !== 'Preview';
      extractBtn.disabled = busy;
      applyStyleBtn.disabled = busy;
    },
  };
}


function bgCss(id: string): string {
  switch (id) {
    case 'aurora':
      return 'radial-gradient(circle at 20% 30%, #1d8a5c 0, transparent 50%), radial-gradient(circle at 80% 70%, #c9a227 0, transparent 45%), #06140e';
    case 'spotlight':
      return 'radial-gradient(ellipse at 50% 40%, #6fd3a2 0, #0e7a4b 30%, #03120b 80%)';
    case 'rays':
      return 'repeating-conic-gradient(from 0deg at 50% 50%, #1f6b4b 0 10deg, #2c8a62 10deg 20deg)';
    case 'linear':
      return 'linear-gradient(#0e7a4b, #03170f)';
    case 'duotone':
      return 'linear-gradient(35deg, #0e7a4b 0 48%, #c9a227 52% 100%)';
    default:
      return 'linear-gradient(160deg, #f4f1ea, #dff0e6)';
  }
}
