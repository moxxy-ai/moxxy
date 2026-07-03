import { describe, expect, it, vi } from 'vitest';
import type { ProviderSetupView } from '@moxxy/sdk';
import { createConnectFlow, type ConnectPhase } from './provider-connect-flow.js';

function makeSetup(over: Partial<ProviderSetupView> = {}): ProviderSetupView {
  return {
    authKind: vi.fn(() => 'apiKey' as const),
    ensureInstalled: vi.fn(async () => true),
    testKey: vi.fn(async () => ({ ok: true }) as const),
    saveKey: vi.fn(async () => undefined),
    loginOAuth: vi.fn(async () => ({})),
    ...over,
  };
}

function collector() {
  const phases: ConnectPhase[] = [];
  return { phases, onPhase: (p: ConnectPhase) => phases.push(p) };
}

describe('createConnectFlow — start', () => {
  it('unknown provider fails non-retryable', async () => {
    const { phases, onPhase } = collector();
    const flow = createConnectFlow({
      setup: makeSetup({ authKind: () => null }),
      providerId: 'nope',
      onPhase,
      onSuccess: vi.fn(),
    });
    await flow.start();
    expect(phases.at(-1)).toMatchObject({ kind: 'failed', retryable: false });
  });

  it('apiKey provider lands on key-entry after install', async () => {
    const { phases, onPhase } = collector();
    const setup = makeSetup();
    const flow = createConnectFlow({ setup, providerId: 'anthropic', onPhase, onSuccess: vi.fn() });
    await flow.start();
    expect(setup.ensureInstalled).toHaveBeenCalledWith('anthropic');
    expect(phases.map((p) => p.kind)).toEqual(['installing', 'key-entry']);
  });

  it('a no-auth provider succeeds immediately', async () => {
    const onSuccess = vi.fn();
    const { onPhase, phases } = collector();
    const flow = createConnectFlow({
      setup: makeSetup({ authKind: () => 'none' }),
      providerId: 'local',
      onPhase,
      onSuccess,
    });
    await flow.start();
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(phases.at(-1)?.kind).toBe('done');
  });

  it('install failure is retryable; not-registered-after-install is not', async () => {
    const { onPhase, phases } = collector();
    const failing = createConnectFlow({
      setup: makeSetup({ ensureInstalled: vi.fn(async () => { throw new Error('npm 404'); }) }),
      providerId: 'x',
      onPhase,
      onSuccess: vi.fn(),
    });
    await failing.start();
    expect(phases.at(-1)).toMatchObject({ kind: 'failed', retryable: true });

    const { onPhase: onPhase2, phases: phases2 } = collector();
    const notRegistered = createConnectFlow({
      setup: makeSetup({ ensureInstalled: vi.fn(async () => false) }),
      providerId: 'x',
      onPhase: onPhase2,
      onSuccess: vi.fn(),
    });
    await notRegistered.start();
    expect(phases2.at(-1)).toMatchObject({ kind: 'failed', retryable: false });
  });
});

describe('createConnectFlow — submitKey', () => {
  it('valid key: saves and succeeds', async () => {
    const onSuccess = vi.fn();
    const setup = makeSetup();
    const { onPhase } = collector();
    const flow = createConnectFlow({ setup, providerId: 'anthropic', onPhase, onSuccess });
    await flow.submitKey('sk-ant-good');
    expect(setup.saveKey).toHaveBeenCalledWith('anthropic', 'sk-ant-good');
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('rejected key: stays on key-entry with the error, never saves', async () => {
    const setup = makeSetup({
      testKey: vi.fn(async () => ({ ok: false, message: 'invalid x-api-key' }) as const),
    });
    const { onPhase, phases } = collector();
    const onSuccess = vi.fn();
    const flow = createConnectFlow({ setup, providerId: 'anthropic', onPhase, onSuccess });
    await flow.submitKey('sk-bad');
    expect(setup.saveKey).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(phases.at(-1)).toMatchObject({
      kind: 'key-entry',
      error: 'anthropic rejected the key: invalid x-api-key',
    });
  });

  it('validator unreachable: saves unvalidated and says so', async () => {
    const setup = makeSetup({
      testKey: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    });
    const onSuccess = vi.fn();
    const { onPhase } = collector();
    const flow = createConnectFlow({ setup, providerId: 'anthropic', onPhase, onSuccess });
    await flow.submitKey('sk-maybe');
    expect(setup.saveKey).toHaveBeenCalledWith('anthropic', 'sk-maybe');
    expect(onSuccess).toHaveBeenCalledWith(expect.stringContaining('saved unvalidated'));
  });

  it('empty key re-prompts', async () => {
    const setup = makeSetup();
    const { onPhase, phases } = collector();
    const flow = createConnectFlow({ setup, providerId: 'a', onPhase, onSuccess: vi.fn() });
    await flow.submitKey('   ');
    expect(setup.testKey).not.toHaveBeenCalled();
    expect(phases.at(-1)).toMatchObject({ kind: 'key-entry', error: expect.stringContaining('paste') });
  });
});

describe('createConnectFlow — oauth', () => {
  it('streams write lines, resolves a paste-back prompt, succeeds', async () => {
    const onSuccess = vi.fn();
    const { onPhase, phases } = collector();
    const setup = makeSetup({
      authKind: () => 'oauth',
      loginOAuth: vi.fn(async (_id, io) => {
        io!.write('open https://example.test/auth\n');
        const code = await io!.prompt!('Paste the code:', { mask: true });
        expect(code).toBe('the-code');
        return { accountId: 'me@example.test' };
      }),
    });
    const flow = createConnectFlow({ setup, providerId: 'claude-code', onPhase, onSuccess });
    const started = flow.start();
    // Wait for the prompt phase to appear, then answer it.
    await vi.waitFor(() => {
      const last = phases.at(-1);
      expect(last?.kind === 'oauth' && last.prompt !== null).toBe(true);
    });
    flow.answerPrompt('the-code');
    await started;
    expect(onSuccess).toHaveBeenCalledTimes(1);
    const oauthPhases = phases.filter((p) => p.kind === 'oauth');
    expect(oauthPhases.some((p) => p.kind === 'oauth' && p.lines.some((l) => l.includes('example.test')))).toBe(true);
  });

  it('login failure is retryable', async () => {
    const { onPhase, phases } = collector();
    const setup = makeSetup({
      authKind: () => 'oauth',
      loginOAuth: vi.fn(async () => {
        throw new Error('OAUTH_FLOW_TIMEOUT');
      }),
    });
    const flow = createConnectFlow({ setup, providerId: 'codex', onPhase, onSuccess: vi.fn() });
    await flow.start();
    expect(phases.at(-1)).toMatchObject({ kind: 'failed', retryable: true });
  });

  it('cancel unblocks a pending prompt with an empty answer', async () => {
    const { onPhase, phases } = collector();
    let received: string | null = null;
    const setup = makeSetup({
      authKind: () => 'oauth',
      loginOAuth: vi.fn(async (_id, io) => {
        received = await io!.prompt!('Paste:', {});
        throw new Error('cancelled');
      }),
    });
    const flow = createConnectFlow({ setup, providerId: 'codex', onPhase, onSuccess: vi.fn() });
    const started = flow.start();
    await vi.waitFor(() => {
      const last = phases.at(-1);
      expect(last?.kind === 'oauth' && last.prompt !== null).toBe(true);
    });
    flow.cancel();
    await started;
    expect(received).toBe('');
    // Cancelled flows go quiet — no failed phase after cancel.
    expect(phases.at(-1)?.kind).not.toBe('failed');
  });
});
