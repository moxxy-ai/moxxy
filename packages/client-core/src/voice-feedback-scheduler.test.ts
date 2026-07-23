import { describe, expect, it } from 'vitest';
import {
  VoiceFeedbackScheduler,
  categorizeVoiceToolActivity,
  type VoiceFeedbackClock,
  type VoiceFeedbackCue,
} from './voice-feedback-scheduler.js';

interface ScheduledTask {
  readonly id: number;
  readonly at: number;
  readonly run: () => void;
}

class ManualClock implements VoiceFeedbackClock {
  private current = 0;
  private nextId = 1;
  private readonly tasks = new Map<number, ScheduledTask>();

  now(): number {
    return this.current;
  }

  setTimeout(run: () => void, delayMs: number): number {
    const id = this.nextId;
    this.nextId += 1;
    this.tasks.set(id, { id, at: this.current + delayMs, run });
    return id;
  }

  clearTimeout(id: unknown): void {
    if (typeof id === 'number') this.tasks.delete(id);
  }

  advanceTo(target: number): void {
    while (true) {
      const due = [...this.tasks.values()]
        .filter((task) => task.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!due) break;
      this.tasks.delete(due.id);
      this.current = due.at;
      due.run();
    }
    this.current = target;
  }

  pendingCount(): number {
    return this.tasks.size;
  }
}

function setup() {
  const clock = new ManualClock();
  const cues: Array<VoiceFeedbackCue & { readonly at: number }> = [];
  const waitingToneStarts: number[] = [];
  let cancelled = 0;
  let waitingToneStops = 0;
  const scheduler = new VoiceFeedbackScheduler({
    clock,
    emitCue: (cue) => cues.push({ ...cue, at: clock.now() }),
    startWaitingTone: () => waitingToneStarts.push(clock.now()),
    stopWaitingTone: () => {
      waitingToneStops += 1;
    },
    cancelPendingCues: () => {
      cancelled += 1;
    },
  });
  return {
    clock,
    cues,
    waitingToneStarts,
    scheduler,
    cancelled: () => cancelled,
    waitingToneStops: () => waitingToneStops,
  };
}

