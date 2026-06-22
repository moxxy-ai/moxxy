/**
 * Regression tests for the run-archive normalizer. The archive lives on disk
 * (~/.moxxy/collab/runs) and is untrusted at the renderer boundary; a corrupted
 * or truncated entry must NOT throw during render and crash the whole
 * Collaborate view. `normalizeRun` coerces every render-dereferenced field to a
 * safe default.
 */
import { describe, expect, it } from 'vitest';
import { normalizeRun } from './CollaboratePanel';

describe('normalizeRun', () => {
  it('passes a well-formed run through with its values intact', () => {
    const r = normalizeRun({
      runId: 'r1',
      task: 'Build it',
      startedAtMs: 1000,
      finishedAtMs: 2000,
      outcome: 'completed',
      parallel: true,
      gitRepo: true,
      agents: [{ id: 'a', name: 'Ada', role: 'impl', status: 'done', subtask: 's', doneSummary: 'd' }],
      doneCount: 1,
      totalCount: 1,
      messageCount: 3,
      merge: { merged: ['x', 'y'], promoted: true, conflicts: 0, stagingBranch: 'staging' },
    });
    expect(r.task).toBe('Build it');
    expect(r.outcome).toBe('completed');
    expect(r.agents).toHaveLength(1);
    expect(r.merge?.merged).toEqual(['x', 'y']);
  });

  it('defaults missing agents to [] so r.agents.map never throws', () => {
    const r = normalizeRun({ runId: 'r2', task: 't', outcome: 'aborted' });
    expect(r.agents).toEqual([]);
    expect(() => r.agents.map((a) => a.id)).not.toThrow();
  });

  it('repairs a merge object with a missing `merged` array', () => {
    const r = normalizeRun({ runId: 'r3', merge: { promoted: false, conflicts: 2 } });
    expect(r.merge?.merged).toEqual([]);
    expect(() => r.merge?.merged.length).not.toThrow();
    expect(r.merge?.conflicts).toBe(2);
  });

  it('filters non-string entries out of merge.merged', () => {
    const r = normalizeRun({ merge: { merged: ['ok', 5, null, 'fine'], promoted: false, conflicts: 0 } });
    expect(r.merge?.merged).toEqual(['ok', 'fine']);
  });

  it('coerces a non-object entry into a safe placeholder rather than throwing', () => {
    for (const bad of [null, undefined, 42, 'nope', []]) {
      const r = normalizeRun(bad);
      expect(typeof r.runId).toBe('string');
      expect(r.agents).toEqual([]);
      expect(r.outcome).toBe('failed');
      expect(r.startedAtMs).toBe(0);
    }
  });

  it('clamps an unknown outcome to "failed" (no arbitrary status leaks to the chip)', () => {
    expect(normalizeRun({ outcome: 'weird' }).outcome).toBe('failed');
    expect(normalizeRun({ outcome: 'completed' }).outcome).toBe('completed');
  });

  it('drops non-string agent fields to safe defaults', () => {
    const r = normalizeRun({ agents: [{ id: 7, name: null, status: undefined }] });
    expect(r.agents[0]).toMatchObject({ id: 'agent', name: 'Agent', status: 'unknown', role: '', subtask: '' });
  });
});
