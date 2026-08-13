import { describe, expect, it } from 'vitest';
import type { VoiceActiveOperation, VoiceOperationKind } from '@moxxy/client-core';
import { createVoiceOrbitState, syncVoiceOrbit } from './voice-orbit';
import { buildVoiceRail } from './voice-rail';

const OUTCOMES: ReadonlyMap<string, boolean> = new Map();

function running(
  callId: string,
  ordinal: number,
  kind: VoiceOperationKind = 'web-search',
): VoiceActiveOperation {
  return { callId, kind, ordinal };
}

/**
 * The rail has room for ONE operation, so which one it shows is a real
 * decision: it must be the oldest still running, and it must not be shoved
 * aside the moment another tool starts — a label that swaps every few hundred
 * milliseconds tells the user nothing. Everything else is a count.
 */
describe('voice rail', () => {
  it('shows the oldest running operation and counts the rest', () => {
    let state = createVoiceOrbitState();
    state = syncVoiceOrbit(state, [running('a', 0), running('b', 1), running('c', 2)], OUTCOMES, 1_000);
    const rail = buildVoiceRail(state, 1_000);

    expect(rail.operation?.callId).toBe('a');
    expect(rail.operation?.label).toBe('Searching the web');
    expect(rail.overflowCount).toBe(2);
  });

  it('holds the visible operation while newer ones come and go', () => {
    let state = createVoiceOrbitState();
    state = syncVoiceOrbit(state, [running('a', 0)], OUTCOMES, 1_000);
    state = syncVoiceOrbit(state, [running('a', 0), running('b', 1)], OUTCOMES, 1_100);
    // 'b' finished; 'a' is still going and must still be the one on screen.
    state = syncVoiceOrbit(state, [running('a', 0)], new Map([['b', true]]), 1_200);

    expect(buildVoiceRail(state, 1_200).operation?.callId).toBe('a');
  });

  it('promotes the next operation once the visible one has finished fading', () => {
    let state = createVoiceOrbitState();
    state = syncVoiceOrbit(state, [running('a', 0), running('b', 1)], OUTCOMES, 1_000);
    // 'a' succeeds: it stays visible, green, for its dwell time.
    state = syncVoiceOrbit(state, [running('b', 1)], new Map([['a', true]]), 1_100);
    expect(buildVoiceRail(state, 1_100).operation?.callId).toBe('a');
    expect(buildVoiceRail(state, 1_100).operation?.state).toBe('succeeded');

    // Once it expires, 'b' takes the slot.
    state = syncVoiceOrbit(state, [running('b', 1)], new Map([['a', true]]), 1_800);
    expect(buildVoiceRail(state, 1_800).operation?.callId).toBe('b');
  });

  it('reports nothing to show when no operation is running', () => {
    const rail = buildVoiceRail(createVoiceOrbitState(), 1_000);

    expect(rail.operation).toBeNull();
    expect(rail.overflowCount).toBe(0);
  });

  it('carries only a safe label, never the tool input', () => {
    let state = createVoiceOrbitState();
    state = syncVoiceOrbit(state, [running('a', 0, 'command')], OUTCOMES, 1_000);
    const rail = buildVoiceRail(state, 1_000);

    expect(rail.operation?.label).toBe('Running commands');
    expect(JSON.stringify(rail)).not.toMatch(/input|argv|path|\//i);
  });
});
