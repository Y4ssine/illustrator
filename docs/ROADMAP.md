# MVP backlog and roadmap

Status key:

- ✅ built and covered by automated tests (simulator)
- 🟡 partly built
- ⬜ not started

**Nothing is verified in real Illustrator yet.** The first task of the next milestone is
to run `dist/tests/af-selftest.jsx` there (see [TESTING.md](TESTING.md)).

## First development milestone (§95): vertical slice

| # | Step | Status | Where |
|---|---|---|---|
| 1–3 | Open Illustrator → panel → sees current artboard | ✅ | `ui/shell.ts`, `ui/app.ts` polling, HOME › Document |
| 4–5 | Instagram Portrait → 1080×1350 artboard if necessary | ✅ | Behaviour depends on the document: new document if none is open; reuses a matching active artboard; resizes an empty single-artboard document; otherwise adds one to the right |
| 6–7 | Campaign Grid → guides and margins | ✅ | GRID › Build Grid (Campaign Grid preset) |
| 8–10 | Ground Shadow on the correct layer | ✅ | Directly below the subject by default, or on the SHADOWS layer |
| 11–12 | Headline + image → Normalize spacing | ✅ | ALIGN › Normalize (272 in the test, on the 8 px system) |
| 13–14 | Organize layers → clean, named | ✅ | LAYERS (preview first) |
| 15–17 | Save → reopen → plugin recognises its items | ✅ | Tags persist; HOME shows counts; selecting a shadow opens *Edit* |

The flow is automated in `tests/host/vertical-slice.test.ts`, driven through the real
panel UI in the simulator, and replayed by the in-Illustrator self-test.

## Phase 1 MVP backlog (§94)

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Panel framework | ✅ | Rail, sections, design system, toasts, dialogs, theme, flyout menu |
| 2 | Selection detection | ✅ | Signature polling (Illustrator has no CEP selection event) + context classification |
| 3 | Smart Grid | 🟡 | Columns, rows, modular, baseline, thirds, golden, centre, diagonals, radial and custom ratios are built. Targets built: artboard, all artboards, selection bounds, each object, clip bounds. **Missing:** a UI for the custom-area target (the engine and command support it); perspective / vanishing-point grids (Phase 2) |
| 4 | Guide Generator | 🟡 | Edges, centres, thirds, quarters, golden, offsets, safe areas, hide/show/lock/unlock/delete plugin guides are built. **Missing:** "Clear artboard guides" including the user's own guides (needs an explicit, separate confirmation) |
| 5 | Spacing tools | ✅ | Normalize, distribute, match smallest/largest/first, exact; RTL anchor; linked shadows follow. Smart alignment (§8) is Phase 2 |
| 6 | Layer Organizer | ✅ | Templates (§32, §66, §16), naming formats, rename/create/optional reorder, rule-based sorting with confidence and preview. Custom templates are edited as validated JSON in PRESETS |
| 7 | Ground Shadow | ✅ | v2: layered contact + core + ambient, light-driven drift, blur, 13 presets, edit existing (upgrades v0.1) |
| 8 | Contact Shadow | ✅ | Contact line; contact added under cast/silhouette shadows |
| 9 | Long Shadow | ✅ | Hull of the footprint (box / rounded / round) swept along the light, fade, clipped to the artboard. Exact outline sweep for arbitrary paths is not built |
| 10 | Backdrop Generator | ✅ | Colour › Backgrounds (aurora, spotlight, sunburst, brand gradient, duotone, soft). Selection-bounds backdrops with padding: use Create › Shapes with *Fit to the selected object* |
| 11 | Social Artboards | ✅ | 10 presets, carousel (continuous or spaced), auto-number |
| 12 | Preset system | ✅ | Every kind modelled; create / rename / duplicate / delete / import / export / JSON edit |
| 13 | Command palette | ✅ | Fuzzy search, favourites, recent boost, context suggestions |
| 14 | Document cleanup | ⬜ | Next. Report-then-fix (empty layers/groups, hidden objects, stray points, off-artboard items) |
| 15 | Export helper | ⬜ | Next. `exportForScreens` (AI 22+) with 1x/2x/3x, naming, progress |

