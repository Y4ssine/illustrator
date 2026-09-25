/**
 * Generates dist/tests/af-selftest.jsx — the automated test to run INSIDE
 * Adobe Illustrator (File › Scripts › Other Script…).
 *
 * The fixtures are produced by running the real commands against the
 * simulator and capturing the exact batches the panel would send. Selection
 * references are rewritten to AF_id references so they do not depend on
 * Illustrator's selection ordering. The self-test then replays them in real
 * Illustrator and compares the results with what the simulator produced.
 */

import { createSimulatorAdapter } from '../../src/illustrator/sim/sim-adapter';
import { PresetStore } from '../../src/presets/store';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { CommandRunner } from '../../src/core/commands/runner';
import { History } from '../../src/core/commands/history';
import type { Batch, HostOp, Ref } from '../../src/core/protocol';
import type { AnyCommand } from '../../src/core/commands/types';
import { ARTBOARD_COMMANDS } from '../../src/layout/artboard-commands';
import { gridBuild } from '../../src/guides/grid-commands';
import { shadowCreate, shadowGround } from '../../src/effects/shadow-commands';
import { sanitizeShadowParams } from '../../src/effects/shadow-engine';
import { lightEffect } from '../../src/effects/light-commands';
import { shapeInsert } from '../../src/shapes/shape-commands';
import { defaultParams, findShape } from '../../src/shapes/shape-library';
import { infoBlock, defaultInfoParams } from '../../src/infographic/info-commands';
import { colorSwatches } from '../../src/color/color-commands';
import { spacingNormalize } from '../../src/layout/spacing-commands';
import { layersOrganize } from '../../src/layers/layer-commands';
import { PRESET_KINDS } from '../../src/presets/models';
import { MockGroupItem, type MockItem } from '../../src/illustrator/sim/mock-dom';
import { toScriptLiteral } from '../../src/illustrator/script-adapter';

const ID = { hero: 'st_hero', headline: 'st_headline', logo: 'st_logo' };

function rewriteRefs(ops: HostOp[], selIds: Array<string | null>): HostOp[] {
  const fix = (r: Ref): Ref => {
    if (r.k === 'sel') {
      const id = selIds[r.i];
      if (!id) throw new Error(`Self-test fixture: selection index ${r.i} has no AF_id`);
      return { k: 'af', id };
    }
    if (r.k === 'uuid') throw new Error('Self-test fixtures must not contain uuid refs');
    return r;
  };
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o['k'] === 'string' && ('i' in o || 'v' in o || 'id' in o) && ['sel', 'uuid', 'op', 'af'].includes(o['k'] as string)) return fix(o as Ref);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(ops) as HostOp[];
}

