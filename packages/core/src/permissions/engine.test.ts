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
    await e.addAllow({ name: 'Edit' });
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.allow[0].name).toBe('Edit');
  });

  it('persists inputMatches with addAllow (regression for silent drop)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-perm-'));
    const file = path.join(tmp, 'permissions.json');
    const e = await PermissionEngine.load(file);
    await e.addAllow({
      name: 'Bash',
      inputMatches: { cmd: '^ls' },
      reason: 'safe listings only',
    });
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    expect(raw.allow[0]).toEqual({
      name: 'Bash',
      inputMatches: { cmd: '^ls' },
      reason: 'safe listings only',
    });

    // Reload and verify it still matches correctly.
    const e2 = await PermissionEngine.load(file);
    expect(e2.check(call('Bash', { cmd: 'ls -la' }))?.mode).toBe('allow');
    expect(e2.check(call('Bash', { cmd: 'rm -rf /' }))).toBeNull();
  });

  it('writes the policy file atomically (tmp+rename, no .tmp residue)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-perm-'));
    const file = path.join(tmp, 'permissions.json');
    const e = await PermissionEngine.load(file);
    await e.addAllow({ name: 'A' });
    const after = await fs.readdir(tmp);
    expect(after.filter((f) => f.startsWith('permissions.json.tmp.'))).toEqual([]);
    expect(after).toContain('permissions.json');
  });

  it('serializes concurrent mutators so no rule is lost (in-memory + on disk)', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-perm-'));
    const file = path.join(tmp, 'permissions.json');
    try {
      const e = await PermissionEngine.load(file);
      // Fire many adds without awaiting between them. Without the per-instance
      // mutex, overlapping persists rename out of order and the final file
      // reflects a stale snapshot (rows dropped).
      await Promise.all(Array.from({ length: 20 }, (_, i) => e.addAllow({ name: `tool-${i}` })));
      expect(e.policySnapshot.allow).toHaveLength(20);
      const reloaded = await PermissionEngine.load(file);
      expect(reloaded.policySnapshot.allow).toHaveLength(20);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
