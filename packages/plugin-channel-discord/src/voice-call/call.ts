/**
 * The Discord voice connection as a call needs it. The adapter over
 * `@discordjs/voice` implements it; tests stand in for it.
 */
export interface VoiceLink {
  /** The owner started transmitting (Discord's own voice activity). */
  onSpeechStart(listener: () => void): () => void;
  /** The owner stopped transmitting (a pause, not yet the end of the utterance). */
  onSpeechEnd(listener: () => void): () => void;
  /** The connection is gone (hung up, kicked, network). */
  onClosed(listener: () => void): () => void;
  /** The owner's Opus packets from now until the utterance ends in silence. */
  captureUtterance(): Promise<Uint8Array[]>;
  /** Play an Ogg/Opus clip; resolves once it finished or was stopped. */
  play(clip: Uint8Array): Promise<void>;
  stop(): void;
  close(): void;
}

export interface VoiceCallDeps {
  /** Speech to text for one utterance. */
  transcribe(packets: ReadonlyArray<Uint8Array>): Promise<string>;
  /** Run the utterance as an agent turn; the reply to say, or null for none. */
  answer(text: string): Promise<string | null>;
  /** Text to an Ogg/Opus clip, or null when it cannot be voiced. */
  speak(text: string): Promise<Uint8Array | null>;
  /** How long the owner must talk over a reply before it stops. */
  bargeInMs?: number;
  /** Utterances with fewer Opus packets (20 ms each) are noise, not speech. */
  minPackets?: number;
  onError?(err: unknown): void;
}

const DEFAULT_BARGE_IN_MS = 250;
const DEFAULT_MIN_PACKETS = 15;

/**
 * One live call, turn by turn: the owner speaks, the utterance is transcribed
 * and answered by the agent, the reply is voiced. Utterances are answered one
 * at a time in the order they were said. Talking over a reply that is being
 * voiced or played stops it (barge-in) — the agent's turn itself runs on, as in
 * the desktop's Voice Mode.
 */
export class VoiceCall {
  private ended = false;
  private capturing = false;
  /** A reply is being synthesized or played — the span barge-in applies to. */
  private voicing = false;
  /** Bumped on barge-in, so a reply voiced before it is never played. */
  private generation = 0;
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly endedListeners = new Set<() => void>();
  private readonly unsubscribes: Array<() => void>;
  private readonly bargeInMs: number;
  private readonly minPackets: number;

  constructor(
    private readonly link: VoiceLink,
    private readonly deps: VoiceCallDeps,
  ) {
    this.bargeInMs = deps.bargeInMs ?? DEFAULT_BARGE_IN_MS;
    this.minPackets = deps.minPackets ?? DEFAULT_MIN_PACKETS;
    this.unsubscribes = [
      link.onSpeechStart(() => this.speechStarted()),
      link.onSpeechEnd(() => this.cancelBargeIn()),
      link.onClosed(() => this.finish()),
    ];
  }

  get active(): boolean {
    return !this.ended;
  }

  onEnded(listener: () => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  /** Say something of the call's own, in turn with the replies. */
  say(text: string): Promise<void> {
    return this.enqueue(() => this.voice(text));
  }

  hangUp(): void {
    this.finish();
    this.link.close();
  }

  private speechStarted(): void {
    if (this.ended) return;
    if (this.voicing && !this.bargeInTimer) {
      this.bargeInTimer = setTimeout(() => {
        this.bargeInTimer = null;
        this.generation += 1;
        this.link.stop();
      }, this.bargeInMs);
    }
    if (!this.capturing) void this.capture();
  }

  private cancelBargeIn(): void {
    if (!this.bargeInTimer) return;
    clearTimeout(this.bargeInTimer);
    this.bargeInTimer = null;
  }

  private async capture(): Promise<void> {
    this.capturing = true;
    try {
      const packets = await this.link.captureUtterance();
      if (this.ended || packets.length < this.minPackets) return;
      void this.enqueue(() => this.respond(packets));
    } catch (err) {
      this.deps.onError?.(err);
    } finally {
      this.capturing = false;
    }
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((err: unknown) => this.deps.onError?.(err));
    this.queue = run;
    return run;
  }

  private async respond(packets: ReadonlyArray<Uint8Array>): Promise<void> {
    const text = (await this.deps.transcribe(packets)).trim();
    if (!text || this.ended) return;
    const reply = await this.deps.answer(text);
    if (!reply || this.ended) return;
    await this.voice(reply);
  }

  private async voice(text: string): Promise<void> {
    const generation = this.generation;
    this.voicing = true;
    try {
      const clip = await this.deps.speak(text);
      if (!clip || this.ended || generation !== this.generation) return;
      await this.link.play(clip);
    } finally {
      this.voicing = false;
      this.cancelBargeIn();
    }
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelBargeIn();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    for (const listener of this.endedListeners) listener();
  }
}
