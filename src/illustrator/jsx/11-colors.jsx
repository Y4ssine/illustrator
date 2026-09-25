/*
 * Colour sampling for "palette from logo": walks the selection (groups,
 * compound paths, text) and returns the colours it paints with, weighted by
 * area. Read-only. Images cannot be sampled (no pixel access from scripts);
 * they are counted so the panel can say so.
 */
AFHost.query.colors = (function () {
  var U = AFHost.util;

  function hex2(n) {
    var v = Math.max(0, Math.min(255, Math.round(n)));
    var h = v.toString(16);
    return h.length < 2 ? '0' + h : h;
  }

  function hex(r, g, b) {
    return ('#' + hex2(r) + hex2(g) + hex2(b)).toUpperCase();
  }

  function cmykToRgb(c, m, y, k) {
    var out;
    try {
      out = app.convertSampleColor(ImageColorSpace.CMYK, [c, m, y, k], ImageColorSpace.RGB, ColorConvertPurpose.defaultpurpose);
      if (out && out.length === 3) {
        return out;
      }
    } catch (e) {
      // fall back to the naive conversion
    }
    return [255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)];
  }

  // tint: 0-100 (spot colour tints mix toward white)
  function colorHex(col, tint) {
    var t = col.typename;
    var rgb = null;
    var f;
    if (t === 'RGBColor') {
      rgb = [col.red, col.green, col.blue];
    } else if (t === 'CMYKColor') {
      rgb = cmykToRgb(col.cyan, col.magenta, col.yellow, col.black);
    } else if (t === 'GrayColor') {
      f = 255 * (1 - col.gray / 100);
      rgb = [f, f, f];
    } else if (t === 'SpotColor') {
      return colorHex(col.spot.color, typeof col.tint === 'number' ? col.tint : 100);
    }
    if (!rgb) {
      return null;
    }
    if (tint < 100) {
      f = tint / 100;
      rgb = [255 + (rgb[0] - 255) * f, 255 + (rgb[1] - 255) * f, 255 + (rgb[2] - 255) * f];
    }
    return hex(rgb[0], rgb[1], rgb[2]);
  }

  function add(acc, h, w) {
    if (!h || !(w > 0)) {
      return;
    }
    if (!acc.hasOwnProperty(h)) {
      acc[h] = 0;
      acc.__keys.push(h);
    }
    acc[h] += w;
  }

  function paint(acc, col, w) {
    var stops;
    var i;
    if (!col) {
      return;
    }
    if (col.typename === 'GradientColor') {
      stops = col.gradient.gradientStops;
      for (i = 0; i < stops.length; i++) {
        add(acc, colorHex(stops[i].color, 100), w / stops.length);
      }
      return;
    }
    add(acc, colorHex(col, 100), w);
  }

  function area(item) {
    var b = item.geometricBounds;
    return Math.max(1, (b[2] - b[0]) * (b[1] - b[3]));
  }

  function visitPath(acc, p, w) {
    var b;
    try {
      if (p.guides || p.clipping) {
        return;
      }
      if (p.filled) {
        paint(acc, p.fillColor, w);
      }
      if (p.stroked && p.strokeWidth > 0) {
        b = p.geometricBounds;
        paint(acc, p.strokeColor, 2 * ((b[2] - b[0]) + (b[1] - b[3])) * p.strokeWidth);
      }
    } catch (e) {
      // pattern or unreadable paint
    }
  }

  function walk(acc, item, budget, info) {
    var t;
    var kids;
    var i;
    if (budget.n <= 0) {
      info.truncated = true;
      return;
    }
    budget.n--;
    info.items++;
    t = item.typename;
    if (t === 'GroupItem') {
      kids = item.pageItems;
      for (i = 0; i < kids.length; i++) {
        walk(acc, kids[i], budget, info);
      }
    } else if (t === 'CompoundPathItem') {
      if (item.pathItems.length > 0) {
        visitPath(acc, item.pathItems[0], area(item));
      }
    } else if (t === 'PathItem') {
      visitPath(acc, item, area(item));
    } else if (t === 'TextFrame') {
      try {
        paint(acc, item.textRange.characterAttributes.fillColor, area(item) * 0.5);
      } catch (e) {
        // mixed colours
      }
    } else if (t === 'PlacedItem' || t === 'RasterItem') {
      info.images++;
    } else {
      info.other++;
    }
  }

  return function (opts) {
    var doc;
    var sel;
    var acc = { __keys: [] };
    var info = { items: 0, images: 0, other: 0, truncated: false };
    var budget = { n: (opts && opts.limit) || 4000 };
    var out = [];
    var i;
    if (!U.hasDoc()) {
      U.fail('NO_DOCUMENT', 'No document is open');
    }
    doc = app.activeDocument;
    sel = doc.selection;
    if (!sel || sel.typename) {
      U.fail('TEXT_EDITING', 'Leave text editing to sample colours');
    }
    for (i = 0; i < sel.length; i++) {
      walk(acc, sel[i], budget, info);
    }
    for (i = 0; i < acc.__keys.length; i++) {
      out.push({ hex: acc.__keys[i], weight: U.r3(acc[acc.__keys[i]]) });
    }
    return { samples: out, items: info.items, images: info.images, other: info.other, truncated: info.truncated };
  };
}());
