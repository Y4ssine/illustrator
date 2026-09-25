/*
 * Batch execution and live preview.
 *
 * run(): executes every op of a batch inside ONE script evaluation, so
 * Illustrator records it as one undo step. On failure the journal is replayed
 * in reverse; deletions only happen after every op succeeded.
 *
 * Preview: a preview is an ordinary batch run with preview naming/tagging.
 * To replace or cancel it, the host prefers app.undo() - that keeps
 * Illustrator's undo history clean - but ONLY when it can prove the last undo
 * step is the preview (same document, same selection signature, preview items
 * still alive). After undoing it verifies the preview items are gone; if not,
 * it calls app.redo() and falls back to deleting the preview items by
 * reference. The designer's own actions are never undone.
 */
AFHost.runner = (function () {
  var U = AFHost.util;
  var I = AFHost.items;
  var O = AFHost.ops;
  var pv = { active: false, docName: null, created: [], layers: [], sig: null };

  function newContext(preview) {
    var doc = U.hasDoc() ? app.activeDocument : null;
    var sel = doc ? doc.selection : [];
    var copy = [];
    var i;
    var active = null;
    if (sel && !sel.typename) {
      for (i = 0; i < sel.length; i++) {
        copy.push(sel[i]);
      }
    }
    try {
      active = doc ? doc.activeLayer : null;
    } catch (e) {
      active = null;
    }
    return {
      doc: doc,
      selection: copy,
      textEditing: !!(sel && sel.typename),
      preview: !!preview,
      produced: [],
      created: [],
      createdLayers: [],
      journal: [],
      deferred: [],
      warnings: [],
      touchedLayers: {},
      explicitSelection: null,
      selUuid: null,
      activeLayer: active,
      opIndex: -1
    };
  }

  function rollback(ctx) {
    var failures = 0;
    var i;
    for (i = ctx.journal.length - 1; i >= 0; i--) {
      try {
        ctx.journal[i]();
      } catch (e) {
        failures++;
      }
    }
    return ctx.journal.length === 0 ? 'none' : failures === 0 ? 'full' : 'partial';
  }

  function finalize(ctx, keepSelection) {
    var i;
    var list;
    for (i = 0; i < ctx.deferred.length; i++) {
      if (U.alive(ctx.deferred[i])) {
        ctx.deferred[i].remove();
      }
    }
    O.restoreLayers(ctx);
    if (!ctx.doc) {
      return;
    }
    list = ctx.explicitSelection;
    if (!list && keepSelection !== false) {
      list = [];
      for (i = 0; i < ctx.selection.length; i++) {
        if (U.alive(ctx.selection[i])) {
          list.push(ctx.selection[i]);
        }
      }
    }
    if (list) {
      try {
        ctx.doc.selection = list.length ? list : null;
      } catch (e) {
        // Locked/hidden items cannot be selected; leave the selection as is.
      }
    }
    if (ctx.activeLayer) {
      try {
        if (U.alive(ctx.activeLayer) && !ctx.activeLayer.locked && ctx.activeLayer.visible) {
          ctx.doc.activeLayer = ctx.activeLayer;
        }
      } catch (e2) {
        // ignore
      }
    }
  }

  function run(batch, preview) {
    var t0 = new Date().getTime();
    var ops = batch.ops || [];
    var ctx;
    var results = [];
    var i;
    var op;
    var fn;
    var prevCS = null;
    var prevUIL = null;
    var rolled;
    var needsDoc = !(ops.length > 0 && ops[0].op === 'doc.create');
    if (needsDoc && !U.hasDoc()) {
      return { ok: false, error: { code: 'NO_DOCUMENT', message: 'No document is open' }, warnings: [], ms: 0 };
    }
    ctx = newContext(preview);
    if (ctx.textEditing && ops.length > 0) {
      return { ok: false, error: { code: 'TEXT_EDITING', message: 'Text editing is active' }, warnings: [], ms: 0 };
    }
    try {
      prevCS = app.coordinateSystem;
      app.coordinateSystem = CoordinateSystem.DOCUMENTCOORDINATESYSTEM;
    } catch (e0) {
      prevCS = null;
    }
    try {
      prevUIL = app.userInteractionLevel;
      app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
    } catch (e1) {
      prevUIL = null;
    }
    try {
      for (i = 0; i < ops.length; i++) {
        op = ops[i];
        ctx.opIndex = i;
        fn = O.handlers[op.op];
        if (!fn) {
          U.fail('BAD_OP', 'Unknown op ' + op.op);
        }
        if (ctx.preview && !O.PREVIEWABLE[op.op]) {
          U.fail('UNSUPPORTED', op.op + ' cannot be previewed');
        }
        results.push(fn(ctx, op) || {});
      }
      finalize(ctx, batch.keepSelection);
      if (ctx.preview) {
        remember(ctx);
      }
      return { ok: true, results: results, warnings: ctx.warnings, ms: new Date().getTime() - t0 };
    } catch (e) {
      rolled = rollback(ctx);
      O.restoreLayers(ctx);
      return {
        ok: false,
        error: {
          code: e.afCode || 'HOST_EXCEPTION',
          message: String(e.message || e),
          opIndex: ctx.opIndex,
          op: op ? op.op : null,
          line: e.line,
          rolledBack: rolled
        },
        warnings: ctx.warnings,
        ms: new Date().getTime() - t0
      };
    } finally {
      try {
        if (prevCS !== null) {
          app.coordinateSystem = prevCS;
        }
        if (prevUIL !== null) {
          app.userInteractionLevel = prevUIL;
        }
      } catch (e2) {
        // ignore
      }
    }
  }

  // ---- preview ---------------------------------------------------------------

  function remember(ctx) {
    pv.active = true;
    pv.docName = String(ctx.doc.name);
    pv.created = ctx.created;
    pv.layers = ctx.createdLayers;
    pv.sig = AFHost.query.signature();
  }

  function allGone(list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (U.alive(list[i])) {
        return false;
      }
    }
    return true;
  }

  function allAlive(list) {
    var i;
    for (i = 0; i < list.length; i++) {
      if (!U.alive(list[i])) {
        return false;
      }
    }
    return true;
  }

  function canUndoSafely() {
    if (!pv.active || !U.hasDoc()) {
      return false;
    }
    if (String(app.activeDocument.name) !== pv.docName) {
      return false;
    }
    if (AFHost.query.signature() !== pv.sig) {
      return false;
    }
    return pv.created.length > 0 && allAlive(pv.created);
  }

  function deleteByReference() {
    var i;
    for (i = pv.created.length - 1; i >= 0; i--) {
      try {
        if (U.alive(pv.created[i])) {
          pv.created[i].remove();
        }
      } catch (e) {
        // ignore
      }
    }
    for (i = pv.layers.length - 1; i >= 0; i--) {
      try {
        if (U.alive(pv.layers[i]) && pv.layers[i].pageItems.length === 0 && pv.layers[i].layers.length === 0) {
          pv.layers[i].remove();
        }
      } catch (e2) {
        // ignore
      }
    }
  }

  // Returns 'undo', 'delete' or 'none'.
  function revert() {
    var how = 'none';
    if (!pv.active) {
      return how;
    }
    if (canUndoSafely()) {
      try {
        app.undo();
        if (allGone(pv.created)) {
          how = 'undo';
        } else {
          // The last undo step was not ours: put it back.
          app.redo();
        }
      } catch (e) {
        how = 'none';
      }
    }
    if (how !== 'undo') {
      deleteByReference();
      how = 'delete';
    }
    pv.active = false;
    pv.created = [];
    pv.layers = [];
    pv.sig = null;
    return how;
  }

  function previewShow(batch) {
    revert();
    return run(batch, true);
  }

  function previewCancel() {
    return { reverted: revert() };
  }

  function previewApply(batch) {
    var how = revert();
    var res = run(batch, false);
    res.reverted = how;
    return res;
  }

  // Removes preview leftovers from an earlier session (e.g. Illustrator quit mid-preview).
  function sweepPreview() {
    var removed = 0;
    var doc;
    var cols;
    var c;
    var i;
    var it;
    if (!U.hasDoc()) {
      return { removed: 0 };
    }
    doc = app.activeDocument;
    cols = [doc.groupItems, doc.pathItems];
    for (c = 0; c < cols.length; c++) {
      for (i = cols[c].length - 1; i >= 0; i--) {
        it = cols[c][i];
        try {
          if (it.tags.length > 0 && I.tagValue(it, 'AF_preview') === '1') {
            it.remove();
            removed++;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return { removed: removed };
  }

  function previewActive() {
    return pv.active;
  }

  return {
    run: run,
    previewShow: previewShow,
    previewCancel: previewCancel,
    previewApply: previewApply,
    sweepPreview: sweepPreview,
    previewActive: previewActive
  };
}());
