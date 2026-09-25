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
interface ShadowParams {
  kind: 'ground' | 'contact' | 'contactAmbient';
  widthScale: number;   // shadow width ÷ subject width            (0.05–4)
  flatness: number;     // shadow height ÷ shadow width (camera)    (0.01–1)
  softness: number;     // 0 hard … 1 very soft (gradient falloff)
  opacity: number;      // 0–100
  offsetX: number;      // % of subject width (+ right)
  offsetY: number;      // % of subject height (+ down; 0 = centred on the bottom edge)
  rotation: number;     // degrees, Illustrator convention (+ = counter-clockwise)
  color: string;        // sRGB hex; converted to the document colour space by the host
  blend: BlendMode;     // 'multiply' by default
  liveBlur: number;     // pt; 0 = off (optional raster Gaussian Blur live effect)
  ambient: { widthScale; flatness; softness; opacity };   // used by contactAmbient
}

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

interface PalettePreset  { colors: Array<{ name; hex; role? }> }   // data only; the palette engine is Phase 2
interface SpacingPreset  { system: { kind: 'multiple'; base } | { kind: 'scale'; values: number[] }; tokens? }
interface ArtboardSizePreset { code; w; h; colorSpace: 'RGB' | 'CMYK'; safeZone? }
interface PatternPreset  { type; cellSize; spacing; strokeWidth; rotation; offset; alternation; symmetry; density; inspiration? }  // Phase 2
interface LightingPreset { type; angle; spread; strength; falloff; color; blend; opacity }                                      // Phase 2
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

- **Shadows:**
  - Soft Social Media
  - Person Grounded
  - Product Photography
  - Luxury Product
  - Floating Card
  - Car Grounded
  - Poster Dramatic (ground)
  - Sunset (long ground)
  - Studio Left / Right
  - Soft Noon
  - Hard Noon

  *Architectural* and other cast-shadow looks wait for the cast-shadow engine.
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
| `AF_type` | `groundShadow` |
| `AF_ver` | `1` |
| `AF_id` | `afm3x2k7q4zt1b` |
| `AF_src` | the subject's `AF_id` |
| `AF_params` | `{"kind":"ground","widthScale":0.95,…,"presetId":"soft-social","subjectRect":{…}}` |
| `AF_preview` | `1` (preview only) |

## 4. Settings (`settings.json`)

`units`, `density`, `direction` (`rtl` keeps the right-most item fixed when spacing
horizontally), `boundsMode`, `spacingPreset`, `shadowPreset`, `shadowPlacement`
(`belowSubject` | `shadowLayer`), `gridPreset`, `layerTemplate`, `namingFormat`,
`guideLayerName` (`_GUIDES`), `artboardSpacing`, `artboardNamePattern` (`{CODE}_{nn}`),
`artboardMode`, `safeMode`, `pollInterval`, `favorites`, `recent`.

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
