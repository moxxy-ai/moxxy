import { describe, it, expect } from 'vitest';
import { alwaysAllowRule, createAllowListResolver, createDeferredPermissionResolver, createSessionGrants, evaluateToolRule } from './resolvers.js';
import type { PendingToolCall, PermissionRule } from './permission.js';

function call(name: string, input: unknown = {}): PendingToolCall {
  return { callId: 'c1', name, input } as unknown as PendingToolCall;
}

describe('evaluateToolRule', () => {
  it('returns null when the tool declares no rule (defer to resolver)', () => {
    expect(evaluateToolRule(undefined, call('reload_skills'))).toBeNull();
  });

  it('allows a tool that declares action allow', () => {
    const rule: PermissionRule = { action: 'allow' };
    expect(evaluateToolRule(rule, call('reload_skills'))).toEqual({
      mode: 'allow',
      reason: 'tool-declared allow',
    });
  });

  it('denies a tool that declares action deny', () => {
    const rule: PermissionRule = { action: 'deny', reason: 'nope' };
    expect(evaluateToolRule(rule, call('danger'))).toEqual({ mode: 'deny', reason: 'nope' });
  });

  it('defers (null) for action prompt so the interactive resolver decides', () => {
    expect(evaluateToolRule({ action: 'prompt' }, call('self_update_verify'))).toBeNull();
  });

  it('only applies when the name pattern matches', () => {
    const rule: PermissionRule = { action: 'allow', pattern: { name: 'reload_skills' } };
    expect(evaluateToolRule(rule, call('reload_skills'))).not.toBeNull();
    expect(evaluateToolRule(rule, call('other_tool'))).toBeNull();
  });

  it('matches on inputMatches (string + RegExp)', () => {
    const rule: PermissionRule = {
      action: 'allow',
      pattern: { inputMatches: { path: /^\/tmp\// } },
    };
    expect(evaluateToolRule(rule, call('write', { path: '/tmp/ok.txt' }))).not.toBeNull();
    expect(evaluateToolRule(rule, call('write', { path: '/etc/passwd' }))).toBeNull();
  });

  it('defers workspace-scoped rules to the filesystem-aware core evaluator', () => {
    const rule: PermissionRule = {
      action: 'allow',
      workspace: { pathInputs: [{ key: 'file_path' }] },
    };
    expect(evaluateToolRule(rule, call('Read', { file_path: 'README.md' }))).toBeNull();
  });
});

describe('createDeferredPermissionResolver scoped session grants', () => {
  it('remembers only the matching consequence, not every call from the tool', async () => {
    let prompts = 0;
    const resolver = createDeferredPermissionResolver({
      prompt: async () => {
        prompts += 1;
        return { mode: 'allow_session', sessionScope: { inputKeys: ['file_path'] } };
      },
    });
    const ctx = { sessionId: 's' };

    await resolver.check(call('Write', { file_path: 'one.ts', content: 'a' }), ctx);
    await resolver.check(call('Write', { file_path: 'one.ts', content: 'b' }), ctx);
    await resolver.check(call('Write', { file_path: 'two.ts', content: 'b' }), ctx);

    expect(prompts).toBe(2);
  });
});

describe('a decision made now', () => {
  it('is marked when the prompt was answered for this call, not when an earlier answer is reused', async () => {
    const resolver = createDeferredPermissionResolver({ prompt: async () => ({ mode: 'allow_session' }) });
    const ctx = { sessionId: 's' };
    expect((await resolver.check(call('computer_run', { app: 'Notes' }), ctx)).decidedNow).toBe(true);
    expect((await resolver.check(call('computer_run', { app: 'Mail' }), ctx)).decidedNow).toBeUndefined();
  });

  it('is marked for a tool the run was started with on its allow-list', async () => {
    expect((await createAllowListResolver(['computer_run']).check(call('computer_run', {}), { sessionId: 's' })).decidedNow).toBe(true);
  });
});

describe('a plain allow is one call, not a session grant', () => {
  it('asks again for the same tool after "allow" (one call only)', async () => {
    let prompts = 0;
    const resolver = createDeferredPermissionResolver({
      prompt: async () => {
        prompts += 1;
        return { mode: 'allow' };
      },
    });
    const ctx = { sessionId: 's' };
    await resolver.check(call('computer_click', { app: 'LM Studio' }), ctx);
    await resolver.check(call('computer_click', { app: 'LM Studio' }), ctx);
    expect(prompts).toBe(2);
  });

  it('does not ask again for the same tool after "allow_session"', async () => {
    let prompts = 0;
    const resolver = createDeferredPermissionResolver({
      prompt: async () => {
        prompts += 1;
        return { mode: 'allow_session' };
      },
    });
    const ctx = { sessionId: 's' };
    await resolver.check(call('computer_click', { app: 'LM Studio' }), ctx);
    await resolver.check(call('computer_click', { app: 'Safari' }), ctx);
    expect(prompts).toBe(1);
  });
});

// computer_request_access grants an app by itself: an answer for Safari must not let Terminal through.
describe('a tool that narrows its grant to the same request', () => {
  const narrowed: PermissionRule = { action: 'prompt', sessionScope: { inputKeys: ['apps', 'full_access'] } };
  const ctx = { sessionId: 's', toolPermission: narrowed };

  it.each(['allow_session', 'allow_always'] as const)('remembers only that request after "%s", in this conversation', async (mode) => {
    let prompts = 0;
    const resolver = createDeferredPermissionResolver({
      prompt: async () => {
        prompts += 1;
        return { mode };
      },
    });

    await resolver.check(call('grant_access', { apps: ['Safari'], full_access: true, reason: 'a' }), ctx);
    await resolver.check(call('grant_access', { apps: ['Safari'], full_access: true, reason: 'b' }), ctx);
    await resolver.check(call('grant_access', { apps: ['Terminal'], full_access: true }), ctx);
    await resolver.check(call('grant_access', { apps: ['Safari'] }), ctx);

    expect(prompts).toBe(3);
  });

  it('is remembered the same way by a channel that keeps its own grants', () => {
    const grants = createSessionGrants();
    grants.remember(call('grant_access', { apps: ['Safari'], full_access: true }), { mode: 'allow_session' }, ctx);

    expect(grants.covers(call('grant_access', { apps: ['Safari'], full_access: true }))).toBe(true);
    expect(grants.covers(call('grant_access', { apps: ['Terminal'], full_access: true }))).toBe(false);
  });

  it('is saved for later conversations as that exact request, a left-out value as null', () => {
    expect(alwaysAllowRule(call('grant_access', { apps: ['Safari'], reason: 'browse' }), ctx)).toEqual({
      name: 'grant_access',
      inputEquals: { apps: ['Safari'], full_access: null },
    });
  });

  it('is saved as the whole tool for a tool that does not narrow its grant', () => {
    expect(alwaysAllowRule(call('Write', { file_path: 'a.ts' }), { sessionId: 's' })).toEqual({ name: 'Write' });
  });
});

describe('session grants of a channel', () => {
  it('cover the whole tool after "allow_session" for a tool that does not narrow it, and nothing after "allow"', () => {
    const grants = createSessionGrants();
    grants.remember(call('computer_click', { app: 'Notes' }), { mode: 'allow' }, { sessionId: 's' });
    expect(grants.covers(call('computer_click', { app: 'Notes' }))).toBe(false);

    grants.remember(call('computer_click', { app: 'Notes' }), { mode: 'allow_session' }, { sessionId: 's' });
    expect(grants.covers(call('computer_click', { app: 'Mail' }))).toBe(true);
  });
});
