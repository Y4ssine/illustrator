/*
 * Local JSON storage for presets/settings/history:
 *   <Adobe user data>/ArtboardForge/<key>.json
 * Nothing is ever sent over the network.
 */
AFHost.storage = (function () {
  var U = AFHost.util;

  function dir() {
    var f = new Folder(Folder.userData + '/ArtboardForge');
    if (!f.exists) {
      f.create();
    }
    return f;
  }

  function checkKey(key) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(key)) {
      U.fail('BAD_OP', 'Invalid storage key ' + key);
    }
  }

  function readFile(f) {
    var s;
    f.encoding = 'UTF-8';
    if (!f.open('r')) {
      U.fail('HOST_EXCEPTION', 'Cannot open ' + f.fsName);
    }
    s = f.read();
    f.close();
    return s;
  }

  function writeFile(f, text) {
    f.encoding = 'UTF-8';
    f.lineFeed = 'Unix';
    if (!f.open('w')) {
      U.fail('HOST_EXCEPTION', 'Cannot write ' + f.fsName);
    }
    f.write(text);
    f.close();
  }

  function read(key) {
    checkKey(key);
    var f = new File(dir().fsName + '/' + key + '.json');
    if (!f.exists) {
      return null;
    }
    return readFile(f);
  }

  // Write to a temp file first so a crash never leaves a half-written preset file.
  function write(key, text) {
    checkKey(key);
    var d = dir().fsName;
    var tmp = new File(d + '/' + key + '.json.tmp');
    var dest = new File(d + '/' + key + '.json');
    writeFile(tmp, text);
    if (dest.exists) {
      dest.remove();
    }
    tmp.rename(key + '.json');
    return true;
  }

  function jsonFilter() {
    if ($.os.indexOf('Windows') >= 0) {
      return 'JSON:*.json,All files:*.*';
    }
    return function (f) {
      return f instanceof Folder || /\.json$/i.test(f.name);
    };
  }

  function importFile(title) {
    var f = File.openDialog(title, jsonFilter(), false);
    if (!f) {
      return null;
    }
    return { name: String(f.name), text: readFile(f) };
  }

  function exportFile(title, suggested, text) {
    var start = new File(Folder.myDocuments.fsName + '/' + suggested);
    var f = start.saveDlg(title, jsonFilter());
    if (!f) {
      return null;
    }
    writeFile(f, text);
    return String(f.fsName);
  }

  return { read: read, write: write, importFile: importFile, exportFile: exportFile, dir: function () { return String(dir().fsName); } };
}());
