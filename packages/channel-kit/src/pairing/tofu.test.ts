import { describe, expect, it, vi } from 'vitest';
import { TofuPairingWindow } from './tofu.js';

interface Candidate {
  readonly teamId: string;
  readonly channelId: string;
}

describe('TofuPairingWindow', () => {
  it('ignores candidates while disarmed', () => {
    const w = new TofuPairingWindow<Candidate>();
    const seen: Candidate[] = [];
    w.onCandidate((c) => seen.push(c));
    expect(w.offer({ teamId: 'T1', channelId: 'C1' })).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it('captures and consumes candidates while armed', () => {
    const w = new TofuPairingWindow<Candidate>();
    const seen: Candidate[] = [];
    w.onCandidate((c) => seen.push(c));
    w.arm();
    expect(w.isArmed).toBe(true);
    expect(w.offer({ teamId: 'T1', channelId: 'C1' })).toBe(true);
    expect(seen).toEqual([{ teamId: 'T1', channelId: 'C1' }]);
  });

  it('stays armed until disarmed (operator confirms out of band)', () => {
    const w = new TofuPairingWindow<Candidate>();
    w.arm();
    expect(w.offer({ teamId: 'T1', channelId: 'C1' })).toBe(true);
    expect(w.offer({ teamId: 'T2', channelId: 'C2' })).toBe(true);
    w.disarm();
    expect(w.isArmed).toBe(false);
    expect(w.offer({ teamId: 'T3', channelId: 'C3' })).toBe(false);
  });

  it('unsubscribe stops a listener', () => {
    const w = new TofuPairingWindow<Candidate>();
    const seen: Candidate[] = [];
    const unsubscribe = w.onCandidate((c) => seen.push(c));
    w.arm();
    w.offer({ teamId: 'T1', channelId: 'C1' });
    unsubscribe();
    w.offer({ teamId: 'T2', channelId: 'C2' });
    expect(seen).toEqual([{ teamId: 'T1', channelId: 'C1' }]);
  });

  it('a throwing listener is reported and never breaks the offer', () => {
    const onListenerError = vi.fn();
    const w = new TofuPairingWindow<Candidate>({ onListenerError });
    const seen: Candidate[] = [];
    w.onCandidate(() => {
      throw new Error('boom');
    });
    w.onCandidate((c) => seen.push(c));
    w.arm();
    expect(w.offer({ teamId: 'T1', channelId: 'C1' })).toBe(true);
    expect(onListenerError).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(1);
  });
});
