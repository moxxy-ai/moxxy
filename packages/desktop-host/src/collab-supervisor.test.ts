/**
 * Guards for the collaboration coordinator supervisor's idle-state contract —
 * the branches the IPC handlers hit when NO coordinator is running. (The
 * spawn/attach paths are integration-shaped — real subprocess + runner socket —
 * and are exercised by the collab-loop end-to-end suite + manual desktop runs;
 * here we pin the safe no-op behavior so a regression can't wedge a turn or
 * throw across the IPC boundary.)
 */

import { describe, expect, it } from 'vitest';

import {
  collabRunning,
  collabSnapshot,
  respondCollabApproval,
  runCollabCommand,
  stopCollab,
} from './collab-supervisor';

describe('CollabSupervisor — idle state (no coordinator)', () => {
  it('reports not-running and an empty snapshot', () => {
    expect(collabRunning()).toBe(false);
    expect(collabSnapshot()).toEqual([]);
  });

  it('stopCollab is a no-op that aborts zero turns', async () => {
    await expect(stopCollab()).resolves.toEqual({ abortedTurns: 0 });
  });

  it('a step-in command with no coordinator returns a clean error (never throws)', async () => {
    await expect(runCollabCommand('collab_say', 'all hi')).resolves.toEqual({
      kind: 'error',
      message: 'no collaboration is running',
    });
  });

  it('answering an unknown approval id is a harmless no-op', () => {
    expect(() => respondCollabApproval('does-not-exist', { optionId: 'approve' })).not.toThrow();
  });
});
