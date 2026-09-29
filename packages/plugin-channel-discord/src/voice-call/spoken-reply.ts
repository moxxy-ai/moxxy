import { IncrementalSpeechSegmenter } from '@moxxy/chat-model';

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
 * is complete, the next two voiced while it plays. `cancel` (barge-in) stops
 * the speech and drops everything after it.
 */
export class SpokenReply {
  /** Settles once every sentence was played, or the reply was cancelled. */
  readonly done: Promise<void>;
  private readonly segmenter = new IncrementalSpeechSegmenter();
  private readonly sentences: Array<{ readonly text: string; clip: Promise<Uint8Array | null> | null }> = [];
  private next = 0;
  private ended = false;
  private cancelled = false;
  private playing = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly output: SpeechOutput,
    private readonly speak: (text: string) => Promise<Uint8Array | null>,
  ) {
    this.done = this.run();
  }

  /** Something is being voiced or played right now — what barge-in stops.
   *  A pause while the agent works between sentences does not count. */
  get audible(): boolean {
    return !this.cancelled && (this.playing || this.next < this.sentences.length);
  }

  write(delta: string): void {
    if (this.cancelled || this.ended) return;
    this.add(this.segmenter.push(delta));
  }

  /** No more text: say what is left, even an unfinished sentence. */
  end(): void {
    if (this.cancelled || this.ended) return;
    this.add(this.segmenter.flush());
    this.ended = true;
    this.notify();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.output.stop();
    this.notify();
  }

  private add(texts: ReadonlyArray<string>): void {
    for (const text of texts) this.sentences.push({ text, clip: null });
    this.prepare();
    this.notify();
  }

  /** Start voicing the next sentence and the ones after it, up to the prefetch. */
  private prepare(): void {
    const last = Math.min(this.sentences.length, this.next + 1 + PREFETCH_SENTENCES);
    for (let i = this.next; i < last; i += 1) {
      const sentence = this.sentences[i];
      if (sentence && !sentence.clip) sentence.clip = this.speak(sentence.text).catch(() => null);
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
      const clip = await sentence.clip;
      this.next += 1;
      if (this.cancelled) return;
      if (!clip) continue;
      this.playing = true;
      try {
        await this.output.play(clip);
      } finally {
        this.playing = false;
      }
    }
  }
}
