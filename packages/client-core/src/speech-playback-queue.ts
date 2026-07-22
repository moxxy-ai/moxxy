import { toErrorMessage } from './errors.js';
import { getPlatform, type AudioClipHandle } from './platform.js';
import { toSpeakableText } from './speech.js';
import { planSpeechProsody, type SpeechProsody } from './speech-prosody.js';
import { detectSpeechLanguage, type SpeechLanguage } from './streaming-speech.js';
import { api } from './transport.js';

export type SpeechPlaybackPhase = 'idle' | 'synthesizing' | 'speaking' | 'error';
export type SpeechPlaybackKind = 'assistant' | 'cue';

export interface SpeechPlaybackSnapshot {
  readonly phase: SpeechPlaybackPhase;
  readonly errorReason: string | null;
  readonly currentKind: SpeechPlaybackKind | null;
}

export interface SpeechPlaybackQueueOptions {
  /** Voice-call surfaces require a configured synthesizer and must never fall
   *  back to the operating-system voice. */
  readonly requireSynthesizer?: boolean;
  /** Receives the analyser for the currently playing generated clip. */
  readonly onAnalyser?: (analyser: unknown | null) => void;
  /** Surface-specific Markdown policy. Read aloud keeps the default while a
   * live voice conversation can omit source code from spoken output. */
  readonly prepareText?: (markdown: string) => string;
}

interface PreparedClip {
  readonly ok: true;
  readonly text: string;
  readonly language: SpeechLanguage;
  readonly prosody: SpeechProsody;
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
  readonly prosody: SpeechProsody;
  readonly kind: SpeechPlaybackKind;
  prepared: Promise<PreparedResult> | null;
  cancelled: boolean;
}

