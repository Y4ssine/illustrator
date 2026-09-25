/*
 * Item helpers: tags, reference resolution, stacking order, searches.
 */
AFHost.items = (function () {
  var U = AFHost.util;

  // ---- Tags (PageItem.tags; persisted in the .ai file) ---------------------

  function readAfTags(item) {
    var out = null;
    var tags;
    var i;
    var t;
    try {
      tags = item.tags;
      if (!tags || tags.length === 0) {
        return null;
      }
      for (i = 0; i < tags.length; i++) {
        t = tags[i];
        if (String(t.name).indexOf('AF_') === 0) {
          if (!out) {
            out = {};
          }
          out[t.name] = String(t.value);
        }
      }
    } catch (e) {
      return out;
    }
    return out;
  }

  function findTag(item, name) {
    var tags = item.tags;
    var i;
    for (i = 0; i < tags.length; i++) {
      if (tags[i].name === name) {
        return tags[i];
      }
    }
    return null;
  }

  function tagValue(item, name) {
    try {
      var t = findTag(item, name);
      return t ? String(t.value) : null;
    } catch (e) {
      return null;
    }
  }

  // Writes tags; pushes undo closures into `journal` unless the item is new.
  function writeTags(item, map, journal) {
    var k;
    var t;
    var old;
    for (k in map) {
      if (!map.hasOwnProperty(k)) {
        continue;
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        U.fail('BAD_OP', 'Invalid tag name ' + k);
      }
      t = findTag(item, k);
      if (t) {
        old = String(t.value);
        t.value = String(map[k]);
        if (journal) {
          journal.push(restoreTagFn(t, old));
        }
      } else {
        t = item.tags.add();
        t.name = k;
        t.value = String(map[k]);
        if (journal) {
          journal.push(removeTagFn(t));
        }
      }
    }
  }

  function restoreTagFn(tag, value) {
    return function () {
      tag.value = value;
    };
  }

  function removeTagFn(tag) {
    return function () {
      tag.remove();
    };
  }

  // ---- Stacking --------------------------------------------------------------

  function sameItem(a, b) {
    if (!a || !b) {
      return false;
    }
    try {
      if (a.uuid && b.uuid) {
        return a.uuid === b.uuid;
      }
    } catch (e) {
      // uuid unavailable before Illustrator 24
    }
    return a == b;
  }

  // Index of item within its parent (0 = front-most). O(siblings); prefer StackIndex for many items.
  function indexInParent(item) {
    var siblings = item.parent.pageItems;
    var i;
    for (i = 0; i < siblings.length; i++) {
      if (sameItem(siblings[i], item)) {
        return i;
      }
    }
    return -1;
  }

  function sublayerIndex(layer) {
    var list = layer.parent.layers;
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].name === layer.name) {
        return i;
      }
    }
    return 0;
  }

  function layerIndex(doc, layer) {
    var i;
    for (i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === layer.name) {
        return i;
      }
    }
    return 9999;
  }

  function isShadowType(t) {
    return t === 'groundShadow' || t === 'contactShadow' || t === 'contactAmbientShadow';
  }

  function sameContainer(a, b) {
    if (a == b) {
      return true;
    }
    try {
      if (a.typename !== b.typename) {
        return false;
      }
      if (a.typename === 'Layer') {
        return a.name === b.name && a.parent.typename === b.parent.typename && (a.parent.typename !== 'Layer' || a.parent.name === b.parent.name);
      }
      return !!a.uuid && a.uuid === b.uuid;
    } catch (e) {
      return false;
    }
  }

  // Per-batch index of parents: the position of each child (by uuid) and the
  // plugin shadows among the children, grouped by the AF_id they point to.
  // Each parent is read once, so sorting/moving N items costs O(N) DOM reads
  // instead of O(N^2) - which matters because every DOM read is slow.
  function StackIndex(doc) {
    this.doc = doc;
    this.entries = [];
  }

  StackIndex.prototype.entry = function (parent) {
    var i;
    var e;
    var kids;
    var k;
    var u;
    var src;
    var t;
    for (i = 0; i < this.entries.length; i++) {
      if (sameContainer(this.entries[i].parent, parent)) {
        return this.entries[i];
      }
    }
    e = { parent: parent, pos: {}, shadows: {} };
    kids = parent.pageItems;
    for (k = 0; k < kids.length; k++) {
      u = null;
      try {
        u = kids[k].uuid;
      } catch (x) {
        u = null;
      }
      if (u) {
        e.pos['u' + u] = k;
      }
      src = null;
      t = null;
      try {
        if (kids[k].tags.length > 0) {
          src = tagValue(kids[k], 'AF_src');
          t = src ? tagValue(kids[k], 'AF_type') : null;
        }
      } catch (y) {
        src = null;
      }
      if (src && isShadowType(t)) {
        if (!e.shadows.hasOwnProperty(src)) {
          e.shadows[src] = [];
        }
        e.shadows[src].push(kids[k]);
      }
    }
    this.entries.push(e);
    return e;
  };

  StackIndex.prototype.positionOf = function (item) {
    var e = this.entry(item.parent);
    var u = null;
    try {
      u = item.uuid;
    } catch (x) {
      u = null;
    }
    if (u && e.pos.hasOwnProperty('u' + u)) {
      return e.pos['u' + u];
    }
    return indexInParent(item); // Illustrator < 24 (no uuid)
  };

  // Plugin shadows that are siblings of `item` and point at it via AF_src.
  StackIndex.prototype.linked = function (item) {
    var id = tagValue(item, 'AF_id');
    var e;
    if (!id) {
      return [];
    }
    e = this.entry(item.parent);
    return e.shadows.hasOwnProperty(id) ? e.shadows[id].slice(0) : [];
  };

  // Key comparing front-to-back across the whole document: [topLayerIndex, ...indices].
  StackIndex.prototype.key = function (item) {
    var path = [];
    var cur = item;
    var guard = 0;
    while (cur && cur.typename !== 'Layer' && guard < 64) {
      path.unshift(this.positionOf(cur));
      cur = cur.parent;
      guard++;
    }
    while (cur && cur.parent && cur.parent.typename === 'Layer' && guard < 128) {
      // Sublayer. Illustrator interleaves sublayers with page items; ordering
      // across that boundary is approximated (sublayer contents sort after
      // the parent layer's own items). Only matters for multi-item moves.
      path.unshift(100000 + sublayerIndex(cur));
      cur = cur.parent;
      guard++;
    }
    path.unshift(cur ? layerIndex(this.doc, cur) : 9999);
    return path;
  };

  function compareKeys(a, b) {
    var n = Math.max(a.length, b.length);
    var i;
    var x;
    var y;
    for (i = 0; i < n; i++) {
      x = i < a.length ? a[i] : -1;
      y = i < b.length ? b[i] : -1;
      if (x !== y) {
        return x - y;
      }
    }
    return 0;
  }

  // Sort items front-to-back.
  StackIndex.prototype.sort = function (items) {
    var keyed = [];
    var out = [];
    var i;
    for (i = 0; i < items.length; i++) {
      keyed.push({ item: items[i], key: this.key(items[i]) });
    }
    keyed.sort(function (p, q) {
      return compareKeys(p.key, q.key);
    });
    for (i = 0; i < keyed.length; i++) {
      out.push(keyed[i].item);
    }
    return out;
  };

  // ---- Searches -------------------------------------------------------------

  function scanForId(collection, id, limit) {
    var n = Math.min(collection.length, limit);
    var i;
    for (i = 0; i < n; i++) {
      if (tagValue(collection[i], 'AF_id') === id) {
        return collection[i];
      }
    }
    return null;
  }

  // Find the item tagged AF_id == id. Looks next to `near` first, then its layer, then the document.
  function findByAfId(doc, id, near, limit) {
    var found = null;
    var max = limit || 20000;
    if (near) {
      try {
        found = scanForId(near.parent.pageItems, id, max);
        if (!found && near.layer) {
          found = scanForId(near.layer.pageItems, id, max);
        }
      } catch (e) {
        found = null;
      }
    }
    if (!found) {
      found = scanForId(doc.pageItems, id, max);
    }
    return found;
  }

  function findLayer(doc, name) {
    var i;
    for (i = 0; i < doc.layers.length; i++) {
      if (doc.layers[i].name === name) {
        return doc.layers[i];
      }
    }
    return null;
  }

  return {
    readAfTags: readAfTags,
    tagValue: tagValue,
    writeTags: writeTags,
    sameItem: sameItem,
    indexInParent: indexInParent,
    StackIndex: StackIndex,
    findByAfId: findByAfId,
    findLayer: findLayer,
    isShadowType: isShadowType
  };
}());
