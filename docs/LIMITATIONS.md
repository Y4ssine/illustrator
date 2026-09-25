# Known limitations

Honest list, current as of version 0.2 (creative toolkit).

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
- Shadows and lights do not follow their subject live. Select a shadow and press
  *Update Shadow* to refit it; spacing and layer moves carry linked shadows along.
- Blur, drop shadow and glows rely on undocumented Live Effect XML (from a tested public
  library). If Illustrator rejects it, the command still succeeds with the vector
  gradients and says so. Turn blur off in Settings for pure vector output.
- Opacity masks cannot be scripted: fades are gradient-opacity overlays, and group
  silhouettes use a flat tone instead of a length fade
  ([COMPATIBILITY §4.7](COMPATIBILITY.md#47-fading-artwork-with-a-mask-53-silhouettes)).
- Images cannot be recoloured or sampled by a script: rim light on a photo follows its
  bounds, silhouettes of photos become subject-shaped casts, and palette extraction reads
  vector art only ([§4.8](COMPATIBILITY.md#48-recolouring-or-reading-images-rim-light-silhouette-neon-palette-on-photos)).
- Text is placed before it can be measured, so infographic labels are sized
  proportionally and may need copy edits for very long labels
  ([§4.9](COMPATIBILITY.md#49-measuring-text-while-building-a-layout-infographics)).
- Arabic typography depends on installed fonts (Settings › Arabic fonts); missing fonts
  fall back to Illustrator's default with a warning.
- The CMYK conversion of the shadow colour uses `app.convertSampleColor` when available,
  otherwise a naive, profile-less formula.
- Illustrator 25.0–25.2 (CEP 10, Chromium 74) is excluded by the manifest.

## Product scope (see [ROADMAP.md](ROADMAP.md))

- Document cleanup and export are **not built** (Phase 1 backlog).
- Shadows: ground, contact, cast, silhouette, floating and long are built. Inner shadow,
  reflections and multi-light setups are not.
- Lights are 2D approximations (gradients + blend modes): there is no 3D surface
  shading; rim light on a group lights each piece from the same side.
- Infographic blocks are rebuilt, not edited in place: to change the numbers, add the
  block again and delete the old group (both are tagged).
- Design recipes are starting compositions with placeholders (product, headline); they
  do not place your logo or photos.
- Spacing is one-dimensional: it orders items along one axis. Two-row layouts need two
  passes.
- Smart Grid has no UI for the custom-area target, and no perspective or vanishing-point
  grids.
- Layer auto-sort moves only **top-level** selected items. Items inside groups are
  reported, not moved. Moving to the top of a layer across **sublayers** orders items
  approximately.
- Measure and Margins are read-outs. *Equalize margins* and Before/After are not built.
- Safe-zone presets for social apps are approximate guidance; platforms change their UI.
- Each gradient style creates one reusable gradient swatch (`AF …`). Deleting artwork
  does not delete the swatch; Illustrator's *Select All Unused* removes it.

## Simulator

- The mock DOM models only what the host uses. Examples: text is not shaped by
  Illustrator's composer (the renderer uses the browser); point-text bounds are
  estimated; images are hatched boxes; the renderer's blur radius and glow are
  approximations of Illustrator's raster effects; `app.redraw()` does nothing;
  `app.coordinateSystem` does not change reported coordinates.
- Screenshots in the docs are **simulator renders**, not Illustrator output.
- Timings are for the mock in Node, not Illustrator (see [BENCHMARK.md](BENCHMARK.md)).
