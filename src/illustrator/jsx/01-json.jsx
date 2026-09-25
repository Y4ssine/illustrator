/*
 * Minimal JSON.stringify for ExtendScript (which has no JSON object).
 * Non-ASCII characters are escaped as \uXXXX so Arabic names and text survive
 * the evalScript bridge regardless of platform encoding.
 * Input payloads never need parsing here: the panel embeds them as ES3
 * object literals.
 */
AFHost.json = (function () {
  var ESC = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

  function hex4(n) {
    var h = n.toString(16);
    while (h.length < 4) {
      h = '0' + h;
    }
    return h;
  }

  function quote(s) {
    var out = [];
    var i;
    var c;
    var code;
    for (i = 0; i < s.length; i++) {
      c = s.charAt(i);
      code = s.charCodeAt(i);
      if (ESC.hasOwnProperty(c)) {
        out.push(ESC[c]);
      } else if (code < 32 || code > 126) {
        out.push('\\u' + hex4(code));
      } else {
        out.push(c);
      }
    }
    return '"' + out.join('') + '"';
  }

  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  function stringify(v) {
    var t = typeof v;
    var parts;
    var k;
    var i;
    if (v === null || t === 'undefined' || t === 'function') {
      return 'null';
    }
    if (t === 'number') {
      return isFinite(v) ? String(v) : 'null';
    }
    if (t === 'boolean') {
      return v ? 'true' : 'false';
    }
    if (t === 'string') {
      return quote(v);
    }
    if (isArray(v)) {
      parts = [];
      for (i = 0; i < v.length; i++) {
        parts.push(stringify(v[i]));
      }
      return '[' + parts.join(',') + ']';
    }
    parts = [];
    for (k in v) {
      if (v.hasOwnProperty(k) && typeof v[k] !== 'undefined' && typeof v[k] !== 'function') {
        parts.push(quote(k) + ':' + stringify(v[k]));
      }
    }
    return '{' + parts.join(',') + '}';
  }

  return { stringify: stringify, quote: quote };
}());
