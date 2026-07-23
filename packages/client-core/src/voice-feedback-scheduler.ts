import type { SpeechPlaybackKind, SpeechPlaybackPhase } from './speech-playback-queue.js';
import { detectSpeechLanguage, type SpeechLanguage } from './streaming-speech.js';

export type VoiceToolActivity =
  | 'research'
  | 'editing'
  | 'command'
  | 'verification'
  | 'application'
  | 'generic';

export type VoiceFeedbackCueKind =
  | 'heartbeat'
  | 'tool-result'
  | 'input-required';

export interface VoiceFeedbackCue {
  readonly kind: VoiceFeedbackCueKind;
  readonly text: string;
  readonly language: SpeechLanguage;
}

export interface VoiceFeedbackClock {
  now(): number;
  setTimeout(run: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface VoiceFeedbackSchedulerOptions {
  readonly emitCue: (cue: VoiceFeedbackCue) => void;
  readonly startWaitingTone: () => void;
  readonly stopWaitingTone: () => void;
  readonly cancelPendingCues: () => void;
  readonly clock?: VoiceFeedbackClock;
}

interface ActiveTool {
  readonly startedAt: number;
  readonly activity: VoiceToolActivity;
}

const WAITING_TONE_DELAY_MS = 120;
const FIRST_HEARTBEAT_MS = 10_000;
const SECOND_HEARTBEAT_DELAY_MS = 30_000;
const LATER_HEARTBEAT_DELAY_MS = 90_000;
const MIN_CUE_GAP_MS = 8_000;
const LONG_TOOL_MS = 10_000;
const RESULT_DELAY_MS = 1_000;

const SYSTEM_CLOCK: VoiceFeedbackClock = {
  now: () => Date.now(),
  setTimeout: (run, delayMs) => setTimeout(run, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const ACTIVITY_CONTINUING: Readonly<Record<SpeechLanguage, Readonly<Record<VoiceToolActivity, string>>>> =
  Object.freeze({
    pl: Object.freeze({
      research: 'Wciąż sprawdzam potrzebne informacje.',
      editing: 'Nadal pracuję nad zmianami.',
      command: 'Polecenia jeszcze się nie zakończyły. Czekam na wynik.',
      verification: 'Nadal sprawdzam, czy wszystko działa.',
      application: 'Nadal sprawdzam to w aplikacji.',
      generic: 'Nadal nad tym pracuję.',
    }),
    en: Object.freeze({
      research: 'I am still checking the information.',
      editing: 'I am still working on the changes.',
      command: 'The commands are still running. I am waiting for the result.',
      verification: 'I am still checking that everything works.',
      application: 'I am still checking this in the application.',
      generic: 'I am still working on that.',
    }),
  });

const LATER_HEARTBEATS: Readonly<Record<SpeechLanguage, ReadonlyArray<string>>> = Object.freeze({
  pl: Object.freeze([
    'Nadal nad tym pracuję. Dam znać, gdy będę mieć wynik.',
    'Jeszcze nad tym pracuję.',
  ]),
  en: Object.freeze([
    'The work is still in progress. I will let you know when I have the result.',
    'I am still working on it.',
  ]),
});

const TOOL_RESULT: Readonly<Record<SpeechLanguage, string>> = Object.freeze({
  pl: 'Mam wynik tego kroku. Teraz go sprawdzam.',
  en: 'I have the result from that step. I am checking it now.',
});

const INPUT_REQUIRED: Readonly<Record<SpeechLanguage, string>> = Object.freeze({
  pl: 'Potrzebuję twojej decyzji w aplikacji, żeby kontynuować.',
  en: 'I need your decision in the application before I can continue.',
});

/** Classifies only the tool name. Inputs may carry paths, commands, or secrets and are never narrated. */
export function categorizeVoiceToolActivity(toolName: string): VoiceToolActivity {
  const normalized = toolName.toLocaleLowerCase().replaceAll('-', '_');
  if (/(?:test|verify|check|lint|typecheck|build)/u.test(normalized)) return 'verification';
  if (/(?:write|edit|patch|replace|create_file|delete_file)/u.test(normalized)) return 'editing';
  if (/(?:read|grep|glob|search|find|list|fetch|recall|web)/u.test(normalized)) return 'research';
  if (/(?:browser|computer|screenshot|click|navigate|view_image)/u.test(normalized)) return 'application';
  if (/(?:bash|exec|command|terminal|shell)/u.test(normalized)) return 'command';
  return 'generic';
}

/**
 * Deterministic, renderer-agnostic timing policy for conversational feedback.
 * It consumes lifecycle facts and emits ephemeral speech cues; it never writes
 * to the event log or inspects tool arguments.
 */
export class VoiceFeedbackScheduler {
  private readonly clock: VoiceFeedbackClock;
  private active = false;
  private waitingForInput = false;
  private language: SpeechLanguage = 'en';
  private previousLanguage: SpeechLanguage | undefined;
  private playbackPhase: SpeechPlaybackPhase = 'idle';
  private lastSpokenAt = Number.NEGATIVE_INFINITY;
  private heartbeatIndex = 0;
  private waitingToneEnabled = true;
  private waitingToneEligible = false;
  private waitingToneActive = false;
  private waitingToneTimer: unknown | null = null;
  private heartbeatTimer: unknown | null = null;
  private resultTimer: unknown | null = null;
  private readonly activeTools = new Map<string, ActiveTool>();

  constructor(private readonly options: VoiceFeedbackSchedulerOptions) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
  }

  beginTranscription(): void {
    if (this.active) return;
    this.resetTurn();
    this.active = true;
    this.waitingToneEligible = true;
    this.scheduleWaitingTone();
  }

  attachTranscript(userText: string): void {
    this.beginTranscription();
    this.language = detectSpeechLanguage(userText, this.previousLanguage);
    this.previousLanguage = this.language;
  }

  beginTurn(userText: string): void {
    this.beginTranscription();
    this.attachTranscript(userText);
  }

  assistantSpeechQueued(): void {
    if (!this.active) return;
    this.waitingToneEligible = false;
    this.pauseWaitingTone();
    this.clearResult();
    this.options.cancelPendingCues();
  }

  setWaitingToneEnabled(enabled: boolean): void {
    if (this.waitingToneEnabled === enabled) return;
    this.waitingToneEnabled = enabled;
    if (!enabled) {
      this.pauseWaitingTone();
      return;
    }
    this.scheduleWaitingTone();
  }

  toolApproved(callId: string, toolName: string): void {
    if (!this.active) return;
    const activity = categorizeVoiceToolActivity(toolName);
    const startsLongOperation = this.activeTools.size === 0;
    this.activeTools.set(callId, { startedAt: this.clock.now(), activity });
    if (startsLongOperation) {
      this.heartbeatIndex = 0;
      this.scheduleHeartbeat(FIRST_HEARTBEAT_MS);
    }
  }

  toolResult(callId: string, ok: boolean): void {
    if (!this.active) return;
    const tool = this.activeTools.get(callId);
    this.activeTools.delete(callId);
    if (this.activeTools.size === 0) this.clearHeartbeat();
    if (!ok || !tool || this.clock.now() - tool.startedAt < LONG_TOOL_MS) return;
    this.clearResult();
    this.resultTimer = this.clock.setTimeout(() => {
      this.resultTimer = null;
      if (!this.active || this.waitingForInput) return;
      this.tryEmit('tool-result', TOOL_RESULT[this.language], true);
    }, RESULT_DELAY_MS);
  }

  inputRequired(): void {
    if (!this.active || this.waitingForInput) return;
    this.waitingForInput = true;
    this.waitingToneEligible = false;
    this.pauseWaitingTone();
    this.clearHeartbeat();
    this.clearResult();
    this.options.cancelPendingCues();
    this.emit('input-required', INPUT_REQUIRED[this.language]);
  }

  inputResolved(): void {
    if (!this.active || !this.waitingForInput) return;
    this.waitingForInput = false;
    this.waitingToneEligible = true;
    this.scheduleWaitingTone();
    this.heartbeatIndex = 0;
    if (this.activeTools.size > 0) this.scheduleHeartbeat(FIRST_HEARTBEAT_MS);
  }

  setPlayback(phase: SpeechPlaybackPhase, _kind: SpeechPlaybackKind | null): void {
    const previousPhase = this.playbackPhase;
    if (this.playbackPhase === 'speaking' && phase !== 'speaking') {
      this.lastSpokenAt = this.clock.now();
    }
    this.playbackPhase = phase;
    if (phase !== 'idle') {
      this.pauseWaitingTone();
    } else if (previousPhase !== 'idle') {
      this.scheduleWaitingTone();
    }
  }

  endTurn(): void {
    this.resetTurn();
  }

  close(): void {
    this.resetTurn();
  }

  private scheduleWaitingTone(): void {
    if (
      !this.active ||
      !this.waitingToneEnabled ||
      !this.waitingToneEligible ||
      this.waitingForInput ||
      this.playbackPhase !== 'idle' ||
      this.waitingToneActive ||
      this.waitingToneTimer !== null
    ) return;
    this.waitingToneTimer = this.clock.setTimeout(() => {
      this.waitingToneTimer = null;
      if (
        !this.active ||
        !this.waitingToneEnabled ||
        !this.waitingToneEligible ||
        this.waitingForInput ||
        this.playbackPhase !== 'idle'
      ) return;
      this.waitingToneActive = true;
      this.options.startWaitingTone();
    }, WAITING_TONE_DELAY_MS);
  }

  private scheduleHeartbeat(delayMs: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = this.clock.setTimeout(() => {
      this.heartbeatTimer = null;
      if (!this.active || this.waitingForInput || this.activeTools.size === 0) return;
      const activity = this.currentActivity();
      const laterHeartbeats = LATER_HEARTBEATS[this.language];
      const text = this.heartbeatIndex < 2
        ? ACTIVITY_CONTINUING[this.language][activity]
        : laterHeartbeats[(this.heartbeatIndex - 2) % laterHeartbeats.length]
          ?? ACTIVITY_CONTINUING[this.language].generic;
      this.tryEmit('heartbeat', text, true);
      const nextDelay = this.heartbeatIndex === 0
        ? SECOND_HEARTBEAT_DELAY_MS
        : LATER_HEARTBEAT_DELAY_MS;
      this.heartbeatIndex += 1;
      this.scheduleHeartbeat(nextDelay);
    }, delayMs);
  }

  private currentActivity(): VoiceToolActivity {
    const tools = [...this.activeTools.values()];
    return tools.at(-1)?.activity ?? 'generic';
  }

  private tryEmit(kind: VoiceFeedbackCueKind, text: string, respectGap: boolean): boolean {
    if (this.playbackPhase !== 'idle') return false;
    if (respectGap && this.clock.now() - this.lastSpokenAt < MIN_CUE_GAP_MS) return false;
    this.emit(kind, text);
    return true;
  }

  private emit(kind: VoiceFeedbackCueKind, text: string): void {
    this.pauseWaitingTone();
    this.lastSpokenAt = this.clock.now();
    this.options.emitCue({ kind, text, language: this.language });
  }

  private resetTurn(): void {
    this.active = false;
    this.waitingForInput = false;
    this.waitingToneEligible = false;
    this.heartbeatIndex = 0;
    this.activeTools.clear();
    this.pauseWaitingTone();
    this.clearHeartbeat();
    this.clearResult();
    this.options.cancelPendingCues();
  }

  private pauseWaitingTone(): void {
    if (this.waitingToneTimer !== null) {
      this.clock.clearTimeout(this.waitingToneTimer);
      this.waitingToneTimer = null;
    }
    this.waitingToneActive = false;
    this.options.stopWaitingTone();
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    this.clock.clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private clearResult(): void {
    if (this.resultTimer === null) return;
    this.clock.clearTimeout(this.resultTimer);
    this.resultTimer = null;
  }
}
