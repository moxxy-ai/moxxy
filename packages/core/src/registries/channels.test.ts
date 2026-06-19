import type { ChannelDef, ChannelFactoryDeps } from '@moxxy/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelRegistryImpl } from './channels.js';

const deps = {} as ChannelFactoryDeps;

function fakeChannel(
  name: string,
  isAvailable?: ChannelDef['isAvailable'],
): ChannelDef {
  return {
    name,
    description: `channel ${name}`,
    create: () => ({}) as never,
    ...(isAvailable ? { isAvailable } : {}),
  };
}

describe('ChannelRegistryImpl.listWithAvailability', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a channel without isAvailable as ok and maps a thrown probe to not-ok', async () => {
    const reg = new ChannelRegistryImpl();
    reg.register(fakeChannel('always'));
    reg.register(
      fakeChannel('throws', async () => {
        throw new Error('boom');
      }),
    );
    const out = await reg.listWithAvailability(deps);
    const byName = Object.fromEntries(out.map((o) => [o.def.name, o.availability]));
    expect(byName.always).toEqual({ ok: true });
    expect(byName.throws).toEqual({ ok: false, reason: 'boom' });
  });

  it('does not let one hung probe block the others or the listing (bounded timeout)', async () => {
    vi.useFakeTimers();
    const reg = new ChannelRegistryImpl();
    // This probe never resolves — without a timeout it would wedge the listing.
    reg.register(fakeChannel('hung', () => new Promise<never>(() => {})));
    reg.register(fakeChannel('fast', async () => ({ ok: true })));

    const promise = reg.listWithAvailability(deps);
    // Advance past the probe timeout so the hung probe resolves to not-ok.
    await vi.advanceTimersByTimeAsync(5_000);
    const out = await promise;
    const byName = Object.fromEntries(out.map((o) => [o.def.name, o.availability]));
    expect(byName.fast).toEqual({ ok: true });
    expect(byName.hung.ok).toBe(false);
    expect(byName.hung.reason).toMatch(/timed out/);
  });

  it('runs probes in parallel — a slow probe does not starve a later fast one', async () => {
    vi.useFakeTimers();
    const reg = new ChannelRegistryImpl();
    let fastRan = false;
    reg.register(
      fakeChannel(
        'slow',
        () => new Promise<{ ok: true }>((resolve) => setTimeout(() => resolve({ ok: true }), 2_000)),
      ),
    );
    reg.register(
      fakeChannel('fast', async () => {
        fastRan = true;
        return { ok: true };
      }),
    );
    const promise = reg.listWithAvailability(deps);
    // The fast probe should already have started (parallel), before the slow
    // one's timer is even advanced.
    await Promise.resolve();
    expect(fastRan).toBe(true);
    await vi.advanceTimersByTimeAsync(2_000);
    await promise;
  });
});
