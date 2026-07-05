import { describe, expect, it, vi } from 'vitest';
import type { SynthesizeReplyResult, SynthesizerSource } from '@moxxy/channel-kit';
import type { PlayAudioResult } from '../audio-play.js';
import {
  createReadAloud,
  lastAssistantReply,
  resolveSpeakCommand,
  type ReadAloudSession,
} from './read-aloud.js';

/** Fake assistant_message events (only the fields read-aloud touches). */
function messages(
  entries: Array<{ seq: number; content: string; stopReason?: string }>,
): ReadAloudSession['log'] {
  const events = entries.map((e) => ({
    type: 'assistant_message',
    seq: e.seq,
    content: e.content,
    stopReason: e.stopReason ?? 'end_turn',
  }));
  return {
    ofType: ((type: string) => (type === 'assistant_message' ? events : [])) as ReadAloudSession['log']['ofType'],
  };
}

function fakeSession(opts: {
  readonly hasSynth: boolean;
  readonly log?: ReadAloudSession['log'];
}): ReadAloudSession {
  return {
    synthesizers: {
      tryGetActive: () => (opts.hasSynth ? ({} as unknown as ReturnType<SynthesizerSource['synthesizers']['tryGetActive']>) : null),
    },
    log: opts.log ?? messages([]),
  };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('resolveSpeakCommand', () => {
  it('bare /speak speaks the last reply when a synthesizer is active', () => {
    expect(resolveSpeakCommand({ arg: '', autoSpeak: false, hasSynthesizer: true })).toEqual({
      action: 'speak-last',
    });
  });

  it('bare /speak nudges to install TTS when no synthesizer is active', () => {
    const d = resolveSpeakCommand({ arg: '', autoSpeak: false, hasSynthesizer: false });
    expect(d.action).toBe('notice');
    if (d.action === 'notice') {
      expect(d.reply).toMatch(/no active text-to-speech/i);
      expect(d.reply).toMatch(/tts-local/);
      expect(d.reply).toMatch(/tts-openai/);
    }
  });

  it('on/off toggle sticky auto-speak; on with no synth still arms + hints', () => {
    expect(resolveSpeakCommand({ arg: 'on', autoSpeak: false, hasSynthesizer: true })).toMatchObject({
      action: 'auto-on',
    });
    const onNoSynth = resolveSpeakCommand({ arg: 'on', autoSpeak: false, hasSynthesizer: false });
    expect(onNoSynth.action).toBe('auto-on');
    if (onNoSynth.action === 'auto-on') expect(onNoSynth.reply).toMatch(/tts-local/);
    expect(resolveSpeakCommand({ arg: 'off', autoSpeak: true, hasSynthesizer: true })).toMatchObject({
      action: 'auto-off',
    });
  });

  it('stop halts playback; status reports state; unknown → usage', () => {
    expect(resolveSpeakCommand({ arg: 'stop', autoSpeak: true, hasSynthesizer: true })).toEqual({
      action: 'stop',
    });
    const status = resolveSpeakCommand({ arg: 'status', autoSpeak: true, hasSynthesizer: true });
    expect(status).toMatchObject({ action: 'notice' });
    if (status.action === 'notice') expect(status.reply).toMatch(/ON/);
    const bad = resolveSpeakCommand({ arg: 'louder', autoSpeak: false, hasSynthesizer: true });
    expect(bad).toMatchObject({ action: 'notice' });
    if (bad.action === 'notice') expect(bad.reply).toMatch(/usage/i);
  });
});

describe('lastAssistantReply', () => {
  it('returns the most recent end_turn reply with its seq', () => {
    const log = messages([
      { seq: 1, content: 'first' },
      { seq: 3, content: 'tool round', stopReason: 'tool_use' },
      { seq: 5, content: 'final answer' },
    ]);
    expect(lastAssistantReply(log)).toEqual({ content: 'final answer', seq: 5 });
  });

  it('skips empty and non-end_turn messages; null when none qualify', () => {
    expect(lastAssistantReply(messages([{ seq: 2, content: '   ' }]))).toBeNull();
    expect(
      lastAssistantReply(messages([{ seq: 2, content: 'mid', stopReason: 'tool_use' }])),
    ).toBeNull();
  });
});

describe('createReadAloud — auto-speak trigger', () => {
  function harness(opts: {
    hasSynth: boolean;
    log?: ReadAloudSession['log'];
    synth?: SynthesizeReplyResult;
    play?: PlayAudioResult;
  }) {
    const notices: Array<string | null> = [];
    const synthesize = vi.fn(async () => opts.synth ?? { ok: true, audio: new Uint8Array([1]), mimeType: 'audio/wav' } as SynthesizeReplyResult);
    const play = vi.fn(async () => opts.play ?? ({ ok: true, player: 'afplay' } as PlayAudioResult));
    const controller = createReadAloud({
      session: fakeSession({ hasSynth: opts.hasSynth, ...(opts.log ? { log: opts.log } : {}) }),
      setSystemNotice: (n) => notices.push(n),
      synthesize,
      play,
      platform: 'darwin',
    });
    return { controller, synthesize, play, notices };
  }

  it('is OFF by default — a completed turn does not speak', async () => {
    const { controller, synthesize, play } = harness({ hasSynth: true, log: messages([{ seq: 5, content: 'hi' }]) });
    controller.onTurnComplete();
    await flush();
    expect(synthesize).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(controller.autoSpeak).toBe(false);
  });

  it('once armed, speaks the final reply exactly once (deduped by seq)', async () => {
    const { controller, synthesize, play } = harness({
      hasSynth: true,
      log: messages([{ seq: 5, content: 'final answer' }]),
    });
    controller.handleCommand('on');
    expect(controller.autoSpeak).toBe(true);

    controller.onTurnComplete();
    await flush();
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0]![1]).toBe('final answer');
    expect(play).toHaveBeenCalledTimes(1);

    // Same turn / same reply → not re-spoken.
    controller.onTurnComplete();
    await flush();
    expect(synthesize).toHaveBeenCalledTimes(1);
  });

  it('a synthesis failure never throws and never reaches the player', async () => {
    const { controller, play, notices } = harness({
      hasSynth: true,
      log: messages([{ seq: 5, content: 'answer' }]),
      synth: { ok: false, reason: 'failed', error: 'backend down' },
    });
    controller.handleCommand('on');
    expect(() => controller.onTurnComplete()).not.toThrow();
    await flush();
    expect(play).not.toHaveBeenCalled();
    expect(notices.some((n) => typeof n === 'string' && /synthesis failed/i.test(n))).toBe(true);
  });

  it('a player failure never throws; a no-player result nudges to install one', async () => {
    const { controller, notices } = harness({
      hasSynth: true,
      log: messages([{ seq: 5, content: 'answer' }]),
      play: { ok: false, reason: 'no-player' },
    });
    controller.handleCommand('on');
    controller.onTurnComplete();
    await flush();
    expect(notices.some((n) => typeof n === 'string' && /no audio player/i.test(n))).toBe(true);
  });
});

