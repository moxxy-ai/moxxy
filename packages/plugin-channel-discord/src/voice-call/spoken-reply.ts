import { IncrementalSpeechSegmenter, detectSpeechLanguage, type SpeechLanguage } from '@moxxy/chat-model';

/** Where a call's speech goes (the Discord voice connection). */
export interface SpeechOutput {
  /** Resolves once the clip finished or was stopped. */
  play(clip: Uint8Array): Promise<void>;
  stop(): void;
}

/** Sentences voiced ahead of the one playing, as in the desktop's Voice Mode. */
const PREFETCH_SENTENCES = 2;

/**
 * A reply said while it is still being written: text arrives in deltas, is
 * split into sentences (the same segmenter as the desktop's Voice Mode), and
 * each sentence is voiced and played in order — the first one as soon as it
 * is complete, the next two voiced while it plays. `interrupt` (barge-in)
 * stops what is being said and skips the rest of that message — the agent's
 * next message (its result) and the call's own sentences are still said;
 * `cancel` (hang-up) stops everything.
 */
export class SpokenReply {
  /** Settles once every sentence was played, or the reply was cancelled. */
  readonly done: Promise<void>;
  private readonly segmenter = new IncrementalSpeechSegmenter();
  private readonly sentences: Array<{
    readonly text: string;
    readonly language: SpeechLanguage;
    clip: Promise<Uint8Array | null> | null;
  }> = [];
  private next = 0;
  private ended = false;
  private cancelled = false;
  private playing = false;
  private wake: (() => void) | null = null;
  private wasAudible = false;
  /** Talked over: what the agent writes is skipped until its message ends. */
  private skipping = false;
  /** Bumped by `interrupt`, so a sentence voiced before it is not played after. */
  private generation = 0;

  constructor(
    private readonly output: SpeechOutput,
    /** One sentence to a clip, in the voice for its language (as the
     *  desktop's Voice Mode picks it: a short word keeps the language before it). */
    private readonly speak: (text: string, language: SpeechLanguage) => Promise<Uint8Array | null>,
    /** Told whenever {@link audible} flips. */
    private readonly onAudible?: (audible: boolean) => void,
    /** The language to start from — the question's, in a call. */
    private language?: SpeechLanguage,
  ) {
    this.done = this.run();
  }

  /** Something is being voiced or played right now — what barge-in stops.
   *  A pause while the agent works between sentences does not count. */
  get audible(): boolean {
    return !this.cancelled && (this.playing || this.next < this.sentences.length);
  }

  write(delta: string): void {
    if (this.cancelled || this.ended || this.skipping) return;
    this.add(this.segmenter.push(delta));
  }

  /** One message of the agent is complete: say its unfinished last sentence. */
  endMessage(): void {
    if (this.cancelled || this.ended) return;
    if (this.skipping) {
      this.skipping = false;
      return;
    }
    this.add(this.segmenter.flush());
  }

  /** A whole sentence of the call's own, said in turn with the reply. */
  interject(sentence: string): void {
    if (this.cancelled || this.ended) return;
    this.add([sentence]);
  }

  /** No more text: say what is left, even an unfinished sentence. */
  end(): void {
    if (this.cancelled || this.ended) return;
    this.add(this.segmenter.flush());
    this.ended = true;
    this.notify();
  }

  /** Barge-in: stop what is being said and skip the rest of this message. */
  interrupt(): void {
    if (this.cancelled) return;
    this.skipping = true;
    this.generation += 1;
    this.segmenter.reset();
    this.next = this.sentences.length;
    this.output.stop();
    this.notify();
    this.syncAudible();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.output.stop();
    this.notify();
    this.syncAudible();
  }

  private add(texts: ReadonlyArray<string>): void {
    for (const text of texts) {
      const language = detectSpeechLanguage(text, this.language);
      this.language = language;
      this.sentences.push({ text, language, clip: null });
    }
    this.prepare();
    this.notify();
    this.syncAudible();
  }

  private syncAudible(): void {
    const audible = this.audible;
    if (audible === this.wasAudible) return;
    this.wasAudible = audible;
    this.onAudible?.(audible);
  }

  /** Start voicing the next sentence and the ones after it, up to the prefetch. */
  private prepare(): void {
    const last = Math.min(this.sentences.length, this.next + 1 + PREFETCH_SENTENCES);
    for (let i = this.next; i < last; i += 1) {
      const sentence = this.sentences[i];
      if (sentence && !sentence.clip) {
        sentence.clip = this.speak(sentence.text, sentence.language).catch(() => null);
      }
    }
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async run(): Promise<void> {
    for (;;) {
      if (this.cancelled) return;
      const sentence = this.sentences[this.next];
      if (!sentence) {
        if (this.ended) return;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        continue;
      }
      this.prepare();
      const generation = this.generation;
      const clip = await sentence.clip;
      if (this.cancelled) return;
      if (generation !== this.generation) continue;
      this.next += 1;
      if (!clip) {
        this.syncAudible();
        continue;
      }
      this.playing = true;
      try {
        await this.output.play(clip);
      } finally {
        this.playing = false;
        this.syncAudible();
      }
    }
  }
}
