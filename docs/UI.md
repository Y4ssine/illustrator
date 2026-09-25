# Panel UI

One dockable panel (320 px default, 220 px minimum). It has an icon rail, a header, a
scrolling content area of collapsible sections, and a status bar. It is dark by default
and follows Illustrator's UI brightness.

## Wireframe

```
┌────┬───────────────────────────────────────────────┐
│ ⌂  │ HOME            [◉ Preview ×]  [🔍 Commands ⌘K]│  ← header: title · preview chip · palette
│ ▦  ├───────────────────────────────────────────────┤
│ ⫴  │ ▾ DOCUMENT                                 🔍 │
│ ▯  │   Founding-Day-Campaign.ai •                  │
│ ◈  │   Artboard     IG_PORTRAIT_01 (1/2)           │
│ ▭  │   Size         1080 px × 1350 px              │
│    │   Colour RGB · Layers 14 · Host Illustrator 29│
│    │   ARTBOARD FORGE ITEMS  [Grid: 1] [Shadow: 2] │
│    │ ▾ FOR THIS SELECTION                          │
│    │   Linked image “hero”                         │
│    │   [Add Ground Shadow] [Contact + Ambient]     │
│    │   [Build Grid from Selection] [Organize…]     │
│    │ ▾ QUICK ACTIONS (★ in palette)                │
│    │ ▾ ARTBOARDS   Size [IG Portrait ▾] Mode [Auto]│
│    │   [Create / Switch]  Carousel: Slides 5 Gap 0 │
│    │ ▾ SET UP DESIGN  Recipe [Saudi Campaign ▾] [▶]│
│ ⚙  │ ▾ RECENT                                   ⇄  │
├────┴───────────────────────────────────────────────┤
│ ● Linked image “hero”        IG_PORTRAIT_01 · 1080×1350 · RGB │ ← status bar
└────────────────────────────────────────────────────┘
```

| Rail | Tab (Alt+n) | Sections |
|---|---|---|
| ⌂ | **Home** (1) | Document (+ recognised plugin items, preview-leftover cleanup) · For this selection (context actions) · Quick actions (favourites) · Artboards (social sizes, carousel, auto-number) · Set up design · Recent (history, repeat) |
| ⌒ | **Create** (2) | Design recipes (Campaign hero, Product spotlight, Infographic poster, Celebration post, Quote card: headline, subline, mood, variation, Preview / Build) · Shapes (category, thumbnail grid, per-shape parameters, palette styles incl. foil / glass / outline / neon, native effect, fit to selection or size, Preview / Insert) |
| ☼ | **Light & Blend** (3) | Scene light (rig presets, **compass** for direction, height, intensity, softness, warmth in Kelvin, custom colour — shared with Shadow) · One-click scenes (6 recipes, amount, variation) · Effects (back glow, rim, floor glow, neon, rays, key light, leak, bokeh, haze, vignette, colour grade; amount, blend, grade) |
| ▯ | **Shadow Studio** (4) | Mode badge (Add / Editing) · preset bar · style tiles (Studio ground, Cast, True silhouette, Contact, Floating, Long) · subject type · *use the scene light* · compass + light height · strength, softness, length, width · floating lift/mode, long footprint · colour chips + picker · blend · photographic blur · contact · placement · Preview / Add / Update |
| ◐ | **Colour** (5) | Brand palette (**Extract from selected logo**, roles, colours, add colour, harmonies → use as palette, reset) · Gradients & fills (brand, deep, glow, duotone, fade, foil, glass, sunset, mono + solids; Apply to selection, Add to Swatches) · Backgrounds (aurora, spotlight, sunburst, brand gradient, duotone, soft; mood, variation) · Fades (edge, colour, reach, strength, selection/artboard) |
| ▥ | **Infographic** (6) | Block tiles (stat cards, bar, column, donut, pie, progress bars, rings, steps, timelines, comparison, pictogram, icon list, header) · data text area (`label | value | note`, Arabic / English samples) · block options · look (card style, light/dark background, roundness, direction, digits, fit to placeholder) · Preview / Add |
| ▦ | **Grid & Guides** (7) | Smart Grid · Guides · Safe areas · Manage plugin guides |
| ⫴ | **Spacing & Align** (8) | Spacing · Measure · Margins |
| ◈ | **Layers** (9) | Template, naming format, options · live plan · per-item proposals · Organize |
| ▭ | **Presets** (0) | Kind · list · Duplicate, Rename, Edit (validated JSON), Delete · Import / Export |
| ⚙ | **Settings** | Units, density, direction, bounds, defaults, guide layer name, artboard naming, Safe Mode, poll interval · Creative: photographic blur, digits (0123 / ٠١٢٣), Arabic and Latin font candidates · Diagnostics · Privacy |

