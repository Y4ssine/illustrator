# Compatibility strategy

## 1. Supported hosts

| Illustrator | Version | CEP | Chromium | Status |
|---|---|---|---|---|
| 2021 | 25.0–25.2 | 10 | 74 | **Excluded** in the manifest: the panel CSS uses flexbox `gap`, `:focus-visible` and `inset` |
| 2021 | 25.3+ | 11 | 88 | Supported minimum (`Host ILST [25.3,99.9]`, `CSXS 11.0`) |
| 2022–2024 | 26–28 | 11 | 88 | Supported |
| 2025 | 29.0–29.5 | 11 | 88 | Supported |
| 2025/2026 | 29.5.1+ / 30 | 12 | 99 | Supported |

The bundle targets `chrome88`. Pre-2020 host behaviour (no `uuid`) is handled: refs fall
back to *selection index + bounds fingerprint*. That path is mainly exercised by tests
with a simulated version 23.

**Not yet verified in real Illustrator.** No Illustrator was available where this was
built. The self-test must be run on at least one macOS and one Windows machine, and for
each CEP generation (11 and 12). See [TESTING.md](TESTING.md).

## 2. Feasibility matrix — how each feature is implemented

Legend:
- **DOM**: documented ExtendScript DOM.
- **Undoc**: in the object model but undocumented (feature-detected, with a fallback).
- **Menu**: `app.executeMenuCommand`.
- **C++**: needs a native plug-in.
- **n/a**: not needed.

