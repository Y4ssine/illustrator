# Data model

All data is plain JSON, typed in TypeScript. Source of truth:

- `src/presets/models.ts`: preset kinds
- `src/core/protocol.ts`: host protocol
- `src/core/tags.ts`: metadata tags
- `src/core/settings.ts`: settings
- `src/core/snapshot.ts`: what the host reports

## 1. Presets

Every kind extends `PresetBase { id, name, builtin?, notes? }`. Built-in presets are
read-only; *Duplicate* makes an editable copy.

```ts
interface ShadowPreset   { params: ShadowParams }
interface ShadowParams {                 // Shadow v2
  style: 'ground' | 'contact' | 'cast' | 'silhouette' | 'floating' | 'long';
  subject: 'person' | 'product' | 'bottle' | 'car' | 'box' | 'card' | 'icon' | 'text';
  lightAngle: number;   // compass degrees the light comes FROM (0 top/behind, 90 right, 180 front, 270 left)
  elevation: number;    // 5 (sunset, long shadows) … 90 (overhead)
  strength: number;     // overall darkness 0–100
  softness: number;     // 0 hard sun … 100 overcast/softbox
  length: number;       // cast/long length, % of the physical length (10–300)
  spread: number;       // footprint width % (30–250)
  color: string;        // sRGB hex; converted to the document colour space by the host
  blur: boolean;        // Gaussian Blur live effects (photographic edge)
  contact: boolean;     // add a contact line under cast/silhouette shadows
  lift: number;         // floating: gap, % of the subject height
  floatMode: 'card' | 'hover';
  footprint: 'rect' | 'round' | 'ellipse';   // long / bounds-based floating
  radius: number;       // pt, rounded footprints
  blend: BlendMode;     // 'multiply' by default
}
// v0.1 shadows ({kind, widthScale, flatness, opacity, …}) are recognised and upgraded when edited.

interface GridPreset { spec: GridSpec }
interface GridSpec {
  margins: { top; right; bottom; left };
  columns?: { count; gutter; ratios?: number[] } | null;
  rows?:    { count; gutter; ratios?: number[] } | null;
  baseline?: { increment; offset } | null;
  thirds?: boolean; golden?: boolean; center?: boolean;
  diagonals?: 'none' | 'corners' | 'fortyFive';
  radial?: { spokes } | null;
  marginGuides?: boolean;        // draw the margin rectangle
  spanArea?: boolean;            // column/row guides span the whole target
  compositionOn?: 'area' | 'content';
  pixelSnap?: boolean;
  extend?: number;               // extend guides past the target (pt)
}

interface LayerTemplate {
  format: 'dash' | 'underscore' | 'dot' | 'plain';          // "05 — SUBJECT" | "05_SUBJECT" | "05. Subject" | "SUBJECT"
  layers: Array<{ role: LayerRole; label: string; number: number | null; printable?: boolean; locked?: boolean }>;
  // Listed in Layers-panel order: first = top (front). Numbers are labels only.
}

interface PalettePreset  { colors: Array<{ name; hex; role? }> }   // data only; the active brand palette lives in settings.palette
interface SpacingPreset  { system: { kind: 'multiple'; base } | { kind: 'scale'; values: number[] }; tokens? }
interface ArtboardSizePreset { code; w; h; colorSpace: 'RGB' | 'CMYK'; safeZone? }
interface PatternPreset  { type; cellSize; spacing; strokeWidth; rotation; offset; alternation; symmetry; density; inspiration? }  // Phase 2
interface LightRig       { angle; elevation; kelvin; color: string | null; intensity; softness }  // settings.lightRig; presets in RIG_PRESETS
interface ExportPreset   { format; scales; transparent; namePattern }                                                           // Phase 1 backlog
```

`LayerRole` is one of `guides notes brand typography texture lighting shadows foreground
subject midground architecture atmosphere background decorations images`. Existing
layers are matched by normalising their names (numbers and separators removed, then
upper-cased) against the template labels and English/Arabic aliases. For example
`_GUIDES` → guides and `الخلفية` → background.

### 1.1 Preset file format

```json
{
  "format": "artboard-forge.presets",
  "version": 1,
  "kind": "shadow",
  "exportedAt": "2026-09-25T20:00:00.000Z",
  "presets": [ { "id": "…", "name": "…", "params": { … } } ]
}
```

- Invalid presets are reported one by one; the rest still import.
- Files from a newer format version are refused with a clear message.
- On import, name clashes get a numeric suffix and id clashes get a new id.
- Examples: [`presets/examples/`](../presets/examples). Files named `builtin-*.json` are
  exports of the shipped presets; `example-*.json` are sample custom presets.

### 1.2 Built-in presets (Phase 1)

