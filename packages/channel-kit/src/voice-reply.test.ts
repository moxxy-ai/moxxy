import { EventEmitter } from 'node:events';
import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Synthesizer } from '@moxxy/sdk';
import {
  __resetFfmpegProbeForTest,
  audioExtForMime,
  deliverVoiceReply,
  ensureOggOpus,
  resolveVoiceToggle,
  synthesizeReply,
  toSpeech,
  type SynthesizerSource,
  type VoiceReplySink,
} from './voice-reply.js';

beforeEach(() => __resetFfmpegProbeForTest());
afterEach(() => __resetFfmpegProbeForTest());

/** A session whose active synthesizer is `synth` (null = none active). */
function sessionWith(synth: Synthesizer | null): SynthesizerSource {
  return { synthesizers: { tryGetActive: () => synth } };
}

function fakeSynth(
  impl: (text: string) => { audio: Uint8Array; mimeType: string } | Promise<never>,
  name = 'fake',
): Synthesizer {
  return {
    name,
    synthesize: async (text: string) => impl(text) as { audio: Uint8Array; mimeType: string },
  };
}

/**
 * A fake `spawn`: the first arg selects behavior. `-version` probes resolve to
 * `probeOk`; a transcode call pushes `output` to stdout then closes with
 * `transcodeCode` (unless `transcodeThrows`).
 */
function makeSpawn(opts: {
  probeOk?: boolean;
  output?: Buffer;
  transcodeCode?: number;
  transcodeError?: boolean;
}): { spawn: any; calls: string[][] } {
  const calls: string[][] = [];
  const spawn = (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    const child = new EventEmitter() as EventEmitter & {
      stdin: { on: () => void; end: () => void };
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => void;
      killed: boolean;
    };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
    };
    child.stdin = { on: () => {}, end: () => {} };
    const isProbe = args.includes('-version');
    queueMicrotask(() => {
      if (isProbe) {
        child.emit('close', opts.probeOk ? 0 : 1);
        return;
      }
      // transcode
      if (opts.transcodeError) {
        child.emit('error', new Error('spawn ENOENT'));
        return;
      }
      if ((opts.transcodeCode ?? 0) === 0 && opts.output) {
        child.stdout.emit('data', opts.output);
      }
      child.emit('close', opts.transcodeCode ?? 0);
    });
    return child;
  };
  return { spawn, calls };
}

