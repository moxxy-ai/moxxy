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

  it('inputMatches is an unanchored substring match by design (u40-2)', () => {
    // Documented, stable contract: `inputMatches` values are UNANCHORED regexes
    // (re.test → substring match). An author who needs a full match anchors
    // their own pattern. We pin both halves of that contract so it can never be
    // silently changed (anchoring it would break existing permission files).
    const substring = new PermissionEngine({
      allow: [{ name: 'Read', inputMatches: { path: 'config' } }],
      deny: [],
    });
    // Substring pattern matches anywhere in the candidate — by design.
    expect(substring.check(call('Read', { path: '/etc/config' }))?.mode).toBe('allow');
    expect(substring.check(call('Read', { path: '/etc/config-evil' }))?.mode).toBe('allow');
    expect(substring.check(call('Read', { path: '~/.ssh/config-backup' }))?.mode).toBe('allow');
    // A path that does not contain the pattern at all is not matched.
    expect(substring.check(call('Read', { path: '/etc/passwd' }))).toBeNull();

    // An author who wants a full match supplies their own ^…$ anchors.
    const anchored = new PermissionEngine({
      allow: [{ name: 'Read', inputMatches: { path: '^/etc/config$' } }],
      deny: [],
    });
    expect(anchored.check(call('Read', { path: '/etc/config' }))?.mode).toBe('allow');
    expect(anchored.check(call('Read', { path: '/etc/config-evil' }))).toBeNull();
  });

  it('deny rule with an invalid-regex inputMatches still denies (fails closed)', () => {
    // Unbalanced bracket = uncompilable regex. The user clearly intended to
    // block `rm -rf`; the old fallback (literal !== equality) silently turned
    // this into a no-op deny, letting the dangerous command through.
    const e = new PermissionEngine({
      allow: [],
      deny: [{ name: 'Bash', inputMatches: { cmd: 'rm -rf [' } }],
    });
    // A call whose input contains that substring (and any other call to the
    // named tool) must still be denied — never silently allowed.
    expect(e.check(call('Bash', { cmd: 'rm -rf /' }))?.mode).toBe('deny');
    expect(e.check(call('Bash', { cmd: 'echo rm -rf [' }))?.mode).toBe('deny');
    // A call to a different tool is unaffected by the bad rule.
    expect(e.check(call('Read', { cmd: 'whatever' }))).toBeNull();
  });

  it('allow rule with an invalid-regex inputMatches does NOT over-grant', () => {
    const e = new PermissionEngine({
      allow: [{ name: 'Bash', inputMatches: { cmd: 'ls [' } }],
      deny: [],
    });
    // The bad pattern can never compile, so the allow rule must not grant —
    // not even for a call whose input literally contains the broken text.
    expect(e.check(call('Bash', { cmd: 'ls -la' }))).toBeNull();
    expect(e.check(call('Bash', { cmd: 'ls [' }))).toBeNull();
  });

  it('inputMatches against a structured (object/array) field matches its JSON form', () => {
    // u40-4: a structured tool-input field used to coerce to '[object Object]',
    // so an inputMatches regex could never match it. It is now JSON-serialized.
    const e = new PermissionEngine({
      allow: [],
      deny: [{ name: 'shell', inputMatches: { argv: '"--force"' } }],
    });
    // The deny rule matches the serialized array element.
    expect(e.check(call('shell', { argv: ['rm', '--force'] }))?.mode).toBe('deny');
    // …and does not match an argv without it.
    expect(e.check(call('shell', { argv: ['ls', '-la'] }))).toBeNull();
  });

  it('valid-regex deny rule still behaves exactly as before', () => {
    const e = new PermissionEngine({
      allow: [],
      deny: [{ name: 'Bash', inputMatches: { cmd: '^rm ' } }],
    });
    expect(e.check(call('Bash', { cmd: 'rm -rf /' }))?.mode).toBe('deny');
    expect(e.check(call('Bash', { cmd: 'ls -la' }))).toBeNull();
  });

  it('valid-regex allow rule still behaves exactly as before', () => {
    const e = new PermissionEngine({
      allow: [{ name: 'Bash', inputMatches: { cmd: '^ls' } }],
      deny: [],
    });
    expect(e.check(call('Bash', { cmd: 'ls -la' }))?.mode).toBe('allow');
    expect(e.check(call('Bash', { cmd: 'rm -rf /' }))).toBeNull();
  });

  it('bounds a pathological pattern + long model input so the check cannot hang (ReDoS guard)', () => {
    // The permission check runs author-supplied patterns over MODEL-controlled
    // input on the synchronous critical path of every tool call. A catastrophic
    // pattern plus a long input string would otherwise pin the event loop. The
    // candidate is truncated before `.test`, so the worst case is bounded.
    const e = new PermissionEngine({
      allow: [{ name: 'Bash', inputMatches: { cmd: '(a+)+$' } }],
      deny: [],
    });
    // 200k of 'a' followed by a non-matching char is the classic ReDoS trigger;
    // unbounded this never returns. Bounded, it completes effectively instantly.
    const evil = 'a'.repeat(200_000) + '!';
    const start = Date.now();
    const decision = e.check(call('Bash', { cmd: evil }));
    const elapsed = Date.now() - start;
    // No catastrophic backtracking: must return well under a second.
    expect(elapsed).toBeLessThan(1000);
    // After truncation to 8 KB the trailing '!' is dropped, so '(a+)+$' matches
    // the all-'a' prefix — the decision is well-defined, not a hang.
    expect(decision?.mode).toBe('allow');
  });

  it('truncates the candidate to the match cap before a glob name test', () => {
    // The glob `prefix-*` becomes `^prefix-.*$`. With the candidate length-capped
    // at 8 KB, a name longer than that still matches the prefix glob (the tail is
    // dropped) and the check returns promptly rather than scanning a huge string.
    const e = new PermissionEngine({
      allow: [{ name: 'prefix-*' }],
      deny: [],
    });
    const start = Date.now();
    const decision = e.check(call('prefix-' + 'x'.repeat(100_000)));
    expect(Date.now() - start).toBeLessThan(1000);
    expect(decision?.mode).toBe('allow');
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
