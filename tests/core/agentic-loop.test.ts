/**
 * PHASE5 §12.2 — exported runAgenticLoop unit tests (happy path, iteration cap,
 * cancellation, scope guard). Uses the FakeAgenticProvider + a temp workspace.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runAgenticLoop, type ApplyEditFn, type JobPacket } from '@kingdomos/core';
import { applyEdit as realApplyEdit } from '@kingdomos/blacksmith';
import { FakeAgenticProvider } from '../helpers/fake-agentic-provider.js';

const applyEdit: ApplyEditFn = (edit, workspace) => realApplyEdit(edit, workspace);

function makePacket(workspace: string, over: Partial<JobPacket> = {}): JobPacket {
  return {
    job_id: 'job-1',
    task_id: 'task-1',
    agent_identity_path: '',
    model_id: 'fake-model',
    messages: [{ role: 'user', content: 'do the thing' }],
    allowed_files: [],
    scope_mode: 'greenfield',
    output_format: 'unified-diff',
    acceptance_criteria: [],
    max_tokens: 100,
    timeout_seconds: 30,
    result_path: join(workspace, 'result.json'),
    ...over,
  };
}

describe('PHASE5 — runAgenticLoop (§12.2)', () => {
  let ws: string;
  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'kingdom-loop-'));
    writeFileSync(join(ws, 'app.ts'), 'export const x = 1;\n');
  });
  afterEach(() => { try { rmSync(ws, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('happy path: apply_edit then finish → applied_files populated, agentic:true', async () => {
    const provider = new FakeAgenticProvider([
      { toolCalls: [{ name: 'apply_edit', arguments: { path: 'app.ts', old_string: 'export const x = 1;', new_string: 'export const x = 2;' } }] },
      { toolCalls: [{ name: 'finish', arguments: { summary: 'bumped x' } }] },
    ]);
    const result = await runAgenticLoop(provider, makePacket(ws), { workspace: ws, applyEdit });

    expect(result.success).toBe(true);
    expect(result.agentic).toBe(true);
    expect(result.finish_reason).toBe('stop');
    expect(result.applied_files).toContain('app.ts');
    expect(readFileSync(join(ws, 'app.ts'), 'utf-8')).toContain('export const x = 2;');
  });

  it('iteration cap: provider never finishes → stops at maxIterations, finish_reason length', async () => {
    // Provider always returns a read_file call, never finish.
    const turns = Array.from({ length: 20 }, () => ({
      toolCalls: [{ name: 'read_file', arguments: { path: 'app.ts' } }],
    }));
    const provider = new FakeAgenticProvider(turns);
    const result = await runAgenticLoop(provider, makePacket(ws), { workspace: ws, applyEdit, maxIterations: 3 });

    expect(result.finish_reason).toBe('length');
    expect(provider.callCount).toBe(3);
  });

  it('cancellation: pre-aborted signal → finish_reason cancelled, no provider call', async () => {
    const provider = new FakeAgenticProvider([
      { toolCalls: [{ name: 'finish', arguments: { summary: 'should not run' } }] },
    ]);
    const ac = new AbortController();
    ac.abort();
    const result = await runAgenticLoop(provider, makePacket(ws), { workspace: ws, applyEdit, signal: ac.signal });

    expect(result.success).toBe(false);
    expect(result.finish_reason).toBe('cancelled');
    expect(provider.callCount).toBe(0);
  });

  it('signal is propagated into provider.complete', async () => {
    const provider = new FakeAgenticProvider([
      { toolCalls: [{ name: 'finish', arguments: { summary: 'done' } }] },
    ]);
    const ac = new AbortController();
    await runAgenticLoop(provider, makePacket(ws), { workspace: ws, applyEdit, signal: ac.signal });
    expect(provider.requests[0].signal).toBe(ac.signal);
  });

  it('scope guard: apply_edit outside allowed_files (planned-files) → scoped error, no write', async () => {
    const provider = new FakeAgenticProvider([
      { toolCalls: [{ name: 'apply_edit', arguments: { path: 'secret.ts', old_string: '', new_string: 'leaked' } }] },
      { toolCalls: [{ name: 'finish', arguments: { summary: 'tried' } }] },
    ]);
    const packet = makePacket(ws, { scope_mode: 'planned-files', allowed_files: ['app.ts'] });
    const result = await runAgenticLoop(provider, packet, { workspace: ws, applyEdit });

    expect(result.applied_files).not.toContain('secret.ts');
    expect(existsSync(join(ws, 'secret.ts'))).toBe(false);
  });
});
