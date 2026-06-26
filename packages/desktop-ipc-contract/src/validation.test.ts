import { describe, it, expect } from 'vitest';
import { validateIpcInput, ipcInputSchemas } from './validation.js';
import { REMOTE_ALLOWED_COMMANDS } from './index.js';

describe('IPC payload validation', () => {
  it('rejects non-http(s) openExternal URLs', () => {
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'https://ok.com' })).not.toThrow();
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'file:///etc/passwd' })).toThrow();
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'javascript:alert(1)' })).toThrow();
  });

  it('confines provider names to a slug', () => {
    expect(() => validateIpcInput('provider.login.start', { loginId: 'abc', provider: 'openai-codex' })).not.toThrow();
    expect(() => validateIpcInput('provider.login.start', { loginId: 'abc', provider: '--flag' })).toThrow();
    expect(() => validateIpcInput('onboarding.saveProviderKey', { provider: '../x', secret: 'k' })).toThrow();
  });

  it('guards interactive-login ids + bounds the pasted answer', () => {
    expect(() =>
      validateIpcInput('provider.login.start', { loginId: 'A1-b2', provider: 'claude-code' }),
    ).not.toThrow();
    // loginId must be a plain token — no path/shell text.
    expect(() => validateIpcInput('provider.login.cancel', { loginId: '../x' })).toThrow();
    expect(() => validateIpcInput('provider.login.cancel', { loginId: '' })).toThrow();
    // Empty answer is valid (the "take the browser branch" choice).
    expect(() => validateIpcInput('provider.login.answer', { loginId: 'x', value: '' })).not.toThrow();
    expect(() =>
      validateIpcInput('provider.login.answer', { loginId: 'x', value: 'y'.repeat(8193) }),
    ).toThrow();
  });

  it('blocks skill-name path traversal', () => {
    expect(() => validateIpcInput('settings.writeSkill', { name: 'my-skill', body: 'x' })).not.toThrow();
    expect(() => validateIpcInput('settings.deleteSkill', { name: '../../etc/passwd' })).toThrow();
    expect(() => validateIpcInput('settings.readSkill', { name: '/abs/path' })).toThrow();
  });

  it('rejects oversize transcribe payloads', () => {
    expect(() => validateIpcInput('session.transcribe', { audioBase64: 'AAAA' })).not.toThrow();
    expect(() =>
      validateIpcInput('session.transcribe', { audioBase64: 'A'.repeat(40_000_001) }),
    ).toThrow();
  });

  it('whitelists prefs.update fields (rejects unknown keys)', () => {
    expect(() => validateIpcInput('prefs.update', { onboardingComplete: true })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { version: 99 })).toThrow();
    expect(() => validateIpcInput('prefs.update', { evil: 'x' })).toThrow();
  });

  it('pins settings.setReasoning effort to the known enum', () => {
    for (const effort of ['off', 'low', 'medium', 'high'] as const) {
      expect(() => validateIpcInput('settings.setReasoning', { effort })).not.toThrow();
    }
    expect(() =>
      validateIpcInput('settings.setReasoning', { workspaceId: 'ws', effort: 'high' }),
    ).not.toThrow();
    // Arbitrary strings can't reach the runner / provider request.
    expect(() => validateIpcInput('settings.setReasoning', { effort: 'maximum' })).toThrow();
    expect(() => validateIpcInput('settings.setReasoning', {})).toThrow();
    expect(() =>
      validateIpcInput('settings.setReasoning', { workspaceId: '', effort: 'low' }),
    ).toThrow();
  });

  it('bounds session.runTurn prompt + attachments', () => {
    expect(() => validateIpcInput('session.runTurn', { prompt: 'hi' })).not.toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', {
        prompt: '',
        attachments: [{ path: '/abs/file.txt', name: 'file.txt' }],
      }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', { prompt: 'x'.repeat(1_000_001) }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', {
        prompt: 'x',
        attachments: Array.from({ length: 65 }, () => ({ path: '/a', name: 'a' })),
      }),
    ).toThrow();
    expect(() =>
      validateIpcInput('session.runTurn', { prompt: 'x', attachments: [{ name: 'a' }] }),
    ).toThrow();
  });

  it('bounds desks.rename name', () => {
    expect(() => validateIpcInput('desks.rename', { id: 'd1', name: 'New name' })).not.toThrow();
    expect(() => validateIpcInput('desks.rename', { id: 'd1', name: '' })).toThrow();
    expect(() =>
      validateIpcInput('desks.rename', { id: 'd1', name: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('bounds sessions.create / rename names like desks.create / rename', () => {
    expect(() => validateIpcInput('sessions.create', undefined)).not.toThrow();
    expect(() => validateIpcInput('sessions.create', {})).not.toThrow();
    expect(() =>
      validateIpcInput('sessions.create', { deskId: 'd1', name: 'Research' }),
    ).not.toThrow();
    expect(() => validateIpcInput('sessions.create', { name: '' })).toThrow();
    expect(() => validateIpcInput('sessions.create', { name: 'x'.repeat(201) })).toThrow();
    expect(() =>
      validateIpcInput('sessions.rename', { id: 's1', name: 'New name' }),
    ).not.toThrow();
    expect(() => validateIpcInput('sessions.rename', { id: 's1', name: '' })).toThrow();
    expect(() =>
      validateIpcInput('sessions.rename', { id: 's1', name: 'x'.repeat(201) }),
    ).toThrow();
  });

  it('requires bounded ids for sessions.setActive / remove', () => {
    expect(() => validateIpcInput('sessions.setActive', { id: 's1' })).not.toThrow();
    expect(() => validateIpcInput('sessions.setActive', { id: '' })).toThrow();
    expect(() => validateIpcInput('sessions.setActive', {})).toThrow();
    expect(() => validateIpcInput('sessions.remove', { id: 's1' })).not.toThrow();
    expect(() => validateIpcInput('sessions.remove', { id: 'x'.repeat(257) })).toThrow();
  });

  it('requires a boolean for setAutoApprove', () => {
    expect(() =>
      validateIpcInput('session.setAutoApprove', { workspaceId: 'ws', enabled: true }),
    ).not.toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', { enabled: false })).not.toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', { enabled: 'yes' })).toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', {})).toThrow();
  });

  it('requires a strict boolean for mobileGateway.setEnabled', () => {
    expect(() => validateIpcInput('mobileGateway.setEnabled', { enabled: true })).not.toThrow();
    expect(() => validateIpcInput('mobileGateway.setEnabled', { enabled: 'yes' })).toThrow();
    expect(() => validateIpcInput('mobileGateway.setEnabled', {})).toThrow();
    // .strict() rejects extra keys (a hostile caller can't smuggle fields).
    expect(() =>
      validateIpcInput('mobileGateway.setEnabled', { enabled: true, evil: 1 }),
    ).toThrow();
  });

  it('pins mobileGateway.status / rotateToken to no payload', () => {
    expect(() => validateIpcInput('mobileGateway.status', undefined)).not.toThrow();
    expect(() => validateIpcInput('mobileGateway.rotateToken', undefined)).not.toThrow();
    expect(() => validateIpcInput('mobileGateway.status', { sneaky: 1 })).toThrow();
  });

  it('bounds local focus-window movement and resize payloads', () => {
    expect(() => validateIpcInput('focus.toggle', undefined)).not.toThrow();
    expect(() => validateIpcInput('focus.toggle', { sneaky: true })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 10, dy: -12 })).not.toThrow();
    expect(() =>
      validateIpcInput('focus.dragStart', { screenX: -1200, screenY: 240 }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('focus.dragMove', { screenX: 3200, screenY: 1800 }),
    ).not.toThrow();
    expect(() => validateIpcInput('focus.dragEnd', undefined)).not.toThrow();
    expect(() =>
      validateIpcInput('focus.resize', { width: 320, height: 76, resizable: false }),
    ).not.toThrow();

    expect(() => validateIpcInput('focus.moveBy', { dx: Number.POSITIVE_INFINITY, dy: 0 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: Number.NaN, dy: 0 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 10_001, dy: 0 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 0, dy: -10_001 })).toThrow();
    expect(() => validateIpcInput('focus.moveBy', { dx: 0, dy: 0, sneaky: true })).toThrow();
    expect(() =>
      validateIpcInput('focus.dragStart', { screenX: Number.NaN, screenY: 0 }),
    ).toThrow();
    expect(() =>
      validateIpcInput('focus.dragMove', { screenX: 100_001, screenY: 0 }),
    ).toThrow();
    expect(() =>
      validateIpcInput('focus.dragMove', { screenX: 0, screenY: 0, sneaky: true }),
    ).toThrow();
    expect(() => validateIpcInput('focus.dragEnd', { sneaky: true })).toThrow();

    expect(() => validateIpcInput('focus.resize', { width: 39, height: 44 })).toThrow();
    expect(() => validateIpcInput('focus.resize', { width: 44, height: 801 })).toThrow();
    expect(() => validateIpcInput('focus.resize', { width: Number.NaN, height: 44 })).toThrow();
  });

  it('allows mobileGatewayEnabled in prefs.update', () => {
    expect(() => validateIpcInput('prefs.update', { mobileGatewayEnabled: true })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { mobileGatewayEnabled: 'x' })).toThrow();
  });

  it('whitelists theme in prefs.update to the three known values', () => {
    expect(() => validateIpcInput('prefs.update', { theme: 'light' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: 'dark' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: 'system' })).not.toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: 'hotdog' })).toThrow();
    expect(() => validateIpcInput('prefs.update', { theme: true })).toThrow();
  });

  it('bounds the remote-reachable session.abortTurn turnId', () => {
    // Valid: a short turn id, with or without an explicit workspaceId.
    expect(() =>
      validateIpcInput('session.abortTurn', { turnId: 't-123' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.abortTurn', { workspaceId: 'ws', turnId: 't-123' }),
    ).not.toThrow();
    // turnId is required and bounded — empty / missing / oversized is rejected.
    expect(() => validateIpcInput('session.abortTurn', { turnId: '' })).toThrow();
    expect(() => validateIpcInput('session.abortTurn', {})).toThrow();
    expect(() =>
      validateIpcInput('session.abortTurn', { turnId: 't'.repeat(257) }),
    ).toThrow();
    // workspaceId, when present, is also bounded.
    expect(() =>
      validateIpcInput('session.abortTurn', { workspaceId: 'w'.repeat(257), turnId: 't' }),
    ).toThrow();
  });

  it('bounds the remote-reachable session.info workspaceId', () => {
    // Valid: no arg (active workspace) or a bounded workspaceId.
    expect(() => validateIpcInput('session.info', undefined)).not.toThrow();
    expect(() => validateIpcInput('session.info', {})).not.toThrow();
    expect(() => validateIpcInput('session.info', { workspaceId: 'ws' })).not.toThrow();
    expect(() =>
      validateIpcInput('session.info', { workspaceId: 'w'.repeat(257) }),
    ).toThrow();
    // An empty workspaceId (not undefined) is rejected.
    expect(() => validateIpcInput('session.info', { workspaceId: '' })).toThrow();
  });

  it('bounds the remote-reachable sessions.list deskId', () => {
    // Valid: no arg (active desk) or a bounded deskId.
    expect(() => validateIpcInput('sessions.list', undefined)).not.toThrow();
    expect(() => validateIpcInput('sessions.list', {})).not.toThrow();
    expect(() => validateIpcInput('sessions.list', { deskId: 'd1' })).not.toThrow();
    expect(() =>
      validateIpcInput('sessions.list', { deskId: 'd'.repeat(257) }),
    ).toThrow();
    expect(() => validateIpcInput('sessions.list', { deskId: '' })).toThrow();
  });

  it('schematizes every remote-reachable, arg-carrying command', () => {
    // Commands reachable over the WS bridge that accept a structured payload
    // MUST have a bounded schema so a hostile remote can't send garbage. The
    // few genuinely no-arg ones (probes / non-mutating reads with no payload)
    // are allow-listed here.
    const NO_ARG: ReadonlySet<string> = new Set([
      'connection.snapshotAll',
      'connection.activeWorkspace',
      'connection.retry',
      'session.hasTranscriber',
      'scheduler.list',
      'workflows.list',
    ]);
    for (const cmd of REMOTE_ALLOWED_COMMANDS) {
      if (NO_ARG.has(cmd)) continue;
      expect(ipcInputSchemas[cmd], `missing schema for remote command "${cmd}"`).toBeDefined();
    }
  });

  it('confines apps.* appId to a non-traversing slug', () => {
    // appId keys a per-app install dir + a network download, so it must be a
    // strict slug — no traversal, no separators, no uppercase, bounded length.
    for (const cmd of ['apps.status', 'apps.install', 'apps.uninstall'] as const) {
      expect(() => validateIpcInput(cmd, { appId: 'anonymizer' })).not.toThrow();
      expect(() => validateIpcInput(cmd, { appId: '../evil' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: 'a/b' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: 'Anonymizer' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: '' })).toThrow();
      expect(() => validateIpcInput(cmd, { appId: 'a'.repeat(65) })).toThrow();
      expect(() => validateIpcInput(cmd, {})).toThrow();
    }
  });

  it('confines channels.* channelId to a non-traversing slug', () => {
    // channelId is spawned as `moxxy <channelId>`, so it must be a strict slug —
    // no traversal, no separators, no leading dash (a flag), bounded length.
    for (const cmd of ['channels.start', 'channels.stop'] as const) {
      expect(() => validateIpcInput(cmd, { channelId: 'slack' })).not.toThrow();
      expect(() => validateIpcInput(cmd, { channelId: '../evil' })).toThrow();
      expect(() => validateIpcInput(cmd, { channelId: '-rf' })).toThrow();
      expect(() => validateIpcInput(cmd, { channelId: 'Slack' })).toThrow();
      expect(() => validateIpcInput(cmd, { channelId: '' })).toThrow();
      expect(() => validateIpcInput(cmd, {})).toThrow();
    }
  });

  it('bounds channels.saveConfig field count + value size (OOM/vault-bloat guard)', () => {
    expect(() =>
      validateIpcInput('channels.saveConfig', {
        channelId: 'slack',
        values: { botToken: 'xoxb-abc', signingSecret: 'sek' },
      }),
    ).not.toThrow();
    // Oversized secret value is rejected.
    expect(() =>
      validateIpcInput('channels.saveConfig', {
        channelId: 'slack',
        values: { botToken: 'x'.repeat(8193) },
      }),
    ).toThrow();
    // A traversing channelId is rejected even with a valid values bag.
    expect(() =>
      validateIpcInput('channels.saveConfig', { channelId: '../x', values: {} }),
    ).toThrow();
  });

  it('bounds anonymizer.parseDocument path + pins pickDocument to no payload', () => {
    expect(() => validateIpcInput('anonymizer.parseDocument', { path: '/a/b.txt' })).not.toThrow();
    expect(() => validateIpcInput('anonymizer.parseDocument', { path: '' })).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocument', { path: 'x'.repeat(4097) }),
    ).toThrow();
    // pickDocument takes nothing — a payload can't be smuggled across.
    expect(() => validateIpcInput('anonymizer.pickDocument', undefined)).not.toThrow();
    expect(() => validateIpcInput('anonymizer.pickDocument', { sneaky: 1 })).toThrow();
  });

  it('caps anonymizer.parseDocumentBytes name + base64 size (OOM guard)', () => {
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', { name: 'doc.pdf', dataBase64: 'AAAA' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', { name: '', dataBase64: 'AAAA' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', {
        name: 'n'.repeat(256),
        dataBase64: 'AAAA',
      }),
    ).toThrow();
    // Empty body and an over-cap body both rejected at the boundary.
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', { name: 'doc.pdf', dataBase64: '' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.parseDocumentBytes', {
        name: 'doc.pdf',
        dataBase64: 'A'.repeat(67_000_001),
      }),
    ).toThrow();
  });

  it('bounds anonymizer.saveRedacted name + content (OOM guard)', () => {
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', { suggestedName: 'out.txt', content: 'hi' }),
    ).not.toThrow();
    // Empty content is valid (a fully-redacted-to-nothing doc); name is required.
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', { suggestedName: 'out.txt', content: '' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', { suggestedName: '', content: 'hi' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('anonymizer.saveRedacted', {
        suggestedName: 'out.txt',
        content: 'x'.repeat(20_000_001),
      }),
    ).toThrow();
  });

  it('is a no-op for commands without a schema', () => {
    expect(() => validateIpcInput('connection.snapshotAll', undefined)).not.toThrow();
  });

  it('pins the remote-reachable desks.list command to no payload', () => {
    expect(() => validateIpcInput('desks.list', undefined)).not.toThrow();
    expect(() => validateIpcInput('desks.list', { sneaky: 1 })).toThrow();
  });

  it('bounds the remote-reachable desks.setActive id', () => {
    expect(() => validateIpcInput('desks.setActive', { id: 'desk-1' })).not.toThrow();
    expect(() => validateIpcInput('desks.setActive', { id: '' })).toThrow();
    expect(() => validateIpcInput('desks.setActive', { id: 'd'.repeat(257) })).toThrow();
  });

  it('allows remote mobile clients to list/switch desks without destructive workspace access', () => {
    expect(REMOTE_ALLOWED_COMMANDS.has('desks.list')).toBe(true);
    expect(REMOTE_ALLOWED_COMMANDS.has('desks.setActive')).toBe(true);
    expect(REMOTE_ALLOWED_COMMANDS.has('desks.create')).toBe(false);
    expect(REMOTE_ALLOWED_COMMANDS.has('desks.remove')).toBe(false);
    expect(REMOTE_ALLOWED_COMMANDS.has('desks.pickFolder')).toBe(false);
    expect(REMOTE_ALLOWED_COMMANDS.has('sessions.remove')).toBe(false);
  });

  it('allows paired mobile clients to switch the active model provider', () => {
    expect(REMOTE_ALLOWED_COMMANDS.has('session.setProvider')).toBe(true);
    expect(() =>
      validateIpcInput('session.setProvider', { workspaceId: 'workspace-1', provider: 'openai-codex' }),
    ).not.toThrow();
  });

  it('allows paired mobile clients to switch the shared active model', () => {
    expect(REMOTE_ALLOWED_COMMANDS.has('session.setModel')).toBe(true);
    expect(() =>
      validateIpcInput('session.setModel', { workspaceId: 'workspace-1', model: 'gpt-5.4' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.setModel', { workspaceId: 'workspace-1', model: null }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('session.setModel', { workspaceId: 'workspace-1', model: '' }),
    ).toThrow();
  });

  it('allows paired mobile clients to toggle session-scoped auto-approve', () => {
    expect(REMOTE_ALLOWED_COMMANDS.has('session.setAutoApprove')).toBe(true);
    expect(() =>
      validateIpcInput('session.setAutoApprove', { workspaceId: 'workspace-1', enabled: true }),
    ).not.toThrow();
  });

  it('allows paired mobile clients to manage existing scheduler entries with bounded ids', () => {
    expect(REMOTE_ALLOWED_COMMANDS.has('scheduler.list' as never)).toBe(true);
    expect(REMOTE_ALLOWED_COMMANDS.has('scheduler.setEnabled' as never)).toBe(true);
    expect(REMOTE_ALLOWED_COMMANDS.has('scheduler.delete' as never)).toBe(true);

    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: 'daily-summary', enabled: false }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('scheduler.delete' as never, { id: 'daily-summary' }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: '', enabled: true }),
    ).toThrow();
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: 's'.repeat(257), enabled: true }),
    ).toThrow();
    expect(() =>
      validateIpcInput('scheduler.setEnabled' as never, { id: 'daily-summary', enabled: 'yes' }),
    ).toThrow();
    expect(() =>
      validateIpcInput('scheduler.delete' as never, { id: 's'.repeat(257) }),
    ).toThrow();
  });
});