| Feature (brief §) | Mechanism | Status |
|---|---|---|
| Artboards: add/resize/name/number (42, 44) | DOM `artboards.add`, `artboardRect`, `setActiveArtboardIndex` | **Built** |
| New document (95) | DOM `documents.add(cs, w, h)` | **Built** |
| Guides, grids, safe areas (5, 6) | DOM `PathItem.guides = true` on paths inside a tagged group | **Built** |
| Hide/lock plugin guides | DOM layer `visible/locked`, plugin guide layer only | **Built** |
| Hide/lock *all* guides globally | Menu `showguide` / `lockguide` (toggles) | Not used: state-unaware toggles |
| Spacing, distribution (7) | DOM `translate` | **Built** |
| Studio ground / contact shadows (10–12) | DOM ellipses + radial `GradientColor` with `GradientStop.opacity`, scaled with "transform gradients"; layered contact + core + ambient | **Built (v2)** |
| Soft blur on shadows and lights | Undoc `PageItem.applyEffect(LiveEffect XML)` "Adobe PSL Gaussian Blur" | **Built, on by default** (Settings); falls back to the vector falloff with a warning |
| Stop-opacity fallback | DOM fade-to-white + Multiply | **Built** |
| Layer organizer (32, 33) | DOM `layers.add`, `move`, `zOrder`, `name`, `printable` | **Built** |
| Metadata / recognition (84, 85) | DOM `PageItem.tags` | **Built** |
| Undo as one step (83) | One script evaluation = one undo step. No `app.redraw()` inside commands | **Built** (verify in host) |
| Live preview / cancel (59) | DOM `app.undo()`/`app.redo()` with guard, or delete by reference | **Built** (verify in host) |
| Selection awareness (58) | Polling a cheap query; no CEP selection event | **Built** |
| Command palette, panel shortcuts (57, 87) | Panel keyboard focus only | **Built** |
| Lighting: glows, rays, rim, neon, bokeh, leaks, haze, vignette, grades | DOM gradient shapes + blend modes (`BlendModes.SCREEN`, `SOFTLIGHT`, …) + clipping groups + optional blur | **Built (v0.2)** |
| Ready shapes (arches, frames, badges, ribbons…) | DOM `pathPoints.add()` with `anchor/leftDirection/rightDirection/pointType`; compound paths with `evenodd` | **Built (v0.2)** |
| Gradient angle | `GradientColor.angle` setter is broken; `rotate(a, false, false, true, false, CENTER)` + gradient-only `resize` | **Built** |
| Native drop shadow / outer / inner glow on shapes | Undoc Live Effect XML (`Adobe Drop Shadow`, `Adobe Outer Glow`, `Adobe Inner Glow`) | **Built, optional** |
| Palette from a logo | DOM walk of fill/stroke/gradient/spot colours weighted by area; OKLab clustering in the panel | **Built** (vector art only) |
| Swatch groups | DOM `swatchGroups.add()`, `swatches.add()`, `addSwatch()` | **Built** |
| Infographics (charts, cards, steps, timelines) | DOM paths + `textFrames.pointText/areaText`; RTL via `ParagraphDirectionType`, World-Ready via `ComposerEngineType.optycaComposer` | **Built (v0.2)** |
| Design recipes (complete compositions) | Everything above in one batch | **Built (v0.2)** |
| Global shortcuts (87) | Not possible from CEP. Workaround: Scripts-menu `.jsx` → CSXSEvent → panel; bind with an Action + F-key | **Built, experimental** |
| Long shadow (14) | DOM path: convex hull of the footprint swept along the light, linear fade, clipped to the artboard | **Built (v2)** |
| Backdrop generator (40) | DOM shapes + gradients + blur: aurora, spotlight, sunburst, brand gradient, duotone, soft | **Built (Colour › Backgrounds)** |
| Document cleanup (34, 36) | DOM traversal (bounded), `remove` | Phase 1 backlog |
| Export assistant (63, 64) | DOM `exportForScreens` (AI 22+), `exportFile` | Phase 1 backlog |
| Cast shadow from silhouette (13) | DOM `duplicate` + `restyle` + `transform(matrix)` projected by the light (cot of the elevation) + gradient | **Built (v2)**: vector art and text; images get a subject-shaped cast |
| Offset path / smart offset (50) | Undoc `applyEffect("Adobe Offset Path")` (live), or menu `Live Offset Path` + expand | Phase 2 |
| Block shadow / fake 3D (48, 49) | Duplicate + translate steps + Pathfinder (menu `Live Pathfinder Add`) | Phase 2 |
| Pattern mask (29) | DOM `groupItems.add` + `clipped = true` | Phase 2 (clipping groups are used by the light and background engines) |
| Edge fade (53) | No DOM API for opacity masks. Fades are gradient overlays whose stop opacity goes to 0 | **Built (Colour › Fades)** as overlays; true opacity masks not built |
| Grain/texture (51, 52) | Vector dots (DOM), or raster via undoc `applyEffect` "Grain" | Phase 2 |
| Text overflow detection (37) | No direct property. Compare `lines` content length with `contents` | Phase 2 |
| Missing fonts (61) | Compare the frame's font against `app.textFonts` | Phase 2 |
| Placed image resolution (65) | `PlacedItem.matrix` scale + bounds + file pixel size (needs file read) | Phase 3, best effort |
| **On-canvas** interactive widgets (light direction drag, hover measure) | **C++** annotator/tool | Panel-side widget instead |
| Shadow that **follows** its subject live | **C++** notifier or a Live Effect plug-in | Workaround: *Re-fit to object*, grouping |
| Named undo steps ("Undo Ground Shadow") | **C++** (`AIUndoSuite`) | Not possible from script: shows as a generic step |

## 3. Verified API facts

Checked against primary or credible sources on 2026-09-25. Two sites were blocked by the
network proxy: `ai-scripting.docsforadobe.dev` and `community.adobe.com`. For those, the
GitHub sources of the documentation were read directly, plus search-result excerpts.

