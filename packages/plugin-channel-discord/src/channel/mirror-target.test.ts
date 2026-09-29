import { describe, expect, it, vi } from 'vitest';
import type { SendableChannelLike } from './discord-like.js';
import { MirrorTarget } from './mirror-target.js';

const channel = (name: string): SendableChannelLike & { name: string } => ({
  name,
  send: async () => {
    throw new Error('not used');
  },
});

describe('MirrorTarget (where replies to turns from the app go)', () => {
  it('uses the channel the owner last wrote from', async () => {
    const openOwnerDm = vi.fn(async () => channel('owner-dm'));
    const target = new MirrorTarget(openOwnerDm);
    target.remember(channel('guild-thread'));

    expect(await target.resolve()).toMatchObject({ name: 'guild-thread' });
    expect(openOwnerDm).not.toHaveBeenCalled();
  });

  it("falls back to the paired owner's DM before anyone wrote since the bot started", async () => {
    const openOwnerDm = vi.fn(async () => channel('owner-dm'));
    const target = new MirrorTarget(openOwnerDm);

    expect(await target.resolve()).toMatchObject({ name: 'owner-dm' });
    expect(await target.resolve()).toMatchObject({ name: 'owner-dm' });
    expect(openOwnerDm).toHaveBeenCalledTimes(1);
  });

  it('has nowhere to post while the bot is not paired', async () => {
    const target = new MirrorTarget(async () => null);
    expect(await target.resolve()).toBeNull();
  });
});
