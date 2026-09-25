# Artboard Forge — Technical Architecture

Status: **Milestone 1 (vertical slice)**. What is built and what is not is listed in
[ROADMAP.md](ROADMAP.md). Known limits are in [LIMITATIONS.md](LIMITATIONS.md).

---

## 1. Platform research (Step 1)

### 1.1 The machine this was built on

This code was written and tested in a Linux cloud container. **Adobe Illustrator is not
installed there** (Illustrator only runs on macOS and Windows), so there was no local
Illustrator version to inspect. Every platform decision below comes from Adobe's published
material and from community sources. To make up for this, the repository ships:

- a **simulator**: the real ExtendScript host code, running on a mock Illustrator DOM, in
  Node and in the browser;
- a **generated in-Illustrator self-test** (`dist/tests/af-selftest.jsx`) and
  **benchmark** (`dist/tests/af-benchmark.jsx`) to run on a real machine.

See [TESTING.md](TESTING.md).

### 1.2 Extension technologies (as of September 2026)

| Technology | Status in Illustrator | Used here |
|---|---|---|
| **CEP** HTML panel (Chromium) + **ExtendScript** host | Shipping and supported. CEP 11 from AI 25.3 (Chromium 88), CEP 12 from AI 29.5.1. Adobe's September 2026 announcement, as quoted in search results, says CEP stays included until **December 2029**. | **Yes — production target** |
| **UXP** plugins | Not public for Illustrator. The same announcement gives a public beta target of **spring 2027**. | Planned: adapter swap ([UXP_MIGRATION.md](UXP_MIGRATION.md)) |
| **C++ SDK** (`.aip`) | Fully supported: native tools, annotators, live effects, notifiers | No. Needed only for a few features, listed in [COMPATIBILITY.md](COMPATIBILITY.md) |
| Standalone `.jsx` scripts | Supported (File › Scripts) | Keyboard triggers, self-test, benchmark |

Decision: ship **CEP + ExtendScript** now. Keep every Illustrator call behind adapter
interfaces so that UXP (or a C++ helper) replaces the adapter, not the application.

