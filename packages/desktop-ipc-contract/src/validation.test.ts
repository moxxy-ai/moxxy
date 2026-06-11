import { describe, it, expect } from 'vitest';
import { validateIpcInput } from './validation.js';

describe('IPC payload validation', () => {
  it('rejects non-http(s) openExternal URLs', () => {
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'https://ok.com' })).not.toThrow();
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'file:///etc/passwd' })).toThrow();
    expect(() => validateIpcInput('onboarding.openExternal', { url: 'javascript:alert(1)' })).toThrow();
  });

  it('confines provider names to a slug', () => {
    expect(() => validateIpcInput('onboarding.runProviderLogin', { provider: 'openai-codex' })).not.toThrow();
    expect(() => validateIpcInput('onboarding.runProviderLogin', { provider: '--flag' })).toThrow();
    expect(() => validateIpcInput('onboarding.saveProviderKey', { provider: '../x', secret: 'k' })).toThrow();
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

  it('bounds chat.migrate workspaces + events', () => {
    expect(() =>
      validateIpcInput('chat.migrate', { workspaces: [{ workspaceId: 'w1', events: [] }] }),
    ).not.toThrow();
    expect(() =>
      validateIpcInput('chat.migrate', { workspaces: [{ workspaceId: '', events: [] }] }),
    ).toThrow();
    expect(() =>
      validateIpcInput('chat.migrate', {
        workspaces: [{ workspaceId: 'w1', events: Array.from({ length: 10_001 }, () => ({})) }],
      }),
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

  it('is a no-op for commands without a schema', () => {
    expect(() => validateIpcInput('desks.list', undefined)).not.toThrow();
    expect(() => validateIpcInput('connection.snapshotAll', undefined)).not.toThrow();
  });
});
