import { asSessionId, type CommandContext, type Workflow, type WorkflowRunResult } from '@moxxy/sdk';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildWorkflowsCommand, type WorkflowCommandDeps } from './command.js';

function wf(name: string, steps: Array<Record<string, unknown>> = [{ id: 'a', prompt: 'go' }]): Workflow {
  return {
    name,
    description: `the ${name} workflow`,
    version: 1,
    enabled: true,
    inputs: {},
    concurrency: 4,
    steps: steps.map((s) => ({ needs: [], onError: 'fail', retries: 0, ...s })),
  } as unknown as Workflow;
}

/** Minimal in-memory store exposing only what the command path touches. */
function fakeStore(entries: Workflow[]): WorkflowCommandDeps['store'] {
  const byName = new Map(entries.map((w) => [w.name, w]));
  return {
    get: async (name: string) => {
      const workflow = byName.get(name);
      return workflow ? { workflow, path: `/tmp/${name}.yaml`, scope: 'user' } : undefined;
    },
  } as unknown as WorkflowCommandDeps['store'];
}

function ctx(args: string): CommandContext {
  return { channel: 'tui', sessionId: asSessionId('s'), args, session: {} };
}

/** A JSONL run record exactly as engine.ts writes it. */
function runRecord(name: string, ok: boolean): string {
  return [
    JSON.stringify({ kind: 'run', workflow: name, executor: 'dag', startedAt: 1, trigger: 'manual', ok }),
    JSON.stringify({ kind: 'step', id: 'a', status: ok ? 'completed' : 'failed' }),
    JSON.stringify({ kind: 'output', output: `OUT_${name}` }),
  ].join('\n');
}

describe('/workflows inspect — last run resolution', () => {
  it('does not resolve a sibling workflow whose name is a superstring', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'wf-runrec-'));
    // Both filenames contain `-report-` as a substring; only one IS `report`.
    await writeFile(join(dir, '2026-01-01T00-00-00-000Z-report-aaaaaa.jsonl'), runRecord('report', true));
    await writeFile(join(dir, '2026-01-02T00-00-00-000Z-daily-report-bbbbbb.jsonl'), runRecord('daily-report', false));

    const cmd = buildWorkflowsCommand({ store: fakeStore([wf('report')]), runRecordDir: dir });
    const out = await cmd.handler(ctx('inspect report'));
    expect(out.kind).toBe('text');
    const text = (out as { text: string }).text;
    // The surfaced last-run line reflects `report` (ok ✓), NOT `daily-report` (✗).
    expect(text).toContain('— last run —');
    const lastRunSection = text.slice(text.indexOf('— last run —'));
    expect(lastRunSection).toContain('✓');
    expect(lastRunSection).not.toContain('✗');
    await rm(dir, { recursive: true, force: true });
  });
});

describe('/workflows run — paused (awaitInput) result', () => {
  it('reports a paused run as awaiting input, not completed', async () => {
    const paused: WorkflowRunResult = {
      ok: true,
      status: 'paused',
      steps: [{ id: 'ask', status: 'awaiting_input', output: 'What topic?', startedAt: 1, endedAt: 2 }],
      output: '',
      runId: 'RUN123',
      pendingStepId: 'ask',
    };
    const cmd = buildWorkflowsCommand({
      store: fakeStore([wf('hitl', [{ id: 'ask', prompt: 'Ask', awaitInput: true }])]),
      runNow: async () => paused,
    });
    const out = await cmd.handler(ctx('run hitl'));
    expect(out.kind).toBe('text');
    const text = (out as { text: string }).text.toLowerCase();
    expect(text).not.toContain('completed');
    expect(text).toMatch(/paused|awaiting input/);
    expect((out as { text: string }).text).toContain('ask'); // pending step id
  });
});
