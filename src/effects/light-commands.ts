/**
 * Lighting commands: single effects driven by the shared light rig, and
 * one-click scene recipes that combine several effects (one undo step).
 */

import type { CommandPlan, DocumentCommand, PlanContext } from '../core/commands/types';
import { requireDoc, subjectItems, subjectLabel, itemBounds } from '../core/commands/helpers';
import { layerTop, roleLayer, targetArtboard, isVector } from '../core/commands/creative';
import type { BlendMode } from '../core/protocol';
import { makeId, plural } from '../utils/misc';
import { mix } from '../color/color-math';
import { activePalette } from '../core/commands/creative';
import { buildShadow, sanitizeShadowParams, SHADOW_AF_TYPE } from './shadow-engine';
import { encodeMeta } from '../core/tags';
import * as L from './light-engine';

export type LightEffectId = 'keySpot' | 'backGlow' | 'beams' | 'leak' | 'bokeh' | 'vignette' | 'grade' | 'haze' | 'floorGlow' | 'rim' | 'neon';

export const LIGHT_EFFECTS: ReadonlyArray<{ id: LightEffectId; name: string; needsSubject: boolean; hint: string }> = [
  { id: 'backGlow', name: 'Back glow', needsSubject: true, hint: 'Halo behind the selected object — the hero light of campaign posters.' },
  { id: 'rim', name: 'Rim light', needsSubject: true, hint: 'Bright edge on the side facing the light.' },
  { id: 'floorGlow', name: 'Floor glow', needsSubject: true, hint: 'Pool of light on the floor under a product.' },
  { id: 'neon', name: 'Neon glow', needsSubject: true, hint: 'Soft coloured glow copies behind strokes, frames and type.' },
  { id: 'beams', name: 'Light rays', needsSubject: false, hint: 'God rays entering from the light direction.' },
  { id: 'keySpot', name: 'Key light', needsSubject: false, hint: 'A large soft pool where the light lands.' },
  { id: 'leak', name: 'Light leak', needsSubject: false, hint: 'Warm, film-style colour leak at the lit edge.' },
  { id: 'bokeh', name: 'Bokeh / sparkles', needsSubject: false, hint: 'Out-of-focus light orbs across the artboard.' },
  { id: 'haze', name: 'Haze', needsSubject: false, hint: 'Atmospheric light rising from the bottom.' },
  { id: 'vignette', name: 'Vignette', needsSubject: false, hint: 'Darkened edges that pull the eye inward.' },
  { id: 'grade', name: 'Colour grade', needsSubject: false, hint: 'Photographic colour grading overlay (golden, teal & orange…).' },
];

export interface LightEffectParams {
  effect: LightEffectId;
  rig: L.LightRig;
  /** 0–100, effect-specific "amount" (size, count, strength…). */
  amount: number;
  blend: BlendMode;
  gradeId: string;
  /** Neon colour (null = light colour). */
  color: string | null;
  seed: number;
}

export const EFFECT_DEFAULT_BLEND: Record<LightEffectId, BlendMode> = {
  keySpot: 'screen',
  backGlow: 'screen',
  beams: 'screen',
  leak: 'screen',
  bokeh: 'screen',
  vignette: 'multiply',
  grade: 'softLight',
  haze: 'screen',
  floorGlow: 'screen',
  rim: 'screen',
  neon: 'screen',
};

interface Built {
  summaries: string[];
  warnings: string[];
}

