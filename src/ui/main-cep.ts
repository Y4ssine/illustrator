/**
 * Production entry point (loaded by cep/index.html inside Illustrator).
 */

import { createCepAdapter } from '../illustrator/cep-adapter';
import { CepBridge } from '../illustrator/cep/bridge';
import { applyHostTheme, mountShell } from './shell';

function boot(): void {
  const root = document.getElementById('app')!;
  if (!CepBridge.available()) {
    root.innerHTML =
      '<p style="padding:16px;font:12px sans-serif">This panel must run inside Adobe Illustrator. For development in a browser, run <code>npm run dev</code> and open the simulator.</p>';
    return;
  }
  const { adapter, bridge } = createCepAdapter();
  applyHostTheme(bridge.panelBackground());
  adapter.on('themeChanged', () => applyHostTheme(bridge.panelBackground()));
  const app = mountShell({ host: adapter, sweepPreview: () => adapter.sweepPreview() }, root);
  bridge.setFlyoutMenu([
    { id: 'palette', label: 'Command Palette…' },
    { id: 'repeat', label: 'Repeat Last Command' },
    '-',
    { id: 'settings', label: 'Settings' },
    { id: 'scan', label: 'Find Artboard Forge Items' },
  ]);
  bridge.on('com.adobe.csxs.events.flyoutMenuClicked', (data) => {
    let id = data;
    try {
      id = (JSON.parse(data) as { menuId?: string }).menuId ?? data;
    } catch {
      /* plain string */
    }
    if (id === 'palette') app.openPalette();
    else if (id === 'repeat') void app.repeatLast();
    else if (id === 'settings') app.go('settings');
    else if (id === 'scan') void app.scanDocument();
  });
}

boot();
