/*
 * Artboard Forge - ExtendScript host (Illustrator).
 *
 * LANGUAGE: ExtendScript = ECMAScript 3. No JSON, no Array.prototype.map /
 * forEach / indexOf, no trailing commas, no reserved words as property names.
 * `npm run check:es3` parses the built file with acorn in ES3 mode.
 *
 * This file is a thin, dumb executor. All layout decisions are made by the
 * TypeScript core in the panel; the host only:
 *   - answers read-only queries (snapshot, signature, layers, tagged scan)
 *   - executes a batch of primitive ops (one evalScript call = one undo step)
 *   - manages the live-preview state
 *   - reads/writes JSON files for presets and settings
 *
 * Coordinates arrive in "design space" (points, Y down). Illustrator's DOM uses
 * Y up, so every Y value is negated here and nowhere else.
 */

var AFHost = {};
AFHost.VERSION = '0.2.0';
AFHost.PROTOCOL = 2;
AFHost.PREVIEW_PREFIX = '\u27E1 AF PREVIEW';
AFHost.caps = { gradientStopOpacity: true, applyEffect: true };
