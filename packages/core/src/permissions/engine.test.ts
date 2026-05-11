import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { asToolCallId } from '@moxxy/sdk';
import { PermissionEngine } from './engine.js';

const call = (name: string, input: unknown = {}) => ({
  callId: asToolCallId('c'),
  name,
  input,
});

describe('PermissionEngine', () => {
  it('returns null when no rules match', () => {
    const e = new PermissionEngine();
    expect(e.check(call('Read'))).toBeNull();
  });

  it('matches exact allow rule', () => {
    const e = new PermissionEngine({
      allow: [{ name: 'Read' }],
      deny: [],
    });
    expect(e.check(call('Read'))?.mode).toBe('allow');
  });

  it('deny takes priority over allow', () => {
    const e = new PermissionEngine({
      allow: [{ name: '*' }],
      deny: [{ name: 'Bash' }],
    });
    expect(e.check(call('Bash'))?.mode).toBe('deny');
    expect(e.check(call('Read'))?.mode).toBe('allow');
  });

  it('supports glob in name pattern', () => {
    const e = new PermissionEngine({
      allow: [{ name: 'mcp-*' }],
      deny: [],
    });
    expect(e.check(call('mcp-filesystem-read'))?.mode).toBe('allow');
    expect(e.check(call('Read'))).toBeNull();
  });

  it('respects inputMatches via regex', () => {
    const e = new PermissionEngine({
      allow: [{ name: 'Bash', inputMatches: { cmd: '^ls' } }],
      deny: [],
    });
    expect(e.check(call('Bash', { cmd: 'ls -la' }))?.mode).toBe('allow');
    expect(e.check(call('Bash', { cmd: 'rm -rf /' }))).toBeNull();
  });

  it('loads policy from disk and handles ENOENT', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-perm-'));
    const file = path.join(tmp, 'permissions.json');
    const e1 = await PermissionEngine.load(file);
    expect(e1.check(call('Read'))).toBeNull();

    await fs.writeFile(file, JSON.stringify({ allow: [{ name: 'Read' }], deny: [] }));
    const e2 = await PermissionEngine.load(file);
    expect(e2.check(call('Read'))?.mode).toBe('allow');
  });

  it('persists addAllow', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-perm-'));
    const file = path.join(tmp, 'permissions.json');
    const e = await PermissionEngine.load(file);
    await e.addAllow({ name: 'Edit', action: 'allow' });
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.allow[0].name).toBe('Edit');
  });
});