describe('createReadAloud — /speak command dispatch', () => {
  it('bare /speak speaks the last reply through synth + player', async () => {
    const notices: Array<string | null> = [];
    const synthesize = vi.fn(async () => ({ ok: true, audio: new Uint8Array([1]), mimeType: 'audio/wav' }) as SynthesizeReplyResult);
    const play = vi.fn(async () => ({ ok: true, player: 'afplay' }) as PlayAudioResult);
    const controller = createReadAloud({
      session: fakeSession({ hasSynth: true, log: messages([{ seq: 9, content: 'spoken reply' }]) }),
      setSystemNotice: (n) => notices.push(n),
      synthesize,
      play,
      platform: 'darwin',
    });
    controller.handleCommand('');
    await flush();
    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(synthesize.mock.calls[0]![1]).toBe('spoken reply');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('bare /speak with no synthesizer shows the install nudge (no synth call)', async () => {
    const notices: Array<string | null> = [];
    const synthesize = vi.fn(async () => ({ ok: true, audio: new Uint8Array([1]), mimeType: 'audio/wav' }) as SynthesizeReplyResult);
    const controller = createReadAloud({
      session: fakeSession({ hasSynth: false, log: messages([{ seq: 9, content: 'reply' }]) }),
      setSystemNotice: (n) => notices.push(n),
      synthesize,
      play: async () => ({ ok: true, player: 'afplay' }) as PlayAudioResult,
    });
    controller.handleCommand('');
    await flush();
    expect(synthesize).not.toHaveBeenCalled();
    expect(notices.some((n) => typeof n === 'string' && /no active text-to-speech/i.test(n))).toBe(true);
  });

  it('/speak stop reports nothing playing when idle', () => {
    const notices: Array<string | null> = [];
    const controller = createReadAloud({
      session: fakeSession({ hasSynth: true }),
      setSystemNotice: (n) => notices.push(n),
      synthesize: async () => ({ ok: true, audio: new Uint8Array([1]), mimeType: 'audio/wav' }) as SynthesizeReplyResult,
      play: async () => ({ ok: true, player: 'afplay' }) as PlayAudioResult,
    });
    controller.handleCommand('stop');
    expect(notices.some((n) => typeof n === 'string' && /nothing is playing/i.test(n))).toBe(true);
  });
});
