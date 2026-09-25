# Development environment

## Prerequisites

- Node.js 20+ (developed on 22) and npm.
- For the real host: Adobe Illustrator 2021 (25.3) or later on macOS or Windows.
- Optional: Chrome, for remote-debugging the panel.

```bash
npm install          # .npmrc sets legacy-peer-deps (works around an npm peer-resolution bug with vitest 4)
npm run verify       # typecheck → build → ES3 check → tests
```

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/`: the CEP extension (`dist/cep/com.artboardforge.panel`), `dist/scripts-menu`, `dist/sim` (simulator), `dist/tests/af-selftest.jsx` and `af-benchmark.jsx` |
| `node scripts/build.mjs --release` | Same, minified, without `.debug` |
| `npm run dev` | Watches and serves the **simulator** at <http://localhost:8123/> |
| `npm run build:watch` | Rebuilds the extension on change (reload the panel in Illustrator) |
| `npm run typecheck` | `tsc` for `src/` (DOM types only) and `tests/` (with Node types) |
| `npm run check:es3` | Parses every ExtendScript file as **ECMAScript 3** with acorn; rejects `JSON.*` and non-ASCII in the bundle |
| `npm test` | vitest: unit + host (real host script on the mock DOM) + self-test dry runs |
| `npm run bench` | Node benchmark (simulator), see [BENCHMARK.md](BENCHMARK.md) |

## The simulator

`npm run dev` opens the real panel beside an SVG view of a **mock** Illustrator
document. The panel talks to the real ExtendScript host code through the same adapter
as production. The simulator shows:

- a sample document: `?doc=sample` (default), `?doc=empty` or `?doc=none`;
- click to select and Shift-click to add;
- Undo / Redo, simulating one step per script evaluation;
- Save & reopen: tags persist, uuids change;
- a text-editing mode toggle;
- a live Layers list.

It is labelled **SIMULATOR — not Illustrator**. It validates logic and UI flow. It does
**not** prove how Illustrator behaves (see [TESTING.md](TESTING.md)).

## Debugging inside Illustrator

1. Install the development build (see [INSTALL.md](INSTALL.md)). `dist` includes a
   `.debug` file.
2. Open the panel, then browse to <http://localhost:8098> in Chrome for DevTools on the
   panel.
3. For the ExtendScript side: use `$.writeln` output in the ExtendScript Debugger
   (VS Code extension), or run pieces with File › Scripts. `AFHost.call('snapshot', {})`
   returns JSON you can inspect.
4. After editing `src/illustrator/jsx/*.jsx`, rebuild. Close and reopen the panel to
   reload `host.jsx` (ScriptPath is loaded when the panel opens).

## Rules for ExtendScript code (`src/illustrator/jsx`)

- **ES3 only.** Use `var` and `function`. No arrow functions, `let`/`const`, trailing
  commas, getters, `Array.prototype.map/forEach/indexOf`, `JSON` or `Object.keys`.
  `npm run check:es3` enforces this.
- **ASCII only.** Write `'ا'` instead of literal Arabic. The build also escapes
  non-ASCII automatically.
- Do not call `app.redraw()` inside a command: it splits the undo step.
- Every mutation pushes a journal closure. Deletions are deferred (`ctx.deferred`).
- Treat the DOM as slow. Read each property once, use collection lengths, and never
  write nested loops over document collections.
- Only `10-query.jsx` and `30-run.jsx` may read `app.activeDocument`. Ops receive
  `ctx.doc`.

## Adding a command (checklist)

1. Engine (pure) in the module folder, with unit tests.
2. Command in `<module>/<module>-commands.ts`:
   - `validate` returns a plain-language reason.
   - `plan` records ops through `ctx.host.begin(label)` facets or `append(engineOps)`.
   - It returns `{ batch, summary, warnings }`, or `nothing`.
3. Register it in `src/core/commands/all.ts`. It appears in the palette automatically.
4. Controls in the relevant view; call `app.run(id, params)`.
5. If it needs a new host primitive, see the next section.
6. Add a host test in `tests/host/`. If it belongs to the core flow, add a step to the
   self-test generator.

## Adding a host op

1. Type it in `src/core/protocol.ts` (`HostOp`).
2. Add a builder in `OpBuffer` and its facet interface (`src/core/host.ts`).
3. Implement it in `src/illustrator/jsx/20-ops.jsx` with a journal entry. Add it to
   `PREVIEWABLE` only if it is purely additive.
4. Model any new DOM surface in `src/illustrator/sim/mock-dom.ts`.
5. `npm run verify`.
