# Testing strategy

Testing has four layers, and each has a clear scope:

| Layer | Runs | Proves | Does **not** prove |
|---|---|---|---|
| 1. Unit tests (`tests/unit`) | Node, `npm test` | Engines are correct: grid maths, spacing, shadow geometry and falloff, ratios, units, layer planning, auto-sort, presets, search, seeded RNG, tags, settings | Anything about Illustrator |
| 2. Host tests (`tests/host`) | Node: the **real ExtendScript host** on the mock DOM | Protocol, batch semantics (rollback, deferred deletes, one step per command), preview safety, locked layers, CMYK, degraded capabilities, stale selections, Arabic round-trip, stacking order, the §95 milestone flow, save/reopen recognition | That the mock matches Illustrator (both were written from the same understanding of the DOM) |
| 3. ES3 check (`npm run check:es3`) | Node (acorn, `ecmaVersion: 3`) | ExtendScript files and generated scripts parse in an ES3 engine and are ASCII-only | Runtime behaviour |
| 4. **In-Illustrator self-test** (`dist/tests/af-selftest.jsx`) + manual QA | Real Illustrator | The actual acceptance test | — |

Current counts: **103 automated tests**, plus 44 checks in the self-test when it is dry-run
in the simulator.

**Status: layer 4 has not been run.** No Illustrator was available in the build
environment. Treat everything as unverified on real hosts until the self-test report is
green.

## 1. Commands

```bash
npm run verify     # typecheck + build + ES3 check + all tests
npm test           # tests only
npm run bench      # benchmark (simulator)
```

## 2. Required coverage (§88)

| Area | Tests |
|---|---|
| Grid calculations | `unit/grid.test.ts`: tracks, gutters, ratios, modular, baseline limits, thirds/golden, diagonals, radial, pixel snap, dedupe, invalid inputs |
| Spacing calculations | `unit/spacing.test.ts`: gaps, suggestions per system, normalize, distribute, match, RTL/centre anchors, overlaps, axis detection, 5,000 items |
| Geometry bounds | `unit/geometry.test.ts`: union/intersect/inset, pair distances, Y-up ↔ design conversion |
| Randomization seed | `unit/misc.test.ts`: same seed gives the same sequence; ranges; distributions |
| Preset serialization | `unit/presets.test.ts`: round-trip of every kind, validation, versioning, import conflicts, example files |
| Layer naming | `unit/layers.test.ts`: formats, normalisation, Arabic aliases, planning, idempotency, auto-sort |
| Aspect ratios | `unit/geometry.test.ts` |
| Shadow parameters | `unit/shadow.test.ts`: placement, clamping, monotonic falloff, op building, presets valid |
| Distribution | `unit/spacing.test.ts` |
| Host behaviour | `host/host-ops.test.ts`, `host/vertical-slice.test.ts` |
| Self-test and benchmark scripts | `host/selftest.test.ts` (ES3 parse + full dry run) |

## 3. In-Illustrator self-test

1. `npm run build`
2. In Illustrator: **File › Scripts › Other Script…** › `dist/tests/af-selftest.jsx`.
3. Wait for the alert with the summary (a few seconds). The report is at
   `~/Desktop/af-selftest-report.txt`.

What it does:

- creates a new document;
- replays the exact op batches the panel produces (captured from the simulator), for
  Instagram Portrait, test content, Campaign Grid, Ground Shadow, Normalize spacing and
  Organize layers;
- checks the results against what the simulator produced;
- checks Arabic text, the storage round-trip and a preview (inside one script, so for
  information only);
- saves to the temp folder, closes, reopens, and checks recognition.

Your open documents are not modified.

Please send back the report file. Every `FAIL` line is a real discrepancy to fix in the
host code **and** in the mock, so the regression tests encode what Illustrator really
does.

## 4. In-Illustrator benchmark

Run `dist/tests/af-benchmark.jsx` the same way. It creates temporary 50 / 500 / 5,000
object documents and times these through the real host:

- ping
- selection analysis
- signature
- grid
- spacing (translating every object)
- organize (13 layers, then moving every object)
- document scan

Results go to `~/Desktop/af-benchmark-report.txt`. Copy them into
[BENCHMARK.md](BENCHMARK.md).

## 5. Manual QA protocol in Illustrator

