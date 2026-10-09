import { describe, expect, it } from 'vitest';
import {
  VoiceFeedbackScheduler,
  categorizeVoiceToolActivity,
  type VoiceFeedbackClock,
  type VoiceFeedbackCue,
  type VoiceFeedbackSchedulerOptions,
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

function setup(options: Partial<VoiceFeedbackSchedulerOptions> = {}) {
  const clock = new ManualClock();
  const cues: Array<VoiceFeedbackCue & { readonly at: number }> = [];
  let cancelled = 0;
  const scheduler = new VoiceFeedbackScheduler({
    clock,
    emitCue: (cue) => cues.push({ ...cue, at: clock.now() }),
    cancelPendingCues: () => {
      cancelled += 1;
    },
    ...options,
  });
  return { clock, cues, scheduler, cancelled: () => cancelled };
}

describe('VoiceFeedbackScheduler', () => {
  it('announces each step it starts when asked to, in the language of the request', () => {
    const polish = setup({ announceSteps: true });
    polish.scheduler.beginTurn('Sprawdź proszę, czy testy przechodzą.');
    polish.scheduler.toolApproved('call-1', 'Bash', { command: 'pnpm test' });

    const english = setup({ announceSteps: true });
    english.scheduler.beginTurn('Please look at the config file for me.');
    english.scheduler.toolApproved('call-1', 'Read', { file_path: 'moxxy.config.ts' });

    expect(polish.cues.map(({ kind, text, at }) => ({ kind, text, at }))).toEqual([
      { kind: 'step', text: 'Sprawdzam, czy wszystko działa.', at: 0 },
    ]);
    expect(english.cues.map(({ kind, text }) => ({ kind, text }))).toEqual([
      { kind: 'step', text: 'Looking through the files.' },
    ]);
  });

  it('does not announce a step right after something was said or while speech plays', () => {
    const { clock, cues, scheduler } = setup({ announceSteps: true });

    scheduler.beginTurn('Poszukaj proszę w internecie i w projekcie.');
    scheduler.toolApproved('call-1', 'Read', {});
    scheduler.toolResult('call-1', true);
    clock.advanceTo(3_000);
    scheduler.toolApproved('call-2', 'Grep', { pattern: 'x' });
    scheduler.toolResult('call-2', true);
    clock.advanceTo(9_000);
    scheduler.setPlayback('speaking', 'assistant');
    scheduler.toolApproved('call-3', 'Bash', { command: 'ls' });
    scheduler.toolResult('call-3', true);
    scheduler.setPlayback('idle', null);
    clock.advanceTo(17_000);
    scheduler.toolApproved('call-4', 'web_search', { query: 'moxxy' });

    expect(cues.map(({ text, at }) => ({ text, at }))).toEqual([
      { text: 'Przeglądam pliki.', at: 0 },
      { text: 'Szukam w internecie.', at: 17_000 },
    ]);
  });

  it('keeps steps quiet unless asked to announce them', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTurn('Sprawdź proszę, czy testy przechodzą.');
    scheduler.toolApproved('call-1', 'Bash', { command: 'pnpm test' });
    clock.advanceTo(5_000);

    expect(cues).toEqual([]);
  });

  it('says nothing through a turn that runs no tool, however long it takes', () => {
    const { clock, cues, scheduler } = setup();

    scheduler.beginTranscription();
    clock.advanceTo(1_000);
    scheduler.attachTranscript('Opowiedz mi proszę o kawie.');
    clock.advanceTo(220_000);

    expect(cues).toEqual([]);
    expect(clock.pendingCount()).toBe(0);
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

  it('drops the cues still waiting to be said once the real answer can be played', () => {
    const { cancelled, cues, scheduler } = setup();

    scheduler.beginTurn('Tell me a short story in English.');
    const before = cancelled();
    scheduler.assistantSpeechQueued();

    expect(cancelled()).toBe(before + 1);
    expect(cues).toEqual([]);
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