/** Records one effect into the transaction. */
function buildEffect(ctx: PlanContext, tx: ReturnType<PlanContext['host']['begin']>, p: LightEffectParams, lightingLayer: () => string, area: { x: number; y: number; w: number; h: number }, out: Built): void {
  const blur = ctx.settings.liveBlur && !!ctx.host.info?.capabilities.applyEffect;
  const lctx: L.LightContext = { sink: tx, rig: p.rig, area, into: layerTop(lightingLayer()), blur, seed: p.seed };
  const a = p.amount;
  const subjects = subjectItems(ctx.snapshot);
  const each = (fn: (s: (typeof subjects)[number]) => L.LightResult): void => {
    for (const s of subjects) out.summaries.push(fn(s).summary);
  };
  switch (p.effect) {
    case 'keySpot':
      out.summaries.push(L.keySpot(lctx, { size: 40 + a * 1.2, blend: p.blend }).summary);
      break;
    case 'beams':
      out.summaries.push(L.beams(lctx, { count: Math.round(3 + a / 12), spread: 30 + a * 0.3, length: 70 + a * 0.5, width: 30 + a * 0.6, blend: p.blend }).summary);
      break;
    case 'leak':
      out.summaries.push(L.lightLeak(lctx, { size: 30 + a * 0.9, hueShift: 28, blend: p.blend }).summary);
      break;
    case 'bokeh': {
      const base = Math.min(area.w, area.h);
      out.summaries.push(L.bokeh(lctx, { count: Math.round(8 + a * 0.5), minSize: base * 0.008, maxSize: base * (0.03 + a * 0.0012), blend: p.blend }).summary);
      break;
    }
    case 'vignette':
      out.summaries.push(L.vignette(lctx, { color: p.color ?? '#000000', strength: 20 + a * 0.8, softness: 60, blend: p.blend }).summary);
      break;
    case 'grade':
      out.summaries.push(L.grade(lctx, p.gradeId, a).summary);
      break;
    case 'haze':
      out.summaries.push(L.haze(lctx, { height: 20 + a * 0.6, color: p.color, blend: p.blend }).summary);
      break;
    case 'backGlow':
      each((s) => L.backGlow(lctx, itemBounds(s, ctx.settings), { k: 'below', ref: s.ref }, { size: 120 + a * 2.2, blend: p.blend }));
      break;
    case 'floorGlow':
      each((s) => L.floorGlow(lctx, itemBounds(s, ctx.settings), { k: 'below', ref: s.ref }, { width: 100 + a * 2.5, blend: p.blend }));
      break;
    case 'rim':
      each((s) => {
        if (!isVector(s)) out.warnings.push(`“${subjectLabel(s)}” is an image: its edge light follows the image bounds.`);
        return L.rimLight(lctx, { ref: s.ref, rect: itemBounds(s, ctx.settings), vector: isVector(s) }, { k: 'above', ref: s.ref }, { width: 10 + a * 0.6, blend: p.blend });
      });
      break;
    case 'neon':
      each((s) => {
        if (!isVector(s)) out.warnings.push(`“${subjectLabel(s)}” is an image; neon glow needs vector art or text.`);
        return L.neon(lctx, { ref: s.ref, strokeWidth: Math.max(1, Math.min(itemBounds(s, ctx.settings).w, itemBounds(s, ctx.settings).h) * 0.01) }, { k: 'below', ref: s.ref }, { color: p.color ?? L.lightColor(p.rig), spread: a });
      });
      break;
  }
}

function needsSubject(effect: LightEffectId): boolean {
  return LIGHT_EFFECTS.find((e) => e.id === effect)?.needsSubject ?? false;
}

export const lightEffect: DocumentCommand<LightEffectParams> = {
  kind: 'document',
  id: 'light.effect',
  title: 'Add Light Effect',
  category: 'light',
  view: 'light',
  supportsPreview: true,
  keywords: ['light', 'glow', 'rays', 'beams', 'bokeh', 'vignette', 'grade', 'rim', 'neon', 'haze', 'lighting', 'blend', 'إضاءة', 'توهج'],
  description: 'Add a lighting effect (glow, rays, rim light, bokeh, vignette, colour grade…) driven by the scene light.',
  defaultParams: ({ settings }) => ({ effect: 'backGlow', rig: { ...settings.lightRig }, amount: 60, blend: 'screen', gradeId: 'golden', color: null, seed: 7 }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (needsSubject(p.effect) && subjectItems(snapshot).length === 0) return `${LIGHT_EFFECTS.find((e) => e.id === p.effect)?.name ?? 'This effect'} needs a selected object.`;
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const tx = ctx.host.begin('Light Effect');
    const created = new Set<string>();
    const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
    const out: Built = { summaries: [], warnings: [] };
    buildEffect(ctx, tx, p, () => roleLayer(tx, ctx.snapshot.doc!, ctx.settings, ctx.presets, 'lighting', 'LIGHTING', 'top', created), ab.rect, out);
    if (p.rig && ctx.settings.liveBlur && !ctx.host.info?.capabilities.applyEffect) out.warnings.push('Live blur is not available here; lights use their vector gradients only.');
    return { batch: tx.toBatch(), summary: out.summaries.length > 1 ? `${plural(out.summaries.length, 'light')} added.` : (out.summaries[0] ?? 'Done.'), warnings: [...new Set(out.warnings)] };
  },
};

