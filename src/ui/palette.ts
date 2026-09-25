/**
 * Command palette (Ctrl/Cmd+K inside the panel): search, ↑/↓, Enter, Esc.
 * Stars toggle favourites (shown on HOME).
 */

import { CATEGORY_LABEL } from '../core/commands/types';
import { searchCommands } from '../core/commands/search';
import type { AppController } from './app';
import { h, svg } from './dom';
import { SearchBox } from './components/controls';
import { ICONS } from './icons';

export function mountPalette(app: AppController): { open(): void; close(): void } {
  let index = 0;
  let hits: ReturnType<typeof searchCommands> = [];
  const list = h('ul', { class: 'palette-list', role: 'listbox' });
  const box = SearchBox({
    placeholder: 'Search commands… e.g. “shadow”, “grid”, “8px”',
    onInput: (q) => render(q),
    onKey: (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        index = Math.min(hits.length - 1, index + 1);
        highlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        index = Math.max(0, index - 1);
        highlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const hit = hits[index];
        if (hit) choose(hit.command.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    },
  });
  const panel = h(
    'div',
    { class: 'palette', role: 'dialog', 'aria-label': 'Artboard Forge commands' },
    h('div', { class: 'palette-title' }, 'ARTBOARD FORGE COMMANDS'),
    box.el,
    list,
    h('div', { class: 'palette-foot' }, '↑↓ navigate · Enter run · Esc close · ★ favourite'),
  );
  const scrim = h('div', { class: 'scrim palette-scrim', hidden: true }, panel);
  scrim.addEventListener('mousedown', (e) => {
    if (e.target === scrim) close();
  });
  app.root.appendChild(scrim);

  const ctxSuggest = (): string[] => app.s.context?.suggestions ?? [];

  function render(q: string): void {
    const all = app.registry.all();
    const query = q.trim();
    if (!query) {
      // Empty query: context suggestions, then favourites, then recent.
      const ids = [...new Set([...ctxSuggest(), ...app.settings.favorites, ...app.settings.recent])];
      hits = ids.map((id) => app.registry.get(id)).filter((c): c is NonNullable<typeof c> => !!c).map((command) => ({ command, score: 1 }));
    } else {
      hits = searchCommands(all, query, app.settings.recent, 14);
    }
    index = 0;
    list.innerHTML = '';
    if (hits.length === 0) {
      list.appendChild(h('li', { class: 'palette-empty' }, 'No matching command.'));
      return;
    }
    hits.forEach((hit, i) => {
      const fav = app.settings.favorites.includes(hit.command.id);
      const star = h('button', { type: 'button', class: `palette-star${fav ? ' on' : ''}`, title: fav ? 'Remove from favourites' : 'Add to favourites' }, svg(fav ? ICONS.starFilled : ICONS.star));
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        app.toggleFavorite(hit.command.id);
        render(box.input.value);
      });
      const item = h(
        'li',
        { class: 'palette-item', role: 'option', dataset: { i: String(i) } },
        h('span', { class: 'palette-cat' }, CATEGORY_LABEL[hit.command.category]),
        h('span', { class: 'palette-name' }, hit.command.title),
        h('span', { class: 'palette-desc' }, hit.command.description),
        star,
      );
      item.addEventListener('mouseenter', () => {
        index = i;
        highlight();
      });
      item.addEventListener('click', () => choose(hit.command.id));
      list.appendChild(item);
    });
    highlight();
  }

  function highlight(): void {
    list.querySelectorAll('.palette-item').forEach((el, i) => {
      el.classList.toggle('active', i === index);
      el.setAttribute('aria-selected', String(i === index));
      if (i === index) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    });
  }

  function choose(id: string): void {
    close();
    void app.run(id);
  }

  function open(): void {
    scrim.hidden = false;
    box.input.value = '';
    render('');
    box.input.focus();
  }

  function close(): void {
    scrim.hidden = true;
  }

  return { open, close };
}
