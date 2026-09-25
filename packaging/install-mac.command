#!/bin/bash
# Artboard Forge - development install for macOS (unsigned build).
# Double-click this file. If macOS blocks it: right-click > Open > Open.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions"

echo "Artboard Forge installer"
echo "1/3  Allowing unsigned panels for CEP 11 and 12 (PlayerDebugMode)..."
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1

echo "2/3  Copying the panel to: $DEST"
mkdir -p "$DEST"
rm -rf "$DEST/com.artboardforge.panel"
cp -R "$HERE/com.artboardforge.panel" "$DEST/"
# Files from a downloaded zip carry a quarantine flag; clear it on the panel only.
xattr -dr com.apple.quarantine "$DEST/com.artboardforge.panel" 2>/dev/null || true

echo "3/3  Done."
echo
echo "Next: quit Illustrator completely, reopen it, then Window > Extensions > Artboard Forge."
echo "Self-test: File > Scripts > Other Script... > tests/af-selftest.jsx (in this folder)."
echo
read -r -p "Press Return to close."
