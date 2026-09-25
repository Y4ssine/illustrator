/*
 * Artboard Forge - keyboard trigger: Add Shadow (Shadow Studio settings)
 *
 * CEP panels cannot register global Illustrator shortcuts. Workaround:
 *   1. Copy this file to Illustrator's Presets/<locale>/Scripts folder (restart Illustrator).
 *   2. Actions panel > New Action (assign an F-key) > Insert Menu Item >
 *      File > Scripts > "AF Add Shadow" > Stop recording.
 * The Artboard Forge panel must be open (it can be docked/collapsed).
 * EXPERIMENTAL: dispatching CSXS events from a File > Scripts script is
 * reported to work but is not documented by Adobe for every version.
 */
(function () {
  var COMMAND = 'shadow.create';
  try {
    var plugplug = new ExternalObject('lib:PlugPlugExternalObject');
    var ev = new CSXSEvent();
    ev.type = 'com.artboardforge.command';
    ev.data = COMMAND;
    ev.dispatch();
  } catch (e) {
    alert('Artboard Forge could not reach its panel. Open Window > Extensions > Artboard Forge and try again.\n\n(' + e.message + ')');
  }
}());
