/*
 * Creative ops: bezier paths, text, duplicate, restyle, transform, rotate,
 * clipping groups and swatch groups.
 *
 * Same rules as 20-ops.jsx: items created by the batch are removed on
 * rollback; changes to existing artwork push a compensating closure onto
 * ctx.journal. Transform, rotate and clip only work on items created by the
 * same batch (duplicates included), so the designer's own artwork is never
 * moved or masked by them.
 */
(function () {
  var U = AFHost.util;
  var I = AFHost.items;
  var O = AFHost.ops;
  var L = O.lib;
  var H = O.handlers;

  var PIVOT = {
    center: 'CENTER',
    left: 'LEFT',
    right: 'RIGHT',
    top: 'TOP',
    bottom: 'BOTTOM',
    topLeft: 'TOPLEFT',
    topRight: 'TOPRIGHT',
    bottomLeft: 'BOTTOMLEFT',
    bottomRight: 'BOTTOMRIGHT'
  };

  function warnOnce(ctx, key, message) {
    if (!ctx.once) {
      ctx.once = {};
    }
    if (!ctx.once[key]) {
      ctx.once[key] = true;
      ctx.warnings.push(message);
    }
  }

  function onlyCreated(ctx, item, what) {
    if (!L.isCreated(ctx, item)) {
      U.fail('BAD_OP', what + ' is only allowed on objects created by the same command');
    }
  }

  // ---- paths -----------------------------------------------------------------

  function cornerOnly(pts) {
    var i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].length >= 6) {
        return false;
      }
    }
    return true;
  }

  // Handles on a straight line through the anchor, pointing in opposite
  // directions -> smooth point; anything else is a corner.
  function smoothHandles(q) {
    var ix = q[2] - q[0];
    var iy = q[3] - q[1];
    var ox = q[4] - q[0];
    var oy = q[5] - q[1];
    var li = Math.sqrt(ix * ix + iy * iy);
    var lo = Math.sqrt(ox * ox + oy * oy);
    if (li < 0.001 || lo < 0.001) {
      return false;
    }
    return Math.abs(ix * oy - iy * ox) / (li * lo) < 0.01 && ix * ox + iy * oy < 0;
  }

  // Point format: [x, y] or [x, y, inX, inY, outX, outY] (design space).
  function buildPath(p, sp) {
    var pts = sp.pts;
    var list;
    var i;
    var q;
    var pp;
    var a;
    if (cornerOnly(pts)) {
      list = [];
      for (i = 0; i < pts.length; i++) {
        list.push([pts[i][0], -pts[i][1]]);
      }
      p.setEntirePath(list);
    } else {
      for (i = 0; i < pts.length; i++) {
        q = pts[i];
        a = [q[0], -q[1]];
        pp = p.pathPoints.add();
        pp.anchor = a;
        if (q.length >= 6) {
          pp.leftDirection = [q[2], -q[3]];
          pp.rightDirection = [q[4], -q[5]];
          pp.pointType = smoothHandles(q) ? PointType.SMOOTH : PointType.CORNER;
        } else {
          pp.leftDirection = a;
          pp.rightDirection = a;
          pp.pointType = PointType.CORNER;
        }
      }
    }
    p.closed = !!sp.closed;
  }

  H['shape.path'] = function (ctx, op) {
    var c = L.containerFor(ctx, op.into);
    var item;
    var first;
    var subs;
    var i;
    if (!op.paths || op.paths.length === 0) {
      U.fail('BAD_OP', 'shape.path needs at least one path');
    }
    if (op.paths.length === 1) {
      item = c.pathItems.add();
      ctx.journal.push(L.removeFn(item));
      buildPath(item, op.paths[0]);
      first = item;
    } else {
      item = c.compoundPathItems.add();
      ctx.journal.push(L.removeFn(item));
      for (i = 0; i < op.paths.length; i++) {
        buildPath(item.pathItems.add(), op.paths[i]);
      }
      // Holes: even-odd keeps inner contours empty whatever their direction.
      subs = item.pathItems;
      for (i = 0; i < subs.length; i++) {
        try {
          subs[i].evenodd = true;
        } catch (e) {
          // property missing in very old versions: direction decides
        }
      }
      // A compound path is painted through its first sub-path.
      first = subs[0];
    }
    L.position(ctx, item, op.into);
    L.applyFill(ctx, item, op.fill, first);
    L.applyStroke(ctx, first, op.stroke);
    L.fitGradient(item, op.fill);
    L.finishItem(ctx, item, op);
    return L.produce(ctx, item);
  };

  // ---- text ------------------------------------------------------------------

  function pickFont(ctx, fonts) {
    var key;
    var i;
    var f;
    if (!fonts || fonts.length === 0) {
      return null;
    }
    if (!ctx.fontCache) {
      ctx.fontCache = {};
    }
    key = fonts.join('|');
    if (ctx.fontCache.hasOwnProperty(key)) {
      return ctx.fontCache[key];
    }
    f = null;
    for (i = 0; i < fonts.length && !f; i++) {
      try {
        f = app.textFonts.getByName(fonts[i]);
      } catch (e) {
        f = null;
      }
    }
    ctx.fontCache[key] = f;
    return f;
  }

  var JUST = { left: 'LEFT', center: 'CENTER', right: 'RIGHT' };

  function styleText(ctx, tf, op) {
    var range = tf.textRange;
    var ca = range.characterAttributes;
    var pa = range.paragraphAttributes;
    var font;
    ca.size = op.size;
    ca.fillColor = U.color(ctx.doc, op.color);
    if (op.fonts && op.fonts.length) {
      font = pickFont(ctx, op.fonts);
      if (font) {
        ca.textFont = font;
      } else {
        warnOnce(ctx, 'font:' + op.fonts[0], 'Font not installed (' + op.fonts.join(', ') + '); Illustrator used its default font.');
      }
    }
    if (typeof op.leading === 'number') {
      ca.autoLeading = false;
      ca.leading = op.leading;
    }
    if (typeof op.tracking === 'number') {
      ca.tracking = op.tracking;
    }
    pa.justification = Justification[JUST[op.align] || 'LEFT'];
    if (op.rtl) {
      try {
        pa.paragraphDirection = ParagraphDirectionType.RIGHT_TO_LEFT_DIRECTION;
        pa.composerEngine = ComposerEngineType.optycaComposer;
      } catch (e) {
        warnOnce(ctx, 'rtl', 'Right-to-left paragraph settings are not available here; set the direction in the Paragraph panel (Middle Eastern features).');
      }
    }
  }

  function textContents(s) {
    // Illustrator separates paragraphs with \r.
    return String(s).replace(/\r\n|\n/g, '\r');
  }

  H['text.point'] = function (ctx, op) {
    var c = L.containerFor(ctx, op.into);
    var tf = c.textFrames.pointText([op.x, -op.y]);
    ctx.journal.push(L.removeFn(tf));
    tf.contents = textContents(op.contents);
    styleText(ctx, tf, op);
    L.position(ctx, tf, op.into);
    L.finishItem(ctx, tf, op);
    return L.produce(ctx, tf);
  };

  H['text.area'] = function (ctx, op) {
    var c = L.containerFor(ctx, op.into);
    var box = c.pathItems.rectangle(-op.y, op.x, op.w, op.h);
    var tf;
    ctx.journal.push(L.removeFn(box));
    tf = c.textFrames.areaText(box);
    ctx.journal.push(L.removeFn(tf));
    tf.contents = textContents(op.contents);
    styleText(ctx, tf, op);
    L.position(ctx, tf, op.into);
    L.finishItem(ctx, tf, op);
    return L.produce(ctx, tf);
  };

  // ---- duplicate -------------------------------------------------------------

  // AF tags copied from the source would duplicate its AF_id (and make the copy
  // look like a subject or a generated effect). Bounded walk.
  function stripAfTags(item, budget) {
    var tags;
    var kids;
    var i;
    if (budget.n <= 0) {
      return;
    }
    budget.n--;
    try {
      tags = item.tags;
      for (i = tags.length - 1; i >= 0; i--) {
        if (String(tags[i].name).indexOf('AF_') === 0) {
          tags[i].remove();
        }
      }
    } catch (e) {
      // items without tags
    }
    if (item.typename === 'GroupItem') {
      kids = item.pageItems;
      for (i = 0; i < kids.length; i++) {
        stripAfTags(kids[i], budget);
      }
    }
  }

  H['item.duplicate'] = function (ctx, op) {
    var src = L.resolve(ctx, op.ref);
    var to = op.to;
    var rel;
    var dup;
    L.containerFor(ctx, to);
    if (to.k === 'layer') {
      rel = I.findLayer(ctx.doc, to.name);
      dup = src.duplicate(rel, to.at === 'bottom' ? ElementPlacement.PLACEATEND : ElementPlacement.PLACEATBEGINNING);
    } else {
      rel = L.resolve(ctx, to.ref);
      if (to.k === 'inside') {
        dup = src.duplicate(rel, to.at === 'bottom' ? ElementPlacement.PLACEATEND : ElementPlacement.PLACEATBEGINNING);
      } else if (to.k === 'below') {
        dup = src.duplicate(rel, ElementPlacement.PLACEAFTER);
      } else if (to.k === 'above') {
        dup = src.duplicate(rel, ElementPlacement.PLACEBEFORE);
      } else {
        U.fail('BAD_OP', 'A duplicate cannot replace another item');
      }
    }
    ctx.journal.push(L.removeFn(dup));
    stripAfTags(dup, { n: 2000 });
    try {
      dup.hidden = false;
      dup.locked = false;
    } catch (e) {
      // ignore
    }
    L.finishItem(ctx, dup, { name: op.name, tags: op.tags });
    return L.produce(ctx, dup);
  };

  // ---- restyle ---------------------------------------------------------------

  function restoreStyleFn(p) {
    var s = { filled: p.filled, stroked: p.stroked, fill: null, stroke: null, width: 0 };
    try {
      s.fill = p.fillColor;
      s.stroke = p.strokeColor;
      s.width = p.strokeWidth;
    } catch (e) {
      // ignore
    }
    return function () {
      p.filled = s.filled;
      if (s.filled && s.fill) {
        p.fillColor = s.fill;
      }
      p.stroked = s.stroked;
      if (s.stroked && s.stroke) {
        p.strokeColor = s.stroke;
        p.strokeWidth = s.width;
      }
    };
  }

  // `fitItem` is the object the gradient is fitted to (compound path or path).
  function restylePath(ctx, p, fitItem, op, journal) {
    if (journal) {
      journal.push(restoreStyleFn(p));
    }
    if (op.fill) {
      L.applyFill(ctx, fitItem, op.fill, p);
    }
    if (op.stroke === null) {
      p.stroked = false;
    } else if (op.stroke) {
      L.applyStroke(ctx, p, op.stroke);
    }
    if (op.fill) {
      L.fitGradient(fitItem, op.fill);
    }
  }

  function firstStop(fill) {
    return fill.t === 'solid' ? fill.c : fill.stops[0].c;
  }

  function restyleText(ctx, tf, op, journal) {
    var ca = tf.textRange.characterAttributes;
    var oldFill = null;
    var oldStroke = null;
    var oldWeight = 0;
    try {
      oldFill = ca.fillColor;
      oldStroke = ca.strokeColor;
      oldWeight = ca.strokeWeight;
    } catch (e) {
      // mixed attributes
    }
    if (journal) {
      journal.push(function () {
        if (oldFill) {
          ca.fillColor = oldFill;
        }
        if (oldStroke) {
          ca.strokeColor = oldStroke;
          ca.strokeWeight = oldWeight;
        }
      });
    }
    if (op.fill && op.fill.t !== 'none') {
      ca.fillColor = U.color(ctx.doc, firstStop(op.fill));
    }
    if (op.stroke === null) {
      ca.strokeColor = new NoColor();
    } else if (op.stroke) {
      ca.strokeColor = U.color(ctx.doc, op.stroke.c);
      ca.strokeWeight = op.stroke.w;
    }
  }

  function restyleItem(ctx, it, op, journal, budget) {
    var t;
    var kids;
    var i;
    if (budget.n <= 0) {
      budget.truncated = true;
      return;
    }
    t = it.typename;
    if (t === 'GroupItem') {
      if (!op.recursive) {
        return;
      }
      kids = it.pageItems;
      for (i = 0; i < kids.length; i++) {
        restyleItem(ctx, kids[i], op, journal, budget);
      }
    } else if (t === 'CompoundPathItem') {
      if (it.pathItems.length > 0) {
        budget.n--;
        restylePath(ctx, it.pathItems[0], it, op, journal);
      }
    } else if (t === 'PathItem') {
      if (it.guides || it.clipping) {
        return;
      }
      budget.n--;
      restylePath(ctx, it, it, op, journal);
    } else if (t === 'TextFrame') {
      budget.n--;
      restyleText(ctx, it, op, journal);
    } else {
      budget.skipped++;
    }
  }

  H['item.restyle'] = function (ctx, op) {
    var item = L.resolve(ctx, op.ref);
    var created = L.isCreated(ctx, item);
    var journal = created ? null : ctx.journal;
    var budget = { n: 5000, skipped: 0, truncated: false };
    if (ctx.preview && !created) {
      return { skipped: 'preview' };
    }
    if (!created) {
      L.editable(ctx, L.topLayerOf(item));
    }
    restyleItem(ctx, item, op, journal, budget);
    if (typeof op.opacity === 'number') {
      if (journal) {
        journal.push(L.restorePropFn(item, 'opacity', item.opacity));
      }
      item.opacity = op.opacity;
    }
    if (op.blend) {
      if (journal) {
        journal.push(L.restorePropFn(item, 'blendingMode', item.blendingMode));
      }
      item.blendingMode = U.blend(op.blend);
    }
    if (budget.skipped > 0) {
      warnOnce(ctx, 'restyle-skip', budget.skipped + ' image(s) or special object(s) kept their original colours.');
    }
    if (budget.truncated) {
      warnOnce(ctx, 'restyle-cap', 'Only the first 5000 objects were recoloured.');
    }
    return { count: 5000 - budget.n };
  };

  // ---- transforms ------------------------------------------------------------

  // op.m is a design-space affine (Y down): x' = a x + c y + tx, y' = b x + d y + ty.
  // In Illustrator's Y-up space that is A = [[a, -c], [-b, d]], t = (tx, -ty).
  // The linear part is applied about the centre, then the centre is moved to
  // where the full affine sends it (exact for any pivot Illustrator uses as long
  // as it is the centre of the geometric bounds).
  H['item.transform'] = function (ctx, op) {
    var item = L.resolve(ctx, op.ref);
    var m = op.m;
    var b;
    var cx;
    var cy;
    var mm;
    onlyCreated(ctx, item, 'Transform');
    b = item.geometricBounds;
    cx = (b[0] + b[2]) / 2;
    cy = (b[1] + b[3]) / 2;
    mm = app.getIdentityMatrix();
    mm.mValueA = m[0];
    mm.mValueB = -m[1];
    mm.mValueC = -m[2];
    mm.mValueD = m[3];
    mm.mValueTX = 0;
    mm.mValueTY = 0;
    item.transform(mm, true, true, !!op.gradients, true, 100, Transformation.CENTER);
    item.translate(m[0] * cx - m[2] * cy + m[4] - cx, -m[1] * cx + m[3] * cy - m[5] - cy);
    return {};
  };

  H['item.rotate'] = function (ctx, op) {
    var item = L.resolve(ctx, op.ref);
    onlyCreated(ctx, item, 'Rotate');
    item.rotate(op.angle, true, true, !!op.gradients, true, Transformation[PIVOT[op.about] || 'CENTER']);
    return {};
  };

  // ---- clipping groups -------------------------------------------------------

  H['group.clip'] = function (ctx, op) {
    var g = L.resolve(ctx, op.ref);
    var top;
    onlyCreated(ctx, g, 'Clipping');
    if (g.typename !== 'GroupItem' || g.pageItems.length < 2) {
      U.fail('BAD_OP', 'A clipping group needs a group with a mask and content');
    }
    top = g.pageItems[0];
    if (top.typename === 'PathItem') {
      top.clipping = true;
    } else if (top.typename === 'CompoundPathItem') {
      top.pathItems[0].clipping = true;
    } else {
      U.fail('BAD_OP', 'The top item of a clipping group must be a path');
    }
    g.clipped = true;
    return {};
  };

  // ---- swatches --------------------------------------------------------------

  function hasSwatch(doc, name) {
    try {
      return !!doc.swatches.getByName(name);
    } catch (e) {
      return false;
    }
  }

  H['swatch.group'] = function (ctx, op) {
    var doc = ctx.doc;
    var sg = null;
    var sw;
    var i;
    var n = 0;
    try {
      sg = doc.swatchGroups.getByName(op.name);
    } catch (e) {
      sg = null;
    }
    if (!sg) {
      sg = doc.swatchGroups.add();
      sg.name = op.name;
      ctx.journal.push(L.removeFn(sg));
    }
    for (i = 0; i < op.colors.length; i++) {
      if (hasSwatch(doc, op.colors[i].name)) {
        continue;
      }
      sw = doc.swatches.add();
      sw.name = op.colors[i].name;
      sw.color = U.color(doc, op.colors[i].c);
      ctx.journal.push(L.removeFn(sw));
      sg.addSwatch(sw);
      n++;
    }
    return { count: n };
  };
}());
