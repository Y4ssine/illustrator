/**
 * Development entry point: the real panel + the real host script running
 * against the mock DOM in the browser, with a live SVG view of the mock
 * document. Clearly labelled as a simulator; it is not Illustrator.
 */

import HOST_JSX from 'virtual:af-host-jsx';
import { createSimulatorAdapter } from '../illustrator/sim/sim-adapter';
import { hitTest, renderDocument } from '../illustrator/sim/render';
import { placedItem, rectItem, seedEmpty, seedSample, selectByName, textItem } from '../illustrator/sim/sample-doc';
import { mountShell } from './shell';

const STORAGE_PREFIX = 'af.sim.fs:';

function loadFs(): Map<string, string> {
  const m = new Map<string, string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (k.startsWith(STORAGE_PREFIX)) m.set(k.slice(STORAGE_PREFIX.length), localStorage.getItem(k) ?? '');
    }
  } catch {
    /* private mode */
  }
  return m;
}

function boot(): void {
  const params = new URLSearchParams(location.search);
  const { adapter, runtime } = createSimulatorAdapter(HOST_JSX, {
    latencyMs: 15,
    fs: { files: loadFs() },
    onWrite: (path, text) => {
      try {
        localStorage.setItem(STORAGE_PREFIX + path, text);
      } catch {
        /* ignore */
      }
    },
  });
  const seed = params.get('doc') ?? 'sample';
  if (seed === 'sample') seedSample(runtime.app);
  else if (seed === 'empty') seedEmpty(runtime.app);

  const canvas = document.getElementById('sim-canvas')!;
  let viewBox: [number, number, number, number] = [0, 0, 1, 1];
  const draw = (): void => {
    const doc = runtime.app._docs[runtime.app._activeIndex];
    if (!doc) {
      canvas.innerHTML = '<p class="sim-empty">No document open (File › New in Illustrator). Use the panel: Home › Artboards.</p>';
      return;
    }
    const r = renderDocument(doc);
    viewBox = r.viewBox;
    canvas.innerHTML = r.svg;
    const layers = document.getElementById('sim-layers')!;
    layers.innerHTML = doc._layers
      .map((l) => `<li class="${l.visible ? '' : 'off'}${l.locked ? ' locked' : ''}">${l.name.replace(/</g, '&lt;')}<span>${l._items.length}</span></li>`)
      .join('');
  };
  const orig = runtime.evalScript.bind(runtime);
  runtime.evalScript = (code: string): string => {
    const r = orig(code);
    queueMicrotask(draw);
    return r;
  };

  canvas.addEventListener('click', (e) => {
    const doc = runtime.app._docs[runtime.app._activeIndex];
    const svg = canvas.querySelector('svg');
    if (!doc || !svg) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.max(viewBox[2] / rect.width, viewBox[3] / rect.height);
    const offX = (rect.width - viewBox[2] / scale) / 2;
    const offY = (rect.height - viewBox[3] / scale) / 2;
    const x = viewBox[0] + (e.clientX - rect.left - offX) * scale;
    const y = viewBox[1] + (e.clientY - rect.top - offY) * scale;
    const hit = hitTest(doc, x, y);
    const current = (doc.selection as unknown[]) ?? [];
    if (e.shiftKey && hit) doc.selection = current.includes(hit) ? current.filter((i) => i !== hit) : [...current, hit];
    else doc.selection = hit ? [hit] : [];
    draw();
  });

  const on = (id: string, fn: () => void): void => document.getElementById(id)?.addEventListener('click', fn);
  on('sim-undo', () => runtime.evalScript('app.undo()'));
  on('sim-redo', () => runtime.evalScript('app.redo()'));
  on('sim-reopen', () => {
    runtime.saveCloseReopen();
    draw();
  });
  on('sim-text', () => {
    runtime.app._textEditing = !runtime.app._textEditing;
    document.getElementById('sim-text')!.classList.toggle('on', runtime.app._textEditing);
  });
  on('sim-selectall', () => {
    const doc = runtime.app._docs[runtime.app._activeIndex];
    if (doc) doc.selection = doc._layers.flatMap((l) => l._items).filter((i) => !i.locked && !i.hidden && !(i as { guides?: boolean }).guides);
    draw();
  });

  draw();
  const app = mountShell({ host: adapter, sweepPreview: () => adapter.sweepPreview() }, document.getElementById('app')!);
  // Dev/test hook (simulator build only).
  (window as unknown as Record<string, unknown>)['__af'] = { app, runtime, adapter, draw, helpers: { placedItem, rectItem, textItem, selectByName } };
}

boot();
