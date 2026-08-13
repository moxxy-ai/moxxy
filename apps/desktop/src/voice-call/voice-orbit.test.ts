import { describe, expect, it } from 'vitest';
import type { VoiceActiveOperation } from '@moxxy/client-core';
import {
  buildVoiceOrbit,
  createVoiceOrbitState,
  syncVoiceOrbit,
} from './voice-orbit';

const operation = (
  callId: string,
  kind: VoiceActiveOperation['kind'],
  ordinal: number,
): VoiceActiveOperation => ({ callId, kind, ordinal });

describe('voice orbit presentation', () => {
  it('keeps stable slots and collapses overflow without exposing tool input', () => {
    const active = [
      operation('a', 'web-search', 0),
      operation('b', 'editing', 1),
      operation('c', 'verification', 2),
      operation('d', 'command', 3),
    ];
    const state = syncVoiceOrbit(createVoiceOrbitState(), active, new Map(), 100);
    const view = buildVoiceOrbit(state, 100);

    expect(view.items.map((item) => [item.callId, item.slot, item.label])).toEqual([
      ['a', 0, 'Searching the web'],
      ['b', 1, 'Writing changes'],
      ['c', 2, 'Running focused tests'],
    ]);
    expect(view.overflowCount).toBe(1);

    const next = syncVoiceOrbit(state, active.slice(1), new Map([['a', true]]), 200);
    expect(buildVoiceOrbit(next, 200).items.find((item) => item.callId === 'b')?.slot).toBe(1);
    expect(buildVoiceOrbit(next, 200).items.find((item) => item.callId === 'a')?.state).toBe('succeeded');
  });

  it('holds terminal feedback for the specified success and failure durations', () => {
    const running = syncVoiceOrbit(
      createVoiceOrbitState(),
      [operation('ok', 'editing', 0), operation('bad', 'command', 1)],
      new Map(),
      0,
    );
    const settled = syncVoiceOrbit(running, [], new Map([['ok', true], ['bad', false]]), 100);

    expect(buildVoiceOrbit(settled, 699).items).toHaveLength(2);
    expect(buildVoiceOrbit(settled, 700).items.map((item) => item.callId)).toEqual(['bad']);
    expect(buildVoiceOrbit(settled, 1_599).items.map((item) => item.callId)).toEqual(['bad']);
    expect(buildVoiceOrbit(settled, 1_600).items).toHaveLength(0);
  });

  it('fades cancelled operations without reporting success', () => {
    const running = syncVoiceOrbit(
      createVoiceOrbitState(),
      [operation('cancelled', 'generic', 0)],
      new Map(),
      0,
    );
    const cancelled = syncVoiceOrbit(running, [], new Map(), 10);

    expect(buildVoiceOrbit(cancelled, 10).items[0]?.state).toBe('cancelled');
    expect(buildVoiceOrbit(cancelled, 189).items).toHaveLength(1);
    expect(buildVoiceOrbit(cancelled, 190).items).toHaveLength(0);
  });
});
