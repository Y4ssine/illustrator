/**
 * Artboard commands: social presets, carousel, renumbering and the
 * "Set Up Design" wizard (artboard + layers + grid + safe area in one go).
 */

import type { CommandPlan, DocumentCommand, PlanContext } from '../core/commands/types';
import { activeTemplate, ensureGuideLayer, requireDoc } from '../core/commands/helpers';
import { AFError } from '../core/errors';
import { activeArtboard } from '../core/snapshot';
import { makeId, plural } from '../utils/misc';
import { computeGrid } from '../guides/grid-engine';
import { addGuideGroup } from '../guides/grid-commands';
import { safeAreaGuides } from '../guides/guide-generator';
import { SAFE_ZONES, scaledInset } from '../guides/safe-zones';
import { organizeOps, planOrganize } from '../layers/organizer';
import type { ArtboardSizePreset } from '../presets/models';
import { formatArtboardName, planCarousel, planSocialArtboard, type ArtboardMode } from './artboard-engine';

export interface SocialArtboardParams {
  presetId: string;
  mode: ArtboardMode;
}

function presetOrThrow(ctx: Pick<PlanContext, 'presets'>, id: string): ArtboardSizePreset {
  const p = ctx.presets.get('artboard', id);
  if (!p) throw new AFError('NO_PRESET', `Unknown artboard preset “${id}”.`);
  return p;
}

async function planSocial(ctx: PlanContext, p: SocialArtboardParams): Promise<CommandPlan> {
  const preset = presetOrThrow(ctx, p.presetId);
  const plan = planSocialArtboard(ctx.snapshot.doc, preset, { mode: p.mode, spacing: ctx.settings.artboardSpacing, namePattern: ctx.settings.artboardNamePattern });
  const tx = ctx.host.begin(preset.name);
  switch (plan.kind) {
    case 'createDocument':
      tx.artboards.createDocument(plan.w, plan.h, plan.colorSpace, plan.name);
      return { batch: tx.toBatch({ keepSelection: false }), summary: `New ${plan.colorSpace} document, ${plan.w} × ${plan.h}.`, warnings: [] };
    case 'alreadyMatches':
      return { batch: tx.toBatch(), summary: '', warnings: [], nothing: plan.message };
    case 'resize':
      tx.artboards.update(plan.index, { rect: plan.rect, name: plan.name });
      tx.artboards.activate(plan.index);
      return {
        batch: tx.toBatch(),
        summary: `Artboard resized to ${preset.w} × ${preset.h} and renamed “${plan.name}”.`,
        warnings: ctx.snapshot.doc?.colorSpace !== preset.colorSpace ? [`This document is ${ctx.snapshot.doc?.colorSpace}; ${preset.name} is usually ${preset.colorSpace}.`] : [],
      };
    case 'add': {
      const ref = tx.artboards.add(plan.rect, plan.name);
      void ref;
      return {
        batch: tx.toBatch(),
        summary: `Added “${plan.name}” (${preset.w} × ${preset.h}) and made it active.`,
        warnings: ctx.snapshot.doc?.colorSpace !== preset.colorSpace ? [`This document is ${ctx.snapshot.doc?.colorSpace}; ${preset.name} is usually ${preset.colorSpace}.`] : [],
      };
    }
  }
}

function socialCommand(presetId: string, title: string, keywords: string[]): DocumentCommand<SocialArtboardParams> {
  return {
    kind: 'document',
    id: `artboard.${presetId}`,
    title,
    category: 'artboards',
    view: 'home',
    worksWithoutDocument: true,
    keywords: ['artboard', 'size', 'social', ...keywords],
    description: `Create or switch to a ${title} artboard. Uses the active artboard if it already matches; resizes an empty single-artboard document; otherwise adds a new artboard to the right.`,
    defaultParams: ({ settings }) => ({ presetId, mode: settings.artboardMode }),
    validate(snapshot) {
      if (snapshot.selection.mode === 'text-editing') return 'You are editing text. Press Esc to leave the text, then try again.';
      return null;
    },
    plan: planSocial,
  };
}