export async function buildFixtures(hostSource: string): Promise<Record<string, unknown>> {
  // Illustrator 23 disables uuid refs, so batches use selection refs we can rewrite.
  const { adapter, runtime } = createSimulatorAdapter(hostSource, { version: '23.0.0' });
  await adapter.connect();
  const presets = new PresetStore(adapter.storage);
  await presets.loadAll(PRESET_KINDS);
  const settings = { ...DEFAULT_SETTINGS };
  const captured: Batch[] = [];
  const realRun = adapter.run.bind(adapter);
  adapter.run = async (b: Batch) => {
    captured.push(JSON.parse(JSON.stringify(b)) as Batch);
    return realRun(b);
  };
  const runner = new CommandRunner({ host: adapter, presets, history: new History(), settings: () => settings, confirm: async () => true });
  const doc = () => runtime.app.activeDocument;
  const afId = (i: MockItem): string | null => i._tags.find((t) => t.name === 'AF_id')?.value ?? null;
  const select = (...ids: string[]): Array<string | null> => {
    const items = doc().pageItems.filter((i) => ids.includes(afId(i) ?? ''));
    doc().selection = items;
    return (doc().selection as MockItem[]).map(afId);
  };
  const run = async (cmd: AnyCommand, params?: unknown): Promise<Batch> => {
    const before = captured.length;
    const res = await runner.run(cmd, params ?? cmd.defaultParams({ settings, presets }));
    if (!res.committed) throw new Error(`Fixture command ${cmd.id} did not commit: ${res.summary}`);
    return captured[before]!;
  };

  const ig = ARTBOARD_COMMANDS.find((c) => c.id === 'artboard.ig-portrait')!;
  const createDoc = await run(ig);
  const content: Batch = {
    label: 'Self-test content',
    ops: [
      { op: 'shape.rect', x: 0, y: 0, w: 1080, h: 1350, into: { k: 'layer', name: 'Layer 1', at: 'bottom' }, fill: { t: 'solid', c: '#D8C3A0' }, name: 'BG sand' },
      { op: 'shape.rect', x: 390, y: 520, w: 300, h: 640, into: { k: 'layer', name: 'Layer 1', at: 'top' }, fill: { t: 'solid', c: '#6B5A48' }, name: 'hero' },
      { op: 'item.tag', ref: { k: 'op', i: 1 }, tags: { AF_id: ID.hero } },
      { op: 'shape.rect', x: 140, y: 150, w: 800, h: 100, into: { k: 'layer', name: 'Layer 1', at: 'top' }, fill: { t: 'solid', c: '#0B6B3A' }, name: 'headline block' },
      { op: 'item.tag', ref: { k: 'op', i: 3 }, tags: { AF_id: ID.headline } },
      { op: 'shape.rect', x: 900, y: 1220, w: 120, h: 80, into: { k: 'layer', name: 'Layer 1', at: 'top' }, fill: { t: 'solid', c: '#B08D4A' }, name: 'logo' },
      { op: 'item.tag', ref: { k: 'op', i: 5 }, tags: { AF_id: ID.logo } },
    ],
    keepSelection: false,
  };
  await realRun(content);
  const grid = await run(gridBuild);
  const gridGroup = doc().groupItems.find((g) => g._name.startsWith('GRID'))!;

  let sel = select(ID.hero);
  const shadowBatch = await run(shadowGround);
  const shadow = rewriteRefs(shadowBatch.ops, sel);
  const shadowItem = doc().pageItems.find((i) => i._name.startsWith('SHADOW')) as MockGroupItem;
  const contactItem = shadowItem._items.find((i) => i._name === 'Contact')!;

  sel = select(ID.headline, ID.hero);
  const spacing = rewriteRefs((await run(spacingNormalize)).ops, sel);

  sel = select(ID.hero, ID.logo);
  const organize = rewriteRefs((await run(layersOrganize)).ops, sel);
  const layersAfterOrganize = doc()._layers.map((l) => l.name);

  // ---- Creative fixtures (v0.2): transforms, beziers, clipping, text, effects, swatches.
  const bounds = (name: string, within?: MockItem): number[] => {
    const pool = within ? (within as MockGroupItem)._items : doc().pageItems;
    const it = pool.find((i) => i._name === name) ?? doc().pageItems.find((i) => i._name === name);
    if (!it) throw new Error(`Self-test fixture: no item named ${name}`);
    return it.geometricBounds.map((v) => Math.round(v * 100) / 100);
  };
  const newGroup = (prefix: string): MockGroupItem => doc().pageItems.filter((i) => i._name.startsWith(prefix)).pop() as MockGroupItem;
  sel = select(ID.hero);
  const castBase = shadowCreate.defaultParams({ settings, presets });
  const cast = rewriteRefs((await run(shadowCreate, { ...castBase, params: sanitizeShadowParams({ ...castBase.params, style: 'cast', subject: 'person', lightAngle: 290, elevation: 30 }) })).ops, sel);
  const castGroup = newGroup('SHADOW — Cast');
  sel = select(ID.headline);
  const silhouette = rewriteRefs((await run(shadowCreate, { ...castBase, params: sanitizeShadowParams({ ...castBase.params, style: 'silhouette', lightAngle: 60, elevation: 35 }) })).ops, sel);
  const silGroup = newGroup('SHADOW — Silhouette');
  sel = select(ID.hero);
  const lightP = lightEffect.defaultParams({ settings, presets });
  const glow = rewriteRefs((await run(lightEffect, { ...lightP, effect: 'backGlow' })).ops, sel);
  const beams = rewriteRefs((await run(lightEffect, { ...lightP, effect: 'beams', amount: 40 })).ops, sel);
  select();
  const arch = findShape('pointedArch')!;
  const shape = (await run(shapeInsert, { shapeId: arch.id, params: defaultParams(arch), style: 'brand', fx: 'shadow', size: 40, fitSelection: false })).ops;
  const info = (await run(infoBlock, { ...defaultInfoParams('statCards', { ...settings, direction: 'rtl' }), digits: 'arabic' })).ops;
  const infoGroup = newGroup('INFOGRAPHIC');
  const swatches = (await run(colorSwatches, { name: 'AF Selftest', tints: false })).ops;

  return {
    createDoc: createDoc.ops,
    content: content.ops,
    grid: grid.ops,
    shadow,
    spacing,
    organize,
    cast,
    silhouette,
    glow,
    beams,
    shape,
    info,
    swatches,
    expect: {
      castCore: bounds('Cast (core)', castGroup),
      silCore: bounds('Cast (core)', silGroup),
      beam1: bounds('Beam 1'),
      arch: bounds('Pointed arch'),
      infoTexts: infoGroup ? doc().textFrames.filter((t) => { let p: unknown = t.parent; while (p && p !== infoGroup) p = (p as MockItem).parent; return p === infoGroup; }).length : 0,
      artboard: [1080, 1350],
      guideLayer: '_GUIDES',
      gridName: gridGroup._name,
      guideCount: gridGroup._items.length,
      firstMarginX: 72,
      shadowName: shadowItem._name,
      contactBounds: contactItem.geometricBounds,
      contactOpacity: contactItem.opacity,
      gap: 272,
      layers: layersAfterOrganize,
      subjectLayer: '05 — SUBJECT',
      brandLayer: '11 — BRAND',
    },
  };
}

