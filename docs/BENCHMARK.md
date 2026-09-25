# Benchmark (§90)

## 1. Simulator (measured)

These numbers come from `npm run bench`: Node 22 on the Linux build container, with the
**real ExtendScript host code** running on the **mock DOM**. They measure the algorithmic
cost of the core and host code. They do **not** measure Illustrator: Illustrator's DOM
calls cost much more, often 0.05–1 ms per property access.

| Objects | Startup | Selection analysis | Grid creation | Spacing normalize | Layer organize¹ | Document scan | Randomizer (engine only)² |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 3.0 ms | 5.1 ms | 9.0 ms | 6.8 ms | 6.7 ms | 1.3 ms | 0.3 ms |
| 500 | 2.4 ms | 20 ms | 27 ms | 32 ms | 23 ms | 7.1 ms | 0.5 ms |
| 5,000 | 0.3 ms | 150 ms | 155 ms | 277 ms | 199 ms | 57 ms | 2.8 ms |

Pure engines: a spacing plan for 5,000 items takes about 4 ms; a dense grid (24×24 plus
a 4 pt baseline) takes about 8 ms.

¹ Snapshot of all selected items, the plan, and rule proposals for every item, plus the
13 layer-create ops. The items are not moved in this row; the in-Illustrator benchmark
moves them all.
² The randomizer command is Phase 2. This column times the seeded-RNG engine only.

Findings that already led to changes:

- Bulk moves between layers were O(N²): the sort and rollback each searched a parent's
  children for every item. They now use a per-parent `StackIndex` (uuid → position,
  AF_src → linked shadows) and a single order snapshot for rollback.
- uuid refs are resolved through a one-time index over the captured selection, not a
  document-wide lookup per ref. At 5,000 items, spacing fell from 874 ms to 277 ms in
  the simulator.
- Commands that act on large selections (spacing, organize) ask for snapshots of up to
  10,000 items. Other reads stop at 500.

## 2. Real Illustrator (to be measured)

Run `dist/tests/af-benchmark.jsx` in Illustrator (File › Scripts › Other Script…) and
paste the report here.

| Machine / Illustrator | Objects | Ping | Selection analysis | Signature | Grid | Spacing (translate all) | Organize (13 layers + move all) | Document scan |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| *pending* | 50 | | | | | | | |
| *pending* | 500 | | | | | | | |
| *pending* | 5,000 | | | | | | | |

Targets for the next milestone:

- selection polling (`signature`) under 20 ms at 5,000 objects;
- spacing and organize under 2 s for 500 objects;
- document scan under 1 s for 5,000 objects.

Where a target is missed, the design allows chunked batches with a progress bar. This
costs extra undo steps and is documented in the UI.