describe('toSpeech — markdown → spoken text', () => {
  it('replaces fenced code blocks with a spoken placeholder', () => {
    const out = toSpeech('Here you go:\n```ts\nconst x = 1;\n```\nDone.');
    expect(out).toContain('(code omitted)');
    expect(out).not.toContain('const x');
    expect(out).not.toContain('```');
  });

  it('handles an unterminated trailing fence', () => {
    const out = toSpeech('Start\n```js\nleftover');
    expect(out).toContain('(code omitted)');
    expect(out).not.toContain('leftover');
  });

  it('keeps link labels and drops urls, strips emphasis/headings/quotes/bullets', () => {
    const out = toSpeech(
      '# Title\n\n**Bold** and _italic_ and `code` see [the docs](https://x.y)\n\n> quoted\n\n- item one\n- item two',
    );
    expect(out).toContain('Title');
    expect(out).toContain('Bold and italic and code');
    expect(out).toContain('the docs');
    expect(out).not.toContain('https://x.y');
    expect(out).not.toMatch(/[#>*_`]/);
    expect(out).toContain('item one');
  });

  it('turns an image into its alt text', () => {
    expect(toSpeech('![a cat](cat.png)')).toBe('a cat');
  });
});

describe('audioExtForMime', () => {
  it('maps common mimes', () => {
    expect(audioExtForMime('audio/ogg')).toBe('ogg');
    expect(audioExtForMime('audio/opus')).toBe('ogg');
    expect(audioExtForMime('audio/mpeg')).toBe('mp3');
    expect(audioExtForMime('audio/wav')).toBe('wav');
    expect(audioExtForMime('audio/x-weird')).toBe('audio');
  });
});

describe('synthesizeReply', () => {
  it('returns no-synthesizer when none is active', async () => {
    const r = await synthesizeReply(sessionWith(null), 'hello');
    expect(r).toEqual({ ok: false, reason: 'no-synthesizer' });
  });

  it('returns empty when the reply has no speakable text', async () => {
    const synth = fakeSynth(() => ({ audio: new Uint8Array([1]), mimeType: 'audio/ogg' }));
    const r = await synthesizeReply(sessionWith(synth), '   \n  ');
    expect(r).toEqual({ ok: false, reason: 'empty' });
  });

  it('returns audio on success and cleans markdown before synthesis', async () => {
    let seen = '';
    const synth = fakeSynth((text) => {
      seen = text;
      return { audio: new Uint8Array([9, 9]), mimeType: 'audio/mpeg' };
    });
    const r = await synthesizeReply(sessionWith(synth), 'Hello **world**');
    expect(r).toEqual({ ok: true, audio: new Uint8Array([9, 9]), mimeType: 'audio/mpeg' });
    expect(seen).toBe('Hello world');
  });

  it('truncates long text at a boundary', async () => {
    let seen = '';
    const synth = fakeSynth((text) => {
      seen = text;
      return { audio: new Uint8Array([1]), mimeType: 'audio/ogg' };
    });
    const long = `${'a'.repeat(50)}. ${'b'.repeat(50)}. ${'c'.repeat(50)}.`;
    await synthesizeReply(sessionWith(synth), long, { maxChars: 60 });
    expect(seen.length).toBeLessThanOrEqual(61);
    expect(seen.endsWith('…')).toBe(true);
  });

  it('never throws when the backend rejects', async () => {
    const synth: Synthesizer = {
      name: 'boom',
      synthesize: async () => {
        throw new Error('tts down');
      },
    };
    const r = await synthesizeReply(sessionWith(synth), 'hi');
    expect(r).toEqual({ ok: false, reason: 'failed', error: 'tts down' });
  });

  it('treats empty audio as a failure', async () => {
    const synth = fakeSynth(() => ({ audio: new Uint8Array(), mimeType: 'audio/ogg' }));
    const r = await synthesizeReply(sessionWith(synth), 'hi');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('failed');
  });
});

describe('ensureOggOpus', () => {
  it('passes ogg/opus through untouched (no ffmpeg spawn)', async () => {
    const { spawn, calls } = makeSpawn({});
    const bytes = new Uint8Array([1, 2, 3]);
    const r = await ensureOggOpus(bytes, 'audio/ogg', { spawnImpl: spawn });
    expect(r).toEqual({ audio: bytes, mimeType: 'audio/ogg', transcoded: false, isOpus: true });
    expect(calls).toHaveLength(0);
  });

  it('transcodes non-opus audio when ffmpeg is present', async () => {
    const output = Buffer.from([7, 7, 7, 7]);
    const { spawn, calls } = makeSpawn({ probeOk: true, output });
    const r = await ensureOggOpus(new Uint8Array([1, 2]), 'audio/mpeg', { spawnImpl: spawn });
    expect(r.isOpus).toBe(true);
    expect(r.transcoded).toBe(true);
    expect(r.mimeType).toBe('audio/ogg');
    expect([...r.audio]).toEqual([7, 7, 7, 7]);
    // probe + transcode.
    expect(calls.length).toBe(2);
    expect(calls[1]).toContain('libopus');
  });

  it('returns the ORIGINAL bytes with isOpus:false when ffmpeg is missing', async () => {
    const { spawn } = makeSpawn({ probeOk: false });
    const bytes = new Uint8Array([5, 6]);
    const r = await ensureOggOpus(bytes, 'audio/mpeg', { spawnImpl: spawn });
    expect(r).toEqual({ audio: bytes, mimeType: 'audio/mpeg', transcoded: false, isOpus: false });
  });

  it('falls back to original bytes when the transcode process fails', async () => {
    const { spawn } = makeSpawn({ probeOk: true, transcodeCode: 1 });
    const bytes = new Uint8Array([5, 6]);
    const r = await ensureOggOpus(bytes, 'audio/mpeg', { spawnImpl: spawn });
    expect(r.isOpus).toBe(false);
    expect(r.audio).toBe(bytes);
  });
});

describe('deliverVoiceReply', () => {
  function recordingSink(): { sink: VoiceReplySink; sent: Array<{ meta: unknown; bytes: number[] }> } {
    const sent: Array<{ meta: unknown; bytes: number[] }> = [];
    return {
      sent,
      sink: { send: async (audio, meta) => void sent.push({ meta, bytes: [...audio] }) },
    };
  }

  it('sends a voice note when a synthesizer is active and audio is opus', async () => {
    const synth = fakeSynth(() => ({ audio: new Uint8Array([1, 2]), mimeType: 'audio/ogg' }));
    const { sink, sent } = recordingSink();
    const { spawn } = makeSpawn({});
    const outcome = await deliverVoiceReply(sessionWith(synth), 'hello', sink, { spawnImpl: spawn });
    expect(outcome).toEqual({ status: 'sent', transcoded: false, isVoiceNote: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.meta).toMatchObject({ filename: 'reply.ogg', isVoiceNote: true });
  });

  it('sends plain audio (isVoiceNote:false, mime-named file) when ffmpeg is missing', async () => {
    const synth = fakeSynth(() => ({ audio: new Uint8Array([1]), mimeType: 'audio/mpeg' }));
    const { sink, sent } = recordingSink();
    const { spawn } = makeSpawn({ probeOk: false });
    const outcome = await deliverVoiceReply(sessionWith(synth), 'hi', sink, { spawnImpl: spawn });
    expect(outcome).toEqual({ status: 'sent', transcoded: false, isVoiceNote: false });
    expect(sent[0]!.meta).toMatchObject({ filename: 'reply.mp3', isVoiceNote: false });
  });

  it('skips (does not call the sink) when no synthesizer is active', async () => {
    const { sink, sent } = recordingSink();
    const outcome = await deliverVoiceReply(sessionWith(null), 'hi', sink);
    expect(outcome).toEqual({ status: 'skipped', reason: 'no-synthesizer' });
    expect(sent).toHaveLength(0);
  });

  it('reports a synth failure without calling the sink', async () => {
    const synth: Synthesizer = {
      name: 'boom',
      synthesize: async () => {
        throw new Error('nope');
      },
    };
    const { sink, sent } = recordingSink();
    const outcome = await deliverVoiceReply(sessionWith(synth), 'hi', sink);
    expect(outcome).toEqual({ status: 'failed', reason: 'synth', error: 'nope' });
    expect(sent).toHaveLength(0);
  });

  it('never throws when the sink throws — returns a delivery failure', async () => {
    const synth = fakeSynth(() => ({ audio: new Uint8Array([1]), mimeType: 'audio/ogg' }));
    const sink: VoiceReplySink = {
      send: async () => {
        throw new Error('network down');
      },
    };
    const outcome = await deliverVoiceReply(sessionWith(synth), 'hi', sink);
    expect(outcome).toEqual({ status: 'failed', reason: 'delivery', error: 'network down' });
  });
});

describe('resolveVoiceToggle', () => {
  const base = {
    hasSynthesizer: true,
    delivery: 'a voice note',
    noSynthesizerHint: 'install tts',
  };

  it('toggles on an empty arg', () => {
    expect(resolveVoiceToggle({ ...base, arg: '', enabled: false })).toMatchObject({
      enabled: true,
      persist: true,
    });
    expect(resolveVoiceToggle({ ...base, arg: '', enabled: true })).toMatchObject({
      enabled: false,
      persist: true,
    });
  });

  it('honors explicit on/off', () => {
    expect(resolveVoiceToggle({ ...base, arg: 'on', enabled: false }).enabled).toBe(true);
    expect(resolveVoiceToggle({ ...base, arg: 'off', enabled: true }).enabled).toBe(false);
  });

  it('status never persists and reports current state', () => {
    const r = resolveVoiceToggle({ ...base, arg: 'status', enabled: true });
    expect(r.persist).toBe(false);
    expect(r.enabled).toBe(true);
    expect(r.reply).toContain('ON');
  });

  it('appends install guidance when enabling with no synthesizer', () => {
    const r = resolveVoiceToggle({ ...base, arg: 'on', enabled: false, hasSynthesizer: false });
    expect(r.reply).toContain('install tts');
  });

  it('does not append guidance when turning off', () => {
    const r = resolveVoiceToggle({ ...base, arg: 'off', enabled: true, hasSynthesizer: false });
    expect(r.reply).not.toContain('install tts');
  });
});