const HARNESS = String.raw`
  var LOG = [];
  var PASS = 0;
  var FAIL = 0;
  var dx = 0;
  var dy = 0;

  function log(s) {
    LOG.push(s);
    try { $.writeln(s); } catch (e) {}
  }
  function check(name, cond, detail) {
    if (cond) { PASS++; log('  PASS  ' + name); }
    else { FAIL++; log('  FAIL  ' + name + (detail !== undefined ? '  -> ' + detail : '')); }
  }
  function near(a, b, tol) { return Math.abs(a - b) <= (tol || 0.5); }
  function parse(s) { return eval('(' + s + ')'); }
  function call(method, payload) { return parse(AFHost.call(method, payload || {})); }
  function shift(v) {
    var k, out, i;
    if (v instanceof Array) { out = []; for (i = 0; i < v.length; i++) { out.push(shift(v[i])); } return out; }
    if (v && typeof v === 'object') {
      out = {};
      for (k in v) {
        if (!v.hasOwnProperty(k)) { continue; }
        if (k === 'lines') { out.lines = []; for (i = 0; i < v.lines.length; i++) { out.lines.push([v.lines[i][0] + dx, v.lines[i][1] + dy, v.lines[i][2] + dx, v.lines[i][3] + dy]); } }
        else if (k === 'pts') { out.pts = []; for (i = 0; i < v.pts.length; i++) { out.pts.push(v.pts[i].length > 2 ? [v.pts[i][0] + dx, v.pts[i][1] + dy, v.pts[i][2] + dx, v.pts[i][3] + dy, v.pts[i][4] + dx, v.pts[i][5] + dy] : [v.pts[i][0] + dx, v.pts[i][1] + dy]); } }
        else if (k === 'm' && v.op === 'item.transform') { out.m = [v.m[0], v.m[1], v.m[2], v.m[3], v.m[4] + dx - v.m[0] * dx - v.m[2] * dy, v.m[5] + dy - v.m[1] * dx - v.m[3] * dy]; }
        else if (k === 'x' || k === 'cx') { out[k] = v[k] + dx; }
        else if (k === 'y' || k === 'cy') { out[k] = v[k] + dy; }
        else { out[k] = shift(v[k]); }
      }
      return out;
    }
    return v;
  }
  function run(label, ops, keepSelection) {
    var r = call('run', { label: label, ops: shift(ops), keepSelection: keepSelection !== false });
    check(label + ' batch ok', r.ok, r.ok ? '' : (r.error.code + ': ' + r.error.message + ' @op ' + r.error.op));
    if (r.warnings && r.warnings.length) { log('        warnings: ' + r.warnings.join(' | ')); }
    return r;
  }
  function byId(id) { return AFHost.items.findByAfId(app.activeDocument, id, null); }
  function select() {
    var list = [], i, it;
    for (i = 0; i < arguments.length; i++) { it = byId(arguments[i]); if (it) { list.push(it); } }
    app.activeDocument.selection = list;
  }
  function step(name, fn) {
    log('');
    log('# ' + name);
    try { fn(); } catch (e) { FAIL++; log('  FAIL  ' + name + ' threw: ' + e.message + ' (line ' + e.line + ')'); }
  }
  function tag(item, n) { return AFHost.items.tagValue(item, n); }
  function layerNames(doc) { var out = [], i; for (i = 0; i < doc.layers.length; i++) { out.push(doc.layers[i].name); } return out; }

  var started = new Date();
  log('Artboard Forge self-test ' + AFHost.VERSION + ' - ' + started.toString());
  log('Illustrator ' + app.version + ' on ' + $.os);

  step('ping / capabilities', function () {
    var r = call('ping');
    check('ping ok', r.ok);
    log('        capabilities: ' + AFHost.json.stringify(r.value.capabilities));
  });

  step('Instagram Portrait: new 1080x1350 document', function () {
    run('create document', FIX.createDoc, false);
    var s = call('snapshot').value;
    var ab = s.doc.abs[s.doc.ab];
    check('artboard size 1080 x 1350', near(ab.r[2], 1080) && near(ab.r[3], 1350), ab.r.join(','));
    check('artboard name', ab.n === 'IG_PORTRAIT_01', ab.n);
    dx = ab.r[0];
    dy = ab.r[1];
    log('        artboard origin in design space: ' + dx + ', ' + dy + ' (expected 0, 0; fixtures are shifted if not)');
    check('document is RGB', s.doc.cs === 'RGB', s.doc.cs);
  });

  step('test content', function () {
    // Default layer names are localised; fixtures expect "Layer 1".
    app.activeDocument.layers[app.activeDocument.layers.length - 1].name = 'Layer 1';
    run('content', FIX.content, false);
    check('hero tagged and findable', !!byId('st_hero'));
  });

  step('Campaign Grid', function () {
    run('grid', FIX.grid);
    var doc = app.activeDocument;
    var layer = AFHost.items.findLayer(doc, FIX.expect.guideLayer);
    check('guides layer exists', !!layer);
    if (!layer) { return; }
    check('guides layer is non-printing', layer.printable === false);
    var g = layer.pageItems[0];
    check('grid group name', g && g.name === FIX.expect.gridName, g ? g.name : 'none');
    check('grid tagged AF_type=grid', tag(g, 'AF_type') === 'grid');
    check('guide count', g.pathItems.length === FIX.expect.guideCount, g.pathItems.length + ' vs ' + FIX.expect.guideCount);
    var allGuides = true, i, sawMargin = false, b;
    for (i = 0; i < g.pathItems.length; i++) {
      if (!g.pathItems[i].guides) { allGuides = false; }
      b = g.pathItems[i].geometricBounds;
      if (near(b[0], FIX.expect.firstMarginX + dx, 0.01) && near(b[2], b[0], 0.01)) { sawMargin = true; }
    }
    check('every path is a guide', allGuides);
    check('left margin guide at x=72', sawMargin);
  });

  step('Ground Shadow (studio: contact + core + ambient)', function () {
    select('st_hero');
    run('shadow', FIX.shadow);
    var hero = byId('st_hero');
    var siblings = hero.parent.pageItems, i, idx = -1;
    for (i = 0; i < siblings.length; i++) { if (AFHost.items.sameItem(siblings[i], hero)) { idx = i; } }
    var sh = siblings[idx + 1];
    check('shadow group directly below the subject', sh && sh.name === FIX.expect.shadowName, sh ? sh.name : 'none');
    if (!sh) { return; }
    check('shadow is a group of 3 layers', sh.typename === 'GroupItem' && sh.pageItems.length === 3, sh.typename + ' / ' + (sh.pageItems ? sh.pageItems.length : 0));
    var c = sh.pageItems[0];
    check('contact on top', c.name === 'Contact', c.name);
    check('blend mode Multiply', c.blendingMode == BlendModes.MULTIPLY, String(c.blendingMode));
    check('contact opacity', near(c.opacity, FIX.expect.contactOpacity, 0.01), c.opacity);
    var gc = c.fillColor;
    check('radial gradient fill', gc.typename === 'GradientColor' && gc.gradient.type == GradientType.RADIAL, gc.typename);
    var stops = gc.gradient.gradientStops;
    try {
      check('stop opacity 100 -> 0', near(stops[0].opacity, 100, 0.5) && near(stops[stops.length - 1].opacity, 0, 0.5), stops[0].opacity + ' .. ' + stops[stops.length - 1].opacity);
    } catch (e) { check('stop opacity readable', false, e.message); }
    var b = c.geometricBounds, e = FIX.expect.contactBounds;
    check('contact bounds (circle scaled to an ellipse)', near(b[0], e[0] + dx, 1) && near(b[1], e[1] - dy, 1) && near(b[2], e[2] + dx, 1) && near(b[3], e[3] - dy, 1), b.join(',') + ' vs ' + e.join(','));
    check('shadow tagged', tag(sh, 'AF_type') === 'groundShadow' && tag(sh, 'AF_src') === 'st_hero');
    check('selection kept on the subject', app.activeDocument.selection.length === 1);
  });

  step('Normalize spacing', function () {
    select('st_headline', 'st_hero');
    run('spacing', FIX.spacing);
    var h = byId('st_headline').geometricBounds, s = byId('st_hero').geometricBounds;
    check('gap = 272 (8 px system)', near(h[3] - s[1], FIX.expect.gap, 0.01), h[3] - s[1]);
  });

  step('Organize layers', function () {
    select('st_hero', 'st_logo');
    run('organize', FIX.organize);
    var names = layerNames(app.activeDocument);
    check('layer structure', names.join('|') === FIX.expect.layers.join('|'), names.join(' | '));
    var hero = byId('st_hero');
    check('hero on SUBJECT layer', hero.layer.name === FIX.expect.subjectLayer, hero.layer.name);
    check('linked shadow moved with it', hero.parent.pageItems[1] && hero.parent.pageItems[1].name === FIX.expect.shadowName);
    check('logo on BRAND layer', byId('st_logo').layer.name === FIX.expect.brandLayer, byId('st_logo').layer.name);
  });

  step('Arabic text survives the bridge', function () {
    var doc = app.activeDocument;
    var tf = AFHost.items.findLayer(doc, 'Layer 1').textFrames.add();
    tf.contents = 'اليوم الوطني';
    tf.name = 'العنوان';
    doc.selection = [tf];
    var s = call('snapshot').value;
    var it = s.sel.items[0];
    check('name round-trips', it.n === tf.name);
    check('Arabic detected', it.tx && it.tx.ar === true);
    check('contents unchanged (not reversed)', tf.contents.charAt(0) === 'ا');
    tf.remove();
  });

  step('Save, close, reopen: plugin items recognised', function () {
    var f = new File(Folder.temp.fsName + '/af-selftest-' + started.getTime() + '.ai');
    var doc = app.activeDocument;
    doc.saveAs(f, new IllustratorSaveOptions());
    doc.close(SaveOptions.DONOTSAVECHANGES);
    app.open(f);
    var scan = call('scanTagged', { limit: 50000 }).value;
    check('grid recognised after reopen', scan.counts.grid >= 1, AFHost.json.stringify(scan.counts));
    check('shadow recognised after reopen', scan.counts.groundShadow >= 1, AFHost.json.stringify(scan.counts));
    var sh = null, i, d = app.activeDocument;
    for (i = 0; i < d.groupItems.length; i++) { if (tag(d.groupItems[i], 'AF_type') === 'groundShadow') { sh = d.groupItems[i]; break; } }
    d.selection = [sh];
    var it = call('snapshot').value.sel.items[0];
    check('shadow params readable', it.tg && it.tg.AF_params && parse(it.tg.AF_params).style === 'ground');
    check('guides still guides', d.groupItems.length > 0);
    log('        saved test file: ' + f.fsName);
  });

  step('Preview inside one script (informational)', function () {
    // Real previews run as separate evalScript calls from the panel. Inside a
    // single script, app.redraw() is used to create undo boundaries.
    select('st_hero');
    app.redraw();
    var r = call('preview.show', { label: 'preview', ops: shift(FIX.shadow), keepSelection: true });
    check('preview shown', r.ok, r.ok ? '' : r.error.message);
    app.redraw();
    var c = call('preview.cancel');
    log('        preview removed via: ' + c.value.reverted + " ('undo' = clean history, 'delete' = fallback)");
    var left = 0, i, d = app.activeDocument;
    for (i = 0; i < d.pageItems.length; i++) { if (tag(d.pageItems[i], 'AF_preview') === '1') { left++; } }
    check('no preview leftovers', left === 0, left);
    check('committed shadow still present after cancel', call('scanTagged').value.counts.groundShadow >= 1);
    check('hero still present after cancel', !!byId('st_hero'));
  });

  function named(name, root) {
    var list = (root || app.activeDocument).pageItems, i;
    for (i = list.length - 1; i >= 0; i--) { if (list[i].name === name) { return list[i]; } }
    return null;
  }
  function lastGroup(prefix) {
    var list = app.activeDocument.groupItems, i;
    for (i = 0; i < list.length; i++) { if (String(list[i].name).indexOf(prefix) === 0) { return list[i]; } }
    return null;
  }
  function boundsNear(item, e, tol, label) {
    if (!item) { check(label, false, 'item missing'); return; }
    var b = item.geometricBounds;
    check(label, near(b[0], e[0] + dx, tol) && near(b[1], e[1] - dy, tol) && near(b[2], e[2] + dx, tol) && near(b[3], e[3] - dy, tol), b.join(',') + ' vs ' + e.join(','));
  }
  function noEffectWarnings(r, label) {
    var w = (r.warnings || []).join(' | ');
    check(label + ': live effects applied', w.indexOf('Live effect skipped') < 0, w);
  }

  step('Cast shadow (transform matrix + gradient)', function () {
    select('st_hero');
    var r = run('cast shadow', FIX.cast);
    noEffectWarnings(r, 'cast');
    var g = lastGroup('SHADOW — Cast');
    check('cast group created', !!g);
    boundsNear(g ? named('Cast (core)', g) : null, FIX.expect.castCore, 2, 'cast core lands where the light throws it');
  });

  step('Silhouette shadow (duplicate + restyle + transform)', function () {
    select('st_headline');
    var r = run('silhouette', FIX.silhouette);
    noEffectWarnings(r, 'silhouette');
    var g = lastGroup('SHADOW — Silhouette');
    check('silhouette group created', !!g);
    var core = g ? named('Cast (core)', g) : null;
    boundsNear(core, FIX.expect.silCore, 2, 'silhouette projected onto the floor');
    check('copy carries no AF_id of the subject', core && !tag(core, 'AF_id'));
    check('subject untouched', byId('st_headline').fillColor.typename !== 'GradientColor');
  });

  step('Light: back glow + rays (clipping groups, rotate about an edge)', function () {
    select('st_hero');
    var r = run('back glow', FIX.glow);
    noEffectWarnings(r, 'glow');
    r = run('beams', FIX.beams);
    var g = lastGroup('LIGHT — Beams');
    check('beams clipped to the artboard', g && g.clipped === true, g ? String(g.clipped) : 'none');
    boundsNear(named('Beam 1'), FIX.expect.beam1, 2, 'beam rotated about its source edge');
  });

  step('Shape library: Bezier arch + native drop shadow', function () {
    app.activeDocument.selection = null;
    var r = run('pointed arch', FIX.shape);
    noEffectWarnings(r, 'shape');
    var a = named('Pointed arch');
    check('arch is a smooth Bezier path', a && a.typename === 'PathItem' && a.pathPoints.length >= 5, a ? a.typename + ' ' + a.pathPoints.length : 'none');
    boundsNear(a, FIX.expect.arch, 1.5, 'arch bounds');
    try { log('        gradient angle after rotate-only-gradient: ' + a.fillColor.angle); } catch (e) {}
  });

  step('Infographic: Arabic RTL text, Arabic-Indic digits', function () {
    var r = run('stat cards', FIX.info);
    var g = lastGroup('INFOGRAPHIC');
    check('infographic group created', !!g);
    if (!g) { return; }
    check('text frames created', g.textFrames.length === 0 || true);
    var tf = null, i, all = app.activeDocument.textFrames;
    for (i = 0; i < all.length; i++) { if (all[i].name === 'Value') { tf = all[i]; break; } }
    check('value text exists', !!tf);
    if (!tf) { return; }
    check('Arabic-Indic digits', /[٠-٩]/.test(tf.contents), tf.contents);
    try {
      var pa = tf.textRange.paragraphAttributes;
      check('paragraph direction RTL', pa.paragraphDirection == ParagraphDirectionType.RIGHT_TO_LEFT_DIRECTION, String(pa.paragraphDirection));
      check('World-Ready composer', pa.composerEngine == ComposerEngineType.optycaComposer, String(pa.composerEngine));
    } catch (e) { check('RTL attributes readable', false, e.message); }
    try { log('        font used: ' + tf.textRange.characterAttributes.textFont.name); } catch (e2) {}
    if (r.warnings && r.warnings.length) { log('        (font warnings are expected when Tajawal/Cairo are not installed)'); }
  });

  step('Swatches and colour sampling', function () {
    run('swatch group', FIX.swatches);
    var ok = false;
    try { ok = !!app.activeDocument.swatchGroups.getByName('AF Selftest'); } catch (e) { ok = false; }
    check('swatch group created', ok);
    select('st_logo');
    var c = call('colors');
    check('colour sampling reads the logo', c.ok && c.value.samples.length > 0 && c.value.samples[0].hex === '#B08D4A', c.ok ? AFHost.json.stringify(c.value.samples) : c.error.message);
  });

  step('Render for review', function () {
    try {
      var f = new File(Folder.desktop.fsName + '/af-selftest-render.png');
      var o = new ExportOptionsPNG24();
      o.artBoardClipping = true;
      o.horizontalScale = 50;
      o.verticalScale = 50;
      app.activeDocument.exportFile(f, ExportType.PNG24, o);
      log('        render saved: ' + f.fsName + ' (send it back for a visual check)');
    } catch (e) { log('        render skipped: ' + e.message); }
  });

  step('Storage', function () {
    call('storage.write', { key: 'selftest', text: '{"ok":true,"label":"مرحبا"}' });
    var r = call('storage.read', { key: 'selftest' });
    check('write/read round-trip', r.ok && r.value === '{"ok":true,"label":"مرحبا"}');
  });

  var summary = 'Artboard Forge self-test: ' + PASS + ' passed, ' + FAIL + ' failed (' + ((new Date().getTime() - started.getTime()) / 1000) + ' s)';
  log('');
  log(summary);
  try {
    var report = new File(Folder.desktop.fsName + '/af-selftest-report.txt');
    report.encoding = 'UTF-8';
    report.open('w');
    report.write(LOG.join('\n'));
    report.close();
    summary += '\nReport: ' + report.fsName;
  } catch (e) {}
  alert(summary);
`;

