import { describe, expect, it } from 'vitest';
import { EXIT_AFTER_PAIR_FLAG, finishPairing } from './channel.js';

/** Records the order of the two lifecycle steps a finished pairing performs. */
function harness(flags: Record<string, string | boolean | undefined> = {}) {
  const steps: string[] = [];
  const ctx = {
    args: { positional: [], flags },
    deps: { cwd: '/tmp' },
    startChannel: async (options?: Readonly<Record<string, unknown>>) => {
      steps.push(`start:${JSON.stringify(options ?? {})}`);
      return 7;
    },
  };
  const stopPairingBot = async () => {
    steps.push('stop-pairing-bot');
  };
  return { ctx, stopPairingBot, steps };
}

describe('finishPairing', () => {
  it('stops the pairing bot (it runs on a provider-less probe session) and starts the channel for real', async () => {
    const { ctx, stopPairingBot, steps } = harness();

    const code = await finishPairing(ctx, stopPairingBot);

    expect(steps).toEqual(['stop-pairing-bot', 'start:{}']);
    expect(code).toBe(7);
  });

  it('forwards the channel start options (e.g. an allow-list chosen during setup)', async () => {
    const { ctx, stopPairingBot, steps } = harness();

    await finishPairing(ctx, stopPairingBot, { allowedTools: ['Read'] });

    expect(steps).toEqual(['stop-pairing-bot', 'start:{"allowedTools":["Read"]}']);
  });

  it('hands control back without starting when an orchestrator asked to exit after pairing', async () => {
    const { ctx, stopPairingBot, steps } = harness({ [EXIT_AFTER_PAIR_FLAG]: true });

    expect(await finishPairing(ctx, stopPairingBot)).toBe(0);
    expect(steps).toEqual(['stop-pairing-bot']);
  });
});