The self-test runs inside a single script, so it cannot check behaviour **across separate
panel calls**: the undo steps and the live preview. Do these by hand. Tick each item
under both macOS and Windows.

### 5.1 Milestone flow (§95)

- [ ] Launch Illustrator, then **Window › Extensions › Artboard Forge**. HOME shows "No
      document open". The status dot is green.
- [ ] HOME › Artboards › Instagram Portrait › **Create / Switch**. A new 1080×1350 RGB
      document opens, with the artboard named `IG_PORTRAIT_01`.
- [ ] Click it again. The info toast says the artboard already matches, and nothing
      changes.
- [ ] GRID › **Build Grid**. A `_GUIDES` layer appears on top, non-printing, with the
      group `GRID — Campaign Grid — IG_PORTRAIT_01`: 6 columns, 8 rows, margins, centre
      axes.
- [ ] **Edit › Undo once** removes the whole grid **and** the layer. Redo brings them
      back.
- [ ] Place a photo or cutout and select it. SHADOW › **Add Ground Shadow**. A soft
      ellipse appears *directly below* the photo in the Layers panel, named
      `SHADOW — Ground — <name>`, Multiply, 26%.
- [ ] Undo once: the shadow **and** the subject's tag are gone.
- [ ] Select a headline and the photo. ALIGN shows the gap and a suggestion. **Normalize**
      sets the gap to a multiple of 8.
- [ ] LAYERS: the preview lists the creates and renames (`_GUIDES → 00 — GUIDES`) and the
      proposed moves. **Organize Layers** runs, then one Undo reverts everything.
- [ ] Save, close, reopen. HOME › Document lists "Grid: 1, Ground Shadow: 1". Selecting
      the shadow switches SHADOW to **Editing Ground Shadow** with its stored values.
      **Update Shadow** keeps the same stacking slot.

### 5.2 Preview across calls

- [ ] SHADOW › Preview on, then drag *Softness*. The preview updates, and **Edit › Undo
      history** keeps at most one preview step.
- [ ] Press Esc. The preview disappears; nothing is left in the Layers panel.
- [ ] Preview on, then click another object on the canvas, then cancel. The preview is
      removed (fallback path) and **your selection change is kept**.
- [ ] Preview on, then **Add**. There is exactly one shadow, and one Undo removes it.

### 5.3 Edge cases

- [ ] Commands while editing text (Type tool active) show "Press Esc to leave the text".
- [ ] Lock the `_GUIDES` layer (GRID › Manage › Lock), then Build Grid. It succeeds and
      the layer stays locked.
- [ ] A CMYK A4 document: shadows use CMYK colours and there are no errors.
- [ ] An Arabic document with an Arabic document name, layer names and text. Names show
      correctly. Text is never reversed or outlined.
- [ ] A clipping group: Ground Shadow uses the **mask** bounds, not the hidden content.
- [ ] A 5,000-object document: the panel stays responsive while idle (polling backs
      off). Spacing on 500 objects completes.
- [ ] Another CEP panel is open at the same time: there is no interference.
- [ ] Illustrator UI brightness set to light, then to dark: the panel theme follows.

## 6. Sample document workflow (§89)

The simulator's sample document (`src/illustrator/sim/sample-doc.ts`) is the reference.
Rebuild it in Illustrator to test by hand:

- **Artboard 1 `IG_PORTRAIT_01` 1080×1350:**
  - Arabic headline text (right-aligned) and a Latin subtitle
  - a placed image `hero` (390, 540, 300×620)
  - a **clipping group** "Photo frame": a rectangle mask over a larger placed photo
  - a **nested group** "motifs" › "stars" (3 stars) plus a "sun" ellipse
  - a background rectangle
- **Artboard 2 `IG_PORTRAIT_02`:** Arabic title, a group "logo placeholder", an embedded
  raster, a green background.

Exercise every module against it:

1. Grid on each artboard, then "all artboards".
2. Grid from selection on the clipping group: the guides follow the mask, not the photo.
3. Shadows on `hero` and on the clipping group.
4. Spacing on headline, subtitle and hero.
5. Organize layers with everything selected. Check the confidence of each proposal: the
   unnamed raster is *not* moved.
6. Delete plugin guides on artboard 1 only.
7. Save, reopen, recognise.
