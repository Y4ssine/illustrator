/**
 * The production adapter: CEP panel ⇄ ExtendScript host inside Illustrator.
 */

import { CEP_EVENTS, CepBridge } from './cep/bridge';
import { ScriptHostAdapter } from './script-adapter';

export function createCepAdapter(): { adapter: ScriptHostAdapter; bridge: CepBridge } {
  const bridge = new CepBridge();
  const adapter = new ScriptHostAdapter('cep', (script) => bridge.evalScript(script));
  bridge.on(CEP_EVENTS.documentAfterActivate, () => adapter.emit('documentChanged', 'activate'));
  bridge.on(CEP_EVENTS.documentAfterDeactivate, () => adapter.emit('documentChanged', 'deactivate'));
  bridge.on(CEP_EVENTS.documentAfterSave, () => adapter.emit('documentChanged', 'save'));
  bridge.on(CEP_EVENTS.themeChanged, () => adapter.emit('themeChanged'));
  bridge.on(CEP_EVENTS.command, (data) => adapter.emit('hostCommand', data));
  return { adapter, bridge };
}
