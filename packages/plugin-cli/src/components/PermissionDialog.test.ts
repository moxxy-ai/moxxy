import { describe, expect, it } from 'vitest';
import { asToolCallId } from '@moxxy/sdk';
import { describePermissionRequest, previewToolInput } from './PermissionDialog.js';

describe('previewToolInput — redacts secret-named fields before display', () => {
  it('masks common secret keys instead of echoing them verbatim', () => {
    const out = previewToolInput({
      apiKey: 'sk-live-DEADBEEF',
      token: 'ghp_supersecret',
      password: 'hunter2',
      url: 'https://example.com',
    });
    expect(out).not.toContain('sk-live-DEADBEEF');
    expect(out).not.toContain('ghp_supersecret');
    expect(out).not.toContain('hunter2');
    // Non-secret fields are preserved.
    expect(out).toContain('https://example.com');
    expect(out).toContain('[redacted]');
  });

  it('matches case-insensitively and hyphen/underscore variants', () => {
    const out = previewToolInput({
      API_KEY: 'a',
      'access-key': 'b',
      Authorization: 'Bearer xyz',
      privateKey: 'c',
    });
    expect(out).not.toContain('Bearer xyz');
    expect(out).not.toMatch(/"a"|"b"|"c"/);
  });

  it('redacts secrets nested inside objects', () => {
    const out = previewToolInput({ headers: { authorization: 'Bearer leaky' } });
    expect(out).not.toContain('Bearer leaky');
    expect(out).toContain('[redacted]');
  });

  it('caps length at 200 chars', () => {
    const out = previewToolInput({ blob: 'x'.repeat(1000) });
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('never throws on a circular / unserializable input', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => previewToolInput(circular)).not.toThrow();
    expect(previewToolInput(circular)).toBe('[unserializable]');
  });

  it('does not blow the stack on a pathologically deep input', () => {
    let deep: Record<string, unknown> = { secret: 'x' };
    for (let i = 0; i < 10000; i += 1) deep = { nested: deep };
    expect(() => previewToolInput(deep)).not.toThrow();
  });
});

describe('describePermissionRequest — consequence-first copy', () => {
  const ctx = { sessionId: 's', toolDescription: 'Optional action' };

  it('describes shell approval without exposing permission jargon', () => {
    const result = describePermissionRequest(
      {
        callId: asToolCallId('c1'),
        name: 'Bash',
        input: { command: 'pnpm test', cwd: '/repo' },
      },
      ctx,
      '/repo',
    );
    expect(result.title).toBe('Run this command?');
    expect(result.target).toBe('pnpm test');
    expect(result.sessionScope.inputKeys).toEqual(['command', 'cwd']);
  });

  it('makes the workspace boundary explicit for external reads', () => {
    const result = describePermissionRequest(
      {
        callId: asToolCallId('c2'),
        name: 'Read',
        input: { file_path: '/tmp/private.txt' },
      },
      ctx,
      '/repo',
    );
    expect(result.title).toBe('Access outside this workspace?');
    expect(result.impact).toContain('repo');
    expect(result.target).toBe('/tmp/private.txt');
  });

  it('scopes edit approval to the selected file', () => {
    const result = describePermissionRequest(
      {
        callId: asToolCallId('c3'),
        name: 'Edit',
        input: { file_path: '/repo/src/app.ts' },
      },
      ctx,
      '/repo',
    );
    expect(result.title).toBe('Change this file?');
    expect(result.target).toBe('src/app.ts');
    expect(result.sessionScope.inputKeys).toEqual(['file_path']);
  });
});
