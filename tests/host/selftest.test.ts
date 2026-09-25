/**
 * Validates the generated in-Illustrator self-test against the simulator:
 * the harness must parse as ES3 and pass end to end here before anyone runs
 * it in real Illustrator (where it is the actual acceptance test).
 */

import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { hostSource } from '../helpers/host';
import { generateSelfTest } from './../illustrator/gen-selftest';
import { SimRuntime } from '../../src/illustrator/sim/runtime';

describe('in-Illustrator self-test (dry run in the simulator)', () => {
  it('is valid ES3 and passes against the mock DOM', async () => {
    const src = hostSource();
    const text = (await generateSelfTest(src, 'test')).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    expect(() => parse(text, { ecmaVersion: 3, sourceType: 'script' })).not.toThrow();
    const rt = new SimRuntime(src);
    const out = rt.evalScript(text);
    expect(out).not.toBe('EvalScript error.');
    const summary = rt.app.alerts[0] ?? '';
    const failures = rt.log.filter((l) => l.includes('FAIL'));
    expect(failures, failures.join('\n')).toEqual([]);
    expect(summary).toMatch(/passed, 0 failed/);
    // The report file was written.
    expect([...rt.fs.files.keys()].some((k) => k.endsWith('af-selftest-report.txt'))).toBe(true);
  });
});

describe('in-Illustrator benchmark (dry run in the simulator)', () => {
  it('runs and reports every operation', async () => {
    const { generateBenchmark } = await import('../illustrator/gen-selftest');
    const src = hostSource();
    const text = (await generateBenchmark(src, 'test')).replace('var SIZES = [50, 500, 5000];', 'var SIZES = [20, 60];');
    expect(() => parse(text.replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')), { ecmaVersion: 3, sourceType: 'script' })).not.toThrow();
    const rt = new SimRuntime(src);
    expect(rt.evalScript(text)).not.toBe('EvalScript error.');
    const report = rt.app.alerts[0] ?? '';
    expect(report).toMatch(/^20 \|/m);
    expect(report).toMatch(/^60 \|/m);
    expect(report).not.toMatch(/FAILED/);
    expect(report).toMatch(/selection described: 60/);
  });
});