const IDLE_SNAPSHOT: SpeechPlaybackSnapshot = Object.freeze({
  phase: 'idle',
  errorReason: null,
  currentKind: null,
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
  private preparingItem: QueuedSpeech | null = null;
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  private previousLanguage: SpeechLanguage | undefined;
  private readonly preparedCues = new Map<string, Promise<PreparedResult>>();

  constructor(
    private readonly workspaceId?: string,
    private readonly options: SpeechPlaybackQueueOptions = {},
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): SpeechPlaybackSnapshot => this.snapshot;

  enqueue(markdown: string, language?: SpeechLanguage): void {
    this.cancelPendingCues();
    this.enqueueItem(markdown, 'assistant', language);
  }

  enqueueCue(markdown: string, language: SpeechLanguage): void {
    this.enqueueItem(markdown, 'cue', language);
  }

  async prewarmCue(markdown: string, language: SpeechLanguage): Promise<void> {
    const item = this.createItem(markdown, 'cue', language);
    if (!item) return;
    const key = this.cueKey(item);
    let prepared = this.preparedCues.get(key);
    if (!prepared) {
      prepared = this.prepareUncached(item);
      this.preparedCues.set(key, prepared);
      while (this.preparedCues.size > 2) {
        const oldest = this.preparedCues.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        this.preparedCues.delete(oldest);
      }
    }
    const result = await prepared;
    if (result.ok && (result.clip || !this.options.requireSynthesizer)) return;
    if (this.preparedCues.get(key) === prepared) this.preparedCues.delete(key);
    if (!result.ok) throw result.error;
    throw new Error('No speech synthesizer is active. Enable Local Piper and try again.');
  }

  cancelPendingCues(): void {
    if (this.preparingItem?.kind === 'cue') this.preparingItem.cancelled = true;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (this.items[index]?.kind === 'cue') this.items.splice(index, 1);
    }
  }

  clearPreparedCues(): void {
    this.preparedCues.clear();
  }

  private enqueueItem(
    markdown: string,
    kind: SpeechPlaybackKind,
    language?: SpeechLanguage,
  ): void {
    const item = this.createItem(markdown, kind, language);
    if (!item) return;
    claimPlayback(this);
    this.previousLanguage = item.language;
    this.items.push(item);
    if (this.snapshot.phase === 'idle' || this.snapshot.phase === 'error') {
      this.setSnapshot('synthesizing', null, kind);
    }
    if (this.activeClip || this.systemSpeaking) this.prepareNext();
    void this.pump(this.generation);
  }

  private createItem(
    markdown: string,
    kind: SpeechPlaybackKind,
    language?: SpeechLanguage,
  ): QueuedSpeech | null {
    const text = (this.options.prepareText ?? toSpeakableText)(markdown);
    if (!text) return null;
    const selectedLanguage = language ?? detectSpeechLanguage(text, this.previousLanguage);
    const prosody = planSpeechProsody(text);
    return {
      text,
      language: selectedLanguage,
      prosody,
      kind,
      prepared: null,
      cancelled: false,
    };
  }

  cancel(): void {
    const ownsPlayback = activeQueue === this;
    this.generation += 1;
    this.items.length = 0;
    this.preparing = false;
    this.preparingItem = null;
    this.systemSpeaking = false;
    this.previousLanguage = undefined;
    this.clearPause();
    this.activeClip?.stop();
    this.activeClip = null;
    this.options.onAnalyser?.(null);
    if (ownsPlayback) {
      getPlatform().tts?.cancel();
      releasePlayback(this);
    }
    this.setSnapshot('idle', null, null);
  }

  private async pump(generation: number): Promise<void> {
    if (this.preparing || this.systemSpeaking || this.activeClip || this.pauseTimer) return;
    let item = this.items.shift();
    while (item?.cancelled) item = this.items.shift();
    if (!item) {
      this.setSnapshot('idle', null, null);
      return;
    }

    this.preparing = true;
    this.preparingItem = item;
    this.setSnapshot('synthesizing', null, item.kind);
    const prepared = await this.prepare(item);
    if (generation !== this.generation) return;
    this.preparing = false;
    this.preparingItem = null;
    if (item.cancelled) {
      void this.pump(generation);
      return;
    }
    if (!prepared.ok) {
      if (item.kind === 'cue') {
        void this.pump(generation);
        return;
      }
      this.fail(toErrorMessage(prepared.error));
      return;
    }
    if (!prepared.clip && this.options.requireSynthesizer) {
      if (item.kind === 'cue') {
        void this.pump(generation);
        return;
      }
      this.fail('No speech synthesizer is active. Enable Local Piper and try again.');
      return;
    }

    const tts = getPlatform().tts;
    if (!tts?.isSupported()) {
      if (item.kind === 'cue') {
        void this.pump(generation);
        return;
      }
      this.fail('Audio playback is unavailable on this device.');
      return;
    }

    const finish = (): void => {
      if (generation !== this.generation) return;
      this.activeClip = null;
      this.systemSpeaking = false;
      this.pauseBeforeNext(prepared.prosody.pauseAfterMs, generation);
    };
    const failPlayback = (): void => {
      if (generation !== this.generation) return;
      if (item.kind === 'cue') {
        this.activeClip = null;
        this.systemSpeaking = false;
        void this.pump(generation);
        return;
      }
      this.fail('The generated speech could not be played.');
    };

    this.setSnapshot('speaking', null, item.kind);
    try {
      if (prepared.clip) {
        const clip = tts.playClip(prepared.clip.audioBase64, prepared.clip.mimeType, {
          onend: finish,
          onerror: failPlayback,
          ...(this.options.onAnalyser ? { onAnalyser: this.options.onAnalyser } : {}),
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
      if (item.kind === 'cue') {
        this.activeClip = null;
        this.systemSpeaking = false;
        void this.pump(generation);
      } else {
        this.fail(toErrorMessage(error));
      }
    }
  }

  private prepare(item: QueuedSpeech): Promise<PreparedResult> {
    if (item.kind === 'cue') {
      const cached = this.preparedCues.get(this.cueKey(item));
      if (cached) return cached;
    }
    item.prepared ??= this.prepareUncached(item);
    return item.prepared;
  }

  private prepareUncached(item: QueuedSpeech): Promise<PreparedResult> {
    return Promise.resolve()
      .then(() =>
        api().invoke('session.synthesize', {
          ...(this.workspaceId ? { workspaceId: this.workspaceId } : {}),
          text: item.text,
          language: item.language,
          rate: item.prosody.rate,
        }),
      )
      .then<PreparedResult>((clip) => ({
        ok: true,
        text: item.text,
        language: item.language,
        prosody: item.prosody,
        clip,
      }))
      .catch<PreparedResult>((error: unknown) => ({ ok: false, error }));
  }

  private cueKey(item: QueuedSpeech): string {
    return `${item.language}\u0000${item.prosody.rate}\u0000${item.text}`;
  }

  /** Keep exactly one sentence warm while the current sentence is playing. */
  private prepareNext(): void {
    const next = this.items[0];
    if (next) void this.prepare(next);
  }

  private pauseBeforeNext(durationMs: number, generation: number): void {
    if (durationMs <= 0) {
      void this.pump(generation);
      return;
    }
    this.pauseTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.pauseTimer = null;
      void this.pump(generation);
    }, durationMs);
  }

  private clearPause(): void {
    if (!this.pauseTimer) return;
    clearTimeout(this.pauseTimer);
    this.pauseTimer = null;
  }

  private fail(reason: string): void {
    this.generation += 1;
    this.items.length = 0;
    this.preparing = false;
    this.preparingItem = null;
    this.systemSpeaking = false;
    this.clearPause();
    this.activeClip?.stop();
    this.activeClip = null;
    this.options.onAnalyser?.(null);
    getPlatform().tts?.cancel();
    releasePlayback(this);
    this.setSnapshot('error', reason, null);
  }

  private setSnapshot(
    phase: SpeechPlaybackPhase,
    errorReason: string | null,
    currentKind: SpeechPlaybackKind | null,
  ): void {
    if (
      this.snapshot.phase === phase &&
      this.snapshot.errorReason === errorReason &&
      this.snapshot.currentKind === currentKind
    ) return;
    this.snapshot = Object.freeze({ phase, errorReason, currentKind });
    for (const listener of this.listeners) listener();
  }
}
