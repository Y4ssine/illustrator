/**
 * CREATE: design recipes (complete compositions in one click) and the ready
 * shape library (arches, frames, badges, ribbons, dividers…) styled from the
 * active palette.
 */

import { RECIPES, type RecipeId, type RecipeParams } from '../../recipes/recipes';
import { SHAPES, SHAPE_CATEGORIES, defaultParams, toSvgPath, type ShapeCategory, type ShapeDef } from '../../shapes/shape-library';
import { SHAPE_STYLES, type ShapeFx, type ShapeInsertParams, type ShapeStyleId } from '../../shapes/shape-commands';
import { fillFor } from '../../color/color-commands';
import { activePalette } from '../../core/commands/creative';
import { paintToCss } from '../../color/palette-engine';
import type { AppController } from '../app';
import { h } from '../dom';
import { Segmented, Select, Slider, TextField, Toggle } from '../components/controls';
import { Note, Section } from '../components/layout';
import { PreviewApply, TileGrid } from '../components/creative';
import type { View } from './view';

function shapeSvg(def: ShapeDef): string {
  const w = def.aspect >= 1 ? 40 : 40 * def.aspect;
  const hh = def.aspect >= 1 ? 40 / def.aspect : 40;
  const box = { x: (48 - w) / 2, y: (48 - hh) / 2, w, h: hh };
  const params = defaultParams(def);
  const d = def.parts ? def.parts(box, params).map((p) => toSvgPath(p.shape)).join(' ') : toSvgPath(def.build(box, params));
  return `<svg viewBox="0 0 48 48" width="40" height="40"><path d="${d}" fill="currentColor" fill-rule="evenodd"/></svg>`;
}

const RECIPE_CSS: Record<RecipeId, string> = {
  'campaign-hero': 'radial-gradient(ellipse at 50% 40%, #d9f5e6 0, #1d7a55 30%, #03170f 75%)',
  'product-spotlight': 'radial-gradient(ellipse at 50% 35%, #7fd1a8 0, #0b4a30 45%, #021009 90%)',
  'infographic-poster': 'linear-gradient(160deg, #f4f1ea 0, #e1f1e8 100%)',
  celebration: 'repeating-conic-gradient(from 0deg at 50% 50%, #1f6b4b 0 10deg, #2c8a62 10deg 20deg)',
  'quote-card': 'linear-gradient(35deg, #0e7a4b 0 48%, #c9a227 52% 100%)',
};

