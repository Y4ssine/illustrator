# Build and installation

## Build

```bash
npm install
npm run build        # or: node scripts/build.mjs --release  (minified, no .debug file)
```

Output:

```
dist/cep/com.artboardforge.panel/   the extension folder (CSXS/manifest.xml, index.html, js/, css/, jsx/host.jsx)
dist/scripts-menu/                  F-key trigger scripts
dist/tests/af-selftest.jsx          in-Illustrator automated test
dist/tests/af-benchmark.jsx         in-Illustrator benchmark
dist/sim/                           browser simulator (development only)
```

## Install for development (unsigned)

Unsigned CEP extensions load only when *PlayerDebugMode* is enabled for the CEP
version your Illustrator uses: CSXS.11 for AI 25.3–29.5, CSXS.12 for 29.5.1+. Enabling
both is harmless.

**macOS**

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
ln -s "$(pwd)/dist/cep/com.artboardforge.panel" ~/Library/Application\ Support/Adobe/CEP/extensions/com.artboardforge.panel
```

**Windows** (PowerShell)

```powershell
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
New-Item -ItemType Junction -Path "$env:APPDATA\Adobe\CEP\extensions\com.artboardforge.panel" -Target "$PWD\dist\cep\com.artboardforge.panel"
```

Restart Illustrator, then open **Window › Extensions › Artboard Forge**.

A symlink or junction means `npm run build:watch` updates the installed panel. Close and
reopen the panel to reload it.

## Distribute (signed)

1. Build with `--release`.
2. Sign with Adobe's `ZXPSignCmd` (from the Adobe-CEP/CEP-Resources repository):
   ```bash
   ZXPSignCmd -selfSignedCert <country> <state> <org> <name> <password> cert.p12
   ZXPSignCmd -sign dist/cep/com.artboardforge.panel ArtboardForge.zxp cert.p12 <password> -tsa http://timestamp.digicert.com
   ```
3. Install the `.zxp` with Adobe's Unified Plugin Installer Agent (shipped with Creative
   Cloud) or a ZXP installer. Signed builds do not need PlayerDebugMode.

## Keyboard shortcuts (F-keys)

CEP panels cannot register global Illustrator shortcuts (details in
[COMPATIBILITY.md §4.1](COMPATIBILITY.md#41-global-keyboard-shortcuts-57-87)). Workaround:

1. Copy `dist/scripts-menu/*.jsx` into Illustrator's Scripts folder, then restart:
   - macOS: `/Applications/Adobe Illustrator <version>/Presets.localized/<locale>/Scripts/`
   - Windows: `C:\Program Files\Adobe\Adobe Illustrator <version>\Presets\<locale>\Scripts\`
2. In the **Actions** panel, create a set *Artboard Forge*. Then:
   1. *New Action* and choose a Function key (e.g. F7 = Ground Shadow).
   2. Stop recording.
   3. Use the panel menu › *Insert Menu Item…* › File › Scripts › *AF Ground Shadow*.
3. Keep the Artboard Forge panel open (it can be collapsed in a dock).

Available triggers:

- AF Ground Shadow
- AF Build Grid
- AF Normalize Spacing
- AF Organize Layers (asks for confirmation in the panel)
- AF Repeat Last

**Experimental:** the trigger dispatches a CSXS event from a File › Scripts script.
Adobe documents this for scripts running in a panel's engine; from the Scripts menu it
works on some versions and not others. If it fails, the script shows an alert instead of
failing silently.

Inside the panel, the shortcuts in [UI.md](UI.md#keyboard-panel-focused) always work.

## Where your data lives

Presets, settings and history are stored in `…/ArtboardForge/*.json`:

- macOS: `~/Library/Application Support/`
- Windows: `%APPDATA%\`

Back up or share presets with *Presets › Export*.

## Uninstall

Delete the extension folder (or the link) from `…/Adobe/CEP/extensions/`. Optionally
delete the `ArtboardForge` data folder.
