# UXP migration plan

## Where things stand (September 2026)

- Illustrator has **no public UXP plugins, no UXP scripting and no public UXP DOM**.
- Adobe's September 2026 announcement, known here through search-result excerpts,
  targets a **public beta of UXP plugins for Illustrator by spring 2027**. It also says
  CEP remains included in the flagship apps until **December 2029**.
- What the Illustrator UXP DOM will cover is unknown.

CEP is therefore the right production target today. The architecture is built so that
moving to UXP means swapping an adapter.

## What stays unchanged

- `src/core`, `src/geometry`, `src/guides`, `src/layout`, `src/effects`, `src/layers`,
  `src/presets`, `src/utils`: pure TypeScript with no host dependencies.
- The command system, history, palette, presets, settings, tags, preview semantics.
- The protocol (`HostOp` batches) as the internal contract, even if UXP runs it
  in-process.
- Unit tests, and the host behaviour tests (re-pointed at the new adapter).

## What changes

| Piece | CEP today | UXP plan |
|---|---|---|
| Host executor | `src/illustrator/jsx/*.jsx` (ES3), reached via `evalScript` | `src/illustrator/uxp/executor.ts`: the same op handlers, written against the UXP Illustrator DOM, called in-process |
| Transport | `ScriptHostAdapter` + `CepBridge` | `UxpHostAdapter implements HostAdapter` (no string eval) |
| Undo grouping | one script evaluation = one step | whatever UXP provides (Photoshop's `executeAsModal` + history suspension is the likely model). Wrap each batch in it and name the step |
| Selection awareness | polling | UXP events, if exposed; keep the poller as a fallback |
| Storage | ExtendScript `File`/`Folder` | `uxp.storage.localFileSystem` (data folder), `getFileForOpening/Saving` |
| Theme | CEP skin info + event | UXP theme CSS variables / events |
| Panel entry | `cep/index.html`, `CSXS/manifest.xml` | `manifest.json` (UXP v5+), `index.html` |
| Shortcuts | F-key Actions workaround | UXP commands/menus, if Illustrator supports them |

## UI portability

- The UI is plain DOM with no framework, so it loads in UXP's HTML environment.
- Before migrating, check the current UXP CSS support:
  - Replace `display: grid` (used in `.grid2`, `.btn-grid`, `.toggle-grid`, `.readout`,
    `.history`, `.palette-item`, `.proposal`) with flexbox if grid is still unsupported.
  - `input[type=range|color]` may need Spectrum UXP widgets (`sp-slider`, colour
    picker).
  - Replace `mix-blend-mode` and `position: absolute` overlays (scrim) if they are
    unsupported.
- `localStorage` (section collapse state) is available in UXP.

## Step-by-step

1. When the beta ships, map every `HostOp` to UXP DOM calls and record the gaps in
   COMPATIBILITY.md.
2. Implement `UxpHostAdapter` behind the existing `HostAdapter` interface. Run
   `tests/host/*` against a UXP mock that follows the real UXP DOM.
3. Build a second entry point, `src/ui/main-uxp.ts`, sharing `mountShell`.
4. Ship CEP and UXP side by side during the overlap (2027–2029). Share presets through
   the same JSON files.
5. Retire CEP before December 2029.
