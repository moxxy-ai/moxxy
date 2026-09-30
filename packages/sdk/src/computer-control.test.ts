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

it('carries the agent cursor as a fraction of the target window, and the target the human sees', () => {
  const snapshot={sessionId:'s',turnId:'t',state:'background',windowId:null,
    cursor:{phase:'moving',x:0.25,y:1},target:{app:'TextEdit',window:'Untitled'}};
  expect(computerControlSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,cursor:{...snapshot.cursor,x:1.5}}).success).toBe(false);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,cursor:{...snapshot.cursor,phase:'teleporting'}}).success).toBe(false);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,cursor:{...snapshot.cursor,screenX:10}}).success).toBe(false);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,target:{app:'',window:null}}).success).toBe(false);
  expect(computerControlSnapshotSchema.safeParse({...snapshot,target:{app:'TextEdit',window:'x'.repeat(300)}}).success).toBe(false);
});
