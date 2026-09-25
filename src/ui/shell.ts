/**
 * Panel shell: icon rail, header, scrolling content, status bar, progress,
 * toasts, command palette and keyboard shortcuts.
 */

import { activeArtboard } from '../core/snapshot';
import { formatLength } from '../geometry/units';
import { AppController, type AppEnv, type TabId } from './app';
import { h, svg } from './dom';
import { ICONS, type IconName } from './icons';
import { ProgressBar } from './components/layout';
import { mountPalette } from './palette';
import { AlignView } from './views/align';
import { GridView } from './views/grid';
import { HomeView } from './views/home';
import { LayersView } from './views/layers';
import { PresetsView } from './views/presets';
import { SettingsView } from './views/settings';
import { ShadowView } from './views/shadow';
import type { View } from './views/view';

const TABS: Array<{ id: TabId; icon: IconName; label: string; key: string }> = [
  { id: 'home', icon: 'home', label: 'Home', key: '1' },
  { id: 'grid', icon: 'grid', label: 'Grid & Guides', key: '2' },
  { id: 'align', icon: 'align', label: 'Spacing & Align', key: '3' },
  { id: 'shadow', icon: 'shadow', label: 'Shadow Lab', key: '4' },
  { id: 'layers', icon: 'layers', label: 'Layers', key: '5' },
  { id: 'presets', icon: 'presets', label: 'Presets', key: '6' },
];

export function mountShell(env: Omit<AppEnv, 'root'>, root: HTMLElement): AppController {
  root.classList.add('af-root');
  const app = new AppController({ ...env, root });
  const views: View[] = [HomeView(app), GridView(app), AlignView(app), ShadowView(app), LayersView(app), PresetsView(app), SettingsView(app)];

  const railBtn = (id: TabId, icon: IconName, label: string, key?: string): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'rail-btn', title: key ? `${label}  (Alt+${key})` : label, 'aria-label': label, dataset: { tab: id } }, svg(ICONS[icon]));
    b.addEventListener('click', () => app.go(id));
    return b;
  };
  const rail = h(
    'nav',
    { class: 'rail', 'aria-label': 'Sections' },
    ...TABS.map((t) => railBtn(t.id, t.icon, t.label, t.key)),
    h('div', { class: 'rail-spacer' }),
    railBtn('settings', 'settings', 'Settings'),
  );
  const title = h('h1', { class: 'header-title' }, 'Home');
  const busy = h('span', { class: 'header-busy', 'aria-live': 'polite' });
  const paletteBtn = h('button', { type: 'button', class: 'palette-btn', title: 'Command palette (Ctrl/Cmd+K)' }, svg(ICONS.search), h('span', null, 'Commands'), h('kbd', null, navigator.platform.startsWith('Mac') ? '⌘K' : 'Ctrl K'));
  const previewChip = h('button', { type: 'button', class: 'preview-chip', hidden: true, title: 'Live preview is on — click or press Esc to cancel' }, svg(ICONS.eye), 'Preview', svg(ICONS.close));
  previewChip.addEventListener('click', () => void app.cancelPreview());
  const progress = ProgressBar();
  const header = h('header', { class: 'header' }, title, previewChip, busy, paletteBtn);
  const content = h('main', { class: 'content' }, ...views.map((v) => ((v.el.hidden = v.id !== 'home'), v.el)));
  const status = h('footer', { class: 'status' });
  const shell = h('div', { class: 'shell' }, rail, h('div', { class: 'main' }, progress.el, header, content, status), app.toasts.el);
  root.appendChild(shell);

  const palette = mountPalette(app);
  app.openPalette = palette.open;
  paletteBtn.addEventListener('click', () => palette.open());

  const renderStatus = (): void => {
    const s = app.s;
    const doc = s.snapshot?.doc;
    const ab = doc ? activeArtboard(doc) : null;
    status.textContent = '';
    const parts = [
      h('span', { class: `dot ${s.connected ? (s.error ? 'warn' : 'ok') : 'off'}`, title: s.error ?? (s.connected ? 'Connected' : 'Not connected') }),
      h('span', { class: 'status-ctx' }, s.context?.label ?? (s.connected ? '' : 'Connecting…')),
      ab ? h('span', { class: 'status-ab' }, `${ab.name} · ${formatLength(ab.rect.w, app.settings.units).replace(/ \w+$/, '')}×${formatLength(ab.rect.h, app.settings.units)} · ${doc!.colorSpace}`) : null,
    ];
    for (const p of parts) if (p) status.append(p);
  };

  app.subscribe((s, changed) => {
    if (changed.has('tab')) {
      views.forEach((v) => (v.el.hidden = v.id !== s.tab));
      rail.querySelectorAll<HTMLButtonElement>('.rail-btn').forEach((b) => b.setAttribute('aria-current', String(b.dataset['tab'] === s.tab)));
      title.textContent = views.find((v) => v.id === s.tab)?.title ?? '';
      content.scrollTop = 0;
    }
    if (changed.has('busy')) {
      busy.textContent = s.busy && s.busy !== 'Preview' ? `${s.busy}…` : '';
      if (s.busy) progress.start(s.busy);
      else progress.stop();
      shell.classList.toggle('is-busy', !!s.busy && s.busy !== 'Preview');
    }
    if (changed.has('previewing')) previewChip.hidden = !s.previewing;
    for (const v of views) v.update(s, changed);
    renderStatus();
  });

  // Keyboard: panel shortcuts work while the panel has focus (CEP cannot
  // register global Illustrator shortcuts; see docs/INSTALL.md for F-key actions).
  document.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.open();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      void app.repeatLast();
    } else if (e.altKey && /^[1-6]$/.test(e.key)) {
      e.preventDefault();
      app.go(TABS[Number(e.key) - 1]!.id);
    } else if (e.key === 'Escape' && app.s.previewing) {
      void app.cancelPreview();
    } else if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      palette.open();
    }
  });

  // Initial render of every view.
  const all = new Set(Object.keys(app.s) as Array<keyof typeof app.s>);
  for (const v of views) v.update(app.s, all);
  rail.querySelector<HTMLButtonElement>('[data-tab="home"]')!.setAttribute('aria-current', 'true');
  renderStatus();
  void app.start();
  return app;
}

/** Map Illustrator's panel background (4 UI brightness levels) onto the theme. */
export function applyHostTheme(bg: { r: number; g: number; b: number } | null): void {
  if (!bg) return;
  const lum = (0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b) / 255;
  const root = document.documentElement;
  root.dataset['theme'] = lum > 0.5 ? 'light' : 'dark';
  root.style.setProperty('--bg', `rgb(${bg.r}, ${bg.g}, ${bg.b})`);
}