describe('VoiceFeedbackScheduler', () => {
  it('starts the waiting tone during transcription and keeps it running when text arrives', () => {
    const { clock, waitingToneStarts, scheduler, waitingToneStops } = setup();

    scheduler.beginTranscription();
    clock.advanceTo(119);
    expect(waitingToneStarts).toEqual([]);

    clock.advanceTo(120);
    expect(waitingToneStarts).toEqual([120]);
    const stopsBeforeTranscript = waitingToneStops();

    scheduler.attachTranscript('Opowiedz mi proszę o kawie.');
    clock.advanceTo(1_000);

    expect(waitingToneStarts).toEqual([120]);
    expect(waitingToneStops()).toBe(stopsBeforeTranscript);
  });

  it('starts one non-verbal waiting tone after the short-response grace period', () => {
    const { clock, cues, waitingToneStarts, scheduler } = setup();

    scheduler.beginTurn('Cześć');
    clock.advanceTo(119);
    expect(waitingToneStarts).toEqual([]);
    expect(cues).toEqual([]);

    clock.advanceTo(220_000);

    expect(waitingToneStarts).toEqual([120]);
    expect(cues).toEqual([]);
  });

  it('speaks only after a tool remains active for the 10 → 30 → 90 second cadence', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Proszę przygotuj aplikację i sprawdź, czy wszystko działa.');
    clock.advanceTo(2_000);
    scheduler.toolApproved('call-1', 'exec_command');
    clock.advanceTo(222_000);

    expect(cues.map(({ kind, language, at }) => ({ kind, language, at }))).toEqual([
      { kind: 'heartbeat', language: 'pl', at: 12_000 },
      { kind: 'heartbeat', language: 'pl', at: 42_000 },
      { kind: 'heartbeat', language: 'pl', at: 132_000 },
      { kind: 'heartbeat', language: 'pl', at: 222_000 },
    ]);
  });

  it('cancels a pending waiting tone when real assistant speech becomes playable', () => {
    const { clock, cues, waitingToneStarts, scheduler, waitingToneStops } = setup();

    scheduler.beginTurn('Tell me a short story in English.');
    clock.advanceTo(80);
    scheduler.assistantSpeechQueued();
    clock.advanceTo(1_500);

    expect(waitingToneStarts).toEqual([]);
    expect(cues).toEqual([]);
    expect(waitingToneStops()).toBeGreaterThan(0);
  });

  it('stops an active waiting tone before assistant speech and never restarts it in that turn', () => {
    const { clock, waitingToneStarts, scheduler, waitingToneStops } = setup();

    scheduler.beginTurn('Tell me a short story in English.');
    clock.advanceTo(300);
    scheduler.assistantSpeechQueued();
    scheduler.setPlayback('speaking', 'assistant');
    scheduler.setPlayback('idle', null);
    clock.advanceTo(5_000);

    expect(waitingToneStarts).toEqual([120]);
    expect(waitingToneStops()).toBeGreaterThan(0);
  });

  it('pauses the waiting tone for a spoken cue and resumes it after playback', () => {
    const { clock, waitingToneStarts, scheduler, waitingToneStops } = setup();

    scheduler.beginTurn('Sprawdź proszę projekt.');
    scheduler.toolApproved('call-1', 'Read');
    clock.advanceTo(10_000);
    expect(waitingToneStops()).toBeGreaterThan(0);

    scheduler.setPlayback('synthesizing', 'cue');
    scheduler.setPlayback('speaking', 'cue');
    scheduler.setPlayback('idle', null);
    clock.advanceTo(10_119);
    expect(waitingToneStarts).toEqual([120]);
    clock.advanceTo(10_120);

    expect(waitingToneStarts).toEqual([120, 10_120]);
  });

  it('honours a live waiting-sound preference change without ending the turn', () => {
    const { clock, waitingToneStarts, scheduler, waitingToneStops } = setup();

    scheduler.beginTurn('Przygotuj proszę odpowiedź.');
    clock.advanceTo(300);
    scheduler.setWaitingToneEnabled(false);
    clock.advanceTo(2_000);
    expect(waitingToneStarts).toEqual([120]);
    expect(waitingToneStops()).toBeGreaterThan(0);

    scheduler.setWaitingToneEnabled(true);
    clock.advanceTo(2_119);
    expect(waitingToneStarts).toEqual([120]);
    clock.advanceTo(2_120);
    expect(waitingToneStarts).toEqual([120, 2_120]);
  });

  it('keeps English feedback English and inherits it for an ambiguous next utterance', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Please build the application and verify that everything works.');
    scheduler.toolApproved('call-1', 'run_tests');
    clock.advanceTo(10_000);
    scheduler.endTurn();
    scheduler.beginTurn('OK');
    scheduler.toolApproved('call-2', 'run_tests');
    clock.advanceTo(20_000);

    expect(cues).toHaveLength(2);
    expect(cues.every((cue) => cue.language === 'en')).toBe(true);
  });

  it('switches feedback language when the user switches from Polish to English', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Sprawdź proszę wszystkie potrzebne pliki.');
    scheduler.toolApproved('call-1', 'Read');
    clock.advanceTo(10_000);
    scheduler.endTurn();
    scheduler.beginTurn('Now please check that all tests work correctly.');
    scheduler.toolApproved('call-2', 'run_tests');
    clock.advanceTo(20_000);

    expect(cues.map((cue) => cue.language)).toEqual(['pl', 'en']);
  });

  it('uses the dominant prose language for a mixed technical utterance', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Proszę sprawdź ten component i zobacz, czy useEffect działa poprawnie.');
    scheduler.toolApproved('call-1', 'run_tests');
    clock.advanceTo(10_000);

    expect(cues[0]?.language).toBe('pl');
  });

  it('does not speak when a tool starts and describes it only after ten seconds', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Przeczytaj proszę dokumentację projektu.');
    scheduler.toolApproved('call-1', 'Read');
    clock.advanceTo(9_999);
    expect(cues).toEqual([]);

    clock.advanceTo(10_000);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      kind: 'heartbeat',
      language: 'pl',
      text: 'Wciąż sprawdzam potrzebne informacje.',
      at: 10_000,
    });
    expect(cues[0]?.text).not.toContain('Read');
  });

  it('uses plain, natural wording while commands are still running', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Uruchom proszę potrzebne polecenia i sprawdź wynik.');
    scheduler.toolApproved('call-1', 'exec_command');
    clock.advanceTo(10_000);

    expect(cues.map((cue) => cue.text)).toEqual([
      'Polecenia jeszcze się nie zakończyły. Czekam na wynik.',
    ]);
  });

  it('skips a due heartbeat instead of queueing it behind active speech', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Please complete this task in English.');
    scheduler.toolApproved('call-1', 'exec_command');
    clock.advanceTo(9_000);
    scheduler.setPlayback('speaking', 'assistant');
    clock.advanceTo(10_000);
    scheduler.setPlayback('idle', null);
    clock.advanceTo(40_000);

    expect(cues.map((cue) => cue.at)).toEqual([40_000]);
  });

  it('announces a completed long-running tool only when no answer supersedes it', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Please inspect the project and report the result.');
    scheduler.toolApproved('call-1', 'Read');
    scheduler.setPlayback('synthesizing', 'assistant');
    clock.advanceTo(12_000);
    scheduler.setPlayback('idle', null);
    scheduler.toolResult('call-1', true);
    clock.advanceTo(13_000);

    expect(cues.at(-1)).toMatchObject({
      kind: 'tool-result',
      language: 'en',
      text: 'I have the result from that step. I am checking it now.',
    });

    scheduler.toolApproved('call-2', 'Read');
    clock.advanceTo(24_000);
    scheduler.toolResult('call-2', true);
    scheduler.assistantSpeechQueued();
    clock.advanceTo(25_000);

    expect(cues.filter((cue) => cue.kind === 'tool-result')).toHaveLength(1);
  });

  it('pauses progress feedback for required input and restarts after it is resolved', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Zrób proszę potrzebne zmiany.');
    clock.advanceTo(5_000);
    scheduler.inputRequired();
    clock.advanceTo(40_000);

    expect(cues.some((cue) => cue.kind === 'input-required')).toBe(true);
    expect(cues.filter((cue) => cue.kind === 'heartbeat')).toHaveLength(0);

    scheduler.inputResolved();
    scheduler.toolApproved('call-1', 'Write');
    clock.advanceTo(50_000);
    expect(cues.filter((cue) => cue.kind === 'heartbeat')).toHaveLength(1);
  });

  it('clears every timer when the turn ends', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Please do this task.');
    scheduler.endTurn();
    expect(clock.pendingCount()).toBe(0);
    clock.advanceTo(500_000);
    expect(cues).toEqual([]);
  });
});

describe('categorizeVoiceToolActivity', () => {
  it.each([
    ['Read', 'research'],
    ['web_search', 'research'],
    ['web__run', 'research'],
    ['Write', 'editing'],
    ['apply_patch', 'editing'],
    ['exec_command', 'command'],
    ['run_tests', 'verification'],
    ['browser_open', 'application'],
    ['unknown_plugin_action', 'generic'],
  ] as const)('maps %s to %s without inspecting its arguments', (name, expected) => {
    expect(categorizeVoiceToolActivity(name)).toBe(expected);
  });
});
