import { describe, expect, it } from 'vitest';
import { assertDefined } from '@moxxy/sdk';
import { setActiveBus } from './shared';
import { registerOnboardingHandlers } from './onboarding';

type Handler = (...args: unknown[]) => Promise<unknown>;

function captureHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  setActiveBus({
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
  } as never);
  registerOnboardingHandlers({ active: () => undefined } as never);
  return handlers;
}

describe('onboarding.providerAuthKind before a runner is reachable', () => {
  it.each(['claude-code', 'codex-agent', 'opencode'])('signs in to %s rather than asking for a key', async (provider) => {
    const authKind = captureHandlers().get('onboarding.providerAuthKind');
    assertDefined(authKind, 'onboarding.providerAuthKind handler');
    expect(await authKind({ provider })).toBe('oauth');
  });

  it.each(['anthropic', 'openai'])('asks for an API key for %s', async (provider) => {
    const authKind = captureHandlers().get('onboarding.providerAuthKind');
    assertDefined(authKind, 'onboarding.providerAuthKind handler');
    expect(await authKind({ provider })).toBe('api-key');
  });
});
