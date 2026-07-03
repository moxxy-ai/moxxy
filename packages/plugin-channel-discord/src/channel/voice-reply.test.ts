import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VaultStore, createStaticKeySource, deriveKey, generateSalt } from '@moxxy/plugin-vault';
import { asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import type { ClientSession as Session } from '@moxxy/sdk';
import { DISCORD_VOICE_REPLIES_KEY, loadVoiceReplies, saveVoiceReplies } from '../keys.js';
import { runSlash } from './slash-handler.js';
import { runDiscordTurn } from './turn-runner.js';
import type { SendableChannelLike, SentMessageLike } from './discord-like.js';
import { TypingIndicator } from './typing-indicator.js';

describe('discord voice-replies vault flag round-trip', () => {
  let tmp: string;
  let vault: VaultStore;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mox-dc-voice-'));
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
    expect(await vault.get(DISCORD_VOICE_REPLIES_KEY)).toBe('1');
    expect(await loadVoiceReplies(vault)).toBe(true);
    await saveVoiceReplies(vault, false);
    expect(await vault.get(DISCORD_VOICE_REPLIES_KEY)).toBe(null);
    expect(await loadVoiceReplies(vault)).toBe(false);
  });
});

describe('runSlash routes /voice to the channel callback', () => {
  it('forwards the argument and returns the callback reply', async () => {
    const args: string[] = [];
    const session = { commands: { get: () => undefined } } as unknown as Session;
    const reply = await runSlash('voice', 'on', session, {
      toggleYolo: () => false,
      voice: async (a) => {
        args.push(a);
        return '🔊 Voice replies ON';
      },
      performSessionAction: async () => '',
    });
    expect(args).toEqual(['on']);
    expect(reply).toContain('Voice replies ON');
  });
});

interface Recorded {
  sends: string[];
  channel: SendableChannelLike;
}
function recordedChannel(): Recorded {
  const sends: string[] = [];
  const channel: SendableChannelLike = {
    send: async (payload) => {
      sends.push(typeof payload === 'string' ? payload : payload.content ?? '');
      const message: SentMessageLike = { edit: async () => {} };
      return message;
    },
  };
  return { sends, channel };
}

function fakeSession(script: (emit: (e: Record<string, unknown>) => void) => void): Session {
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

describe('runDiscordTurn onFinalReply seam (final assistant text)', () => {
  it('calls onFinalReply with the assistant body after the text is flushed', async () => {
    const { sends, channel } = recordedChannel();
    const seen: string[] = [];
    const session = fakeSession((emit) => {
      emit({ type: 'assistant_chunk', delta: 'Hi' });
      emit({ type: 'assistant_message', content: 'Hi there, done.' });
    });
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10, onFinalReply: async (t) => void seen.push(t) },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('d1') },
    );
    expect(sends.length).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual(['Hi there, done.']);
  });

  it('does not speak a tool-only turn (empty assistant body)', async () => {
    const { channel } = recordedChannel();
    const seen: string[] = [];
    const session = fakeSession((emit) => {
      emit({ type: 'tool_call_requested', callId: 'c1', name: 'read', input: {} });
    });
    await runDiscordTurn(
      { session, channel, typing: new TypingIndicator(), editFrameMs: 10, onFinalReply: async (t) => void seen.push(t) },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('d2') },
    );
    expect(seen).toEqual([]);
  });

  it('never breaks the (already-sent) text turn when the voice hook rejects', async () => {
    const { sends, channel } = recordedChannel();
    const session = fakeSession((emit) => emit({ type: 'assistant_message', content: 'Done.' }));
    await runDiscordTurn(
      {
        session,
        channel,
        typing: new TypingIndicator(),
        editFrameMs: 10,
        onFinalReply: async () => {
          throw new Error('tts exploded');
        },
      },
      { text: 'hi', controller: new AbortController(), turnId: asTurnId('d3') },
    );
    // The text still landed; the failed hook did NOT surface a "Turn failed".
    expect(sends.join(' ')).toContain('Done.');
    expect(sends.join(' ')).not.toContain('Turn failed');
  });
});