| Fact | Confidence | Source |
|---|---|---|
| `PageItem.uuid` and `Document.getPageItemFromUuid()` exist since AI 24.0 | High | docsforadobe/illustrator-scripting-guide (changelog, PageItem.md, Document.md) |
| `PageItem.applyEffect(liveEffectXML)` exists (XML undocumented). `Adobe PSL Gaussian Blur` with `R blur N` and `Adobe Offset Path` with `R ofst`, `I jntp` (0 round, 1 bevel, 2 miter), `R mlim` are used by working libraries | Medium-high | mark1bean/live-effect-functions-for-illustrator; AI 27 object model stubs |
| Tags: `tags.add()` then set `name`/`value` (writable despite the docs). Names with spaces throw | Medium | docsforadobe Tag.md; forum reports |
| Tags persist through save and reopen | Medium (forum) | community reports. **Asserted by the self-test** |
| `PathItem.guides` is writable | Medium-high | docsforadobe PathItem.md |
| Menu strings `showguide`, `lockguide`, `makeguide`, `releaseguide`, `clearguide` | High | SDK `AIMenuCommandString.h` via community lists |
| `GradientStop.opacity` (0–100) exists | High | docsforadobe GradientStop.md |
| `resize(sx, sy, changePositions, changeFillPatterns, changeFillGradients, changeStrokePattern, changeLineWidths:Number(%), scaleAbout)` | High | docsforadobe PageItem.md + object model defaults |
| A script run is one undo step. `app.redraw()` inside a script adds undo entries. No suspendHistory | Medium | forum threads; docsforadobe Application.md |
| No CEP selection-change event in Illustrator (AIHostAdapter plug-in optional, fragile) | High | CEP-Resources (AIHostAdapter), issue #480 |
| CSXSEvent dispatch from ExtendScript via `PlugPlugExternalObject` | High inside a panel's engine. **Unverified** from File › Scripts | CEP 12 Cookbook |
| `exportForScreens(folder, type, options, itemToExport, prefix)` since CC 2018 | High | object model stubs; public scripts |
| No global shortcut API for panels. Actions + F-key workaround | High | CEP-Resources #238 |
| Script coordinates are Y-up; `app.coordinateSystem` default unverified (set explicitly) | Medium-high | docsforadobe positioning.md |
| CEP per version: AI 25.0 = CEP 10, 25.3 = CEP 11, 29.5.1 = CEP 12 | High | CEP 12 HTML Extension Cookbook |
| UXP plugins for Illustrator: public beta announced for spring 2027; CEP included until Dec 2029 | Medium-high (search excerpts of Adobe's Sept 2026 blog post) | blog.developer.adobe.com (2026/09) |
| Live Effect XML: colour is `"5 r g b"` (RGB, 0–1 floats), `"0 k"` gray, `"1 c m y k"` CMYK. Drop Shadow `I blnd, R opac (0–1), R horz, R vert, R blur, B usePSLBlur, I csrc, R dark, B pair` + `<Entry name="sclr">`; Outer Glow `blnd, opac, blur` + `sclr`; Inner Glow `blnd, gtyp (0 centre, 1 edge), opac, blur` + `gclr`; Gaussian Blur `R PrevDocScale 1 I PrevDres 300 R blur N`; Feather `Adobe Fuzzy Mask` `R Radius`. `blnd` 0 = Normal, 1 = Multiply (≥ 2 unverified, not used) | Medium-high | mark1bean/live-effect-functions-for-illustrator (LE_Functions.js + tests) |
| `textFrames.pointText(anchor)`, `textFrames.areaText(path)`; `ParagraphAttributes.paragraphDirection = ParagraphDirectionType.RIGHT_TO_LEFT_DIRECTION`; `composerEngine = ComposerEngineType.optycaComposer` (= World-Ready); `CharacterAttributes.digitSet`, `dirOverride`, `kashidas` exist | Medium-high | docsforadobe guide (TextFrameItems.md); AI 27 object model (omv.xml); Adobe CC Libraries `util.jsx` maps World-Ready to `optycaComposer` |
| `app.textFonts.getByName(PostScriptName)` throws when the font is missing | High | docsforadobe; public scripts wrap it in try/catch |
| `transform(matrix, changePositions, changeFillPatterns, changeFillGradients, changeStrokePattern, changeLineWidths:Number(%), transformAbout)`; `app.getIdentityMatrix()`, `mValueA…D/TX/TY` | High | docsforadobe PageItem.md, Matrix.md; object model |
| `duplicate([relativeObject][, ElementPlacement])` returns the copy | High | docsforadobe PathItem.md / TextFrameItem.md |
| Clipping groups: top path `clipping = true` (compound: `pathItems[0].clipping`), then `group.clipped = true`. Only `PathItem` has `clipping` | Medium-high | public scripts (ai2html, Everstory); object model |
| `GradientColor.angle` cannot be set (bug since 2008, still in 29.3.1); rotating only the gradient with `rotate(a, false, false, true, false, Transformation.CENTER)` works | High | docsforadobe GradientColor.md; creold ConvertToGradient.jsx |
| `PathPoint.anchor / leftDirection (in) / rightDirection (out) / pointType` after `pathPoints.add()` | High | docsforadobe creatingPathsShapes.md |

Assumptions **not** independently verified, so the self-test checks them in Illustrator:

- `GradientColor` assigned to a circle, then `resize(..., changeFillGradients=true)`,
  gives an elliptical falloff. The test checks the bounds and stops.
- Setting `rampPoint` in index order keeps the stop order. The test checks the order.
- `Layer.move(layer, PLACEBEFORE/PLACEAFTER)` and `Layer.zOrder` reorder top-level
  layers. The test checks the final layer list.
- `PLACEAFTER` puts an item *behind* its reference. The test checks that the shadow sits
  directly below the subject.
- A new document's first artboard sits at the origin. If not, the self-test logs the
  real origin and shifts its fixtures.
- `app.convertSampleColor` is used for CMYK when available, otherwise a naive conversion.
- **v0.2:** `item.transform()` about `CENTER` pivots on the centre of the geometric
  bounds (the pivot correction relies on it). The test compares cast and silhouette
  shadow bounds with the simulator (±2 pt).
- **v0.2:** `resize(..., changePositions = false, ..., changeFillGradients = true)`
  scales only the gradient (like the verified `rotate` trick). Used for gradient length
  after rotation and for elliptical radial fills on non-ellipse shapes.
- **v0.2:** Bézier paths built point by point match the simulator's bounds (arch test,
  ±1.5 pt); the Live Effect XML above applies without a warning; RTL paragraph
  direction and the World-Ready composer read back as set; swatch groups are created;
  colour sampling reads a known colour. The test also exports
  `af-selftest-render.png` to the Desktop for a visual check.

