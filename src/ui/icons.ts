/**
 * Original, minimal 16×16 line icons (stroke = currentColor). Deliberately
 * generic shapes — no third-party icon sets.
 */

const s = (body: string): string =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  home: s('<path d="M2.5 7.5 8 3l5.5 4.5"/><path d="M4 6.5V13h8V6.5"/><path d="M7 13v-3h2v3"/>'),
  grid: s('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11"/>'),
  align: s('<path d="M2.5 2.5v11M13.5 2.5v11"/><rect x="4.5" y="4" width="2.5" height="8" rx=".5"/><rect x="9" y="5.5" width="2.5" height="5" rx=".5"/>'),
  shadow: s('<rect x="5.5" y="2.5" width="5" height="8" rx="1"/><ellipse cx="8" cy="12.6" rx="5" ry="1.4" fill="currentColor" fill-opacity=".35" stroke="none"/>'),
  layers: s('<path d="M8 2.5 13.5 5.5 8 8.5 2.5 5.5Z"/><path d="m2.5 8 5.5 3 5.5-3"/><path d="m2.5 10.5 5.5 3 5.5-3"/>'),
  presets: s('<path d="M4.5 2.5h7v11l-3.5-2.5-3.5 2.5Z"/>'),
  settings: s('<circle cx="8" cy="8" r="2"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6 5 5M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4"/>'),
  search: s('<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>'),
  star: s('<path d="m8 2.3 1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.1 4.5 13l.8-3.9-2.9-2.7 3.9-.5Z"/>'),
  starFilled: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="m8 2.3 1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.1 4.5 13l.8-3.9-2.9-2.7 3.9-.5Z"/></svg>`,
  eye: s('<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.8"/>'),
  play: s('<path d="M5 3.5v9l7-4.5Z"/>'),
  reset: s('<path d="M3 8a5 5 0 1 0 1.5-3.6"/><path d="M3 2.5v2.5h2.5"/>'),
  more: s('<circle cx="4" cy="8" r=".6" fill="currentColor"/><circle cx="8" cy="8" r=".6" fill="currentColor"/><circle cx="12" cy="8" r=".6" fill="currentColor"/>'),
  close: s('<path d="m4 4 8 8M12 4l-8 8"/>'),
  chevron: s('<path d="m6 4 4 4-4 4"/>'),
  copy: s('<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1"/><path d="M3 10.5V3h7.5"/>'),
  repeat: s('<path d="M3 6.5h8.5L9.5 4.5M13 9.5H4.5l2 2"/>'),
  warn: s('<path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.4v.1"/>'),
  info: s('<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.8M8 5v.1"/>'),
  check: s('<path d="m3.5 8.5 3 3 6-7"/>'),
  link: s('<path d="M6.5 9.5 9.5 6.5"/><path d="M7 4.5 8.5 3a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5 7.5 13A2.5 2.5 0 0 1 4 9.5L5.5 8"/>'),
  artboard: s('<rect x="3.5" y="3.5" width="9" height="9"/><path d="M1.5 3.5h1M3.5 1.5v1M13.5 12.5h1M12.5 13.5v1"/>'),
} as const;

export type IconName = keyof typeof ICONS;
