import { describe, expect, it, vi } from 'vitest';
import type { ClientSession as Session } from '@moxxy/sdk';
import type { InboundMessage } from '../schema.js';
import { MAX_AUDIO_BYTES } from '../schema.js';
import type { InboundContext } from './message-handler.js';
import { handleVoiceMessage, pickAudioAttachment } from './voice-handler.js';

function audioMsg(overrides: Partial<InboundMessage['attachments'][number]> = {}): InboundMessage {
  return {
    id: '999999999999',
    content: '',
    channelId: '555555555555',
    guildId: null,
    authorId: '111111111111',
    authorIsBot: false,
    attachments: [
      {
        id: '888888888888',
        url: 'https://cdn.example/voice.ogg',
        contentType: 'audio/ogg',
        size: 1_000,
        name: 'voice-message.ogg',
        ...overrides,
      },
    ],
  };
}

function makeCtx(msg: InboundMessage): { ctx: InboundContext; replies: string[] } {
  const replies: string[] = [];
  return {
    replies,
    ctx: {
      msg,
      channel: { send: async () => ({ edit: async () => undefined }) },
      reply: async (text: string) => {
        replies.push(text);
      },
    },
  };
}

function sessionWithTranscriber(transcribe: ((bytes: Uint8Array, o: { mimeType: string }) => Promise<{ text: string }>) | null): Session {
  return {
    transcribers: {
      tryGetActive: () => (transcribe ? { transcribe } : null),
    },
  } as unknown as Session;
}

const okFetch = (bytes = 16) =>
  vi.fn(async () => ({
    ok: true,
    headers: { get: () => String(bytes) },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  }));

describe('pickAudioAttachment', () => {
  it('picks the first audio/* attachment and ignores others', () => {
    const msg = audioMsg();
    expect(pickAudioAttachment(msg.attachments)?.contentType).toBe('audio/ogg');
    expect(pickAudioAttachment([{ ...msg.attachments[0]!, contentType: 'image/png' }])).toBeNull();
    expect(pickAudioAttachment([{ ...msg.attachments[0]!, contentType: null }])).toBeNull();
  });
});

describe('handleVoiceMessage', () => {
  it('returns false for messages without audio (text path proceeds)', async () => {
    const { ctx } = makeCtx({ ...audioMsg(), attachments: [] });
    const consumed = await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(null), busy: false },
      {},
      { runUserTurn: vi.fn() },
    );
    expect(consumed).toBe(false);
  });

  it('guides the user when no transcriber is configured', async () => {
    const { ctx, replies } = makeCtx(audioMsg());
    const runUserTurn = vi.fn();
    const consumed = await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(null), busy: false },
      {},
      { runUserTurn },
    );
    expect(consumed).toBe(true);
    expect(replies[0]).toMatch(/plugin-stt-whisper/);
    expect(runUserTurn).not.toHaveBeenCalled();
  });

  it('rejects a declared-oversized attachment BEFORE downloading', async () => {
    const fetchAudio = okFetch();
    const { ctx, replies } = makeCtx(audioMsg({ size: MAX_AUDIO_BYTES + 1 }));
    await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(async () => ({ text: 'x' })), busy: false },
      {},
      { runUserTurn: vi.fn(), fetchAudio },
    );
    expect(replies[0]).toMatch(/too large/);
    expect(fetchAudio).not.toHaveBeenCalled();
  });

  it('rejects on a lying Content-Length header before buffering', async () => {
    const fetchAudio = vi.fn(async () => ({
      ok: true,
      headers: { get: () => String(MAX_AUDIO_BYTES + 1) },
      arrayBuffer: async () => new ArrayBuffer(8),
    }));
    const { ctx, replies } = makeCtx(audioMsg());
    await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(async () => ({ text: 'x' })), busy: false },
      {},
      { runUserTurn: vi.fn(), fetchAudio },
    );
    expect(replies[0]).toMatch(/too large/);
  });

  it('rejects an oversized BUFFERED body (no content-length)', async () => {
    const fetchAudio = vi.fn(async () => ({
      ok: true,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(MAX_AUDIO_BYTES + 1),
    }));
    const { ctx, replies } = makeCtx(audioMsg());
    await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(async () => ({ text: 'x' })), busy: false },
      {},
      { runUserTurn: vi.fn(), fetchAudio },
    );
    expect(replies[0]).toMatch(/too large/);
  });

  it('refuses while busy', async () => {
    const { ctx, replies } = makeCtx(audioMsg());
    await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(async () => ({ text: 'x' })), busy: true },
      {},
      { runUserTurn: vi.fn() },
    );
    expect(replies[0]).toMatch(/still working/);
  });

  it('transcribes and runs a user turn with a "heard:" echo', async () => {
    const transcribe = vi.fn(async () => ({ text: '  turn on the lights  ' }));
    const runUserTurn = vi.fn();
    const { ctx, replies } = makeCtx(audioMsg());
    const consumed = await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(transcribe), busy: false },
      {},
      { runUserTurn, fetchAudio: okFetch() },
    );
    expect(consumed).toBe(true);
    expect(transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { mimeType: 'audio/ogg' });
    expect(replies[0]).toBe('*heard:* turn on the lights');
    expect(runUserTurn).toHaveBeenCalledWith(ctx, 'turn on the lights');
  });

  it('reports empty transcriptions instead of running an empty turn', async () => {
    const runUserTurn = vi.fn();
    const { ctx, replies } = makeCtx(audioMsg());
    await handleVoiceMessage(
      ctx,
      { session: sessionWithTranscriber(async () => ({ text: '   ' })), busy: false },
      {},
      { runUserTurn, fetchAudio: okFetch() },
    );
    expect(replies[0]).toMatch(/empty text/);
    expect(runUserTurn).not.toHaveBeenCalled();
  });
});
