import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { loadVoiceReplies, saveVoiceReplies, TELEGRAM_VOICE_REPLIES_KEY } from '../keys.js';
import { runSlash } from './slash-handler.js';
import { runUserTurn } from './turn-runner.js';

describe('telegram voice-replies vault flag round-trip', () => {
  let tmp: string;
  let vault: VaultStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-tg-voice-'));
    vault = new VaultStore({
      filePath: path.join(tmp, 'vault.json'),
      keySource: createStaticKeySource(deriveKey('test', generateSalt())),
    });
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('defaults to off, persists on, then off', async () => {
    expect(await loadVoiceReplies(vault)).toBe(false);
    await saveVoiceReplies(vault, true);
    expect(await vault.get(TELEGRAM_VOICE_REPLIES_KEY)).toBe('1');
    expect(await loadVoiceReplies(vault)).toBe(true);
    await saveVoiceReplies(vault, false);
    expect(await vault.get(TELEGRAM_VOICE_REPLIES_KEY)).toBe(null);
    expect(await loadVoiceReplies(vault)).toBe(false);
  });
});

/** Minimal session: `/voice` only touches `commands.get` (miss → channel-local)
 *  and `synthesizers.tryGetActive`. */
function slashSession(opts: { synth?: unknown } = {}): Session {
  return {
    id: 'sess',
    commands: { get: () => undefined },
    synthesizers: { tryGetActive: () => opts.synth ?? null },
  } as unknown as Session;
}

function slashCtx(): { ctx: any; replies: string[] } {
  const replies: string[] = [];
  return { replies, ctx: { reply: async (t: string) => void replies.push(t) } };
}

describe('/voice slash command', () => {
  const cbBase = {
    toggleYolo: () => false,
    performSessionAction: async () => undefined,
  };

  it('enables + persists when a synthesizer is active', async () => {
    const { ctx, replies } = slashCtx();
    const persisted: boolean[] = [];
    await runSlash(
      ctx,
      '/voice on',
      { session: slashSession({ synth: { name: 'fake' } }), model: undefined, activeModelOverride: null, yolo: false, voiceReplies: false },
      { ...cbBase, setVoiceReplies: async (on: boolean) => void persisted.push(on) },
    );
    expect(persisted).toEqual([true]);
    expect(replies[0]).toContain('ON');
    expect(replies[0]).not.toContain('tts-openai');
  });

  it('still enables but shows install guidance when no synthesizer is active', async () => {
    const { ctx, replies } = slashCtx();
    const persisted: boolean[] = [];
    await runSlash(
      ctx,
      '/voice on',
      { session: slashSession(), model: undefined, activeModelOverride: null, yolo: false, voiceReplies: false },
      { ...cbBase, setVoiceReplies: async (on: boolean) => void persisted.push(on) },
    );
    expect(persisted).toEqual([true]);
    expect(replies[0]).toContain('moxxy plugins install tts-openai');
  });

  it('toggles off and reports status without persisting', async () => {
    const persisted: boolean[] = [];
    const setVoiceReplies = async (on: boolean): Promise<void> => void persisted.push(on);

    const off = slashCtx();
    await runSlash(
      off.ctx,
      '/voice',
      { session: slashSession(), model: undefined, activeModelOverride: null, yolo: false, voiceReplies: true },
      { ...cbBase, setVoiceReplies },
    );
    expect(persisted).toEqual([false]);
    expect(off.replies[0]).toContain('OFF');

    const status = slashCtx();
    await runSlash(
      status.ctx,
      '/voice status',
      { session: slashSession(), model: undefined, activeModelOverride: null, yolo: false, voiceReplies: true },
      { ...cbBase, setVoiceReplies },
    );
    // status did NOT persist anything new.
    expect(persisted).toEqual([false]);
    expect(status.replies[0]).toContain('ON');
  });
});

