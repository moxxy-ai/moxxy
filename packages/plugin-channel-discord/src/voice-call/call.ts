import { VoiceFeedbackScheduler, detectSpeechLanguage, type SpeechLanguage } from '@moxxy/chat-model';
import { SpokenReply } from './spoken-reply.js';

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

/** Why a call ended: on purpose (`/hangup`, the owner left) or the voice
 *  connection was lost. */
export type CallEnd = 'hung-up' | 'dropped';

/** What a call hears of the agent's turn while it runs. */
export interface CallTurnListener {
  /** The reply as it is written, piece by piece. */
  text(delta: string): void;
  /** One message of the reply is complete. */
  messageEnded(): void;
  /** An approved tool call starts; `input` only picks how the step is named. */
  toolStarted(callId: string, name: string, input: unknown): void;
  toolFinished(callId: string, ok: boolean): void;
}

export interface VoiceCallDeps {
  /** Speech to text for one utterance. */
  transcribe(packets: ReadonlyArray<Uint8Array>): Promise<string>;
  /** Run the utterance as an agent turn, telling the call what happens as it runs. */
  answer(text: string, turn: CallTurnListener): Promise<void>;
  /** One sentence to an Ogg/Opus clip in the voice for its language, or null
   *  when it cannot be voiced. */
  speak(text: string, language: SpeechLanguage): Promise<Uint8Array | null>;
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
 * and answered by the agent, and the reply is said sentence by sentence while
 * the agent is still writing it. Utterances are answered one at a time in the
 * order they were said. Talking over a reply that is being voiced or played
 * stops it and skips the rest of that message (barge-in) — the agent's turn
 * runs on, and what it says next, such as its result, is still said. While the agent works in silence the call says
 * which step it is on and, during a long one, that it is still at it (the
 * desktop's voice feedback, with steps announced).
 */
export class VoiceCall {
  private ended = false;
  private capturing = false;
  /** The reply being said, if any. */
  private reply: SpokenReply | null = null;
  private bargeInTimer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly feedback = new VoiceFeedbackScheduler({
    announceSteps: true,
    emitCue: (cue) => this.reply?.interject(cue.text),
    startWaitingTone: () => undefined,
    stopWaitingTone: () => undefined,
    cancelPendingCues: () => undefined,
  });
  private readonly endedListeners = new Set<(why: CallEnd) => void>();
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
      link.onClosed(() => this.finish('dropped')),
    ];
  }

  get active(): boolean {
    return !this.ended;
  }

  onEnded(listener: (why: CallEnd) => void): () => void {
    this.endedListeners.add(listener);
    return () => this.endedListeners.delete(listener);
  }

  /** Say something of the call's own, in turn with the replies. */
  say(text: string): Promise<void> {
    return this.enqueue(async () => {
      const reply = this.startReply();
      reply.write(text);
      reply.end();
      await this.finishReply(reply);
    });
  }

  hangUp(): void {
    this.finish('hung-up');
    this.link.close();
  }

  private speechStarted(): void {
    if (this.ended) return;
    if (this.reply?.audible && !this.bargeInTimer) {
      this.bargeInTimer = setTimeout(() => {
        this.bargeInTimer = null;
        if (this.reply?.audible) this.reply.interrupt();
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
    const reply = this.startReply(detectSpeechLanguage(text));
    this.feedback.beginTurn(text);
    try {
      await this.deps.answer(text, {
        text: (delta) => {
          if (delta.trim()) this.feedback.assistantSpeechQueued();
          reply.write(delta);
        },
        messageEnded: () => reply.endMessage(),
        toolStarted: (callId, name, input) => this.feedback.toolApproved(callId, name, input),
        toolFinished: (callId, ok) => this.feedback.toolResult(callId, ok),
      });
    } finally {
      this.feedback.endTurn();
      reply.end();
    }
    await this.finishReply(reply);
  }

  private startReply(language?: SpeechLanguage): SpokenReply {
    const reply = new SpokenReply(
      this.link,
      (sentence, sentenceLanguage) => this.deps.speak(sentence, sentenceLanguage),
      (audible) => this.feedback.setPlayback(audible ? 'speaking' : 'idle', audible ? 'assistant' : null),
      language,
    );
    this.reply = reply;
    if (this.ended) reply.cancel();
    return reply;
  }

  private async finishReply(reply: SpokenReply): Promise<void> {
    try {
      await reply.done;
    } finally {
      if (this.reply === reply) this.reply = null;
      this.cancelBargeIn();
    }
  }

  private finish(why: CallEnd): void {
    if (this.ended) return;
    this.ended = true;
    this.cancelBargeIn();
    this.feedback.close();
    this.reply?.cancel();
    for (const unsubscribe of this.unsubscribes) unsubscribe();
    for (const listener of this.endedListeners) listener(why);
  }
}