Verified API facts used by the design, with confidence and sources, are in
[COMPATIBILITY.md §3](COMPATIBILITY.md#3-verified-api-facts).

---

## 2. Layered architecture

```
┌──────────────────────────────── UI ADAPTER ────────────────────────────────┐
│  src/ui   panel shell · views · design-system components · command palette │
│           (plain DOM, no framework — portable to UXP's HTML subset)        │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │  AppController (state, polling, toasts, preview, persistence)
┌──────────────▼──────────────────────── CORE ───────────────────────────────┐
│  commands  registry · runner (validate → plan → confirm → commit) · history │
│            palette search · selection context                              │
│  engines   geometry · grid · guides · spacing · shadow · layers · artboards │
│            presets · tags · random                                         │
│  protocol  HostOp / Ref / Place / Paint (plain JSON)                       │
│  host.ts   HostAdapter + DocumentAdapter, SelectionAdapter, LayerAdapter,  │
│            GuideAdapter, ShapeAdapter, TransformAdapter, AppearanceAdapter,│
│            ColorAdapter, MetaAdapter, ArtboardAdapter, StorageAdapter,     │
│            PreviewController                                               │
└──────────────┬──────────────────────────────────────────────────────────────┘
               │  one JSON batch per command
┌──────────────▼─────────────────────── HOST ADAPTER ────────────────────────┐
│  ScriptHostAdapter (src/illustrator/script-adapter.ts)                     │
│     transport = CEP evalScript  (production)                               │
│     transport = SimRuntime       (tests, browser simulator)                │
│  ExtendScript executor (src/illustrator/jsx/*.jsx, ES3) — the ONLY code    │
│  that touches Illustrator's DOM                                            │
│  Future: UxpHostAdapter implementing the same interfaces                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Rule:** nothing above the host adapter imports Illustrator types or calls Illustrator.
The engines are pure functions that take rectangles and parameters and return geometry or
plans, so they are unit-tested without a host.

---

## 3. Folder structure

```
cep/                       CEP static files: CSXS/manifest.xml, index.html, .debug
dev/                       browser simulator page (index.html, sim.css)
docs/                      this documentation
presets/examples/          example preset files (JSON)
scripts/                   build.mjs, check-es3.mjs, bench.mjs, jsx-sources.mjs
scripts-menu/              F-key trigger scripts (File › Scripts)
src/
  core/                    protocol, host interfaces, transaction, snapshot, tags,
    commands/              settings, context, errors; command system
  geometry/                rect, units, ratio
  guides/                  grid engine, guide generator, safe zones, grid commands
  layout/                  spacing engine/commands, artboard presets/engine/commands
  effects/                 shadow engine, shadow presets, shadow commands
  layers/                  naming/roles, templates, organizer, auto-sort, commands
  presets/                 models, built-ins, serialization, store
  illustrator/
    jsx/                   ExtendScript host (ES3), concatenated into host.jsx
    cep/                   CEP bridge (evalScript queue, events, theme, flyout)
    sim/                   mock DOM, runtime, serializer, renderer, sample docs
    script-adapter.ts      HostAdapter over any "eval a script" transport
    cep-adapter.ts         production wiring
  ui/                      shell, app controller, palette, views/, components/, styles/
  utils/                   seeded RNG, colour, misc
  types/                   virtual module declaration (host source for the simulator)
tests/
  unit/                    engines, presets, search, settings…
  host/                    real host script vs mock DOM; milestone flow; self-test dry run
  illustrator/             generator for the in-Illustrator self-test and benchmark
  bench/                   Node benchmark
```

---

## 4. Host protocol

`src/core/protocol.ts` is the contract between core and host. It is plain JSON so it can
cross `evalScript`, be stored in history, and be embedded in the self-test.

- **Coordinates:** design space. Units are points (1 pt = 1 px in RGB documents) and **Y
  points down**. The ExtendScript host flips Y exactly once (`02-util.jsx`: `rect`,
  `aiRect`; ops negate `y`). Illustrator's DOM keeps its old Y-up axis
  (`geometricBounds = [left, top, right, bottom]`, top > bottom). The host sets
  `app.coordinateSystem = DOCUMENTCOORDINATESYSTEM` for each batch and restores it after.
- **Refs** point at items:
  - `uuid`: `PageItem.uuid`, AI 24+. Valid within a session.
  - `sel`: an index into the selection captured when the batch starts, plus a bounds
    fingerprint that detects a changed selection.
  - `op`: an item created earlier in the same batch.
  - `af`: an item tagged `AF_id=…`. Persistent across save and reopen.
- **Place** says where a new or moved item goes: layer top or bottom, below or above a
  ref, inside a group, or *replace* (take an existing item's slot).
- **Ops**: `layer.ensure|rename|move|props`, `group.create`, `guides.lines`,
  `shape.rect|ellipse`, `item.translate|place|remove|rename|tag|appearance|effect`,
  `items.toLayer`, `artboard.add|update|activate`, `selection.set`, `doc.create`,
  `af.removeTagged`.

### 4.1 Batch semantics (`30-run.jsx`)

1. One command becomes **one `evalScript`** call, and Illustrator records one script run
   as **one undo step**. Nothing calls `app.redraw()` during a command, because that
   would split the undo step.
2. Every change pushes a compensating closure onto a **journal**. If an op throws, the
   journal replays in reverse and the error reports `rolledBack: full|partial`.
3. **Deletions are deferred** to the end of the batch. An item that is being "replaced" is
   hidden first. Nothing is destroyed unless every op succeeded.
4. Layers that are locked or hidden are unlocked or shown temporarily and restored when
   the batch ends.
5. The original selection and active layer are restored, unless the batch sets the
   selection explicitly.
6. Deleting requires `AF_type` tags (`requireTag`). The host refuses to delete artwork
   that the plugin did not create.

### 4.2 Queries (`10-query.jsx`)

`ping`, `snapshot`, `signature`, `layers`, `scanTagged` and `findByAfId` are read-only
and create no undo steps. `snapshot` describes up to `maxItems` selected items: type,
name, layer, geometric/visible/**clip** bounds, tags and text info. Clip bounds exist
because Illustrator reports a clipping group's bounds as *all* of its content, including
what the mask hides. The frame the designer sees is the clipping path.

---

## 5. Adapters

`src/core/host.ts` defines the adapters named in the brief:

| Adapter | Kind | Methods |
|---|---|---|
| `DocumentAdapter` | async queries | `snapshot`, `signature`, `layers`, `scanTagged`, `findByAfId` |
| `SelectionAdapter` | async query | `current` |
| `LayerAdapter` | transaction facet | `ensure`, `rename`, `move`, `setProps` |
| `GuideAdapter` | transaction facet | `lines` |
| `ShapeAdapter` | transaction facet | `group`, `rect`, `ellipse` |
| `TransformAdapter` | transaction facet | `translate`, `place`, `toLayer` |
| `AppearanceAdapter` | transaction facet | `set` (opacity/blend), `effect` |
| `ColorAdapter` | transaction facet | paint builders (`solid`, `none`). The host converts sRGB hex into the document colour space |
| `MetaAdapter` | transaction facet | `tag`, `rename`, `remove`, `removeTagged` |
| `ArtboardAdapter` | transaction facet | `add`, `update`, `activate`, `createDocument` |
| `StorageAdapter` | async | `read`, `write`, `importFile`, `exportFile` |
| `PreviewController` | async | `show`, `cancel`, `apply` |

Writes are *recorded* in a `HostTransaction` (`OpBuffer`) and sent together by
`commit()`. This is what makes one command one undo step on every adapter. A future UXP
adapter implements `commit()` with direct DOM calls inside whatever undo-grouping UXP
offers.

---

## 6. Command system

```ts
interface DocumentCommand<P> {
  id; title; category; keywords; description; view?;
  destructive?; worksWithoutDocument?; supportsPreview?; maxSelection?;
  defaultParams(ctx): P;                          // serialize: params are plain JSON
  validate(snapshot, params, settings): string | null;   // plain-language reason
  plan(ctx, params): Promise<CommandPlan>;        // no side effects → batch + summary
}
```

`CommandRunner` (`src/core/commands/runner.ts`) handles every command the same way:

1. Take a fresh snapshot.
2. `validate`. Soft errors read like "Ground Shadow requires at least one selected object."
3. `plan`, which may report "nothing to do".
4. Confirm when the plan asks for it, or when the command is destructive and Safe Mode
   is on.
5. Commit through the host, as a preview apply if a preview is showing.
6. Run optional **multi-stage** plans (`next`). Example: create the document, then build
   inside it against a fresh snapshot.
7. Record history.

Other command features:

- **Preview:** `runner.preview` plans the same command. It forces additive parameters
  (for example `replaceExisting: false`) and calls `PreviewController.show`. The host
  refuses non-additive ops while previewing.
- **History:** the last 10 operations, stored separately from Illustrator's Undo. Clicking
  an entry reopens the command's view with its parameters and never re-runs it.
- **Repeat last:** re-runs the last command's parameters on the current selection, with
  confirmation for destructive commands in Safe Mode.
- **Palette:** `searchCommands` ranks results as title prefix, then word prefix, then
  substring, then keyword, then description, then subsequence, with a boost for recent
  commands.
- **Context:** `classifySelection` maps the selection (no document, nothing, text,
  image, path, group, plugin item, multiple, text editing) to suggested commands.

---

## 7. Generated-object tagging and recognition

Every generated item carries `PageItem.tags`. Tag names are restricted to
`[A-Za-z_][A-Za-z0-9_]*` because Illustrator rejects spaces.

| Tag | Meaning |
|---|---|
| `AF_type` | `groundShadow`, `contactShadow`, `contactAmbientShadow`, `grid`, `guides`, `subject` |
| `AF_ver` | metadata schema version (1) |
| `AF_id` | stable id of this item |
| `AF_src` | `AF_id` of the subject (shadows) |
| `AF_params` | JSON of the parameters used |
| `AF_preview` | `1` on preview items (sweepable) |

Items also get readable names, for example `SHADOW — Ground — hero` or
`GRID — Campaign Grid — IG_PORTRAIT_01`.

**Subjects** get an `AF_id` tag when a shadow is created, so the link survives save and
reopen. `uuid` is *not* assumed to persist. **Edit existing effect:** when the selection
is only plugin shadows, the Shadow Lab switches to *Edit*. It loads `AF_params` and
rebuilds the shadow in the same stacking slot (`place: replace`), keeping its `AF_id`. It
also keeps the shadow where the designer moved it, unless *Re-fit to object* is used.

---

## 8. Live preview (`30-run.jsx`)

A preview is a normal batch run in preview mode. Preview items are named
`⟡ AF PREVIEW — …` and tagged `AF_preview=1`. To replace or cancel a preview, the host
prefers `app.undo()`, which keeps Illustrator's history clean. It does so **only** when
it can prove the last step is the preview:

- the document is the same,
- the selection signature is the same,
- all preview items are still alive.

After undoing, it checks that the preview items are gone. If they are not, it calls
`app.redo()` to put back what it undid and deletes the preview items by reference
instead. The designer's own actions are never undone. *Apply* reverts the preview, then
commits the final batch as one step. Previews are purely additive, and ops like
translate, remove or replace are rejected, so the fallback path always restores the
document exactly. If a session crashes mid-preview, the leftovers can be found and
removed from HOME.

---

## 9. Selection awareness

CEP panels in Illustrator get no selection-change event. The documented events are
`documentAfterActivate/Deactivate/Save` and `applicationActivate`. The optional
AIHostAdapter plug-in is not relied on. So the panel **polls** a cheap `signature` query
every 700 ms, which is configurable. The signature is built from:

- document name,
- artboard count and active rect,
- layer count,
- selection count,
- the first three items' type, bounds, tag count and name.

Polling pauses while the panel is hidden or busy, and backs off when a query takes more
than 150 ms. A full snapshot is taken only when the signature changes.

---

## 10. Performance

- **Selection-scoped by default.** Only `scanTagged`, `af.removeTagged` and `findByAfId`
  walk the document. They check group and path collections only, read `tags.length`
  before any tag, and stop at a limit.
- **One round trip per command.** Payloads are ES3 object literals with non-ASCII
  characters escaped.
- **Bulk moves are O(N):** a per-parent `StackIndex` stores each child's position by uuid
  and the linked shadows by `AF_src`. Rollback uses one order snapshot per parent instead
  of a neighbour search per item.
- **uuid refs are resolved** through an index over the captured selection. This avoids a
  document-wide lookup per ref.
- **Gradient swatches are reused by name** (`AF Shadow 1A1410 s75`), so the Swatches
  panel does not fill up.

Numbers: [BENCHMARK.md](BENCHMARK.md).

---

## 11. Errors

- The host returns `{ code, message, opIndex, op, line, rolledBack }`.
- `fromHostError` turns this into a plain-language message, with copyable technical
  details shown in the toast.
- Bridge failures are detected: `EvalScript error.`, an empty answer, or a timeout.
  They get specific advice, for example *"is a modal dialog open?"*.

---

## 12. Privacy and offline

- There is no network code. Nothing is uploaded, and there is no telemetry.
- Presets, settings and history are JSON files in
  `Folder.userData/ArtboardForge/*.json`.
- Any future telemetry must be opt-in and must never include artwork, document names or
  text ([ROADMAP.md](ROADMAP.md#phase-3)).

## 13. Optional AI module (future, not built)

The architecture keeps a place for it without depending on it. An `AnalyzeLayout`
service would take the same `DocumentSnapshot` the composition analyzer uses: bounds,
roles and colours, **not pixels**. It would run behind an explicit per-use consent
dialog. Core tools never import it.