- **Shadows (v2):** Studio product · Person on the ground · Golden-hour cast · Noon sun ·
  Backlit hero · Luxury product · Bottle on a table · Car grounded · Logo / type
  silhouette · Floating card (UI) · Hovering product · Long shadow 45° · Contact line only.
- **Light rigs:** Golden hour · Studio key left/right · Noon sun · Backlit hero ·
  Lantern / candle · Moonlight · Neon night · Emerald glow.
- **Scenes:** Hero glow · Golden rays · Studio product · Night neon · Lantern warmth ·
  Emerald luxury.
- **Colour grades:** Golden hour · Teal & orange · Emerald mood · Night blue · Desert heat
  · Cinematic fade · Luxury gold.
- **Design recipes:** Campaign hero · Product spotlight · Infographic poster ·
  Celebration post · Quote / announcement.
- **Grids:**
  - Campaign Grid (6×8, 24 gutters, 72 margins, centre axes)
  - 12 Columns
  - Poster (12 col + 12 pt baseline + thirds)
  - Editorial
  - Rule of Thirds
  - Golden Sections
  - Diagonal Method
  - Baseline 8
  - Radial 12
- **Layer templates:**
  - Campaign Standard (§32 names)
  - Saudi Campaign Workspace (§66)
  - Depth Stack (§16)
- **Spacing systems:** 4 / 8 / 10 / 12 px and a token scale (4 → 128).
- **Palettes:** two *example* palettes, labelled as not official specifications.
- **Artboards:**
  - Instagram Square / Portrait / Story
  - X / Twitter post
  - LinkedIn square and landscape
  - YouTube thumbnail
  - Presentation 16:9
  - A4, A3
- **Safe zones:**
  - IG Story, IG Reel, IG portrait profile-grid crop: approximate, labelled as such
  - Title safe 10%, action safe 5%
  - Print 5 mm

## 2. Host protocol

See [ARCHITECTURE.md §4](ARCHITECTURE.md#4-host-protocol). Summary:

```ts
type Ref   = { k:'uuid'; v } | { k:'sel'; i; fp? } | { k:'op'; i } | { k:'af'; id; near? };
type Place = { k:'layer'; name; at:'top'|'bottom' } | { k:'below'|'above'; ref } | { k:'inside'; ref; at } | { k:'replace'; ref };
type Paint = { t:'none' } | { t:'solid'; c } | { t:'radial'|'linear'; stops:[{p,c,o,m?}]; name; angle?; fallback?:'fadeToWhiteMultiply' };
interface Batch { label; ops: HostOp[]; keepSelection? }
type BatchResult = { ok:true; results; warnings; ms } | { ok:false; error:{code,message,opIndex?,op?,line?,rolledBack?}; warnings; ms };
```

## 3. Metadata on generated artwork

| Tag | Example |
|---|---|
| `AF_type` | `groundShadow`, `castShadow`, `light`, `shape`, `infographic`, `background`, `decor`, … |
| `AF_light` | light effect id, e.g. `backGlow`, `beams`, `rim` (light groups) |
| `AF_info` | infographic block id, e.g. `statCards`, `donut` |
| `AF_ver` | `1` |
| `AF_id` | `afm3x2k7q4zt1b` |
| `AF_src` | the subject's `AF_id` |
| `AF_params` | `{"style":"ground","subject":"product","lightAngle":320,…,"presetId":"studio-product","subjectRect":{…}}` |
| `AF_preview` | `1` (preview only) |

## 4. Settings (`settings.json`)

`units`, `density`, `direction` (`rtl` keeps the right-most item fixed when spacing
horizontally), `boundsMode`, `spacingPreset`, `shadowPreset`, `shadowPlacement`
(`belowSubject` | `shadowLayer`), `gridPreset`, `layerTemplate`, `namingFormat`,
`guideLayerName` (`_GUIDES`), `artboardSpacing`, `artboardNamePattern` (`{CODE}_{nn}`),
`artboardMode`, `safeMode`, `pollInterval`, `favorites`, `recent`, and (v0.2)
`lightRig` (the scene light shared by Light and Shadow), `palette` (active brand palette
hexes, `null` = built-in), `fontsArabic` / `fontsLatin` (PostScript candidates, first
installed wins), `digits` (`western` | `arabic`), `liveBlur`.

Unknown or invalid values are replaced by defaults (`mergeSettings`).

## 5. Storage locations

ExtendScript `Folder.userData` + `/ArtboardForge/`:

- macOS: `~/Library/Application Support/ArtboardForge/`
- Windows: `%APPDATA%\ArtboardForge\`

Files:

- `settings.json`
- `history.json`
- `presets.<kind>.json` (user presets only)

Writes go to a `.tmp` file first, then the file is renamed.

Design tokens *per document* (§54) are planned. They will be stored in a tagged,
non-printing data item or in XMP, and the design is still open ([ROADMAP.md](ROADMAP.md)).