export const artboardCommands = [
  socialCommand('ig-square', 'Instagram Square 1080×1080', ['instagram', 'square', 'post', '1:1']),
  socialCommand('ig-portrait', 'Instagram Portrait 1080×1350', ['instagram', 'portrait', 'post', '4:5', 'feed']),
  socialCommand('ig-story', 'Instagram Story 1080×1920', ['instagram', 'story', 'reel', '9:16', 'vertical']),
  socialCommand('x-post', 'X / Twitter Post 1600×900', ['x', 'twitter', '16:9']),
  socialCommand('linkedin-square', 'LinkedIn Square 1200×1200', ['linkedin']),
  socialCommand('linkedin-landscape', 'LinkedIn Landscape 1200×627', ['linkedin', 'link']),
  socialCommand('youtube-thumb', 'YouTube Thumbnail 1280×720', ['youtube', 'thumbnail']),
  socialCommand('presentation', 'Presentation 1920×1080', ['presentation', 'slide', 'keynote', '16:9']),
];

export interface CarouselParams {
  presetId: string;
  count: number;
  spacing: number;
  namePattern: string;
}

export const artboardCarousel: DocumentCommand<CarouselParams> = {
  kind: 'document',
  id: 'artboard.carousel',
  title: 'Create Carousel Slides',
  category: 'artboards',
  view: 'home',
  keywords: ['carousel', 'slides', 'swipe', 'multiple', 'artboards', 'instagram'],
  description: 'Add N slides side by side (spacing 0 makes a continuous carousel for spanning artwork).',
  defaultParams: () => ({ presetId: 'ig-portrait', count: 5, spacing: 0, namePattern: 'Slide {nn}' }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (!(p.count >= 1 && p.count <= 100)) return 'Slide count must be between 1 and 100.';
    return null;
  },
  async plan(ctx, p) {
    const preset = presetOrThrow(ctx, p.presetId);
    const slides = planCarousel(
      ctx.snapshot.doc!.artboards.map((a) => a.rect),
      preset,
      p.count,
      p.spacing,
      p.namePattern,
    );
    const tx = ctx.host.begin('Carousel');
    for (const s of slides) tx.artboards.add(s.rect, s.name);
    return {
      batch: tx.toBatch(),
      summary: `${plural(slides.length, 'slide')} added (${preset.w} × ${preset.h}${p.spacing === 0 ? ', continuous' : ''}).`,
      warnings: [],
    };
  },
};

export interface RenumberParams {
  pattern: string;
}

export const artboardRenumber: DocumentCommand<RenumberParams> = {
  kind: 'document',
  id: 'artboard.renumber',
  title: 'Auto-Number Artboards',
  category: 'artboards',
  view: 'home',
  keywords: ['rename', 'number', 'artboards', 'names', 'sequence'],
  description: 'Rename every artboard in order, e.g. IG_POST_01, IG_POST_02…',
  defaultParams: () => ({ pattern: 'IG_POST_{nn}' }),
  validate(snapshot, p) {
    const d = requireDoc(snapshot);
    if (d) return d;
    if (!/\{n+\}/.test(p.pattern)) return 'The pattern needs a number token: {n}, {nn} or {nnn}.';
    return null;
  },
  async plan(ctx, p) {
    const tx = ctx.host.begin('Number Artboards');
    const abs = ctx.snapshot.doc!.artboards;
    abs.forEach((a, i) => {
      const name = formatArtboardName(p.pattern, i + 1);
      if (a.name !== name) tx.artboards.update(a.index, { name });
    });
    if (tx.ops.length === 0) return { batch: tx.toBatch(), summary: '', warnings: [], nothing: 'Artboards already follow this pattern.' };
    return { batch: tx.toBatch(), summary: `${plural(abs.length, 'artboard')} renamed.`, warnings: [] };
  },
};

export interface SetupParams {
  artboardPresetId: string;
  gridPresetId: string;
  templateId: string;
  safeZoneId: string | null;
}

