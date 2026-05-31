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

  it('requires a boolean for setAutoApprove', () => {
    expect(() =>
      validateIpcInput('session.setAutoApprove', { workspaceId: 'ws', enabled: true }),
    ).not.toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', { enabled: false })).not.toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', { enabled: 'yes' })).toThrow();
    expect(() => validateIpcInput('session.setAutoApprove', {})).toThrow();
  });

  it('is a no-op for commands without a schema', () => {
    expect(() => validateIpcInput('desks.list', undefined)).not.toThrow();
    expect(() => validateIpcInput('connection.snapshotAll', undefined)).not.toThrow();
  });
});
