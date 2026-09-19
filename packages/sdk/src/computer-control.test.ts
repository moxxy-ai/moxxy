import { expect, it } from 'vitest';
import { computerControlCommandSchema, computerControlSnapshotSchema } from './computer-control.js';

it('requires exact session and turn ownership for human control commands', () => {
  const command={sessionId:'session-a',turnId:'turn-a',command:'stop'};
  expect(computerControlCommandSchema.safeParse(command).success).toBe(true);
  expect(computerControlCommandSchema.safeParse({turnId:'turn-a',command:'stop'}).success).toBe(false);
  expect(computerControlCommandSchema.safeParse({...command,command:'restart'}).success).toBe(false);
  expect(computerControlCommandSchema.safeParse({...command,workspaceId:'unexpected'}).success).toBe(false);
});

it('validates bounded control-state snapshots, never executable commands', () => {
  const snapshot={sessionId:'s',turnId:'t',state:'waiting_for_focus',windowId:null};
  expect(computerControlSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,state:'running arbitrary code'}).success).toBe(false);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,windowId:'x'.repeat(200)}).success).toBe(false);
});
