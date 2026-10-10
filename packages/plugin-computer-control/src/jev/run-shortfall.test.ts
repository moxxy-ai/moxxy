import { describe, expect, it } from 'vitest';
import { openShortfall, shortfallNudge, asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { describeRun, runShortfall, type RunReport, type StepOutcome } from './run.js';
import type { RunStep } from '../contract/tools.js';

const steps: RunStep[] = [{ do: 'click', target: 'Save' }];
const report = (outcome: StepOutcome): RunReport => ({
  outcomes: [outcome], state: { tree: { app: 'Editor', elements: [] } }, asks: 0, ms: 0, time: { jev: 0, act: 0, look: 0 },
});
const pending = (outcome: StepOutcome) => {
  const shortfall = runShortfall(report(outcome), steps);
  const event: MoxxyEvent = { id: asEventId('e1'), seq: 0, ts: 0, sessionId: asSessionId('s1'), turnId: asTurnId('t1'), source: 'tool', type: 'tool_result', callId: 'c1', ok: true, output: { text: outcome.why, ...(shortfall ? { shortfall } : {}) } };
  return openShortfall([event]);
};

describe('Computer Use outcome through the turn checkpoint boundary', () => {
  it.each(['user_stopped', 'user_intervened', 'permissions_not_granted', 'permissions_pending', 'screen_locked', 'tier_insufficient', 'app_not_allowed', 'protected_path', 'system_key_combo', 'clipboard_not_granted', 'own_window'] as const)('does not create pending work for %s, even with an earlier uncertain effect', (code) => {
      expect(pending({ status: 'failed', attempts: 1, code, unverified: true, why: 'Localized text with no error code' })).toBeNull();
    });

  it('still reminds about an ordinary failure, without inferring a block from text', () => {
    const shortfall = pending({ status: 'failed', attempts: 1, code: 'target_blocked', why: 'user_stopped is merely a button label here' });
    expect(shortfall?.what).toContain('user_stopped is merely a button label');
    expect(shortfall?.unverified).toBeUndefined();
  });

  it('requires an observation before deciding to repeat an uncertain action', () => {
    const shortfall = pending({ status: 'failed', attempts: 1, code: 'timeout', unverified: true, why: 'No answer from helper' });
    expect(shortfall).toMatchObject({ unverified: true });
    expect(shortfallNudge(shortfall ?? { what: 'missing' })).toContain('read the page or window');
  });

  it('does not suggest another route in the report after a user block', () => {
    const text = describeRun(report({ status: 'failed', attempts: 1, code: 'user_intervened', unverified: true, why: 'blocked' }), steps);
    expect(text).not.toContain('continue from the failed step by another route');
    expect(text).toContain('once they resume');
  });

  it('asks to verify an unknown effect before repeating it in the report itself', () => {
    const text = describeRun(report({ status: 'failed', attempts: 1, unverified: true, why: 'No response' }), steps);
    expect(text).toContain('verify the effect before repeating');
  });
});
