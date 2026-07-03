import { describe, expect, it, vi } from 'vitest';
import type { ClientSession as Session } from '@moxxy/sdk';
import { MAX_AUDIO_BYTES, pickAudioAttachment, transcribeVoiceAttachment } from './voice.js';

function fakeSession(transcriber: { transcribe: (bytes: Uint8Array, o: { mimeType: string }) => Promise<{ text: string }> } | null): Session {
  return {
    transcribers: { tryGetActive: () => transcriber },
  } as unknown as Session;
}

function replies(): { sent: string[]; reply: (t: string) => Promise<void> } {
  const sent: string[] = [];
  return {
    sent,
    reply: async (t) => {
      sent.push(t);
    },
  };
}

describe('pickAudioAttachment', () => {
  it('picks the first audio/* attachment', () => {
    expect(
      pickAudioAttachment([
        { id: 'a', contentType: 'image/png' },
        { id: 'b', contentType: 'audio/aac' },
        { id: 'c', contentType: 'audio/ogg' },
      ])?.id,
    ).toBe('b');
  });

  it('returns null when nothing is audio', () => {
    expect(pickAudioAttachment([{ id: 'a', contentType: 'image/png' }])).toBeNull();
    expect(pickAudioAttachment(undefined)).toBeNull();
  });
});

describe('transcribeVoiceAttachment', () => {
  it('replies with install guidance when no transcriber is configured', async () => {
    const r = replies();
    const out = await transcribeVoiceAttachment(
      { session: fakeSession(null), attachmentsDir: '/tmp', reply: r.reply },
      { id: 'abc', contentType: 'audio/aac', size: 10 },
    );
    expect(out).toBeNull();
    expect(r.sent[0]).toMatch(/plugin-stt-whisper/);
  });

  it('rejects oversized audio from the declared size before reading', async () => {
    const r = replies();
    const readFile = vi.fn();
    const out = await transcribeVoiceAttachment(
      {
        session: fakeSession({ transcribe: async () => ({ text: 'x' }) }),
        attachmentsDir: '/tmp',
        reply: r.reply,
        readFile,
      },
      { id: 'abc', contentType: 'audio/aac', size: MAX_AUDIO_BYTES + 1 },
    );
    expect(out).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    expect(r.sent[0]).toMatch(/too large/);
  });

  it('rejects a body that lies about its declared size', async () => {
    const r = replies();
    const out = await transcribeVoiceAttachment(
      {
        session: fakeSession({ transcribe: async () => ({ text: 'x' }) }),
        attachmentsDir: '/tmp',
        reply: r.reply,
        readFile: async () => new Uint8Array(MAX_AUDIO_BYTES + 1),
      },
      { id: 'abc', contentType: 'audio/aac', size: 10 },
    );
    expect(out).toBeNull();
    expect(r.sent[0]).toMatch(/too large/);
  });

  it('drops attachments whose id could escape the attachments dir', async () => {
    const r = replies();
    const readFile = vi.fn();
    const out = await transcribeVoiceAttachment(
      {
        session: fakeSession({ transcribe: async () => ({ text: 'x' }) }),
        attachmentsDir: '/tmp',
        reply: r.reply,
        readFile,
      },
      { id: '../../etc/passwd' as never, contentType: 'audio/aac' },
    );
    expect(out).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
    expect(r.sent).toEqual([]); // silent drop — nothing to say to a forged envelope
  });

  it('replies with the transcription error instead of throwing', async () => {
    const r = replies();
    const out = await transcribeVoiceAttachment(
      {
        session: fakeSession({
          transcribe: async () => {
            throw new Error('whisper 500');
          },
        }),
        attachmentsDir: '/tmp',
        reply: r.reply,
        readFile: async () => new Uint8Array(4),
      },
      { id: 'abc', contentType: 'audio/aac' },
    );
    expect(out).toBeNull();
    expect(r.sent[0]).toMatch(/whisper 500/);
  });

  it('transcribes, echoes "heard:", and returns the transcript', async () => {
    const r = replies();
    const transcribe = vi.fn(async () => ({ text: '  turn on the lights  ' }));
    const out = await transcribeVoiceAttachment(
      {
        session: fakeSession({ transcribe }),
        attachmentsDir: '/data/attachments',
        reply: r.reply,
        readFile: async (p) => {
          expect(p).toBe('/data/attachments/12345.opus');
          return new Uint8Array([1, 2, 3]);
        },
      },
      { id: '12345.opus', contentType: 'audio/ogg', size: 3 },
    );
    expect(out).toBe('turn on the lights');
    expect(transcribe).toHaveBeenCalledWith(expect.any(Uint8Array), { mimeType: 'audio/ogg' });
    expect(r.sent[0]).toBe('heard: turn on the lights');
  });
});