/**
 * Fake session whose `runTurn` fans scripted events (stamped with the turnId)
 * through the log subscribers, mirroring the real Session. Matches the pattern
 * in the Discord turn-runner test.
 */
function turnSession(
  script: (emit: (e: Record<string, unknown>) => void) => void,
): Session {
  const listeners = new Set<(e: MoxxyEvent) => void>();
  return {
    log: {
      subscribe(fn: (e: MoxxyEvent) => void) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
    },
    runTurn: (_p: string, opts: { turnId: string }) =>
      (async function* () {
        const emit = (e: Record<string, unknown>): void => {
          const ev = { ...e, turnId: opts.turnId } as unknown as MoxxyEvent;
          for (const fn of listeners) fn(ev);
        };
        script(emit);
        yield undefined as never;
      })(),
  } as unknown as Session;
}

/** A frame-pump stand-in that captures the final assistant text the same way the
 *  real renderer does (assistant_message overwrites the body). */
function fakeFramePump(): { framePump: any; flushedFinal: boolean[] } {
  let body = '';
  const flushedFinal: boolean[] = [];
  const framePump = {
    beginTurn: () => {},
    endTurn: () => {},
    scheduleEdit: () => {},
    flush: async (final: boolean) => void flushedFinal.push(final),
    renderState: {
      accept: (e: MoxxyEvent) => {
        if (e.type === 'assistant_message') body = (e as { content: string }).content;
        return { hasUpdate: true };
      },
      snapshot: () => ({ body }),
    },
  };
  return { framePump, flushedFinal };
}

const typingNoop = { start: () => {}, stop: () => {} } as any;

describe('turn-runner onFinalReply seam (final assistant text)', () => {
  it('calls onFinalReply with the final assistant body AFTER flushing the text', async () => {
    const { framePump, flushedFinal } = fakeFramePump();
    const seen: string[] = [];
    const session = turnSession((emit) => {
      emit({ type: 'assistant_chunk', delta: 'Hel' });
      emit({ type: 'assistant_message', content: 'Hello there.' });
    });
    await runUserTurn(
      { reply: async () => {} } as any,
      {
        session,
        bot: null,
        framePump,
        typing: typingNoop,
        onFinalReply: async (t) => void seen.push(t),
      },
      { chatId: 1, text: 'hi', model: undefined, controller: new AbortController(), turnId: asTurnId('t1') },
    );
    expect(flushedFinal).toContain(true);
    expect(seen).toEqual(['Hello there.']);
  });

  it('does not speak a tool-only turn (empty assistant body)', async () => {
    const { framePump } = fakeFramePump();
    const seen: string[] = [];
    const session = turnSession((emit) => {
      emit({ type: 'tool_call_requested', callId: 'c1', name: 'read', input: {} });
    });
    await runUserTurn(
      { reply: async () => {} } as any,
      { session, bot: null, framePump, typing: typingNoop, onFinalReply: async (t) => void seen.push(t) },
      { chatId: 1, text: 'hi', model: undefined, controller: new AbortController(), turnId: asTurnId('t2') },
    );
    expect(seen).toEqual([]);
  });

  it('never breaks the (already-sent) text turn when the voice hook rejects', async () => {
    const { framePump } = fakeFramePump();
    const replies: string[] = [];
    const session = turnSession((emit) => emit({ type: 'assistant_message', content: 'Done.' }));
    await expect(
      runUserTurn(
        { reply: async (t: string) => void replies.push(t) } as any,
        {
          session,
          bot: null,
          framePump,
          typing: typingNoop,
          onFinalReply: async () => {
            throw new Error('tts exploded');
          },
        },
        { chatId: 1, text: 'hi', model: undefined, controller: new AbortController(), turnId: asTurnId('t3') },
      ),
    ).resolves.toBeUndefined();
    // No "Turn failed" reply — the hook failure was swallowed.
    expect(replies.join(' ')).not.toContain('Turn failed');
  });
});
