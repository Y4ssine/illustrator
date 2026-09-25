/*
 * Public entry point used by the panel:
 *
 *   AFHost.call("snapshot", { maxItems: 500 })   ->  JSON string
 *
 * Every call returns {"ok":true,"value":...} or {"ok":false,"error":{...}}.
 * Batch methods ("run", "preview.*") return the batch result object itself.
 */
AFHost.call = function (method, payload) {
  var out;
  var Q = AFHost.query;
  var R = AFHost.runner;
  var S = AFHost.storage;
  var p = payload || {};
  try {
    switch (method) {
      case 'ping':
        out = { ok: true, value: Q.ping() };
        break;
      case 'snapshot':
        out = { ok: true, value: Q.snapshot(p) };
        break;
      case 'signature':
        out = { ok: true, value: Q.signature() };
        break;
      case 'layers':
        out = { ok: true, value: Q.layers() };
        break;
      case 'scanTagged':
        out = { ok: true, value: Q.scanTagged(p) };
        break;
      case 'findByAfId':
        out = { ok: true, value: Q.findByAfId(p) };
        break;
      case 'run':
        out = R.run(p, false);
        break;
      case 'preview.show':
        out = R.previewShow(p);
        break;
      case 'preview.cancel':
        out = { ok: true, value: R.previewCancel() };
        break;
      case 'preview.apply':
        out = R.previewApply(p);
        break;
      case 'preview.sweep':
        out = { ok: true, value: R.sweepPreview() };
        break;
      case 'storage.read':
        out = { ok: true, value: S.read(p.key) };
        break;
      case 'storage.write':
        out = { ok: true, value: S.write(p.key, p.text) };
        break;
      case 'storage.import':
        out = { ok: true, value: S.importFile(p.title) };
        break;
      case 'storage.export':
        out = { ok: true, value: S.exportFile(p.title, p.name, p.text) };
        break;
      default:
        out = { ok: false, error: { code: 'BAD_OP', message: 'Unknown method ' + method } };
    }
  } catch (e) {
    out = { ok: false, error: { code: e.afCode || 'HOST_EXCEPTION', message: String(e.message || e), line: e.line } };
  }
  return AFHost.json.stringify(out);
};
