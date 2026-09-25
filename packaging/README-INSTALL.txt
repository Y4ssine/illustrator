ARTBOARD FORGE 0.1.0 - development build (unsigned)
===================================================

Requires Adobe Illustrator 2021 (25.3) or later, macOS or Windows.
This is the first build to run in real Illustrator: please run the self-test
(step 3) and send back the report.

1. INSTALL THE PANEL
   macOS:    double-click  install-mac.command
             (if macOS blocks it: right-click > Open > Open)
   Windows:  double-click  install-windows.bat

   What the installer does:
   - enables "PlayerDebugMode" for CEP 11 and 12, which Illustrator needs to
     load an unsigned panel;
   - copies the com.artboardforge.panel folder into your CEP extensions folder:
       macOS:   ~/Library/Application Support/Adobe/CEP/extensions/
       Windows: %APPDATA%\Adobe\CEP\extensions\

2. OPEN IT
   Quit Illustrator completely and reopen it, then:
   Window > Extensions > Artboard Forge

   Try the milestone flow:
   HOME > Artboards > Instagram Portrait > Create / Switch
   GRID > Build Grid
   select an image > SHADOW > Add Ground Shadow
   select headline + image > SPACING > Normalize
   LAYERS > Organize Layers
   Save, close, reopen: HOME lists the grid and shadow; selecting the shadow
   opens it in Edit mode.

3. RUN THE SELF-TEST (important)
   File > Scripts > Other Script...  >  tests/af-selftest.jsx
   It creates its own documents and does not touch your open files.
   It writes af-selftest-report.txt to your Desktop. Please send that file back.

   Optional: tests/af-benchmark.jsx (timings for 50 / 500 / 5,000 objects;
   writes af-benchmark-report.txt to the Desktop).

OPTIONAL: F-KEY SHORTCUTS
   Copy scripts-menu/*.jsx into Illustrator's Presets/<locale>/Scripts folder,
   restart, then bind each one to an F-key with an Action
   (Actions panel > New Action > Insert Menu Item > File > Scripts > ...).
   Experimental.

IF THE PANEL DOES NOT APPEAR IN Window > Extensions
   - Check the Illustrator version (25.3 or later).
   - Quit Illustrator fully (Cmd+Q / close every window) after installing.
   - Check the folder exists at the path above.
   - For panel DevTools, open http://localhost:8098 in Chrome while the panel is open.

UNINSTALL
   Delete the com.artboardforge.panel folder from the CEP extensions folder.
