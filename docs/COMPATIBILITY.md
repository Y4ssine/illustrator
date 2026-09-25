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
| Ground/contact shadows (10–12) | DOM ellipse + radial `GradientColor` with `GradientStop.opacity`, scaled with "transform gradients" | **Built** |
| Soft blur on shadows | Undoc `PageItem.applyEffect(LiveEffect XML)` "Adobe PSL Gaussian Blur" | **Built, optional**; falls back with a warning |
| Stop-opacity fallback | DOM fade-to-white + Multiply | **Built** |
| Layer organizer (32, 33) | DOM `layers.add`, `move`, `zOrder`, `name`, `printable` | **Built** |
| Metadata / recognition (84, 85) | DOM `PageItem.tags` | **Built** |
| Undo as one step (83) | One script evaluation = one undo step. No `app.redraw()` inside commands | **Built** (verify in host) |
| Live preview / cancel (59) | DOM `app.undo()`/`app.redo()` with guard, or delete by reference | **Built** (verify in host) |
| Selection awareness (58) | Polling a cheap query; no CEP selection event | **Built** |
| Command palette, panel shortcuts (57, 87) | Panel keyboard focus only | **Built** |
| Global shortcuts (87) | Not possible from CEP. Workaround: Scripts-menu `.jsx` → CSXSEvent → panel; bind with an Action + F-key | **Built, experimental** |
| Long shadow (14) | DOM path construction (convex sweep) or blend + expand via menu commands | Phase 1 backlog |
| Backdrop generator (40) | DOM rect / rounded rect / ellipse | Phase 1 backlog (trivial on this base) |
| Document cleanup (34, 36) | DOM traversal (bounded), `remove` | Phase 1 backlog |
| Export assistant (63, 64) | DOM `exportForScreens` (AI 22+), `exportFile` | Phase 1 backlog |
| Cast shadow from silhouette (13) | DOM duplicate + transform matrix (skew/scale) + gradient | Phase 2 |
| Offset path / smart offset (50) | Undoc `applyEffect("Adobe Offset Path")` (live), or menu `Live Offset Path` + expand | Phase 2 |
| Block shadow / fake 3D (48, 49) | Duplicate + translate steps + Pathfinder (menu `Live Pathfinder Add`) | Phase 2 |
| Pattern mask (29) | DOM `groupItems.add` + `clipped = true` | Phase 2 |
| Edge fade / opacity masks (53) | No DOM API for opacity masks; menu `makeMask` works on the selection | Phase 2 (menu-based, fragile) |
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