// ---------------------------------------------------------------------------
// Scene recipes
// ---------------------------------------------------------------------------

export interface SceneRecipe {
  id: string;
  name: string;
  hint: string;
  rig: Partial<L.LightRig>;
  /** Effects applied in order (area effects go on the LIGHTING layer, subject effects next to the subject). */
  steps: Array<Partial<LightEffectParams> & { effect: LightEffectId }>;
  /** Add a studio ground shadow under the subject(s). */
  shadow: boolean;
}

export const SCENE_RECIPES: readonly SceneRecipe[] = [
  {
    id: 'hero-glow',
    name: 'Hero glow',
    hint: 'Back glow + floor light + sparkles + vignette: the classic campaign hero.',
    rig: { angle: 0, elevation: 30, intensity: 85, softness: 65 },
    steps: [{ effect: 'backGlow', amount: 70 }, { effect: 'floorGlow', amount: 55 }, { effect: 'bokeh', amount: 45 }, { effect: 'vignette', amount: 55 }],
    shadow: true,
  },
  {
    id: 'golden-rays',
    name: 'Golden rays',
    hint: 'Low warm sun: rays, light leak, golden grade and a cast-ready ground shadow.',
    rig: { angle: 300, elevation: 18, kelvin: 2600, color: null, intensity: 85, softness: 50 },
    steps: [{ effect: 'beams', amount: 60 }, { effect: 'leak', amount: 45 }, { effect: 'rim', amount: 50 }, { effect: 'grade', gradeId: 'golden', amount: 70 }, { effect: 'vignette', amount: 45 }],
    shadow: true,
  },
  {
    id: 'studio-product',
    name: 'Studio product',
    hint: 'Clean key light, soft floor, studio shadow — e-commerce and product ads.',
    rig: { angle: 320, elevation: 45, kelvin: 5200, color: null, intensity: 65, softness: 80 },
    steps: [{ effect: 'keySpot', amount: 55 }, { effect: 'floorGlow', amount: 40 }, { effect: 'rim', amount: 35 }, { effect: 'vignette', amount: 30 }],
    shadow: true,
  },
  {
    id: 'night-neon',
    name: 'Night neon',
    hint: 'Neon glow on frames and type, cool bokeh and a night grade.',
    rig: { angle: 90, elevation: 30, kelvin: 6500, color: '#35E0B0', intensity: 80, softness: 50 },
    steps: [{ effect: 'neon', amount: 55 }, { effect: 'bokeh', amount: 40 }, { effect: 'grade', gradeId: 'night', amount: 60 }, { effect: 'vignette', amount: 50 }],
    shadow: false,
  },
  {
    id: 'lantern-warmth',
    name: 'Lantern warmth',
    hint: 'Candle/lantern light: warm glow, haze and a luxury grade (Ramadan, heritage).',
    rig: { angle: 45, elevation: 30, kelvin: 1900, color: null, intensity: 80, softness: 70 },
    steps: [{ effect: 'backGlow', amount: 55 }, { effect: 'haze', amount: 35 }, { effect: 'bokeh', amount: 35 }, { effect: 'grade', gradeId: 'luxury', amount: 65 }, { effect: 'vignette', amount: 50 }],
    shadow: true,
  },
  {
    id: 'emerald-luxury',
    name: 'Emerald luxury',
    hint: 'Deep emerald mood with gold rim light — national and premium campaigns.',
    rig: { angle: 330, elevation: 35, kelvin: 3000, color: null, intensity: 75, softness: 60 },
    steps: [{ effect: 'backGlow', amount: 60 }, { effect: 'rim', amount: 45 }, { effect: 'grade', gradeId: 'emerald', amount: 60 }, { effect: 'bokeh', amount: 30 }, { effect: 'vignette', amount: 60 }],
    shadow: true,
  },
];