export const SETUP_RECIPES: Array<{ id: string; name: string; params: SetupParams }> = [
  { id: 'saudi-campaign', name: 'Saudi Campaign Workspace (4:5)', params: { artboardPresetId: 'ig-portrait', gridPresetId: 'campaign-grid', templateId: 'saudi-campaign', safeZoneId: 'ig-portrait-grid' } },
  { id: 'ig-post', name: 'Instagram Post — Campaign', params: { artboardPresetId: 'ig-portrait', gridPresetId: 'campaign-grid', templateId: 'campaign-standard', safeZoneId: null } },
  { id: 'story', name: 'Story — Campaign', params: { artboardPresetId: 'ig-story', gridPresetId: 'campaign-grid', templateId: 'campaign-standard', safeZoneId: 'ig-story' } },
  { id: 'poster', name: 'Poster Workspace (A3)', params: { artboardPresetId: 'a3', gridPresetId: 'poster', templateId: 'campaign-standard', safeZoneId: 'print-5mm' } },
  { id: 'presentation', name: 'Presentation — Editorial', params: { artboardPresetId: 'presentation', gridPresetId: 'twelve-column', templateId: 'campaign-standard', safeZoneId: 'title-safe-10' } },
];

async function setupStage2(ctx: PlanContext, p: SetupParams): Promise<CommandPlan> {
  const doc = ctx.snapshot.doc;
  if (!doc) throw new AFError('NO_DOCUMENT', 'The new document could not be found.');
  const ab = activeArtboard(doc)!;
  const template = ctx.presets.get('layerTemplate', p.templateId) ?? activeTemplate(ctx.settings, ctx.presets);
  const grid = ctx.presets.get('grid', p.gridPresetId);
  const tx = ctx.host.begin('Set Up Design — layers & grid');
  const plan = planOrganize(doc.layers, template);
  tx.append(organizeOps(plan));
  const guideLayer = plan.roleNames.guides ?? ensureGuideLayer(tx, { ...doc, layers: [] }, ctx.settings, template);
  const warnings = [...plan.warnings];
  if (grid) {
    const g = computeGrid(ab.rect, grid.spec);
    warnings.push(...g.warnings);
    addGuideGroup(tx, guideLayer, `GRID — ${grid.name} — ${ab.name}`, g.lines, {
      type: 'grid',
      id: makeId(),
      params: { presetId: grid.id, spec: grid.spec, target: 'activeArtboard', area: ab.rect, artboard: ab.index },
    });
  }
  const zone = p.safeZoneId ? SAFE_ZONES.find((z) => z.id === p.safeZoneId) : undefined;
  if (zone) {
    addGuideGroup(tx, guideLayer, `SAFE AREA — ${zone.name} — ${ab.name}`, safeAreaGuides(ab.rect, scaledInset(zone, ab.rect.w, ab.rect.h)), {
      type: 'guides',
      id: makeId(),
      params: { zoneId: zone.id, artboard: ab.index },
    });
  }
  return {
    batch: tx.toBatch({ keepSelection: false }),
    summary: `Workspace ready: “${template.name}” layers${grid ? `, ${grid.name}` : ''}${zone ? `, ${zone.name} safe area` : ''}.`,
    warnings,
  };
}

export const setupWizard: DocumentCommand<SetupParams> = {
  kind: 'document',
  id: 'setup.wizard',
  title: 'Set Up Design',
  category: 'artboards',
  view: 'home',
  worksWithoutDocument: true,
  keywords: ['setup', 'wizard', 'workspace', 'new', 'saudi', 'campaign', 'poster', 'template', 'start'],
  description: 'Artboard + layer structure + grid + safe area in one step. Adds no artwork, logos or emblems.',
  defaultParams: () => SETUP_RECIPES[0]!.params,
  validate(snapshot) {
    if (snapshot.selection.mode === 'text-editing') return 'You are editing text. Press Esc to leave the text, then try again.';
    return null;
  },
  async plan(ctx, p) {
    const stage1 = await planSocial(ctx, { presetId: p.artboardPresetId, mode: 'auto' });
    const next = (c: PlanContext): Promise<CommandPlan> => setupStage2(c, p);
    if (stage1.nothing) {
      // Artboard already right: go straight to layers & grid.
      return setupStage2(ctx, p);
    }
    return { ...stage1, next };
  },
};

export const ARTBOARD_COMMANDS = [...artboardCommands, artboardCarousel, artboardRenumber, setupWizard];