Cross-cutting items already in place:

- ✅ Command architecture (§93)
- ✅ Tagging (§84) and edit existing (§85)
- ✅ History (§75) and repeat (§74)
- ✅ Safe Mode (§76) and settings (§77)
- ✅ Friendly errors with copyable diagnostics (§78)
- ✅ No telemetry, offline (§79, §80)
- ✅ One-step undo (§83)
- ✅ Live preview for grid and shadows (§59)
- ✅ Set Up Design (§68) and the Saudi Campaign Workspace (§66)
- 🟡 Poster Workspace (§67): the grid and layers exist; title/hero/footer regions do not
- 🟡 Measure (§71) and Margins (§69): read-outs only; *Equalize margins* is not built
- 🟡 Design tokens (§54): spacing tokens only
- ⬜ Before/After toggle (§60)

## Version 0.2: creative toolkit (built)

Requested after the first review: pro lighting and blending, better shadows, ready
shapes, gradients and fades from a logo, easy Arabic infographics, and complete looks.

| Item | Status | Where |
|---|---|---|
| Lighting builder (§22) + scene light shared with shadows | ✅ | LIGHT: rig, 11 effects, 6 one-click scenes, 7 colour grades |
| Cast / silhouette / floating / long shadows (§10, §13, §14) | ✅ | SHADOW STUDIO (inner shadow not built) |
| Gradient overlays & fades (§23, §53) | ✅ | COLOUR › Fades (overlays; no opacity masks) |
| Palette engine & harmonies (§24–26) | ✅ | COLOUR › Brand palette (extract from a vector logo, harmonies, swatches). Find/replace colours (§73) not built |
| Ready shapes | ✅ | CREATE › Shapes (~30 parametric shapes, palette styles, native effects) |
| Infographics (charts, cards, steps, timelines…) | ✅ | INFOGRAPHIC (14 blocks, RTL, Arabic-Indic digits) |
| Complete compositions | ✅ | CREATE › Design recipes (5) |
| Verified in real Illustrator | ⬜ | Run `dist/tests/af-selftest.jsx` — it now covers the v0.2 APIs and exports a render |

## Implementation roadmap

### Milestone 2: validate on real hosts (next)

1. Run the self-test and benchmark on macOS and Windows, for CEP 11 (AI 2022–2025) and
   CEP 12 (AI 2025.5+/2026). Record the results in [BENCHMARK.md](BENCHMARK.md) and
   [COMPATIBILITY.md](COMPATIBILITY.md).
2. Run the manual QA protocol ([TESTING.md §5](TESTING.md#5-manual-qa-protocol-in-illustrator)),
   especially undo granularity and preview behaviour across separate `evalScript` calls.
3. Fix every failure. Update the mock DOM wherever Illustrator behaved differently, so
   the regression tests encode the real behaviour.
4. Package a signed ZXP.

### Milestone 3: complete Phase 1

Document cleanup and inspector (§34, §36, §61, §62), Export helper and batch export
(§63, §64), custom-area UI, Equalize margins, Before/After, editing infographic data in
place, colour find/replace.

### Phase 2

- Pattern engine (§28, §29)
- Motif and path scatter (§30, §31); seeded RNG already built
- Randomizer (§27)
- Depth builder and depth scale (§16, §17)
- Atmospheric perspective (§18)
- Perspective grids (§47)
- Inner shadows, reflections, multi-light rigs
- Smart offset, block shadow and fake 3D (§48–50)
- Typography tools (§37–39): overflow and missing-font detection, type scale, Arabic
  alignment helpers
- Selection supertools (§72)
- Smart duplicate and radial duplicate (§45, §46)
- Image frames (§41)
- Design QA (§65)

### Phase 3

- Composition analyser and overlays (§19): observations only, no "quality score"
- Auto-composition by role (§20, §21)
- Advanced packing (§9)
- Optional, opt-in AI "Analyze Layout" (§81): it would send bounds, roles and colours
  only, never pixels, text or document names, and only with explicit consent each time
- UXP adapter when Illustrator's UXP beta ships ([UXP_MIGRATION.md](UXP_MIGRATION.md))