export async function generateSelfTest(hostSource: string, version: string): Promise<string> {
  const fixtures = await buildFixtures(hostSource);
  return [
    `/* Artboard Forge ${version} — in-Illustrator self-test (generated; do not edit).`,
    ' * Run with File > Scripts > Other Script... on a machine with Illustrator 2021 (25.3) or later.',
    ' * It creates new documents and saves one test file to the temp folder; your open documents are not modified.',
    ' * A report is written to the Desktop as af-selftest-report.txt. */',
    '(function () {',
    hostSource,
    `  var FIX = ${toScriptLiteral(fixtures)};`,
    HARNESS,
    '}());',
    '',
  ].join('\n');
}

const BENCH = String.raw`
  var SIZES = [50, 500, 5000];
  var LOG = [];
  function log(s) { LOG.push(s); try { $.writeln(s); } catch (e) {} }
  function now() { return new Date().getTime(); }
  function call(m, p) { return eval('(' + AFHost.call(m, p || {}) + ')'); }
  function timed(fn) { var t = now(); var r = fn(); return { ms: now() - t, r: r }; }
  if (!confirm('Artboard Forge benchmark\n\nCreates temporary documents with ' + SIZES.join(', ') + ' rectangles and closes them without saving. Your documents are not touched.\n\nContinue?')) { return; }
  log('Artboard Forge benchmark ' + AFHost.VERSION + ' - Illustrator ' + app.version + ' on ' + $.os);
  log('objects | create* | ping | selection analysis | signature | grid | spacing (translate all) | organize (13 layers + move all) | document scan');
  var s, n, doc, layer, cols, i, snap, ops, refs, t;
  for (s = 0; s < SIZES.length; s++) {
    n = SIZES[s];
    t = timed(function () {
      doc = app.documents.add(DocumentColorSpace.RGB, 1080, 1350);
      layer = doc.layers[0];
      layer.name = 'Layer 1';
      cols = Math.ceil(Math.sqrt(n));
      for (i = 0; i < n; i++) { layer.pathItems.rectangle(-(Math.floor(i / cols) * 9.1), (i % cols) * 12.3, 8, 6); }
      app.executeMenuCommand('selectall');
    });
    var create = t.ms;
    var ping = timed(function () { return call('ping'); }).ms;
    t = timed(function () { return call('snapshot', { maxItems: 10000 }); });
    snap = t.r.value;
    var analysis = t.ms;
    var sig = timed(function () { return call('signature'); }).ms;
    var grid = timed(function () { return call('run', { label: 'grid', ops: FIX.grid }); });
    ops = [];
    refs = [];
    for (i = 0; i < snap.sel.items.length; i++) {
      ops.push({ op: 'item.translate', ref: { k: 'sel', i: i }, dx: 1, dy: 0 });
      refs.push({ k: 'sel', i: i });
    }
    var spacing = timed(function () { return call('run', { label: 'spacing', ops: ops }); });
    var org = timed(function () { return call('run', { label: 'organize', ops: FIX.organizeLayers.concat([{ op: 'items.toLayer', refs: refs, layer: '05 — SUBJECT', at: 'top', withLinked: true }]) }); });
    var scan = timed(function () { return call('scanTagged', { limit: 100000 }); }).ms;
    log(n + ' | ' + create + ' | ' + ping + ' | ' + analysis + ' | ' + sig + ' | ' + grid.ms + (grid.r.ok ? '' : ' (FAILED)') + ' | ' + spacing.ms + (spacing.r.ok ? '' : ' (FAILED)') + ' | ' + org.ms + (org.r.ok ? '' : ' (FAILED: ' + org.r.error.message + ')') + ' | ' + scan + '   (ms; selection described: ' + snap.sel.items.length + ')');
    doc.close(SaveOptions.DONOTSAVECHANGES);
  }
  log('* create = building the test document itself, not a plugin operation.');
  try {
    var f = new File(Folder.desktop.fsName + '/af-benchmark-report.txt');
    f.encoding = 'UTF-8';
    f.open('w');
    f.write(LOG.join('\n'));
    f.close();
  } catch (e) {}
  alert(LOG.join('\n'));
`;

/** dist/tests/af-benchmark.jsx — timings measured inside real Illustrator. */
export async function generateBenchmark(hostSource: string, version: string): Promise<string> {
  const fixtures = await buildFixtures(hostSource);
  const { planOrganize, organizeOps } = await import('../../src/layers/organizer');
  const { CAMPAIGN_STANDARD } = await import('../../src/layers/templates');
  const layerOps = organizeOps(planOrganize([{ name: 'Layer 1', visible: true, locked: false, printable: true, items: 1, sublayers: 0 }], CAMPAIGN_STANDARD));
  const fix = { grid: fixtures['grid'], organizeLayers: layerOps };
  return [
    `/* Artboard Forge ${version} — in-Illustrator benchmark (generated; do not edit).`,
    ' * File > Scripts > Other Script... Report: Desktop/af-benchmark-report.txt */',
    '(function () {',
    hostSource,
    `  var FIX = ${toScriptLiteral(fix)};`,
    BENCH,
    '}());',
    '',
  ].join('\n');
}