export interface SceneParams {
  recipeId: string;
  /** Scale every step's amount (0–150 %). */
  intensity: number;
  seed: number;
}

export const lightScene: DocumentCommand<SceneParams> = {
  kind: 'document',
  id: 'light.scene',
  title: 'Light the Scene',
  category: 'light',
  view: 'light',
  supportsPreview: true,
  keywords: ['scene', 'recipe', 'cinematic', 'hero', 'golden', 'neon', 'studio', 'lantern', 'mood', 'one click', 'مشهد'],
  description: 'One click: a complete lighting recipe (glows, rays, grade, vignette, shadow) around the selected subject.',
  defaultParams: () => ({ recipeId: 'hero-glow', intensity: 100, seed: 7 }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    const r = SCENE_RECIPES.find((x) => x.id === p.recipeId);
    if (!r) return 'Unknown scene recipe.';
    if (r.steps.some((s) => needsSubject(s.effect)) && subjectItems(snapshot).length === 0) return 'Select the subject (product, person, logo or frame) to light.';
    return null;
  },
  async plan(ctx, p): Promise<CommandPlan> {
    const recipe = SCENE_RECIPES.find((x) => x.id === p.recipeId)!;
    const rig: L.LightRig = { ...ctx.settings.lightRig, ...recipe.rig };
    const tx = ctx.host.begin(`Scene: ${recipe.name}`);
    const created = new Set<string>();
    const ab = targetArtboard(ctx.snapshot, ctx.settings)!;
    const out: Built = { summaries: [], warnings: [] };
    const layer = (): string => roleLayer(tx, ctx.snapshot.doc!, ctx.settings, ctx.presets, 'lighting', 'LIGHTING', 'top', created);
    const k = Math.max(0, Math.min(150, p.intensity)) / 100;
    for (const step of recipe.steps) {
      if (needsSubject(step.effect) && subjectItems(ctx.snapshot).length === 0) continue;
      const params: LightEffectParams = {
        effect: step.effect,
        rig,
        amount: Math.round((step.amount ?? 50) * k),
        blend: step.blend ?? EFFECT_DEFAULT_BLEND[step.effect],
        gradeId: step.gradeId ?? 'golden',
        color: step.color ?? null,
        seed: p.seed,
      };
      buildEffect(ctx, tx, params, layer, ab.rect, out);
    }
    // Shadows last: 'below subject' puts them directly under it, above floor glows.
    if (recipe.shadow) {
      const palette = activePalette(ctx.settings);
      for (const s of subjectItems(ctx.snapshot)) {
        const rect = itemBounds(s, ctx.settings);
        const params = sanitizeShadowParams({ style: 'ground', subject: 'product', lightAngle: rig.angle, elevation: rig.elevation, strength: 70 * Math.min(1.2, k), color: mix(palette.dark, '#000000', 0.6) });
        const subjectId = s.af?.id ?? makeId();
        if (!s.af?.id) tx.meta.tag(s.ref, encodeMeta({ type: 'subject', id: subjectId }));
        buildShadow({ sink: tx, subject: { rect, ref: s.ref, kind: s.kind, name: subjectLabel(s) }, params, place: { k: 'below', ref: s.ref }, tags: encodeMeta({ type: SHADOW_AF_TYPE.ground, id: makeId(), source: subjectId, params: { ...params, subjectRect: rect } as unknown as Record<string, unknown> }), blurOk: ctx.settings.liveBlur && !!ctx.host.info?.capabilities.applyEffect, artboard: ab.rect });
      }
    }
    return { batch: tx.toBatch(), summary: `${recipe.name}: ${plural(recipe.steps.length + (recipe.shadow ? 1 : 0), 'layer')} of light added.`, warnings: [...new Set(out.warnings)] };
  },
};

export const LIGHT_COMMANDS = [lightEffect, lightScene];
