import { afterEach, describe, expect, it, vi } from 'vitest';
import { configurePlatform, type SpeakOptions } from './platform.js';
import { SpeechPlaybackQueue } from './speech-playback-queue.js';
import { toVoiceConversationText } from './speech.js';
import { __setApiOverride } from './transport.js';

afterEach(() => {
  configurePlatform({});
  __setApiOverride(null);
});

async function waitForPhase(
  queue: SpeechPlaybackQueue,
  phase: ReturnType<SpeechPlaybackQueue['getSnapshot']>['phase'],
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (queue.getSnapshot().phase !== phase) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${phase}; got ${queue.getSnapshot().phase}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('SpeechPlaybackQueue voice-call policy', () => {
  it('does not synthesize fenced code in the voice-conversation policy', async () => {
    const invoke = vi.fn(async () => ({ audioBase64: 'AQID', mimeType: 'audio/wav' }));
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: vi.fn(),
        cancel: vi.fn(),
        playClip: vi.fn(() => ({ stop: vi.fn() })),
      },
    });
    __setApiOverride({
      invoke,
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', {
      requireSynthesizer: true,
      prepareText: toVoiceConversationText,
    });

    queue.enqueue('Gotowe.\n\n```ts\nconst answer = 42;\n```\n\nMożemy iść dalej.');
    await waitForPhase(queue, 'speaking');

    expect(invoke).toHaveBeenCalledWith('session.synthesize', expect.objectContaining({
      text: 'Gotowe. Możemy iść dalej.',
      language: 'pl',
    }));
    expect(invoke).not.toHaveBeenCalledWith('session.synthesize', expect.objectContaining({
      text: expect.stringMatching(/code block|const answer/u),
    }));
    queue.cancel();
  });

  it('prewarms a cue once and reuses the in-memory Piper clip', async () => {
    const synthesized: string[] = [];
    const played: string[] = [];
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: () => undefined,
        cancel: () => undefined,
        playClip: (base64) => {
          played.push(base64);
          return { stop: () => undefined };
        },
      },
    });
    __setApiOverride({
      invoke: (async (_channel: string, payload: { text: string }) => {
        synthesized.push(payload.text);
        return { audioBase64: payload.text, mimeType: 'audio/wav' };
      }) as never,
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    await queue.prewarmCue('Jasne, moment.', 'pl');
    queue.enqueueCue('Jasne, moment.', 'pl');
    await waitForPhase(queue, 'speaking');

    expect(synthesized).toEqual(['Jasne, moment.']);
    expect(played).toEqual(['Jasne, moment.']);
    expect(queue.getSnapshot().currentKind).toBe('cue');
    queue.cancel();
  });

  it('drops pending cues in favour of assistant speech without cutting the active cue', async () => {
    const playbackOptions: SpeakOptions[] = [];
    const played: string[] = [];
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: () => undefined,
        cancel: () => undefined,
        playClip: (base64, _mime, options = {}) => {
          played.push(base64);
          playbackOptions.push(options);
          return { stop: () => undefined };
        },
      },
    });
    __setApiOverride({
      invoke: (async (_channel: string, payload: { text: string }) => ({
        audioBase64: payload.text,
        mimeType: 'audio/wav',
      })) as never,
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueueCue('Active cue.', 'en');
    queue.enqueueCue('Stale queued cue.', 'en');
    await waitForPhase(queue, 'speaking');
    queue.enqueue('The actual answer is ready.', 'en');

    expect(played).toEqual(['Active cue.']);
    playbackOptions[0]?.onend?.();
    const deadline = Date.now() + 1_000;
    while (played.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(played).toEqual(['Active cue.', 'The actual answer is ready.']);
    expect(queue.getSnapshot().currentKind).toBe('assistant');
    queue.cancel();
  });

  it('treats an optional cue failure as non-fatal for the real answer', async () => {
    const played: string[] = [];
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: () => undefined,
        cancel: () => undefined,
        playClip: (base64) => {
          played.push(base64);
          return { stop: () => undefined };
        },
      },
    });
    __setApiOverride({
      invoke: (async (_channel: string, payload: { text: string }) => {
        if (payload.text === 'Optional cue.') throw new Error('cue failed');
        return { audioBase64: payload.text, mimeType: 'audio/wav' };
      }) as never,
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueueCue('Optional cue.', 'en');
    queue.enqueue('The real answer.', 'en');
    await waitForPhase(queue, 'speaking');

    expect(queue.getSnapshot().phase).toBe('speaking');
    expect(played).toEqual(['The real answer.']);
    queue.cancel();
  });

  it('switches synthesis from Polish to English within one streamed response', async () => {
    const invoke = vi.fn(async () => ({ audioBase64: 'AQID', mimeType: 'audio/wav' }));
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: vi.fn(),
        cancel: vi.fn(),
        playClip: vi.fn(() => ({ stop: vi.fn() })),
      },
    });
    __setApiOverride({
      invoke,
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueue('Dobrze, zróbmy to.');
    queue.enqueue('Great, everything works correctly.');
    const deadline = Date.now() + 1_000;
    while (invoke.mock.calls.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(invoke).toHaveBeenNthCalledWith(1, 'session.synthesize', expect.objectContaining({
      language: 'pl',
    }));
    expect(invoke).toHaveBeenNthCalledWith(2, 'session.synthesize', expect.objectContaining({
      language: 'en',
    }));
    queue.cancel();
  });

  it('sends deterministic prosody to the active synthesizer', async () => {
    const invoke = vi.fn(async () => ({ audioBase64: 'AQID', mimeType: 'audio/wav' }));
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: vi.fn(),
        cancel: vi.fn(),
        playClip: vi.fn(() => ({ stop: vi.fn() })),
      },
    });
    __setApiOverride({
      invoke,
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueue('Świetnie!');
    await waitForPhase(queue, 'speaking');

    expect(invoke).toHaveBeenCalledWith('session.synthesize', {
      workspaceId: 'workspace-a',
      text: 'Świetnie!',
      language: 'pl',
      rate: 1.06,
    });
    queue.cancel();
  });

  it('keeps a natural pause between generated clips', async () => {
    const playbackOptions: SpeakOptions[] = [];
    const playClip = vi.fn((_base64, _mime, opts?: SpeakOptions) => {
      if (opts) playbackOptions.push(opts);
      return { stop: vi.fn() };
    });
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: vi.fn(),
        cancel: vi.fn(),
        playClip,
      },
    });
    __setApiOverride({
      invoke: vi.fn(async () => ({ audioBase64: 'AQID', mimeType: 'audio/wav' })),
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueue('Świetnie!');
    queue.enqueue('Możemy przejść dalej.');
    await waitForPhase(queue, 'speaking');
    playbackOptions[0]?.onend?.();
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(playClip).toHaveBeenCalledTimes(1);
    const deadline = Date.now() + 500;
    while (playClip.mock.calls.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(playClip).toHaveBeenCalledTimes(2);
    queue.cancel();
  });

  it('cancels a pending pause without starting the next clip', async () => {
    const playbackOptions: SpeakOptions[] = [];
    const playClip = vi.fn((_base64, _mime, opts?: SpeakOptions) => {
      if (opts) playbackOptions.push(opts);
      return { stop: vi.fn() };
    });
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: vi.fn(),
        cancel: vi.fn(),
        playClip,
      },
    });
    __setApiOverride({
      invoke: vi.fn(async () => ({ audioBase64: 'AQID', mimeType: 'audio/wav' })),
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueue('Świetnie!');
    queue.enqueue('Tego fragmentu nie wolno już odtworzyć.');
    await waitForPhase(queue, 'speaking');
    playbackOptions[0]?.onend?.();
    queue.cancel();
    await new Promise((resolve) => setTimeout(resolve, 90));

    expect(playClip).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().phase).toBe('idle');
  });

  it('surfaces a missing synthesizer instead of falling back to the system voice', async () => {
    const speak = vi.fn();
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak,
        cancel: vi.fn(),
        playClip: vi.fn(() => ({ stop: vi.fn() })),
      },
    });
    __setApiOverride({
      invoke: vi.fn(async () => null),
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', { requireSynthesizer: true });

    queue.enqueue('To powinien powiedzieć Piper.');
    await waitForPhase(queue, 'error');

    expect(queue.getSnapshot().errorReason).toMatch(/synthesizer/i);
    expect(speak).not.toHaveBeenCalled();
    queue.cancel();
  });

  it('forwards the real playback analyser to the voice surface', async () => {
    const analyser = { kind: 'piper-output' };
    const onAnalyser = vi.fn();
    configurePlatform({
      tts: {
        isSupported: () => true,
        speak: vi.fn(),
        cancel: vi.fn(),
        playClip: vi.fn((_base64, _mime, opts?: SpeakOptions) => {
          opts?.onAnalyser?.(analyser);
          return { stop: vi.fn() };
        }),
      },
    });
    __setApiOverride({
      invoke: vi.fn(async () => ({ audioBase64: 'AQID', mimeType: 'audio/wav' })),
      subscribe: () => () => undefined,
    } as never);
    const queue = new SpeechPlaybackQueue('workspace-a', {
      requireSynthesizer: true,
      onAnalyser,
    });

    queue.enqueue('Hello from Piper.');
    await waitForPhase(queue, 'speaking');

    expect(onAnalyser).toHaveBeenCalledWith(analyser);
    queue.cancel();
  });
});