Tabs from the brief that still have no module (PATTERN, TYPE, CLEAN, EXPORT) are not
shown. There are no placeholder buttons.

Screenshots (simulator, not Illustrator): [Create](images/v2-panel-create-built.png) ·
[Light](images/v2-panel-light-built.png) · [Shadow](images/v2-panel-shadow-preview.png) ·
[Colour](images/v2-panel-color-extracted.png) · [Infographic](images/v2-panel-info-built.png).

## Design system (`src/ui/components`)

| Component | Notes |
|---|---|
| `Button`, `IconButton` | primary / secondary / quiet / danger, small, icon-only; pill-shaped like Spectrum |
| `Section` | collapsible, remembers state per panel, optional hint and header actions |
| `NumberField` | **scrub** by dragging the label (Shift ×10, Alt ×0.1), arrow keys, Enter/Esc; length fields accept `5mm`, `24px` and show the current unit |
| `Slider` | range + value read-out; live `onInput`, committed `onChange` |
| `Select` (Dropdown) | option groups |
| `Toggle` | switch with label |
| `Segmented` | exclusive options (unit, axis, placement, RTL/LTR…) |
| `ColorField` | native picker + hex input |
| `TextField`, `SearchBox` | — |
| `PresetBar` (PresetDropdown) | select + Save as new + ⋯ menu (update, duplicate, rename, delete) |
| `ProgressBar` | indeterminate while the host works; determinate API for chunked jobs |
| `TileGrid` | selectable thumbnail tiles (SVG glyph or CSS preview) — recipes, shapes, styles, effects, blocks |
| `Compass` | light-direction dial: drag or arrow keys (Shift = 45° steps); shows the sun, the subject and the shadow direction |
| `Chips` | colour swatch row (pick / copy) |
| `TextArea` | data entry, `dir="auto"` so Arabic lines read right to left |
| `PreviewApply` | the standard Preview toggle + primary action pair (debounced live preview) |
| `Readout`, `Badge`, `Note`, `Empty` | dense read-outs |
| Toasts | success / info / warn / error; *Details* expands technical info; *Copy diagnostics* |
| Dialogs | confirm (lists affected items), prompt |
| Tooltips | native `title` on every control (CEP renders these reliably) |

### Tokens

- **Spacing scale:** 2 · 4 · 6 · 8 · 12 · 16 px (`--s1…--s6`).
- **Field height:** 22 px compact, 26 px comfortable.
- **Colours:** `--bg`, `--bg-field`, `--bg-raised`, `--line`, `--text`, `--text-dim`,
  `--accent`, `--good`, `--warn`, `--danger`, `--af` (plugin items).
- **Light theme:** applied when Illustrator's panel background is light.

## Keyboard (panel focused)

| Keys | Action |
|---|---|
| Ctrl/Cmd + K or `/` | Command palette (↑ ↓ Enter Esc, ★ to favourite) |
| Ctrl/Cmd + Shift + R | Repeat last command |
| Alt + 1…6 | Switch tab |
| Esc | Cancel live preview / close dialog |
| Enter / Esc in dialogs | Confirm / cancel |

Global F-key shortcuts: see [INSTALL.md › Keyboard shortcuts](INSTALL.md#keyboard-shortcuts-f-keys).

## RTL / Arabic

- *Keep fixed: Right (RTL)* is the default. Horizontal spacing keeps the right-most
  object in place.
- Arabic text is only measured and moved, never rewritten, reversed or outlined.
- Snapshots flag Arabic text frames (`text.arabic`) for type tools in Phase 2.

## Screenshots (simulator)

The real panel, driving the real host script on the mock document (`npm run dev`).
These are **not** Illustrator screenshots.

| Grid built from the Campaign Grid preset | Editing a recognised shadow after save and reopen |
|---|---|
| ![Grid](images/simulator-grid.png) | ![Edit shadow](images/simulator-edit-shadow.png) |
| **Layers organised (preview, then applied)** | **Command palette: "shadow"** |
| ![Layers](images/simulator-layers.png) | ![Palette](images/simulator-palette.png) |
