/*
 * Op handlers. Each handler receives (ctx, op) and returns a small result
 * object. Every change pushes a compensating closure onto ctx.journal so a
 * failing batch can be rolled back; deletions are deferred to the end of the
 * batch (ctx.deferred) so nothing is destroyed unless every op succeeded.
 */
AFHost.ops = (function () {
  var U = AFHost.util;
  var I = AFHost.items;
  var H = {};

  // Ops allowed while previewing: purely additive, so a preview can always be
  // removed without touching the designer's own artwork.
  var PREVIEWABLE = {
    'layer.ensure': true,
    'group.create': true,
    'guides.lines': true,
    'shape.rect': true,
    'shape.ellipse': true,
    'item.tag': true,
    'item.appearance': true,
    'item.effect': true,
    'selection.set': true,
    // Creative ops (21-ops-creative.jsx). Those that modify an item only touch
    // items created by the same preview batch; anything else is skipped.
    'shape.path': true,
    'text.point': true,
    'text.area': true,
    'item.duplicate': true,
    'item.restyle': true,
    'item.transform': true,
    'item.rotate': true,
    'group.clip': true
  };

  // ---- reference resolution -------------------------------------------------

  function resolve(ctx, ref) {
    var it;
    if (!ref || !ref.k) {
      U.fail('BAD_OP', 'Missing reference');
    }
    if (ref.k === 'op') {
      it = ctx.produced[ref.i];
      if (!it) {
        U.fail('REF_NOT_FOUND', 'Op #' + ref.i + ' produced no item');
      }
      return it;
    }
    if (ref.k === 'uuid') {
      // Most refs point into the selection: index it once (one uuid read per
      // selected item) instead of a document-wide lookup per reference.
      if (!ctx.selUuid) {
        ctx.selUuid = {};
        for (var s = 0; s < ctx.selection.length; s++) {
          try {
            ctx.selUuid['u' + ctx.selection[s].uuid] = ctx.selection[s];
          } catch (e0) {
            // pre-2020 Illustrator: no uuid
          }
        }
      }
      it = ctx.selUuid['u' + ref.v] || null;
      if (!it) {
        try {
          it = ctx.doc.getPageItemFromUuid(ref.v);
        } catch (e) {
          it = null;
        }
      }
      if (!it) {
        U.fail('REF_NOT_FOUND', 'No item with uuid ' + ref.v);
      }
      return it;
    }
    if (ref.k === 'sel') {
      it = ctx.selection[ref.i];
      if (!it) {
        U.fail('SELECTION_CHANGED', 'Selection index ' + ref.i + ' is missing');
      }
      if (ref.fp && U.fingerprint(it) !== ref.fp) {
        U.fail('SELECTION_CHANGED', 'Selection item ' + ref.i + ' moved or changed');
      }
      return it;
    }
    if (ref.k === 'af') {
      it = I.findByAfId(ctx.doc, ref.id, ref.near ? tryResolve(ctx, ref.near) : null);
      if (!it) {
        U.fail('REF_NOT_FOUND', 'No item tagged AF_id=' + ref.id);
      }
      return it;
    }
    U.fail('BAD_OP', 'Unknown reference kind ' + ref.k);
    return null;
  }

  function tryResolve(ctx, ref) {
    try {
      return resolve(ctx, ref);
    } catch (e) {
      return null;
    }
  }

  // Resolve outside a batch (queries): uuid and af refs only.
  function resolveStandalone(doc, ref) {
    var sel = doc.selection;
    var ctx = { doc: doc, produced: [], selection: sel && !sel.typename ? sel : [] };
    return resolve(ctx, ref);
  }

  function layerOrFail(ctx, name) {
    var l = I.findLayer(ctx.doc, name);
    if (!l) {
      U.fail('LAYER_NOT_FOUND', 'Layer "' + name + '" not found');
    }
    return l;
  }

  function topLayerOf(item) {
    var cur = item;
    while (cur && cur.typename !== 'Layer') {
      cur = cur.parent;
    }
    return cur;
  }

  // Temporarily unlock/show a layer so items can be created in it; the original
  // state is restored when the batch ends (success or failure).
  function editable(ctx, layer) {
    var key;
    var entry;
    if (!layer || layer.typename !== 'Layer') {
      return;
    }
    key = layer.name;
    if (ctx.touchedLayers[key]) {
      return;
    }
    entry = { layer: layer, locked: layer.locked, visible: layer.visible };
    ctx.touchedLayers[key] = entry;
    if (layer.locked) {
      layer.locked = false;
    }
    if (!layer.visible) {
      layer.visible = true;
    }
  }

  function restoreLayers(ctx) {
    var k;
    var e;
    for (k in ctx.touchedLayers) {
      if (!ctx.touchedLayers.hasOwnProperty(k)) {
        continue;
      }
      e = ctx.touchedLayers[k];
      try {
        if (U.alive(e.layer)) {
          e.layer.visible = e.visible;
          e.layer.locked = e.locked;
        }
      } catch (err) {
        // ignore
      }
    }
  }

  function containerFor(ctx, into) {
    var ref;
    if (into.k === 'layer') {
      ref = layerOrFail(ctx, into.name);
      editable(ctx, ref);
      return ref;
    }
    ref = resolve(ctx, into.ref);
    if (into.k === 'inside') {
      if (ref.typename !== 'GroupItem') {
        U.fail('BAD_OP', 'Can only place items inside a group');
      }
      editable(ctx, topLayerOf(ref));
      return ref;
    }
    editable(ctx, topLayerOf(ref));
    return ref.parent;
  }

  // Position a freshly created item according to `into`.
  function position(ctx, item, into) {
    var ref;
    if (into.k === 'layer') {
      item.move(layerOrFail(ctx, into.name), into.at === 'bottom' ? ElementPlacement.PLACEATEND : ElementPlacement.PLACEATBEGINNING);
      return;
    }
    ref = resolve(ctx, into.ref);
    if (into.k === 'inside') {
      item.move(ref, into.at === 'bottom' ? ElementPlacement.PLACEATEND : ElementPlacement.PLACEATBEGINNING);
    } else if (into.k === 'below') {
      item.move(ref, ElementPlacement.PLACEAFTER);
    } else if (into.k === 'above' || into.k === 'replace') {
      item.move(ref, ElementPlacement.PLACEBEFORE);
    }
    if (into.k === 'replace') {
      // Hide now, delete when the whole batch has succeeded.
      ctx.journal.push(unhideFn(ref, ref.hidden));
      ref.hidden = true;
      ctx.deferred.push(ref);
    }
  }

  function unhideFn(item, wasHidden) {
    return function () {
      item.hidden = wasHidden;
    };
  }

  function removeFn(item) {
    return function () {
      if (U.alive(item)) {
        item.remove();
      }
    };
  }

  function produce(ctx, item) {
    var out = { name: String(item.name) };
    ctx.produced[ctx.opIndex] = item;
    ctx.created.push(item);
    try {
      out.uuid = String(item.uuid);
    } catch (e) {
      // pre-2020 Illustrator
    }
    try {
      out.bounds = U.rect(item.geometricBounds);
    } catch (e2) {
      // empty group
    }
    return { item: out };
  }

  function isCreated(ctx, item) {
    var i;
    for (i = 0; i < ctx.created.length; i++) {
      if (I.sameItem(ctx.created[i], item)) {
        return true;
      }
    }
    return false;
  }

  // ---- paint ---------------------------------------------------------------

  function gradientFor(ctx, fill) {
    var doc = ctx.doc;
    var g = null;
    try {
      g = doc.gradients.getByName(fill.name);
    } catch (e) {
      g = null;
    }
    if (g) {
      return g;
    }
    g = doc.gradients.add();
    g.name = fill.name;
    g.type = fill.t === 'radial' ? GradientType.RADIAL : GradientType.LINEAR;
    ctx.journal.push(removeFn(g));
    setStops(ctx, g, fill);
    return g;
  }

  function setStops(ctx, g, fill) {
    var stops = fill.stops;
    var i;
    var s;
    var st;
    var opacityOk = AFHost.caps.gradientStopOpacity;
    while (g.gradientStops.length < stops.length) {
      g.gradientStops.add();
    }
    for (i = 0; i < stops.length; i++) {
      s = g.gradientStops[i];
      st = stops[i];
      s.rampPoint = st.p;
      s.midPoint = st.m || 50;
      if (opacityOk) {
        try {
          s.color = U.color(ctx.doc, st.c);
          s.opacity = st.o;
        } catch (e) {
          opacityOk = false;
          AFHost.caps.gradientStopOpacity = false;
        }
      }
      if (!opacityOk) {
        s.color = U.color(ctx.doc, fill.fallback === 'fadeToWhiteMultiply' ? U.mixWhite(st.c, st.o) : st.c);
      }
    }
    if (!opacityOk) {
      ctx.warnings.push('Gradient stop opacity is not available; a fade-to-white falloff was used (keep the Multiply blend mode).');
    }
  }

  function paintColor(ctx, fill) {
    var gc;
    if (fill.t === 'solid') {
      return U.color(ctx.doc, fill.c);
    }
    gc = new GradientColor();
    gc.gradient = gradientFor(ctx, fill);
    return gc;
  }

  // `target` receives the paint (for a compound path: its first sub-path);
  // `item` is the object whose bounds the gradient is fitted to.
  function applyFill(ctx, item, fill, target) {
    var t = target || item;
    if (!fill || fill.t === 'none') {
      t.filled = false;
      return;
    }
    t.filled = true;
    t.fillColor = paintColor(ctx, fill);
  }

  // GradientColor.angle cannot be set from a script (long-standing Illustrator
  // bug), so the gradient alone is rotated with rotate(..., changePositions =
  // false, ..., changeFillGradients = true) and then scaled so it spans the
  // object along the new direction. Radial fills with fit = 'ellipse' are
  // scaled the same way to get an elliptical falloff.
  function fitGradient(item, fill) {
    var b;
    var w;
    var h;
    var a;
    var k;
    if (!fill || (fill.t !== 'linear' && fill.t !== 'radial')) {
      return;
    }
    b = item.geometricBounds;
    w = b[2] - b[0];
    h = b[1] - b[3];
    if (w <= 0.001 || h <= 0.001) {
      return;
    }
    if (fill.t === 'linear' && fill.angle) {
      a = (fill.angle * Math.PI) / 180;
      k = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / w;
      item.rotate(fill.angle, false, false, true, false, Transformation.CENTER);
      if (Math.abs(k - 1) > 0.001) {
        item.resize(k * 100, k * 100, false, false, true, false, 100, Transformation.CENTER);
      }
    } else if (fill.t === 'radial' && fill.fit === 'ellipse' && Math.abs(h - w) > 0.001) {
      item.resize(100, (h / w) * 100, false, false, true, false, 100, Transformation.CENTER);
    }
  }

  function applyStroke(ctx, t, stroke) {
    if (stroke) {
      t.stroked = true;
      t.strokeColor = U.color(ctx.doc, stroke.c);
      t.strokeWidth = stroke.w;
    } else {
      t.stroked = false;
    }
  }

  function applyStyle(ctx, item, op, skipFit) {
    applyFill(ctx, item, op.fill);
    applyStroke(ctx, item, op.stroke);
    if (!skipFit) {
      fitGradient(item, op.fill);
    }
    finishItem(ctx, item, op);
  }

  function finishItem(ctx, item, op) {
    if (typeof op.opacity === 'number') {
      item.opacity = op.opacity;
    }
    if (op.blend) {
      item.blendingMode = U.blend(op.blend);
    }
    if (op.name) {
      item.name = ctx.preview ? AFHost.PREVIEW_PREFIX + ' \u2014 ' + op.name : op.name;
    }
    if (op.tags) {
      I.writeTags(item, op.tags, null);
    }
    if (ctx.preview) {
      I.writeTags(item, { AF_preview: '1' }, null);
    }
  }

  // ---- handlers --------------------------------------------------------------

  H['doc.create'] = function (ctx, op) {
    var cs = op.colorSpace === 'CMYK' ? DocumentColorSpace.CMYK : DocumentColorSpace.RGB;
    var doc = app.documents.add(cs, op.w, op.h);
    ctx.journal.push(function () {
      doc.close(SaveOptions.DONOTSAVECHANGES);
    });
    ctx.doc = doc;
    ctx.selection = [];
    ctx.activeLayer = null;
    if (op.artboardName) {
      doc.artboards[0].name = op.artboardName;
    }
    return { artboard: 0 };
  };

  H['layer.ensure'] = function (ctx, op) {
    var doc = ctx.doc;
    var layer = I.findLayer(doc, op.name);
    var anchor;
    if (!layer) {
      layer = doc.layers.add();
      layer.name = op.name;
      ctx.journal.push(removeFn(layer));
      ctx.createdLayers.push(layer);
      if (op.anchor === 'bottom') {
        layer.zOrder(ZOrderMethod.SENDTOBACK);
      } else if (op.anchor && op.anchor.name) {
        anchor = layerOrFail(ctx, op.anchor.name);
        layer.move(anchor, op.anchor.place === 'below' ? ElementPlacement.PLACEAFTER : ElementPlacement.PLACEBEFORE);
      } else {
        layer.zOrder(ZOrderMethod.BRINGTOFRONT);
      }
    }
    setLayerProps(ctx, layer, op);
    return { layer: String(layer.name) };
  };

  function setLayerProps(ctx, layer, op) {
    var keys = ['printable', 'visible', 'locked'];
    var i;
    var k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (typeof op[k] === 'boolean' && layer[k] !== op[k]) {
        ctx.journal.push(restorePropFn(layer, k, layer[k]));
        if (ctx.touchedLayers[layer.name] && (k === 'locked' || k === 'visible')) {
          // An explicit request wins over the temporary unlock/show.
          ctx.touchedLayers[layer.name][k] = op[k];
        } else {
          layer[k] = op[k];
        }
      }
    }
  }

  function restorePropFn(obj, key, value) {
    return function () {
      obj[key] = value;
    };
  }

  H['layer.rename'] = function (ctx, op) {
    var layer = layerOrFail(ctx, op.from);
    if (I.findLayer(ctx.doc, op.to)) {
      U.fail('BAD_OP', 'A layer named "' + op.to + '" already exists');
    }
    ctx.journal.push(restorePropFn(layer, 'name', layer.name));
    layer.name = op.to;
    return { layer: String(op.to) };
  };

  H['layer.move'] = function (ctx, op) {
    var layer = layerOrFail(ctx, op.name);
    var doc = ctx.doc;
    var i;
    var above = null;
    for (i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === layer.name) {
        above = i > 0 ? doc.layers[i - 1] : null;
        break;
      }
    }
    ctx.journal.push(function () {
      if (above) {
        layer.move(above, ElementPlacement.PLACEAFTER);
      } else {
        layer.zOrder(ZOrderMethod.BRINGTOFRONT);
      }
    });
    if (op.anchor === 'top') {
      layer.zOrder(ZOrderMethod.BRINGTOFRONT);
    } else if (op.anchor === 'bottom') {
      layer.zOrder(ZOrderMethod.SENDTOBACK);
    } else {
      layer.move(layerOrFail(ctx, op.anchor.name), op.anchor.place === 'below' ? ElementPlacement.PLACEAFTER : ElementPlacement.PLACEBEFORE);
    }
    return { layer: String(layer.name) };
  };

  H['layer.props'] = function (ctx, op) {
    var layer = layerOrFail(ctx, op.name);
    setLayerProps(ctx, layer, op);
    return { layer: String(layer.name) };
  };

  H['group.create'] = function (ctx, op) {
    var c = containerFor(ctx, op.into);
    var g = c.groupItems.add();
    ctx.journal.push(removeFn(g));
    position(ctx, g, op.into);
    finishItem(ctx, g, op);
    return produce(ctx, g);
  };

  H['guides.lines'] = function (ctx, op) {
    var c = containerFor(ctx, op.into);
    var i;
    var l;
    var p;
    for (i = 0; i < op.lines.length; i++) {
      l = op.lines[i];
      p = c.pathItems.add();
      p.setEntirePath([[l[0], -l[1]], [l[2], -l[3]]]);
      p.filled = false;
      p.stroked = false;
      p.guides = true;
      if (!isCreated(ctx, c)) {
        // Guides inside a group created by this batch go away with the group.
        ctx.journal.push(removeFn(p));
      }
    }
    return { count: op.lines.length };
  };

  H['shape.rect'] = function (ctx, op) {
    var c = containerFor(ctx, op.into);
    var item = op.radius && op.radius > 0
      ? c.pathItems.roundedRectangle(-op.y, op.x, op.w, op.h, op.radius, op.radius)
      : c.pathItems.rectangle(-op.y, op.x, op.w, op.h);
    ctx.journal.push(removeFn(item));
    position(ctx, item, op.into);
    applyStyle(ctx, item, op);
    if (op.guide) {
      item.guides = true;
    }
    return produce(ctx, item);
  };

  H['shape.ellipse'] = function (ctx, op) {
    var c = containerFor(ctx, op.into);
    var radial = op.fill && op.fill.t === 'radial';
    // Radial fills: draw a circle, fill it, then scale it vertically with
    // "transform gradients" on - this makes the falloff elliptical instead of
    // a circle clipped by the ellipse (see src/effects/shadow-engine.ts).
    var h0 = radial ? op.w : op.h;
    var item = c.pathItems.ellipse(-(op.cy - h0 / 2), op.cx - op.w / 2, op.w, h0);
    ctx.journal.push(removeFn(item));
    position(ctx, item, op.into);
    applyStyle(ctx, item, op, radial);
    if (radial && Math.abs(op.h - op.w) > 0.001) {
      item.resize(100, (op.h / op.w) * 100, true, true, true, true, 100, Transformation.CENTER);
    }
    if (op.rotation) {
      item.rotate(op.rotation, true, true, true, true, Transformation.CENTER);
    }
    return produce(ctx, item);
  };

  H['item.translate'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    item.translate(op.dx, -op.dy);
    ctx.journal.push(function () {
      item.translate(-op.dx, op.dy);
    });
    return {};
  };

  // Remember where an existing item sits so a failed batch can put it back.
  function rememberSlot(ctx, item) {
    var parent = item.parent;
    var idx = I.indexInParent(item);
    var above = idx > 0 ? parent.pageItems[idx - 1] : null;
    ctx.journal.push(function () {
      if (above && U.alive(above)) {
        item.move(above, ElementPlacement.PLACEAFTER);
      } else {
        item.move(parent, ElementPlacement.PLACEATBEGINNING);
      }
    });
  }

  function restoreOrderFn(entries) {
    var saved = [];
    var e;
    var kids;
    var list;
    var i;
    for (e = 0; e < entries.length; e++) {
      kids = entries[e].parent.pageItems;
      list = [];
      for (i = 0; i < kids.length; i++) {
        list.push(kids[i]);
      }
      saved.push({ parent: entries[e].parent, kids: list });
    }
    return function () {
      var s2;
      var k;
      for (s2 = 0; s2 < saved.length; s2++) {
        for (k = saved[s2].kids.length - 1; k >= 0; k--) {
          if (U.alive(saved[s2].kids[k])) {
            saved[s2].kids[k].move(saved[s2].parent, ElementPlacement.PLACEATBEGINNING);
          }
        }
      }
    };
  }

  H['item.place'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    rememberSlot(ctx, item);
    if (op.to.k === 'layer') {
      editable(ctx, layerOrFail(ctx, op.to.name));
    }
    position(ctx, item, op.to);
    return {};
  };

  H['items.toLayer'] = function (ctx, op) {
    var layer = layerOrFail(ctx, op.layer);
    var index = new I.StackIndex(ctx.doc);
    var items = [];
    var linked = [];
    var i;
    var j;
    var k;
    var it;
    var placement = op.at === 'bottom' ? ElementPlacement.PLACEATEND : ElementPlacement.PLACEATBEGINNING;
    editable(ctx, layer);
    for (i = 0; i < op.refs.length; i++) {
      items.push(resolve(ctx, op.refs[i]));
    }
    // Everything is measured before anything moves.
    items = index.sort(items);
    for (i = 0; i < items.length; i++) {
      linked.push(op.withLinked ? index.linked(items[i]) : []);
    }
    // Rollback: one snapshot of each affected parent's child order (O(N)),
    // rather than a neighbour search per moved item (O(N^2)).
    ctx.journal.push(restoreOrderFn(index.entries));
    // Moving to the top: move the back-most first so the original order is kept.
    for (j = 0; j < items.length; j++) {
      k = op.at === 'bottom' ? j : items.length - 1 - j;
      it = items[k];
      it.move(layer, placement);
      for (i = 0; i < linked[k].length; i++) {
        linked[k][i].move(it, ElementPlacement.PLACEAFTER);
      }
    }
    return { count: items.length };
  };

  H['item.remove'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    if (op.requireTag && !I.tagValue(item, 'AF_type')) {
      U.fail('NOT_TAGGED', 'Item "' + item.name + '" was not created by Artboard Forge');
    }
    ctx.deferred.push(item);
    return {};
  };

  H['item.rename'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    ctx.journal.push(restorePropFn(item, 'name', item.name));
    item.name = op.name;
    return {};
  };

  H['item.tag'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    if (ctx.preview && !isCreated(ctx, item)) {
      return { skipped: 'preview' };
    }
    I.writeTags(item, op.tags, isCreated(ctx, item) ? null : ctx.journal);
    return {};
  };

  H['item.appearance'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    if (ctx.preview && !isCreated(ctx, item)) {
      return { skipped: 'preview' };
    }
    if (typeof op.opacity === 'number') {
      ctx.journal.push(restorePropFn(item, 'opacity', item.opacity));
      item.opacity = op.opacity;
    }
    if (op.blend) {
      ctx.journal.push(restorePropFn(item, 'blendingMode', item.blendingMode));
      item.blendingMode = U.blend(op.blend);
    }
    return {};
  };

  // Live effects use PageItem.applyEffect(xml): present in the object model but
  // with undocumented XML. Optional effects degrade to a warning.
  H['item.effect'] = function (ctx, op) {
    var item = resolve(ctx, op.ref);
    try {
      item.applyEffect(op.xml);
    } catch (e) {
      AFHost.caps.applyEffect = false;
      if (!op.optional) {
        U.fail('UNSUPPORTED', 'Live effect could not be applied: ' + e.message);
      }
      ctx.warnings.push('Live effect skipped (not supported by this Illustrator version).');
      return { skipped: 'unsupported' };
    }
    return {};
  };

  H['artboard.add'] = function (ctx, op) {
    var doc = ctx.doc;
    var prev = doc.artboards.getActiveArtboardIndex();
    var ab;
    var idx;
    try {
      ab = doc.artboards.add(U.aiRect(op.x, op.y, op.w, op.h));
    } catch (e) {
      U.fail('HOST_EXCEPTION', 'Illustrator refused the artboard (it may fall outside the canvas): ' + e.message);
    }
    ab.name = op.name;
    idx = doc.artboards.length - 1;
    ctx.journal.push(function () {
      doc.artboards.setActiveArtboardIndex(prev);
      doc.artboards.remove(idx);
    });
    doc.artboards.setActiveArtboardIndex(idx);
    return { artboard: idx };
  };

  H['artboard.update'] = function (ctx, op) {
    var ab = ctx.doc.artboards[op.index];
    var oldRect;
    var oldName;
    if (!ab) {
      U.fail('BAD_OP', 'No artboard #' + op.index);
    }
    oldRect = ab.artboardRect;
    oldName = ab.name;
    ctx.journal.push(function () {
      ab.artboardRect = oldRect;
      ab.name = oldName;
    });
    if (typeof op.w === 'number') {
      ab.artboardRect = U.aiRect(op.x, op.y, op.w, op.h);
    }
    if (op.name) {
      ab.name = op.name;
    }
    return { artboard: op.index };
  };

  H['artboard.activate'] = function (ctx, op) {
    var abs = ctx.doc.artboards;
    var prev = abs.getActiveArtboardIndex();
    ctx.journal.push(function () {
      abs.setActiveArtboardIndex(prev);
    });
    abs.setActiveArtboardIndex(op.index);
    return { artboard: op.index };
  };

  H['selection.set'] = function (ctx, op) {
    var list = [];
    var i;
    var it;
    for (i = 0; i < op.refs.length; i++) {
      it = tryResolve(ctx, op.refs[i]);
      if (it) {
        list.push(it);
      }
    }
    ctx.explicitSelection = list;
    return { count: list.length };
  };

  function inScope(item, rect) {
    var b = item.geometricBounds;
    var cx = (b[0] + b[2]) / 2;
    var cy = (b[1] + b[3]) / 2;
    return cx >= rect[0] && cx <= rect[2] && cy <= rect[1] && cy >= rect[3];
  }

  H['af.removeTagged'] = function (ctx, op) {
    var doc = ctx.doc;
    var wanted = {};
    var onlyGroups = true;
    var i;
    var t;
    var it;
    var col;
    var n;
    var count = 0;
    var rect = null;
    for (i = 0; i < op.types.length; i++) {
      wanted[op.types[i]] = true;
      if (op.types[i] !== 'grid' && op.types[i] !== 'guides') {
        onlyGroups = false;
      }
    }
    if (op.scope && typeof op.scope.artboard === 'number') {
      rect = doc.artboards[op.scope.artboard].artboardRect;
    }
    // Grids and guide sets are always groups; scanning groups only is much cheaper.
    col = onlyGroups ? doc.groupItems : doc.pageItems;
    n = col.length;
    for (i = 0; i < n; i++) {
      it = col[i];
      try {
        if (it.tags.length === 0) {
          continue;
        }
      } catch (e) {
        continue;
      }
      t = I.tagValue(it, 'AF_type');
      if (t && wanted[t] && (!rect || inScope(it, rect))) {
        editable(ctx, topLayerOf(it));
        ctx.deferred.push(it);
        count++;
      }
    }
    return { count: count };
  };

  // Internals shared with 21-ops-creative.jsx.
  var lib = {
    resolve: resolve,
    containerFor: containerFor,
    position: position,
    editable: editable,
    topLayerOf: topLayerOf,
    produce: produce,
    isCreated: isCreated,
    removeFn: removeFn,
    restorePropFn: restorePropFn,
    paintColor: paintColor,
    applyFill: applyFill,
    applyStroke: applyStroke,
    fitGradient: fitGradient,
    finishItem: finishItem
  };

  return { handlers: H, lib: lib, resolve: resolve, resolveStandalone: resolveStandalone, restoreLayers: restoreLayers, PREVIEWABLE: PREVIEWABLE };
}());
