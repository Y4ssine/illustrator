/**
 * Thin, typed wrapper over CEP's native `window.__adobe_cep__` object — the
 * object Adobe's CSInterface.js itself wraps. Using it directly keeps the
 * bundle free of third-party code; every method is feature-detected.
 *
 * evalScript calls are serialised through a queue: ExtendScript is single
 * threaded and interleaved calls would make results arrive out of order.
 */

interface CepNative {
  evalScript(script: string, callback?: (result: string) => void): void;
  addEventListener(type: string, listener: (event: CepEvent) => void, obj?: unknown): void;
  getHostEnvironment(): string;
  getSystemPath?(pathType: string): string;
  invokeSync?(name: string, arg: string): string;
  getExtensionId?(): string;
}

export interface CepEvent {
  type: string;
  data?: string | object;
}

interface HostEnvironment {
  appName: string;
  appVersion: string;
  appLocale?: string;
  appSkinInfo?: {
    panelBackgroundColor?: { color?: { red: number; green: number; blue: number } };
    baseFontSize?: number;
  };
}

declare global {
  interface Window {
    __adobe_cep__?: CepNative;
  }
}

/** Events Illustrator dispatches to CEP panels. There is no selection-change event (the panel polls). */
export const CEP_EVENTS = {
  documentAfterActivate: 'documentAfterActivate',
  documentAfterDeactivate: 'documentAfterDeactivate',
  documentAfterSave: 'documentAfterSave',
  applicationActivate: 'applicationActivate',
  themeChanged: 'com.adobe.csxs.events.ThemeColorChanged',
  flyoutClicked: 'com.adobe.csxs.events.flyoutMenuClicked',
  /** Dispatched by the scripts in /scripts-menu (see docs/INSTALL.md › keyboard shortcuts). */
  command: 'com.artboardforge.command',
} as const;

export class CepBridge {
  private readonly cep: CepNative;
  private queue: Promise<unknown> = Promise.resolve();
  readonly timeoutMs: number;

  static available(): boolean {
    return typeof window !== 'undefined' && !!window.__adobe_cep__;
  }

  constructor(timeoutMs = 60000) {
    if (!window.__adobe_cep__) throw new Error('Not running inside a CEP panel');
    this.cep = window.__adobe_cep__;
    this.timeoutMs = timeoutMs;
  }

  evalScript(script: string): Promise<string> {
    const run = (): Promise<string> =>
      new Promise<string>((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
          if (!done) {
            done = true;
            reject(new Error(`Illustrator did not answer within ${Math.round(this.timeoutMs / 1000)} s (is a modal dialog open?)`));
          }
        }, this.timeoutMs);
        try {
          this.cep.evalScript(script, (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(result);
          });
        } catch (e) {
          done = true;
          clearTimeout(timer);
          reject(e);
        }
      });
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  on(type: string, handler: (data: string) => void): void {
    this.cep.addEventListener(type, (ev) => {
      const d = ev?.data;
      handler(typeof d === 'string' ? d : d ? JSON.stringify(d) : '');
    });
  }

  environment(): HostEnvironment | null {
    try {
      return JSON.parse(this.cep.getHostEnvironment()) as HostEnvironment;
    } catch {
      return null;
    }
  }

  /** Panel background colour from Illustrator's UI brightness setting. */
  panelBackground(): { r: number; g: number; b: number } | null {
    const c = this.environment()?.appSkinInfo?.panelBackgroundColor?.color;
    return c ? { r: c.red, g: c.green, b: c.blue } : null;
  }

  /** Flyout menu in the panel's top-right corner (CEP "setPanelFlyoutMenu"). */
  setFlyoutMenu(items: Array<{ id: string; label: string; enabled?: boolean } | '-'>): boolean {
    if (!this.cep.invokeSync) return false;
    const xml =
      '<Menu>' +
      items
        .map((it) =>
          it === '-'
            ? '<MenuItem Label="---" />'
            : `<MenuItem Id="${esc(it.id)}" Label="${esc(it.label)}" Enabled="${it.enabled === false ? 'false' : 'true'}" Checked="false"/>`,
        )
        .join('') +
      '</Menu>';
    try {
      this.cep.invokeSync('setPanelFlyoutMenu', xml);
      return true;
    } catch {
      return false;
    }
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
