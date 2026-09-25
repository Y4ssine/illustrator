import { describe, expect, it } from 'vitest';
import { formatLayerName, normalizeLayerName, resolveRole } from '../../src/layers/naming';
import { organizeOps, planOrganize } from '../../src/layers/organizer';
import { proposeSort } from '../../src/layers/autosort';
import { CAMPAIGN_STANDARD, DEPTH_STACK, SAUDI_CAMPAIGN } from '../../src/layers/templates';
import type { LayerInfo, ItemDescriptor } from '../../src/core/snapshot';

const L = (name: string, items = 0): LayerInfo => ({ name, visible: true, locked: false, printable: true, items, sublayers: 0 });

describe('layer naming', () => {
  it('formats names', () => {
    expect(formatLayerName({ label: 'SUBJECT', number: 5 }, 'dash')).toBe('05 — SUBJECT');
    expect(formatLayerName({ label: 'SUBJECT', number: 5 }, 'underscore')).toBe('05_SUBJECT');
    expect(formatLayerName({ label: 'SUBJECT', number: 5 }, 'dot')).toBe('05. Subject');
    expect(formatLayerName({ label: 'SUBJECT', number: null }, 'dash')).toBe('SUBJECT');
    expect(formatLayerName({ label: 'SUBJECT', number: 5 }, 'plain')).toBe('SUBJECT');
  });

  it('normalises and resolves roles, including Arabic aliases', () => {
    expect(normalizeLayerName('05 — Subject ')).toBe('SUBJECT');
    expect(normalizeLayerName('_GUIDES')).toBe('GUIDES');
    expect(normalizeLayerName('01_BG')).toBe('BG');
    expect(resolveRole('_GUIDES')).toBe('guides');
    expect(resolveRole('00 — GUIDES')).toBe('guides');
    expect(resolveRole('Hero')).toBe('subject');
    expect(resolveRole('الخلفية')).toBe('background');
    expect(resolveRole('شعار')).toBe('brand');
    expect(resolveRole('Layer 1')).toBeNull();
    expect(resolveRole('')).toBeNull();
  });
});

describe('layer organizer', () => {
  it('creates the full template above unrecognised layers, in order', () => {
    const plan = planOrganize([L('Layer 1', 12)], CAMPAIGN_STANDARD);
    const creates = plan.actions.filter((a) => a.kind === 'create');
    expect(creates).toHaveLength(13);
    expect(plan.unmatched).toEqual(['Layer 1']);
    // First create (bottom-most, BACKGROUND) goes to the top; each next one goes above the previous.
    expect(creates[0]).toMatchObject({ name: '01 — BACKGROUND', anchor: 'top' });
    expect(creates[1]).toMatchObject({ name: '02 — ATMOSPHERE', anchor: { name: '01 — BACKGROUND', place: 'above' } });
    expect(creates[12]).toMatchObject({ name: '00 — GUIDES', printable: false });
    expect(plan.roleNames.typography).toBe('10 — TYPOGRAPHY');
  });

  it('renames recognised layers and anchors missing ones next to them', () => {
    const plan = planOrganize([L('_GUIDES', 1), L('Typo'), L('Layer 1', 3), L('BG', 1)], CAMPAIGN_STANDARD);
    expect(plan.actions).toContainEqual({ kind: 'rename', from: '_GUIDES', to: '00 — GUIDES', role: 'guides' });
    expect(plan.actions).toContainEqual({ kind: 'rename', from: 'BG', to: '01 — BACKGROUND', role: 'background' });
    // "Typo" is not an alias → unmatched; TYPOGRAPHY created.
    expect(plan.unmatched).toContain('Typo');
    const atmos = plan.actions.find((a) => a.kind === 'create' && a.role === 'atmosphere');
    expect(atmos).toMatchObject({ anchor: { name: '01 — BACKGROUND', place: 'above' } });
    // guides layer gets made non-printing
    expect(plan.actions).toContainEqual({ kind: 'props', name: '00 — GUIDES', role: 'guides', printable: false });
    const ops = organizeOps(plan);
    const firstCreate = ops.findIndex((o) => o.op === 'layer.ensure');
    const lastRename = ops.map((o) => o.op).lastIndexOf('layer.rename');
    expect(lastRename).toBeLessThan(firstCreate);
  });

  it('never reorders existing layers unless asked', () => {
    const layers = [L('01 — BACKGROUND', 1), L('05 — SUBJECT', 1)];
    const plan = planOrganize(layers, CAMPAIGN_STANDARD);
    expect(plan.actions.some((a) => a.kind === 'move')).toBe(false);
    const re = planOrganize(layers, CAMPAIGN_STANDARD, { renameMatched: true, createMissing: false, reorderExisting: true });
    expect(re.actions.filter((a) => a.kind === 'move')).toEqual([{ kind: 'move', name: '05 — SUBJECT', role: 'subject', anchor: { name: '01 — BACKGROUND', place: 'above' } }]);
    expect(re.warnings.join()).toMatch(/reordered/);
  });

  it('is idempotent', () => {
    const first = planOrganize([L('Layer 1', 2)], SAUDI_CAMPAIGN);
    const names = [...first.actions.filter((a) => a.kind === 'create').map((a) => a.name)].reverse();
    // After applying, the panel order is the template order followed by Layer 1.
    const after = [
      ...SAUDI_CAMPAIGN.layers.map((e) => ({ ...L(names.find((n) => n.endsWith(e.label))!), printable: e.printable !== false })),
      L('Layer 1'),
    ];
    const second = planOrganize(after, SAUDI_CAMPAIGN);
    expect(second.actions.every((a) => a.kind === 'keep')).toBe(true);
  });

  it('warns about duplicate roles and name clashes', () => {
    const plan = planOrganize([L('Guides'), L('_GUIDES')], DEPTH_STACK);
    // DEPTH_STACK has no guides role, so both are unmatched.
    expect(plan.unmatched).toEqual(['Guides', '_GUIDES']);
    const dup = planOrganize([L('BG'), L('Background')], CAMPAIGN_STANDARD);
    expect(dup.duplicates).toEqual(['Background']);
    expect(dup.warnings.join()).toMatch(/same role/);
  });
});

