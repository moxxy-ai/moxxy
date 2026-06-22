import { describe, expect, it, vi } from 'vitest';
import type { Context } from 'grammy';
import { Session } from '@moxxy/core';
import { defineTranscriber } from '@moxxy/sdk';
import { handleVoiceMessage } from './voice-handler.js';

const TOKEN = '1234567890:test-token';

const makeSession = (): Session => new Session({ cwd: '/tmp', silent: true });

const fakeCtx = (overrides: Partial<{ chatId: number; voice: unknown; audio: unknown; filePath: string | null }> = {}) => {
  const replies: string[] = [];
  const reply = vi.fn(async (text: string) => {
    replies.push(text);
  });
  const getFile = vi.fn(async () => ({
    file_id: 'f',
    file_unique_id: 'u',
    file_path: overrides.filePath === undefined ? 'voice/file.ogg' : overrides.filePath,
  }));
  return {
    ctx: {
      chat: { id: overrides.chatId ?? 99 },
      message: {
        voice: overrides.voice,
        audio: overrides.audio,
      },
      reply,
      api: { getFile },
    } as unknown as Context,
    replies,
    reply,
    getFile,
  };
};

const okFetch = (bytes: Uint8Array) =>
  vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes.buffer.slice(0) }));

describe('handleVoiceMessage', () => {
  const baseDeps = (token = TOKEN) => ({
    pairing: { isAuthorized: () => true } as never,
    token,
  });

  it('rejects unauthorized chats', async () => {
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    await handleVoiceMessage(
      ctx,
      {
        session: makeSession(),
        busy: false,
      },
      { ...baseDeps(), pairing: { isAuthorized: () => false } as never },
      { runUserTurn, fetchAudio: okFetch(new Uint8Array([1])) },
    );
    expect(replies[0]).toMatch(/paired with a different chat/);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('warns when no transcriber is registered on the session', async () => {
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    const session = makeSession();
    await handleVoiceMessage(
      ctx,
      {
        session,
        busy: false,
      },
      baseDeps(),
      { runUserTurn, fetchAudio: okFetch(new Uint8Array([1])) },
    );
    expect(replies[0]).toMatch(/no speech-to-text backend/);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('transcribes and forwards the transcript to runUserTurn', async () => {
    const audio = new Uint8Array([1, 2, 3, 4]);
    const session = makeSession();
    const transcribe = vi.fn(async () => ({ text: 'hello agent' }));
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe }),
      }),
    );
    session.transcribers.setActive('t');

    const { ctx, replies, getFile } = fakeCtx({
      voice: { file_id: 'voice-1', mime_type: 'audio/ogg' },
    });
    const runUserTurn = vi.fn(async () => {});
    await handleVoiceMessage(
      ctx,
      {
        session,
        busy: false,
      },
      baseDeps(),
      { runUserTurn, fetchAudio: okFetch(audio) },
    );
    expect(getFile).toHaveBeenCalledWith('voice-1');
    expect(transcribe).toHaveBeenCalled();
    const transcribeArgs = transcribe.mock.calls[0]!;
    expect((transcribeArgs[1] as { mimeType: string }).mimeType).toBe('audio/ogg');
    expect(replies.some((r) => /heard:/.test(r) && /hello agent/.test(r))).toBe(true);
    expect(runUserTurn).toHaveBeenCalledWith(ctx, 99, 'hello agent');
  });

  it('refuses to start a new turn while busy', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    await handleVoiceMessage(
      ctx,
      {
        session,
        busy: true,
      },
      baseDeps(),
      { runUserTurn, fetchAudio: okFetch(new Uint8Array([1])) },
    );
    expect(replies[0]).toMatch(/working on the previous prompt/);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('replies on empty transcript and skips the turn', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: '   ' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    await handleVoiceMessage(
      ctx,
      {
        session,
        busy: false,
      },
      baseDeps(),
      { runUserTurn, fetchAudio: okFetch(new Uint8Array([1])) },
    );
    expect(replies.some((r) => /empty text/.test(r))).toBe(true);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('logs the real HTTP status when the download fails', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    const warn = vi.fn();
    await handleVoiceMessage(
      ctx,
      { session, busy: false },
      { ...baseDeps(), logger: { warn } },
      {
        runUserTurn,
        fetchAudio: vi.fn(async () => ({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          arrayBuffer: async () => new ArrayBuffer(0),
        })),
      },
    );
    expect(replies.some((r) => /Failed to download/.test(r))).toBe(true);
    expect(runUserTurn).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('telegram voice download failed', {
      status: 404,
      statusText: 'Not Found',
    });
  });

  it('rejects an oversized upload before downloading it', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies, getFile } = fakeCtx({
      voice: { file_id: 'f', file_size: 50 * 1024 * 1024 },
    });
    const runUserTurn = vi.fn();
    const fetchAudio = vi.fn();
    await handleVoiceMessage(
      ctx,
      { session, busy: false },
      baseDeps(),
      { runUserTurn, fetchAudio },
    );
    expect(replies.some((r) => /too large/.test(r))).toBe(true);
    expect(getFile).not.toHaveBeenCalled();
    expect(fetchAudio).not.toHaveBeenCalled();
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('rejects a body that exceeds the cap after download (Content-Length)', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    await handleVoiceMessage(
      ctx,
      { session, busy: false },
      baseDeps(),
      {
        runUserTurn,
        fetchAudio: vi.fn(async () => ({
          ok: true,
          headers: { get: (n: string) => (n === 'content-length' ? String(99 * 1024 * 1024) : null) },
          arrayBuffer: async () => new ArrayBuffer(0),
        })),
      },
    );
    expect(replies.some((r) => /too large/.test(r))).toBe(true);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('passes an AbortSignal to the fetch and reports a timeout abort', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    const runUserTurn = vi.fn();
    let sawSignal = false;
    const fetchAudio = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
      sawSignal = init?.signal instanceof AbortSignal;
      // Simulate the AbortController firing mid-download.
      const err = new Error('aborted');
      (init?.signal as AbortSignal | undefined)?.dispatchEvent?.(new Event('abort'));
      throw err;
    });
    await handleVoiceMessage(
      ctx,
      { session, busy: false },
      baseDeps(),
      { runUserTurn, fetchAudio },
    );
    expect(sawSignal).toBe(true);
    expect(replies.some((r) => /Failed to download|timed out/.test(r))).toBe(true);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('replies (not throws) when getFile itself fails', async () => {
    const session = makeSession();
    session.transcribers.register(
      defineTranscriber({
        name: 't',
        createClient: () => ({ name: 't', transcribe: async () => ({ text: 'x' }) }),
      }),
    );
    session.transcribers.setActive('t');
    const { ctx, replies } = fakeCtx({ voice: { file_id: 'f' } });
    // Override getFile to throw.
    (ctx.api as unknown as { getFile: () => Promise<never> }).getFile = vi.fn(async () => {
      throw new Error('network down');
    });
    const runUserTurn = vi.fn();
    await expect(
      handleVoiceMessage(
        ctx,
        { session, busy: false },
        baseDeps(),
        { runUserTurn, fetchAudio: okFetch(new Uint8Array([1])) },
      ),
    ).resolves.toBeUndefined();
    expect(replies.some((r) => /Could not look up/.test(r))).toBe(true);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('handles uploaded audio (message:audio) with its own mime_type', async () => {
    const session = makeSession();
    const transcribe = vi.fn(async () => ({ text: 'recorded earlier' }));
    session.transcribers.register(
      defineTranscriber({ name: 't', createClient: () => ({ name: 't', transcribe }) }),
    );
    session.transcribers.setActive('t');
    const { ctx } = fakeCtx({
      audio: { file_id: 'a-1', mime_type: 'audio/mpeg' },
    });
    const runUserTurn = vi.fn(async () => {});
    await handleVoiceMessage(
      ctx,
      {
        session,
        busy: false,
      },
      baseDeps(),
      { runUserTurn, fetchAudio: okFetch(new Uint8Array([9])) },
    );
    expect((transcribe.mock.calls[0]![1] as { mimeType: string }).mimeType).toBe('audio/mpeg');
    expect(runUserTurn).toHaveBeenCalledWith(ctx, 99, 'recorded earlier');
  });
});
