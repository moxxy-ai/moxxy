import { toErrorMessage } from './errors.js';
import { getPlatform, type AudioClipHandle } from './platform.js';
import { toSpeakableText } from './speech.js';
import { detectSpeechLanguage, type SpeechLanguage } from './streaming-speech.js';
import { api } from './transport.js';

export type SpeechPlaybackPhase = 'idle' | 'synthesizing' | 'speaking' | 'error';

export interface SpeechPlaybackSnapshot {
  readonly phase: SpeechPlaybackPhase;
  readonly errorReason: string | null;
}

interface PreparedClip {
  readonly ok: true;
  readonly text: string;
  readonly language: SpeechLanguage;
  readonly clip: { readonly audioBase64: string; readonly mimeType: string } | null;
}

interface FailedClip {
  readonly ok: false;
  readonly error: unknown;
}

type PreparedResult = PreparedClip | FailedClip;

interface QueuedSpeech {
  readonly text: string;
  readonly language: SpeechLanguage;
  prepared: Promise<PreparedResult> | null;
}

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = Object.freeze({
  phase: 'idle',
  errorReason: null,
});

let activeQueue: SpeechPlaybackQueue | null = null;

function claimPlayback(queue: SpeechPlaybackQueue): void {
  if (activeQueue === queue) return;
  activeQueue?.cancel();
  activeQueue = queue;
}

function releasePlayback(queue: SpeechPlaybackQueue): void {
  if (activeQueue === queue) activeQueue = null;
}

/**
 * Serial audio player with bounded prefetch. Playback remains strictly ordered
 * while Piper prepares exactly one sentence ahead of the current audio.
 */
export class SpeechPlaybackQueue {
  private readonly listeners = new Set<() => void>();
  private readonly items: QueuedSpeech[] = [];
  private snapshot: SpeechPlaybackSnapshot = IDLE_SNAPSHOT;
  private generation = 0;
  private preparing = false;
  private systemSpeaking = false;
  private activeClip: AudioClipHandle | null = null;
  private previousLanguage: SpeechLanguage | undefined;

  constructor(private readonly workspaceId?: string) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SpeechPlaybackSnapshot => this.snapshot;

  enqueue(markdown: string, language?: SpeechLanguage): void {
    const text = toSpeakableText(markdown);
    if (!text) return;
    const selectedLanguage = language ?? detectSpeechLanguage(text, this.previousLanguage);
    claimPlayback(this);
    this.previousLanguage = selectedLanguage;
    this.items.push({ text, language: selectedLanguage, prepared: null });
    if (this.snapshot.phase === 'idle' || this.snapshot.phase === 'error') {
      this.setSnapshot('synthesizing', null);
    }
    if (this.activeClip || this.systemSpeaking) this.prepareNext();
    void this.pump(this.generation);
  }

  cancel(): void {
    const ownsPlayback = activeQueue === this;
    this.generation += 1;
    this.items.length = 0;
    this.preparing = false;
    this.systemSpeaking = false;
    this.previousLanguage = undefined;
    this.activeClip?.stop();
    this.activeClip = null;
    if (ownsPlayback) {
      getPlatform().tts?.cancel();
      releasePlayback(this);
    }
    this.setSnapshot('idle', null);
  }

  private async pump(generation: number): Promise<void> {
    if (this.preparing || this.systemSpeaking || this.activeClip) return;
    const item = this.items.shift();
    if (!item) {
      this.setSnapshot('idle', null);
      return;
    }

    this.preparing = true;
    this.setSnapshot('synthesizing', null);
    const prepared = await this.prepare(item);
    if (generation !== this.generation) return;
    this.preparing = false;
    if (!prepared.ok) {
      this.fail(toErrorMessage(prepared.error));
      return;
    }

    const tts = getPlatform().tts;
    if (!tts?.isSupported()) {
      this.fail('Audio playback is unavailable on this device.');
      return;
    }

    const finish = (): void => {
      if (generation !== this.generation) return;
      this.activeClip = null;
      this.systemSpeaking = false;
      void this.pump(generation);
    };
    const failPlayback = (): void => {
      if (generation !== this.generation) return;
      this.fail('The generated speech could not be played.');
    };

    this.setSnapshot('speaking', null);
    try {
      if (prepared.clip) {
        const clip = tts.playClip(prepared.clip.audioBase64, prepared.clip.mimeType, {
          onend: finish,
          onerror: failPlayback,
        });
        if (generation !== this.generation) {
          clip.stop();
          return;
        }
        this.activeClip = clip;
        this.prepareNext();
        return;
      }

      // No active runner synthesizer is the explicit `system` voice sentinel.
      // A present Piper that throws never reaches this branch and stays visible.
      this.systemSpeaking = true;
      tts.speak(prepared.text, {
        language: prepared.language,
        onend: finish,
        onerror: failPlayback,
      });
      this.prepareNext();
    } catch (error) {
      this.fail(toErrorMessage(error));
    }
  }

  private prepare(item: QueuedSpeech): Promise<PreparedResult> {
    item.prepared ??= Promise.resolve()
      .then(() =>
        api().invoke('session.synthesize', {
          ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
          text: item.text,
          language: item.language,
        }),
      )
      .then<PreparedResult>((clip) => ({
        ok: true,
        text: item.text,
        language: item.language,
        clip,
      }))
      .catch<PreparedResult>((error: unknown) => ({ ok: false, error }));
    return item.prepared;
  }

  /** Keep exactly one sentence warm while the current sentence is playing. */
  private prepareNext(): void {
    const next = this.items[0];
    if (next) void this.prepare(next);
  }

  private fail(reason: string): void {
    this.generation += 1;
    this.items.length = 0;
    this.preparing = false;
    this.systemSpeaking = false;
    this.activeClip?.stop();
    this.activeClip = null;
    getPlatform().tts?.cancel();
    releasePlayback(this);
    this.setSnapshot('error', reason);
  }

  private setSnapshot(phase: SpeechPlaybackPhase, errorReason: string | null): void {
    if (this.snapshot.phase === phase && this.snapshot.errorReason === errorReason) return;
    this.snapshot = Object.freeze({ phase, errorReason });
    for (const listener of this.listeners) listener();
  }
}