describe('auto sort', () => {
  const item = (over: Partial<ItemDescriptor>): ItemDescriptor => ({
    ref: { k: 'sel', i: 0 },
    index: 0,
    uuid: null,
    kind: 'path',
    typename: 'PathItem',
    name: '',
    layer: 'Layer 1',
    topLevel: true,
    geometric: { x: 0, y: 0, w: 1, h: 1 },
    visible: { x: 0, y: 0, w: 1, h: 1 },
    clip: null,
    hidden: false,
    locked: false,
    af: null,
    text: null,
    ...over,
  });
  const roleNames = planOrganize([L('Layer 1')], CAMPAIGN_STANDARD).roleNames;

  it('proposes confident moves and explains weak ones', () => {
    const props = proposeSort(
      [
        item({ index: 0, kind: 'text', typename: 'TextFrame', name: '' }),
        item({ index: 1, name: 'Logo white' }),
        item({ index: 2, kind: 'placed', typename: 'PlacedItem', name: '' }),
        item({ index: 3, name: 'star', topLevel: false }),
        item({ index: 4, name: 'شعار الحملة' }),
        item({ index: 5, name: 'headline', kind: 'text', layer: '10 — TYPOGRAPHY' }),
        item({ index: 6, af: { type: 'groundShadow', version: 1, id: 'a', source: 'b', params: null, preview: false } }),
      ],
      roleNames,
      { shadowPlacement: 'belowSubject' },
    );
    expect(props[0]).toMatchObject({ targetLayer: '10 — TYPOGRAPHY', confidence: 'high', selected: true, blocked: false });
    expect(props[1]).toMatchObject({ targetLayer: '11 — BRAND', confidence: 'medium', selected: true });
    expect(props[2]).toMatchObject({ blocked: true, confidence: 'low' });
    expect(props[2]!.reason).toMatch(/not enough information/);
    expect(props[3]).toMatchObject({ blocked: true });
    expect(props[4]).toMatchObject({ targetLayer: '11 — BRAND' });
    expect(props[5]).toMatchObject({ blocked: true, reason: 'Already on “10 — TYPOGRAPHY”.' });
    expect(props[6]).toMatchObject({ blocked: true });
    expect(props[6]!.reason).toMatch(/travels with its subject/);
  });

  it('sends plugin shadows to SHADOWS when that placement is chosen', () => {
    const [p] = proposeSort([item({ af: { type: 'contactShadow', version: 1, id: 'a', source: 'b', params: null, preview: false } })], roleNames, { shadowPlacement: 'shadowLayer' });
    expect(p).toMatchObject({ targetLayer: '07 — SHADOWS', confidence: 'high' });
  });
});