export function CreateView(app: AppController): View {
  // ---- Recipes ----------------------------------------------------------------
  const rp: RecipeParams = app.command('recipe.build')!.defaultParams({ settings: app.settings, presets: app.presets }) as RecipeParams;
  const recipeTiles = TileGrid<RecipeId>({
    items: RECIPES.map((r) => ({ value: r.id, label: r.name, title: r.hint, thumb: { css: RECIPE_CSS[r.id] } })),
    value: rp.recipe,
    columns: 3,
    onChange: (v) => {
      rp.recipe = v;
      recipeHint.textContent = RECIPES.find((r) => r.id === v)?.hint ?? '';
      recipePA.changed();
    },
  });
  const recipeHint = h('p', { class: 'hint' }, RECIPES[0]!.hint);
  const headline = TextField({ label: 'Headline', value: rp.headline, onChange: (v) => ((rp.headline = v), recipePA.changed()) });
  const subline = TextField({ label: 'Subline', value: rp.subline, onChange: (v) => ((rp.subline = v), recipePA.changed()) });
  const dark = Segmented<'dark' | 'light'>({ label: 'Mood', value: rp.dark ? 'dark' : 'light', options: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], onChange: (v) => ((rp.dark = v === 'dark'), recipePA.changed()) });
  const seed = Slider({ label: 'Variation', value: rp.seed, min: 1, max: 99, onChange: (v) => ((rp.seed = v), recipePA.changed()) });
  const recipePA = PreviewApply(app, { commandId: () => 'recipe.build', params: () => rp, label: 'Build Design', icon: 'play' });
  const recipeSection = Section(
    { id: 'create.recipes', title: 'Design recipes', hint: 'Builds a complete, editable composition on the artboard: background, frames, light, shadow and live type — from your palette (Colour tab). One undo step.' },
    recipeTiles.el,
    recipeHint,
    headline.el,
    subline.el,
    dark.el,
    seed.el,
    recipePA.el,
  );

  // ---- Shapes ---------------------------------------------------------------------
  let category: ShapeCategory = 'Frames & arches';
  const first = SHAPES.find((s) => s.category === category)!;
  const sp: ShapeInsertParams = { shapeId: first.id, params: defaultParams(first), style: 'brand', fx: 'none', size: 45, fitSelection: false };
  const catSel = Select<ShapeCategory>({ label: 'Category', value: category, options: SHAPE_CATEGORIES.map((c) => ({ value: c, label: c })), onChange: (v) => {
    category = v;
    shapeTiles.setItems(itemsFor(v));
    const d = SHAPES.find((s) => s.category === v)!;
    pickShape(d.id);
  } });
  const itemsFor = (cat: ShapeCategory) => SHAPES.filter((s) => s.category === cat).map((s) => ({ value: s.id, label: s.name, thumb: { svg: shapeSvg(s) } }));
  const shapeTiles = TileGrid<string>({ items: itemsFor(category), value: sp.shapeId, columns: 4, size: 'sm', onChange: (v) => pickShape(v) });
  const paramBox = h('div', { class: 'sub' });
  const styleTiles = TileGrid<ShapeStyleId>({ items: [], value: sp.style, columns: 4, size: 'sm', onChange: (v) => ((sp.style = v), shapePA.changed()) });
  const fx = Select<ShapeFx>({ label: 'Effect', value: sp.fx, options: [{ value: 'none', label: 'None' }, { value: 'shadow', label: 'Drop shadow' }, { value: 'glow', label: 'Outer glow' }, { value: 'innerGlow', label: 'Inner glow' }], title: 'Native Illustrator live effects (editable in the Appearance panel)', onChange: (v) => ((sp.fx = v), shapePA.changed()) });
  const size = Slider({ label: 'Size', value: sp.size, min: 5, max: 120, format: (v) => `${Math.round(v)}%`, title: '% of the artboard’s shorter side', onInput: (v) => ((sp.size = v), shapePA.changed()), onChange: (v) => ((sp.size = v), shapePA.changed()) });
  const fit = Toggle({ label: 'Fit to the selected object', value: sp.fitSelection, onChange: (v) => {
    sp.fitSelection = v;
    size.el.hidden = v;
    shapePA.changed();
  } });
  const shapePA = PreviewApply(app, { commandId: () => 'shape.insert', params: () => sp, label: 'Insert Shape', icon: 'check' });

  function styleItems(): Array<{ value: ShapeStyleId; label: string; thumb: { css: string } }> {
    const pal = activePalette(app.settings);
    return SHAPE_STYLES.map((s) => {
      let css: string;
      if (s.id === 'outline') css = `transparent; box-shadow: inset 0 0 0 2px ${pal.primary}`;
      else if (s.id === 'neon') css = `#111; box-shadow: inset 0 0 0 2px ${pal.accent}, 0 0 8px ${pal.accent}`;
      else if (s.id === 'glass') css = 'linear-gradient(135deg, rgba(255,255,255,.55), rgba(255,255,255,.12))';
      else css = paintToCss(fillFor(pal, s.id));
      return { value: s.id, label: s.name, thumb: { css } };
    });
  }

  function pickShape(id: string): void {
    const def = SHAPES.find((s) => s.id === id)!;
    sp.shapeId = id;
    sp.params = defaultParams(def);
    shapeTiles.set(id);
    paramBox.textContent = '';
    for (const prm of def.params) {
      const sl = Slider({
        label: prm.label,
        value: prm.value,
        min: prm.min,
        max: prm.max,
        step: prm.step ?? 1,
        format: (v) => `${Math.round(v)}${prm.unit ?? ''}`,
        onInput: (v) => ((sp.params[prm.key] = v), shapePA.changed()),
        onChange: (v) => ((sp.params[prm.key] = v), shapePA.changed()),
      });
      paramBox.appendChild(sl.el);
    }
    paramBox.hidden = def.params.length === 0;
    shapePA.changed();
  }

  styleTiles.setItems(styleItems());
  pickShape(sp.shapeId);
  const shapeSection = Section(
    { id: 'create.shapes', title: 'Shapes', hint: 'Clean Bézier paths (few anchors, true arcs) — ordinary editable Illustrator art.' },
    catSel.el,
    shapeTiles.el,
    paramBox,
    h('div', { class: 'subhead' }, 'Style (from your palette)'),
    styleTiles.el,
    fx.el,
    fit.el,
    size.el,
    shapePA.el,
  );

  const notes = Section(
    { id: 'create.notes', title: 'Tips', collapsed: true },
    Note('Extract your brand palette from a logo in the Colour tab first — recipes, shapes, charts and backgrounds all follow it.'),
    Note('Draw a rectangle where a shape should go, select it and turn on “Fit to the selected object”.'),
    Note('Neon style = outline + soft glow copies (Screen + Gaussian Blur). Pair with Light › Night neon.'),
  );

  const el = h('div', { class: 'view' }, recipeSection.el, shapeSection.el, notes.el);
  return {
    id: 'create',
    title: 'Create',
    el,
    update(s, ch) {
      if (ch.has('settingsVersion')) styleTiles.setItems(styleItems());
      if (ch.has('previewing') && !s.previewing?.startsWith('recipe.') && !s.previewing?.startsWith('shape.')) {
        recipePA.stop();
        shapePA.stop();
      }
      const busy = !!s.busy && s.busy !== 'Preview';
      recipePA.applyBtn.disabled = busy;
      shapePA.applyBtn.disabled = busy;
    },
  };
}