## 4. Limitations in detail

Each entry gives: requested behaviour · host limitation · available API · closest reliable
workaround · would the C++ SDK solve it · would UXP simplify it.

### 4.1 Global keyboard shortcuts (§57, §87)
- **Requested:** a shortcut opens the palette or runs Ground Shadow from anywhere.
- **Limitation:** CEP panels only receive keys while they have focus. Illustrator's
  Keyboard Shortcuts dialog does not list Scripts-menu items.
- **API:** `registerKeyEventsInterest` works only while the panel is focused.
- **Workaround:** in-panel shortcuts (Ctrl/Cmd+K, Alt+1…6, Ctrl/Cmd+Shift+R, Esc). The
  trigger scripts in `scripts-menu/` dispatch a CSXSEvent to the panel; bind each one to
  an **Action with an F-key**. Experimental: dispatching from File › Scripts is not
  guaranteed on every version.
- **C++ SDK:** yes. A plug-in can add real menu items with shortcuts.
- **UXP:** likely, if Illustrator UXP exposes menu/command registration (unknown today).

### 4.2 Selection-change notification (§58)
- **Requested:** the panel reacts instantly to the selection.
- **Limitation:** no CEP event.
- **API:** document activate/deactivate/save events only.
- **Workaround:** 700 ms signature polling with back-off, plus a refresh on panel focus
  and document events.
- **C++ SDK:** yes (`kAIArtSelectionChangedNotifier`).
- **UXP:** expected to provide events.

### 4.3 Interactive on-canvas controls (§13 light widget, §71 hover measure)
- **Requested:** drag a light on the artboard, hover to measure.
- **Limitation:** scripts cannot draw transient overlays or track the mouse on the canvas.
- **API:** none in ExtendScript or CEP.
- **Workaround:** widgets live in the panel; measurements work from the selection
  (ALIGN › Measure).
