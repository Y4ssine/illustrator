/*
 * Utilities: coordinate conversion, colours, blend modes, errors.
 */
AFHost.util = (function () {
  function fail(code, message) {
    var e = new Error(message);
    e.afCode = code;
    throw e;
  }

  function r3(n) {
    return Math.round(n * 1000) / 1000;
  }

  // Illustrator bounds [left, top, right, bottom] (Y up) -> design rect [x, y, w, h] (Y down).
  function rect(b) {
    return [r3(b[0]), r3(-b[1]), r3(b[2] - b[0]), r3(b[1] - b[3])];
  }

  // Design rect -> Illustrator artboardRect [left, top, right, bottom].
  function aiRect(x, y, w, h) {
    return [x, -y, x + w, -(y + h)];
  }

  function fingerprint(item) {
    var b = item.geometricBounds;
    return Math.round(b[0] * 100) / 100 + ',' + Math.round(b[1] * 100) / 100 + ',' + Math.round(b[2] * 100) / 100 + ',' + Math.round(b[3] * 100) / 100;
  }

  function hexToRgb(hex) {
    var s = String(hex).replace('#', '');
    var n;
    if (s.length === 3) {
      s = s.charAt(0) + s.charAt(0) + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(s)) {
      fail('BAD_OP', 'Invalid colour ' + hex);
    }
    n = parseInt(s, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Profile-less fallback; used only when app.convertSampleColor is unavailable.
  function naiveCmyk(rgb) {
    var r = rgb[0] / 255;
    var g = rgb[1] / 255;
    var b = rgb[2] / 255;
    var k = 1 - Math.max(r, Math.max(g, b));
    if (k >= 1) {
      return [0, 0, 0, 100];
    }
    return [((1 - r - k) / (1 - k)) * 100, ((1 - g - k) / (1 - k)) * 100, ((1 - b - k) / (1 - k)) * 100, k * 100];
  }

  function toCmyk(rgb) {
    try {
      // Uses the document's colour settings when available (Illustrator CC+).
      var out = app.convertSampleColor(ImageColorSpace.RGB, rgb, ImageColorSpace.CMYK, ColorConvertPurpose.defaultpurpose);
      if (out && out.length === 4) {
        return out;
      }
    } catch (e) {
      // fall through
    }
    return naiveCmyk(rgb);
  }

  function isCmykDoc(doc) {
    try {
      return doc.documentColorSpace == DocumentColorSpace.CMYK;
    } catch (e) {
      return false;
    }
  }

  function color(doc, hex) {
    var rgb = hexToRgb(hex);
    var c;
    var cmyk;
    if (isCmykDoc(doc)) {
      cmyk = toCmyk(rgb);
      c = new CMYKColor();
      c.cyan = cmyk[0];
      c.magenta = cmyk[1];
      c.yellow = cmyk[2];
      c.black = cmyk[3];
      return c;
    }
    c = new RGBColor();
    c.red = rgb[0];
    c.green = rgb[1];
    c.blue = rgb[2];
    return c;
  }

  // Mix a colour toward white by opacity (0-100). Used for the Multiply fallback
  // when gradient stops cannot carry opacity.
  function mixWhite(hex, opacity) {
    var rgb = hexToRgb(hex);
    var t = opacity / 100;
    var out = [];
    var i;
    var h;
    for (i = 0; i < 3; i++) {
      h = Math.round(255 + (rgb[i] - 255) * t).toString(16);
      out.push(h.length < 2 ? '0' + h : h);
    }
    return '#' + out.join('');
  }

  var BLEND = {
    normal: 'NORMAL',
    multiply: 'MULTIPLY',
    screen: 'SCREEN',
    overlay: 'OVERLAY',
    softLight: 'SOFTLIGHT',
    hardLight: 'HARDLIGHT',
    colorDodge: 'COLORDODGE',
    colorBurn: 'COLORBURN',
    darken: 'DARKEN',
    lighten: 'LIGHTEN',
    difference: 'DIFFERENCE',
    exclusion: 'EXCLUSION',
    hue: 'HUE',
    saturation: 'SATURATIONBLEND',
    color: 'COLORBLEND',
    luminosity: 'LUMINOSITY'
  };

  function blend(name) {
    var key = BLEND[name];
    if (!key) {
      fail('BAD_OP', 'Unknown blend mode ' + name);
    }
    return BlendModes[key];
  }

  function alive(item) {
    try {
      return !!item && !!item.typename;
    } catch (e) {
      return false;
    }
  }

  function majorVersion() {
    try {
      return parseInt(String(app.version).split('.')[0], 10) || 0;
    } catch (e) {
      return 0;
    }
  }

  function hasDoc() {
    try {
      return app.documents.length > 0;
    } catch (e) {
      return false;
    }
  }

  return {
    fail: fail,
    r3: r3,
    rect: rect,
    aiRect: aiRect,
    fingerprint: fingerprint,
    color: color,
    mixWhite: mixWhite,
    blend: blend,
    alive: alive,
    majorVersion: majorVersion,
    hasDoc: hasDoc
  };
}());
