import { describe, it, expect } from 'vitest';
import { REMOTE_ALLOWED_COMMANDS } from './index.js';
import type { IpcCommandName } from './index.js';

/**
 * The remote/mobile trust surface is security-load-bearing: it is the single
 * allow-list the WebSocket bridge enforces deny-by-default. These tests pin the
 * exact membership so a refactor (the barrel split) cannot silently widen or
 * narrow what a paired phone may invoke, and so a future edit that adds a
 * host-mutating command to the set is caught.
 */
describe('REMOTE_ALLOWED_COMMANDS', () => {
  it('is exactly the chat-client trust surface (no more, no less)', () => {
    const expected: ReadonlyArray<IpcCommandName> = [
      'ask.respond',
      'connection.snapshotAll',
      'connection.activeWorkspace',
      'connection.retry',
      'session.info',
      'session.runTurn',
      'session.abortTurn',
      'session.setMode',
      'session.newSession',
      'session.runCommand',
      'sessions.list',
      'sessions.create',
      'sessions.setActive',
      'sessions.rename',
      'session.hasTranscriber',
      'session.transcribe',
      'chat.append',
      'chat.loadSegment',
      'chat.clearLog',
      'chat.migrate',
      'workflows.list',
      'workflows.run',
      'workflows.getRun',
      'workflows.resume',
    ];
    expect([...REMOTE_ALLOWED_COMMANDS].sort()).toEqual([...expected].sort());
  });

  it('keeps host-mutating / control commands OFF the allow-list', () => {
    const denied: ReadonlyArray<IpcCommandName> = [
      'session.setAutoApprove',
      'sessions.remove',
      'desks.create',
      'desks.remove',
      'settings.vaultSet',
      'settings.vaultDelete',
      // Session-config mutation (reasoning effort) — host-only, like the other
      // settings writes; a paired phone holds a conversation, it doesn't retune
      // the runner's generation config.
      'settings.setReasoning',
      'app.updateCli',
      'prefs.update',
      'workflows.save',
      'workflows.validateDraft',
      'workflows.setEnabled',
      'mobileGateway.setEnabled',
      'mobileGateway.rotateToken',
      'mobileGateway.status',
    ];
    for (const cmd of denied) {
      expect(REMOTE_ALLOWED_COMMANDS.has(cmd)).toBe(false);
    }
  });
});
