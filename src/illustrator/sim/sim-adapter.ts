/**
 * Simulator adapter: the real host script + mock DOM, behind the same
 * HostAdapter as production. Used by tests and the browser dev harness.
 */

import { ScriptHostAdapter } from '../script-adapter';
import { SimRuntime, type RuntimeOptions } from './runtime';

export function createSimulatorAdapter(hostSource: string, opts: RuntimeOptions & { latencyMs?: number } = {}): { adapter: ScriptHostAdapter; runtime: SimRuntime } {
  const runtime = new SimRuntime(hostSource, opts);
  const latency = opts.latencyMs ?? 0;
  const adapter = new ScriptHostAdapter('simulator', (script) =>
    latency > 0
      ? new Promise((resolve) => setTimeout(() => resolve(runtime.evalScript(script)), latency))
      : Promise.resolve(runtime.evalScript(script)),
  );
  return { adapter, runtime };
}
