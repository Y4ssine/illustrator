/*
 * Read-only queries. None of these modify the document, so none of them
 * create undo steps. They are called frequently (selection polling), so they
 * read as few DOM properties as possible.
 */
AFHost.query = (function () {
  var U = AFHost.util;
  var I = AFHost.items;
  var ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

  function capabilities() {
    var major = U.majorVersion();
    return {
      uuid: major >= 24,
      applyEffect: AFHost.caps.applyEffect && major >= 20,
      exportForScreens: major >= 22,
      gradientStopOpacity: AFHost.caps.gradientStopOpacity,
      undo: true
    };
  }

  function ping() {
    return {
      host: 'illustrator',
      version: String(app.version),
      hostScript: AFHost.VERSION,
      protocol: AFHost.PROTOCOL,
      capabilities: capabilities()
    };
  }

  function kindOf(item) {
    var t = item.typename;
    if (t === 'PathItem') {
      try {
        if (item.guides) {
          return 'guide';
        }
      } catch (e) {
        // ignore
      }
      return 'path';
    }
    if (t === 'CompoundPathItem') {
      return 'compound';
    }
    if (t === 'GroupItem') {
      try {
        if (item.clipped) {
          return 'clipGroup';
        }
      } catch (e2) {
        // ignore
      }
      return 'group';
    }
    if (t === 'TextFrame') {
      return 'text';
    }
    if (t === 'PlacedItem') {
      return 'placed';
    }
    if (t === 'RasterItem') {
      return 'raster';
    }
    if (t === 'SymbolItem') {
      return 'symbol';
    }
    if (t === 'MeshItem') {
      return 'mesh';
    }
    if (t === 'PluginItem') {
      return 'plugin';
    }
    return 'other';
  }

  // Illustrator reports geometricBounds of a clipping group as the bounds of ALL
  // its contents, including artwork hidden by the mask. The visible frame is the
  // clipping path, which is a direct child with `clipping == true` (for a
  // compound clipping path, its first sub-path carries the flag).
  function clipBounds(group) {
    var items = group.pageItems;
    var i;
    var it;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      try {
        if (it.typename === 'PathItem' && it.clipping) {
          return it.geometricBounds;
        }
        if (it.typename === 'CompoundPathItem' && it.pathItems.length > 0 && it.pathItems[0].clipping) {
          return it.geometricBounds;
        }
      } catch (e) {
        // keep looking
      }
    }
    return null;
  }

  function textInfo(tf) {
    var info = { kind: 'point', size: null, font: null, just: null, len: 0, ar: false };
    var c;
    var ca;
    try {
      if (tf.kind == TextType.AREATEXT) {
        info.kind = 'area';
      } else if (tf.kind == TextType.PATHTEXT) {
        info.kind = 'path';
      }
    } catch (e) {
      // ignore
    }
    try {
      c = tf.contents;
      info.len = c.length;
      info.ar = ARABIC.test(c);
    } catch (e2) {
      // ignore
    }
    try {
      ca = tf.textRange.characterAttributes;
      info.size = ca.size;
      info.font = ca.textFont.name;
    } catch (e3) {
      // mixed or missing font
    }
    try {
      info.just = String(tf.textRange.paragraphAttributes.justification);
    } catch (e4) {
      // ignore
    }
    return info;
  }

  function describe(item, index, uuidOk) {
    var d = { i: index, id: null, t: String(item.typename), k: kindOf(item), n: '', ly: '', top: false, gb: null, vb: null, hd: false, lk: false, fp: '' };
    var tags;
    var cb;
    if (uuidOk) {
      try {
        d.id = String(item.uuid);
      } catch (e) {
        d.id = null;
      }
    }
    try {
      d.n = String(item.name || '');
    } catch (e1) {
      d.n = '';
    }
    try {
      d.ly = String(item.layer.name);
    } catch (e2) {
      d.ly = '';
    }
    try {
      d.top = item.parent.typename === 'Layer';
    } catch (e3) {
      d.top = false;
    }
    d.gb = U.rect(item.geometricBounds);
    try {
      d.vb = U.rect(item.visibleBounds);
    } catch (e4) {
      d.vb = d.gb;
    }
    d.fp = U.fingerprint(item);
    if (d.k === 'clipGroup') {
      cb = clipBounds(item);
      d.cb = cb ? U.rect(cb) : null;
    }
    try {
      d.hd = !!item.hidden;
      d.lk = !!item.locked;
    } catch (e5) {
      // ignore
    }
    tags = I.readAfTags(item);
    if (tags) {
      d.tg = tags;
    }
    if (d.k === 'text') {
      d.tx = textInfo(item);
    }
    return d;
  }

  function layerInfo(layer) {
    return {
      n: String(layer.name),
      v: !!layer.visible,
      l: !!layer.locked,
      p: !!layer.printable,
      c: layer.pageItems.length,
      s: layer.layers.length
    };
  }

  function docInfo(doc) {
    var abs = [];
    var layers = [];
    var i;
    var ab;
    for (i = 0; i < doc.artboards.length; i++) {
      ab = doc.artboards[i];
      abs.push({ i: i, n: String(ab.name), r: U.rect(ab.artboardRect) });
    }
    for (i = 0; i < doc.layers.length; i++) {
      layers.push(layerInfo(doc.layers[i]));
    }
    return {
      name: String(doc.name),
      saved: !!doc.saved,
      cs: doc.documentColorSpace == DocumentColorSpace.CMYK ? 'CMYK' : 'RGB',
      abs: abs,
      ab: doc.artboards.getActiveArtboardIndex(),
      layers: layers
    };
  }

  // Cheap signature for the poller: changes when the document, artboards,
  // layers or selection (count / first items' bounds / tags) change.
  function signatureOf(doc, sel) {
    var parts = [String(doc.name), doc.artboards.length, doc.layers.length];
    var ai = doc.artboards.getActiveArtboardIndex();
    var i;
    var n;
    parts.push(ai + ':' + doc.artboards[ai].artboardRect.join(','));
    if (sel && sel.typename) {
      parts.push('T');
    } else if (sel) {
      parts.push(sel.length);
      n = Math.min(sel.length, 3);
      for (i = 0; i < n; i++) {
        try {
          parts.push(sel[i].typename + '@' + U.fingerprint(sel[i]) + '#' + sel[i].tags.length + '~' + sel[i].name);
        } catch (e) {
          parts.push('?');
        }
      }
    }
    return parts.join('|');
  }

  function signature() {
    if (!U.hasDoc()) {
      return 'nodoc';
    }
    var doc = app.activeDocument;
    return signatureOf(doc, doc.selection);
  }

  function snapshot(opts) {
    var max = opts && opts.maxItems ? opts.maxItems : 500;
    var out = { doc: null, sel: { mode: 'none', count: 0, truncated: false, items: [] }, sig: 'nodoc' };
    var doc;
    var sel;
    var i;
    var n;
    var uuidOk = capabilities().uuid;
    if (!U.hasDoc()) {
      return out;
    }
    doc = app.activeDocument;
    out.doc = docInfo(doc);
    sel = doc.selection;
    if (sel && sel.typename) {
      // With the Type tool active, `selection` is a TextRange, not an array.
      out.sel.mode = 'text-editing';
    } else if (sel && sel.length > 0) {
      out.sel.mode = 'items';
      out.sel.count = sel.length;
      n = Math.min(sel.length, max);
      for (i = 0; i < n; i++) {
        out.sel.items.push(describe(sel[i], i, uuidOk));
      }
      out.sel.truncated = sel.length > max;
    }
    out.sig = signatureOf(doc, sel);
    return out;
  }

  function layers() {
    var out = [];
    var doc;
    var i;
    if (!U.hasDoc()) {
      return out;
    }
    doc = app.activeDocument;
    for (i = 0; i < doc.layers.length; i++) {
      out.push(layerInfo(doc.layers[i]));
    }
    return out;
  }

  // Counts plugin-generated items. Only paths and groups can be generated
  // items, so only those collections are scanned; bounded by `limit`.
  function scanTagged(opts) {
    var limit = opts && opts.limit ? opts.limit : 20000;
    var out = { counts: {}, scanned: 0, truncated: false, previewLeftovers: 0 };
    var doc;
    var cols;
    var c;
    var i;
    var n;
    var it;
    var t;
    if (!U.hasDoc()) {
      return out;
    }
    doc = app.activeDocument;
    cols = [doc.groupItems, doc.pathItems];
    for (c = 0; c < cols.length; c++) {
      n = cols[c].length;
      for (i = 0; i < n; i++) {
        if (out.scanned >= limit) {
          out.truncated = true;
          return out;
        }
        it = cols[c][i];
        out.scanned++;
        try {
          if (it.tags.length === 0) {
            continue;
          }
        } catch (e) {
          continue;
        }
        t = I.tagValue(it, 'AF_type');
        if (!t) {
          continue;
        }
        if (I.tagValue(it, 'AF_preview') === '1') {
          out.previewLeftovers++;
          continue;
        }
        out.counts[t] = (out.counts[t] || 0) + 1;
      }
    }
    return out;
  }

  function findByAfId(opts) {
    if (!U.hasDoc()) {
      return null;
    }
    var doc = app.activeDocument;
    var near = null;
    var found;
    if (opts.near) {
      try {
        near = AFHost.ops.resolveStandalone(doc, opts.near);
      } catch (e) {
        near = null;
      }
    }
    found = I.findByAfId(doc, opts.id, near, opts.limit);
    return found ? describe(found, -1, capabilities().uuid) : null;
  }

  return {
    ping: ping,
    capabilities: capabilities,
    snapshot: snapshot,
    signature: signature,
    layers: layers,
    scanTagged: scanTagged,
    findByAfId: findByAfId,
    describe: describe
  };
}());
