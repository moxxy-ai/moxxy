import { detectSpeechLanguage, type SpeechLanguage } from './streaming-speech.js';
import { categorizeVoiceOperation, type VoiceOperationKind } from './voice-operations.js';

export type SpeechPlaybackPhase = 'idle' | 'synthesizing' | 'speaking' | 'error';
export type SpeechPlaybackKind = 'assistant' | 'cue';

export type VoiceToolActivity =
  | 'research'
  | 'editing'
  | 'command'
  | 'verification'
  | 'application'
  | 'generic';

export type VoiceFeedbackCueKind =
  | 'step'
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
  readonly cancelPendingCues: () => void;
  /** Say what kind of step starts ("Przeglądam pliki.") whenever the reply
   *  has been quiet for a while — for a surface where silence is all the
   *  listener gets, such as a phone-like call. */
  readonly announceSteps?: boolean;
  readonly clock?: VoiceFeedbackClock;
}

interface ActiveTool {
  readonly startedAt: number;
  readonly activity: VoiceToolActivity;
}

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

const STEP_STARTED: Readonly<Record<SpeechLanguage, Readonly<Record<VoiceOperationKind, string>>>> =
  Object.freeze({
    pl: Object.freeze({
      'web-search': 'Szukam w internecie.',
      'project-read': 'Przeglądam pliki.',
      editing: 'Wprowadzam zmiany.',
      verification: 'Sprawdzam, czy wszystko działa.',
      command: 'Uruchamiam polecenie.',
      application: 'Sprawdzam to na ekranie.',
      delegation: 'Zlecam część pracy pomocnikowi.',
      generic: 'Pracuję nad tym.',
    }),
    en: Object.freeze({
      'web-search': 'Searching the web.',
      'project-read': 'Looking through the files.',
      editing: 'Making the changes.',
      verification: 'Checking that everything works.',
      command: 'Running a command.',
      application: 'Checking this on the screen.',
      delegation: 'Handing part of this to a helper.',
      generic: 'Working on it.',
    }),
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
    this.clearResult();
    this.options.cancelPendingCues();
  }

  /** `input` only picks the kind of step; it is never spoken. */
  toolApproved(callId: string, toolName: string, input?: unknown): void {
    if (!this.active) return;
    if (this.options.announceSteps && !this.waitingForInput) {
      this.tryEmit('step', STEP_STARTED[this.language][categorizeVoiceOperation(toolName, input)], true);
    }
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
    this.clearHeartbeat();
    this.clearResult();
    this.options.cancelPendingCues();
    this.emit('input-required', INPUT_REQUIRED[this.language]);
  }

  inputResolved(): void {
    if (!this.active || !this.waitingForInput) return;
    this.waitingForInput = false;
    this.heartbeatIndex = 0;
    if (this.activeTools.size > 0) this.scheduleHeartbeat(FIRST_HEARTBEAT_MS);
  }

  setPlayback(phase: SpeechPlaybackPhase, _kind: SpeechPlaybackKind | null): void {
    if (this.playbackPhase === 'speaking' && phase !== 'speaking') {
      this.lastSpokenAt = this.clock.now();
    }
    this.playbackPhase = phase;
  }

  endTurn(): void {
    this.resetTurn();
  }

  close(): void {
    this.resetTurn();
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
    this.lastSpokenAt = this.clock.now();
    this.options.emitCue({ kind, text, language: this.language });
  }

  private resetTurn(): void {
    this.active = false;
    this.waitingForInput = false;
    this.heartbeatIndex = 0;
    this.activeTools.clear();
    this.clearHeartbeat();
    this.clearResult();
    this.options.cancelPendingCues();
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
