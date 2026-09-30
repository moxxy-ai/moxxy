import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import type { ClientSession } from '@moxxy/sdk';
import { AutoApproveSwitch } from './auto-approve.js';

const conversation = () =>
  new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });

describe('a channel bot\'s /auto-approve switch', () => {
  it('switches the conversation\'s auto-approve, so the desktop chat shows the same state', async () => {
    const session = conversation();
    const autoApprove = new AutoApproveSwitch(() => session);

    expect(await autoApprove.toggle()).toBe(true);

    expect(session.getInfo().autoApprove).toBe(true);
    expect(autoApprove.enabled).toBe(true);
  });

  it('follows a switch made from the desktop', async () => {
    const session = conversation();
    const autoApprove = new AutoApproveSwitch(() => session);

    await session.setAutoApprove(true);

    expect(autoApprove.enabled).toBe(true);
    expect(await autoApprove.toggle()).toBe(false);
    expect(session.getInfo().autoApprove).toBe(false);
  });

  it('keeps a flag of its own on a runner that predates the shared switch', async () => {
    // An older runner's info carries no auto-approve and offers no switch.
    const oldRunner = { getInfo: () => ({}) } as unknown as ClientSession;
    const autoApprove = new AutoApproveSwitch(() => oldRunner);

    expect(await autoApprove.toggle()).toBe(true);
    expect(autoApprove.enabled).toBe(true);
    autoApprove.forgetLocal();
    expect(autoApprove.enabled).toBe(false);
  });

  it('is off before the bot has a session', async () => {
    const autoApprove = new AutoApproveSwitch(() => null);
    expect(autoApprove.enabled).toBe(false);
  });
});
