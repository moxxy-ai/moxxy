import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId } from './ids.js';
import type { MoxxyEvent } from './events.js';
import { openShortfall, shortfallNudge, shortfallOf } from './shortfall.js';

/**
 * A tool that carries out steps can stop short of them and still answer
 * without an error: `browser_run` says "0 of 1 steps done". In a form trial
 * the agent pressed Send, the page answered "503, try again", and the agent
 * ended the turn there. A result that names what it did not get done
 * (`shortfall.what`) lets the loop see that the turn ended on such a step.
 */
const sid = asSessionId('s1');
const t1 = asTurnId('t1');

function event(seq: number, partial: Omit<MoxxyEvent, 'id' | 'seq' | 'ts' | 'sessionId'>): MoxxyEvent {
  return { id: asEventId(`e${seq}`), seq, ts: seq, sessionId: sid, ...partial } as MoxxyEvent;
}

function step(seq: number, callId: string, output: unknown, error?: { message: string; kind: 'aborted' | 'threw' | 'denied' | 'timeout' }): MoxxyEvent[] {
  return [
    event(seq, { type: 'tool_call_requested', turnId: t1, source: 'model', callId, name: 'run', input: {} }),
    event(seq + 1, { type: 'tool_result', turnId: t1, source: 'tool', callId, ok: error === undefined, ...(error ? { error } : { output }) }),
  ];
}

const SHORT = { text: '0 of 1 steps done', shortfall: { what: 'step 1, click "Send": the page answered 503' } };

describe('shortfallOf', () => {
  it('reads what a result says it did not get done, and whether the step was delivered unseen', () => {
    expect(shortfallOf(SHORT)).toEqual({ what: 'step 1, click "Send": the page answered 503' });
    expect(shortfallOf({ shortfall: { what: 'step 2: not seen', unverified: true } })).toEqual({ what: 'step 2: not seen', unverified: true });
  });

  it('is null for a result that says nothing of it', () => {
    expect(shortfallOf('plain text')).toBeNull();
    expect(shortfallOf({ text: '3 of 3 steps done' })).toBeNull();
    expect(shortfallOf({ shortfall: { unverified: true } })).toBeNull();
    expect(shortfallOf({ shortfall: { what: '   ' } })).toBeNull();
  });
});

describe('openShortfall', () => {
  it('is the step the turn ended on, when that step did not get done', () => {
    expect(openShortfall([...step(0, 'c1', { text: 'ok' }), ...step(2, 'c2', SHORT)])).toEqual(SHORT.shortfall);
  });

  it('is settled by any step after it: another route that worked, a hand-over, a look', () => {
    expect(openShortfall([...step(0, 'c1', SHORT), ...step(2, 'c2', { text: 'sent through the other form' })])).toBeNull();
    expect(openShortfall([...step(0, 'c1', SHORT), ...step(2, 'c2', { completed: false })])).toBeNull();
  });

  it('is not an error, a refusal or a cancel — those say nothing of a step left to finish', () => {
    for (const kind of ['threw', 'denied', 'aborted', 'timeout'] as const) {
      expect(openShortfall([...step(0, 'c1', SHORT), ...step(2, 'c2', undefined, { message: 'no', kind })])).toBeNull();
    }
  });

  it('is null in a turn that called no tool', () => {
    expect(openShortfall([event(0, { type: 'assistant_message', turnId: t1, source: 'model', content: 'hello', stopReason: 'end_turn' })])).toBeNull();
  });
});

describe('shortfallNudge', () => {
  it('does not assert delivery when the helper did not answer', () => {
    const text = shortfallNudge({ what: 'Save: helper timed out', unverified: true });
    expect(text).not.toContain('It was delivered');
    expect(text).toContain('read the page or window to see whether it took effect');
    expect(text).toContain('do not repeat it blind');
  });
  it('names the step, offers another way and leaves room to say what blocks', () => {
    const text = shortfallNudge({ what: 'step 1, click "Send": the page answered 503' });

    expect(text).toContain('step 1, click "Send": the page answered 503');
    expect(text).toMatch(/another way/);
    expect(text).toMatch(/say plainly what stops you/);
    expect(text).toMatch(/do not work around a refusal/);
  });

  it('tells to check the effect first when the step was delivered, never to send it again blind', () => {
    const text = shortfallNudge({ what: 'step 1, click "Pay": delivered, but "paid" was not seen', unverified: true });

    expect(text).toMatch(/read the page or window to see whether it took effect/);
    expect(text).toMatch(/do not repeat it blind/);
  });

  it('says to do the step again when the page shows it did not take: an error that says "try again" is not a risk of a duplicate', () => {
    // In a form trial the agent was reminded, read "503, try again" on the page and still asked whether to resend.
    const text = shortfallNudge({ what: 'step 1, click "Send": delivered, but "a ticket number" was not seen', unverified: true });

    expect(text).toMatch(/If it shows that it did not — an error, a "try again" — do the step again/);
  });
});
