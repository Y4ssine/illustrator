# Known limitations

Honest list, current as of milestone 1.

## Verification

- **Not yet run in real Illustrator.** The build environment had no Illustrator. All
  host behaviour has been tested against a mock DOM written from Adobe's documentation
  and community sources. The generated self-test (`dist/tests/af-selftest.jsx`) and the
  manual protocol in [TESTING.md](TESTING.md) are the acceptance gate.
- Assumptions the self-test verifies are listed in
  [COMPATIBILITY.md §3](COMPATIBILITY.md#3-verified-api-facts).

## Host platform (details and workarounds in [COMPATIBILITY.md §4](COMPATIBILITY.md#4-limitations-in-detail))

- There are no global keyboard shortcuts from a CEP panel. The F-key Actions workaround
  is experimental.
- There is no selection-change event. The panel polls, which gives up to about 0.7 s of
  latency and backs off on very large documents.
- Undo steps cannot be named, and preview updates can add steps when the guarded-undo
  path is not possible.
- There are no on-canvas widgets (light direction, hover measure). The controls live in
  the panel.
- Shadows do not follow their subject live. Use *Re-fit to object*. Spacing and layer
  moves carry linked shadows along.
- The optional live blur relies on undocumented Live Effect XML. The vector falloff is
  the default.
- The CMYK conversion of the shadow colour uses `app.convertSampleColor` when available,
  otherwise a naive, profile-less formula.
- Illustrator 25.0–25.2 (CEP 10, Chromium 74) is excluded by the manifest.

## Product scope (see [ROADMAP.md](ROADMAP.md))

- Long shadow, backdrops, document cleanup and export are **not built** (Phase 1
  backlog).
- Only **ellipse-based** shadows exist (ground, contact, contact + ambient). Cast,
  perspective, inner, glow and rim light are Phase 2.
- Spacing is one-dimensional: it orders items along one axis. Two-row layouts need two
  passes.
- Smart Grid has no UI for the custom-area target, and no perspective or vanishing-point
  grids.
- Layer auto-sort moves only **top-level** selected items. Items inside groups are
  reported, not moved. Moving to the top of a layer across **sublayers** orders items
  approximately.
- Measure and Margins are read-outs. *Equalize margins* and Before/After are not built.
- Safe-zone presets for social apps are approximate guidance; platforms change their UI.
- Each shadow colour/softness pair creates one reusable gradient swatch
  (`AF Shadow …`). Deleting shadows does not delete the swatch; Illustrator's *Select
  All Unused* removes it.

## Simulator

- The mock DOM models only what the host uses. Examples: text boxes are not shaped;
  images are hatched boxes; rotated ellipse scaling is approximate; `app.redraw()` does
  nothing; `app.coordinateSystem` does not change reported coordinates.
- Timings are for the mock in Node, not Illustrator (see [BENCHMARK.md](BENCHMARK.md)).