- **C++ SDK:** yes (annotators, tool plug-ins).
- **UXP:** unknown.

### 4.4 Shadows that stay attached to the subject (§85)
- **Requested:** move the subject and the shadow follows.
- **Limitation:** scripts create static art. There are no live links between objects.
- **API:** tags record the link.
- **Workaround:**
  - *Re-fit to object* recomputes the shadow from the subject's current bounds.
  - Spacing and layer moves carry linked shadows along.
  - Designers can group subject and shadow.
- **C++ SDK:** yes (plug-in group / live effect).
- **UXP:** unlikely to add live art.

### 4.5 Undo naming and grouping (§83)
- **Requested:** Edit › Undo Ground Shadow, one step.
- **Limitation:** one script evaluation is one step, but it cannot be named, and preview
  updates add steps.
- **API:** `app.undo()` and `app.redo()`.
- **Workaround:** one batch per command. Guarded undo for previews keeps history clean
  when possible.
- **C++ SDK:** yes (`AIUndoSuite::SetUndoTextUS`).
- **UXP:** likely (host-managed modal scopes in other apps).

### 4.6 Raster-quality soft shadows (§11 blur)
- **Requested:** Gaussian-blurred shadows.
- **Limitation:** blur is a raster live effect whose quality depends on the Document
  Raster Effects resolution. Its XML is undocumented.
- **API:** `applyEffect`.
- **Workaround:** the default shadow is **vector** (a radial gradient with a Gaussian
  opacity curve). The blur is an opt-in extra.
- **C++ SDK:** not needed.
- **UXP:** may document effects.

### 4.7 Fading artwork with a mask (§53, silhouettes)
- **Requested:** fade a photo or a cast silhouette out along its length.
- **Limitation:** opacity masks cannot be created or edited from a script.
- **API:** gradient stop opacity; clipping masks (hard edges only); menu `makeMask`
  (clipping, selection-based).
- **Workaround:** fades are gradient-opacity overlays in the background colour
  (Colour › Fades). Single-path silhouettes fade through their own gradient fill;
  multi-part (group) silhouettes get a flat tone plus blur, because each sub-path
  would restart the gradient.
- **C++ SDK:** yes (`AIMaskSuite`).
- **UXP:** unknown.

### 4.8 Recolouring or reading images (rim light, silhouette, neon, palette on photos)
- **Requested:** light, recolour or sample colours from placed/embedded images.
- **Limitation:** scripts have no pixel access and cannot recolour raster content.
- **API:** `PlacedItem`/`RasterItem` bounds and transforms only.
- **Workaround:** image subjects get bounds-based effects (edge light clipped to the
  bounds, subject-shaped cast shadow, back and floor glows). Palette extraction reads
  vector art only; trace a raster logo (Image Trace) first. The panel says so.
- **C++ SDK:** partly (raster access via `AIRasterSuite`).
- **UXP:** unknown.

### 4.9 Measuring text while building a layout (infographics)
- **Requested:** size and place labels exactly around their real text width.
- **Limitation:** a batch runs in one script call; text metrics are only known after the
  frame exists, and the panel plans the batch before it runs.
- **API:** `TextFrame` bounds after creation; `createOutline()`.
- **Workaround:** sizes are proportional to the block; labels use point text anchored at
  their reading edge (right in RTL); long notes use area text that wraps. The designer
  adjusts copy after insertion.
- **C++ SDK:** yes (ATE text measuring).
- **UXP:** possibly (async measure-then-place).

### 4.10 Fonts for Arabic infographics and recipes
- **Requested:** nice Arabic typography out of the box.
- **Limitation:** only installed fonts can be used; a script cannot activate fonts.
- **API:** `app.textFonts.getByName()`.
- **Workaround:** candidate lists in Settings (Tajawal, Cairo, Almarai, DIN Next Arabic,
  Noto Kufi, Myriad Arabic…); first installed wins, otherwise Illustrator's default with
  a warning. Paragraph direction RTL + World-Ready composer are set on every Arabic
  frame.
- **C++ SDK:** no.
- **UXP:** no.
