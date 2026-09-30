import { describe, expect, it, vi } from 'vitest';
import { Session, silentLogger, autoAllowResolver } from '@moxxy/core';
import { applySessionAction, type SessionActionTarget } from './session-action.js';

function target(over: Partial<SessionActionTarget> = {}) {
  const session = new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });
  const stop = vi.fn(async () => undefined);
  const abortPending = vi.fn();
  const onReset = vi.fn();
  const t: SessionActionTarget = {
    session,
    turnController: null,
    handle: { stop },
    channelName: 'Telegram',
    abortPending,
    onReset,
    exitDelayMs: 0,
    ...over,
  };
  return { t, session, stop, abortPending, onReset };
}

describe('applySessionAction (a registered command asked for /new, /clear or /exit)', () => {
  it('/new clears the conversation at its source and resets the channel', async () => {
    const { t, session, abortPending, onReset } = target();
    await session.log.append({ type: 'user_prompt', turnId: 't1', text: 'hi' } as never);
    const controller = new AbortController();

    const reply = await applySessionAction('new', undefined, { ...t, turnController: controller });

    expect(reply).toBe('✓ new session — conversation history cleared');
    expect(session.log.length).toBe(0);
    expect(controller.signal.aborted).toBe(true);
    expect(abortPending).toHaveBeenCalledWith('session reset');
    expect(onReset).toHaveBeenCalledWith('new');
  });

  it('/new says the history was NOT cleared when the reset fails', async () => {
    const { t, session } = target();
    session.reset = async () => {
      throw new Error('runner gone');
    };

    expect(await applySessionAction('new', undefined, t)).toBe(
      '⚠ /new failed: runner gone — history NOT cleared',
    );
  });

  it('/clear confirms with the notice', async () => {
    const { t, onReset } = target();
    expect(await applySessionAction('clear', 'screen cleared', t)).toBe('✓ screen cleared');
    expect(onReset).toHaveBeenCalledWith('clear');
  });

  it('/exit answers first and stops the channel afterwards', async () => {
    const { t, stop } = target();

    expect(await applySessionAction('exit', undefined, t)).toBe('closing Telegram channel');
    await vi.waitFor(() => expect(stop).toHaveBeenCalledWith('user /exit'));
  });

  it('says the session is not ready before the channel has one', async () => {
    const { t } = target({ session: null });
    expect(await applySessionAction('new', undefined, t)).toBe('session is not ready yet.');
  });
});
