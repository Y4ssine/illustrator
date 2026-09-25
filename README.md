# Artboard Forge

A design-assistant panel for Adobe Illustrator, built for social-media, campaign, poster
and branding work, with first-class support for Arabic/RTL documents. It automates the
technical parts of building a composition (artboards, grids, spacing, shadows, layer
structure) and leaves the creative decisions to the designer.

> **Status: milestone 1 (vertical slice).** The core engines, the ExtendScript host, the
> CEP panel and 103 automated tests are done. **It has not been run in real Illustrator
> yet**: it was built where Illustrator was not available. Run the generated self-test
> first ([docs/TESTING.md](docs/TESTING.md)).

## What works today

| Area | Features |
|---|---|
| **Artboards** | Instagram Square / Portrait / Story, X, LinkedIn, YouTube, 16:9, A4/A3. It reuses a matching artboard, resizes an empty new document, or adds one. Also: carousel slides (continuous or spaced) and auto-numbering |
| **Smart Grid** | Columns, rows, modular, baseline, thirds, golden sections, centre axes, diagonals, radial and custom ratios (`1:2:1`). Targets: artboard, all artboards, selection, each object, clip-mask bounds. Presets include *Campaign Grid* and *Poster*. Live preview |
| **Guides** | Edges, centres, thirds, quarters and golden sections for the selection or artboard; offsets (+8/+16/+24/+32/custom); social and print safe areas; hide / lock / delete **plugin** guides only |
| **Spacing** | Live gap read-out with a suggestion (4/8/10/12 px or token scale). Normalize, distribute, match smallest/largest/first, exact gap. RTL-aware anchor. Linked shadows move with their subject. Two-object measure, margins read-out |
| **Shadow Lab** | Ground, Contact, Contact + Ambient. Vector radial-falloff ellipses (no rasterising) placed **directly below** each object, Multiply, 12 presets, optional live blur, live preview, **edit existing shadow** (even after reopening the file) |
| **Layers** | Templates: *Campaign Standard*, *Saudi Campaign Workspace*, *Depth Stack*; custom templates as JSON. Recognises existing layers (English and Arabic aliases), renames and creates, and sorts **selected** items by rules with confidence levels. Preview first. Never deletes layers |
| **Set Up Design** | One click: artboard, layer structure, grid and safe area (e.g. *Saudi Campaign Workspace 4:5*). Adds no logos or artwork |
| **Workflow** | Command palette (Ctrl/Cmd+K), favourites, recent operations, repeat last, Safe Mode, presets (create / rename / duplicate / delete / import / export), friendly errors with copyable diagnostics, one Undo per command, offline, no telemetry |

## Quick start

```bash
npm install
npm run verify        # typecheck, build, ES3 check, 103 tests
npm run dev           # simulator at http://localhost:8123/ (real panel + real host script on a mock document)
```

To install in Illustrator, see [docs/INSTALL.md](docs/INSTALL.md). You need Illustrator
2021 (25.3) or later.

## Documentation

| Document | Contents |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Platform research, layers, folder structure, protocol, adapters, command system, tagging, preview, performance |
| [COMPATIBILITY.md](docs/COMPATIBILITY.md) | Supported versions, feasibility matrix (DOM / undocumented / C++), verified API facts with sources, limitations analysis |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Presets, file format, protocol, tags, settings, storage |
| [UI.md](docs/UI.md) | Wireframe, tabs, design system, keyboard, RTL |
| [ROADMAP.md](docs/ROADMAP.md) | MVP backlog with status, milestones, Phase 2/3 |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Dev environment, scripts, simulator, debugging, ES3 rules, adding commands and ops |
| [INSTALL.md](docs/INSTALL.md) | Build, install (dev and signed), F-key shortcuts, data location |
| [TESTING.md](docs/TESTING.md) | Test layers, in-Illustrator self-test and benchmark, manual QA, sample document workflow |
| [BENCHMARK.md](docs/BENCHMARK.md) | 50 / 500 / 5,000 objects |
| [LIMITATIONS.md](docs/LIMITATIONS.md) | Known limitations |
| [UXP_MIGRATION.md](docs/UXP_MIGRATION.md) | Plan for Illustrator UXP |
| [presets/examples](presets/examples) | Example preset files |

## Principles

- Non-destructive: generated art is new, tagged and named; deletions are limited to
  plugin-tagged items.
- Selection-scoped: nothing outside the selection is changed.
- One Undo per command.
- Arabic text is never reversed or outlined.
- Nothing leaves the computer.
