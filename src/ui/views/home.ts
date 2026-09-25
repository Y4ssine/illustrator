/**
 * HOME: document status, context-aware actions, favourites, artboards,
 * one-click "Set Up Design", recent operations.
 */

import { activeArtboard } from '../../core/snapshot';
import { AF_TYPE_LABEL, type AfType } from '../../core/tags';
import { ARTBOARD_PRESETS } from '../../layout/artboard-presets';
import { SETUP_RECIPES, type CarouselParams, type SetupParams, type SocialArtboardParams } from '../../layout/artboard-commands';
import type { ArtboardMode } from '../../layout/artboard-engine';
import { formatLength } from '../../geometry/units';
import type { AppController } from '../app';
import { h, replaceChildren } from '../dom';
import { Button, NumberField, Select, TextField } from '../components/controls';
import { Badge, ButtonGrid, Empty, Note, Readout, Row, Section } from '../components/layout';
import type { View } from './view';

export function HomeView(app: AppController): View {
  // ---- Document ------------------------------------------------------------
  const docBox = h('div', { class: 'doc-card' });
  const scanBox = h('div', { class: 'scan' });
  const docSection = Section(
    { id: 'home.doc', title: 'Document', actions: [Button({ icon: 'search', title: 'Find Artboard Forge items in this document', variant: 'quiet', onClick: () => void app.scanDocument() })] },
    docBox,
    scanBox,
  );

  // ---- Context ---------------------------------------------------------------
  const ctxBox = h('div', { class: 'ctx' });
  const ctxSection = Section({ id: 'home.context', title: 'For this selection' }, ctxBox);

  // ---- Favourites ----------------------------------------------------------------
  const favBox = h('div', null);
  const favSection = Section(
    { id: 'home.fav', title: 'Quick actions', hint: 'Star commands in the command palette (Ctrl/Cmd+K) to add them here.' },
    favBox,
  );

  // ---- Artboards --------------------------------------------------------------------
  let presetId = 'ig-portrait';
  let mode: ArtboardMode = app.settings.artboardMode;
  const abPreset = Select({
    label: 'Size',
    value: presetId,
    options: ARTBOARD_PRESETS.map((p) => ({ value: p.id, label: `${p.name}  ${Math.round(p.w)}×${Math.round(p.h)}`, group: p.group })),
    onChange: (v) => (presetId = v),
  });
  const abMode = Select<ArtboardMode>({
    label: 'Mode',
    value: mode,
    title: 'Auto: reuse a matching active artboard, resize an empty new document, otherwise add one to the right.',
    options: [
      { value: 'auto', label: 'Auto' },
      { value: 'add', label: 'Add new artboard' },
      { value: 'resizeActive', label: 'Resize active artboard' },
    ],
    onChange: (v) => (mode = v),
  });
  const carousel: CarouselParams = { presetId: 'ig-portrait', count: 5, spacing: 0, namePattern: 'Slide {nn}' };
  const unit = (): typeof app.settings.units => app.settings.units;
  const abSection = Section(
    { id: 'home.artboards', title: 'Artboards' },
    abPreset.el,
    abMode.el,
    Row(
      Button({
        label: 'Create / Switch',
        icon: 'artboard',
        variant: 'primary',
        onClick: () => {
          const params: SocialArtboardParams = { presetId, mode };
          void app.run(`artboard.${presetId}`, params);
        },
      }),
    ),
    h('div', { class: 'subhead' }, 'Carousel'),
    Row(
      NumberField({ label: 'Slides', value: carousel.count, min: 1, max: 100, kind: 'count', width: 'narrow', onChange: (v) => (carousel.count = v) }).el,
      NumberField({ label: 'Gap', value: carousel.spacing, min: 0, max: 2000, kind: 'length', unit, width: 'narrow', title: '0 = continuous carousel (artwork can span slides)', onChange: (v) => (carousel.spacing = v) }).el,
    ),
    Row(
      Button({
        label: 'Add slides',
        onClick: () => void app.run('artboard.carousel', { ...carousel, presetId }),
      }),
    ),
    h('div', { class: 'subhead' }, 'Auto-number'),
    (() => {
      let pattern = 'IG_POST_{nn}';
      return h(
        'div',
        null,
        TextField({ label: 'Pattern', value: pattern, title: 'Tokens: {n}, {nn}, {nnn}', onChange: (v) => (pattern = v) }).el,
        Row(Button({ label: 'Rename all artboards', onClick: () => void app.run('artboard.renumber', { pattern }) })),
      );
    })(),
  );

  // ---- Set up design ------------------------------------------------------------------
  let recipe = SETUP_RECIPES[0]!.id;
  const setupSection = Section(
    { id: 'home.setup', title: 'Set up design', hint: 'Creates or reuses the artboard, then the layer structure, grid and safe area in one go. Adds no artwork, logos or emblems.' },
    Select({ label: 'Recipe', value: recipe, options: SETUP_RECIPES.map((r) => ({ value: r.id, label: r.name })), onChange: (v) => (recipe = v) }).el,
    Row(
      Button({
        label: 'Set up',
        icon: 'play',
        variant: 'primary',
        onClick: () => {
          const r = SETUP_RECIPES.find((x) => x.id === recipe)!;
          void app.run('setup.wizard', r.params satisfies SetupParams);
        },
      }),
    ),
  );

  // ---- Recent -------------------------------------------------------------------------
  const recentBox = h('div', null);
  const recentSection = Section(
    { id: 'home.recent', title: 'Recent', actions: [Button({ icon: 'repeat', title: 'Repeat last command', variant: 'quiet', onClick: () => void app.repeatLast() })] },
    recentBox,
  );

  const el = h('div', { class: 'view' }, docSection.el, ctxSection.el, favSection.el, abSection.el, setupSection.el, recentSection.el);

  function renderDoc(): void {
    const s = app.s;
    const doc = s.snapshot?.doc;
    if (!s.connected) {
      replaceChildren(docBox, Note(s.error ?? 'Connecting to Illustrator…', s.error ? 'warn' : 'info'));
      return;
    }
    if (!doc) {
      replaceChildren(docBox, Empty('No document open. Pick a size under Artboards or use Set up design.'));
      return;
    }
    const ab = activeArtboard(doc);
    const u = app.settings.units;
    replaceChildren(
      docBox,
      h('div', { class: 'doc-name', title: doc.name }, doc.name, doc.saved ? null : h('span', { class: 'dirty', title: 'Unsaved changes' }, ' •')),
      Readout([
        ['Artboard', ab ? `${ab.name} (${ab.index + 1}/${doc.artboards.length})` : '—'],
        ['Size', ab ? `${formatLength(ab.rect.w, u)} × ${formatLength(ab.rect.h, u)}` : '—'],
        ['Colour', doc.colorSpace],
        ['Layers', String(doc.layers.length)],
        ['Host', `${s.info?.host === 'simulator' ? 'Simulator' : 'Illustrator'} ${s.info?.version ?? ''}`],
      ]),
    );
  }

  function renderScan(): void {
    const scan = app.s.scan;
    if (!app.s.snapshot?.doc || !scan) {
      replaceChildren(scanBox);
      return;
    }
    const entries = Object.entries(scan.counts);
    replaceChildren(
      scanBox,
      h('div', { class: 'subhead' }, 'Artboard Forge items'),
      entries.length
        ? h('div', { class: 'chips' }, ...entries.map(([t, n]) => Badge(`${AF_TYPE_LABEL[t as AfType] ?? t}: ${n}`, 'af')))
        : Empty('None yet.'),
      scan.truncated ? Note(`Scanned the first ${scan.scanned} objects only (large document).`) : null,
      scan.previewLeftovers > 0
        ? h('div', null, Note(`${scan.previewLeftovers} preview item(s) were left by an interrupted session.`, 'warn'), Row(Button({ label: 'Remove leftovers', variant: 'danger', small: true, onClick: () => void app.sweepPreviewLeftovers() })))
        : null,
    );
  }

  function renderContext(): void {
    const c = app.s.context;
    if (!c) {
      replaceChildren(ctxBox);
      return;
    }
    const buttons = c.suggestions
      .map((id) => app.command(id))
      .filter((cmd): cmd is NonNullable<typeof cmd> => !!cmd)
      .map((cmd) => Button({ label: cmd.title, title: cmd.description, small: true, onClick: () => (cmd.view && cmd.view !== 'home' && cmd.id !== 'layers.organize' ? app.go(cmd.view) : void app.run(cmd.id)) }));
    replaceChildren(
      ctxBox,
      h('div', { class: 'ctx-label' }, c.label),
      c.kind === 'textEditing' ? Note('Press Esc to leave text editing; plugin commands work on objects.') : null,
      buttons.length ? ButtonGrid(...buttons) : null,
    );
  }

  function renderFavs(): void {
    const buttons = app.settings.favorites
      .map((id) => app.command(id))
      .filter((cmd): cmd is NonNullable<typeof cmd> => !!cmd)
      .map((cmd) => Button({ label: cmd.title, title: cmd.description, small: true, onClick: () => void app.run(cmd.id) }));
    replaceChildren(favBox, buttons.length ? ButtonGrid(...buttons) : Empty('No favourites yet.'));
  }

  function renderRecent(): void {
    const list = app.history.list();
    if (list.length === 0) {
      replaceChildren(recentBox, Empty('Plugin operations appear here (separate from Edit › Undo).'));
      return;
    }
    replaceChildren(
      recentBox,
      h(
        'ol',
        { class: 'history' },
        ...list.map((e) => {
          const li = h('li', { title: 'Open with these settings (does not run it)' }, h('span', { class: 'history-title' }, e.title), h('span', { class: 'history-summary' }, e.summary), h('time', null, new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
          li.addEventListener('click', () => app.open(e));
          return li;
        }),
      ),
    );
  }

  return {
    id: 'home',
    title: 'Home',
    el,
    update(_s, changed) {
      if (changed.has('snapshot') || changed.has('connected') || changed.has('info') || changed.has('error') || changed.has('settingsVersion')) renderDoc();
      if (changed.has('scan') || changed.has('snapshot')) renderScan();
      if (changed.has('context')) renderContext();
      if (changed.has('settingsVersion') || changed.has('tab')) renderFavs();
      if (changed.has('busy') || changed.has('tab') || changed.has('settingsVersion')) renderRecent();
    },
  };
}
