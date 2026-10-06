import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { useVoiceModePresentation } from './useVoiceModePresentation';

const START = 1_000_000;
const prompt = {
  id: asEventId('e1'),
  seq: 1,
  ts: START,
  sessionId: asSessionId('session-1'),
  turnId: asTurnId('turn_1'),
  type: 'user_prompt',
  source: 'user',
  text: 'Zapisz plik.',
} as MoxxyEvent;

function present(agentTurn: { sending: boolean; activeTurnId: string | null; streamingText: string }) {
  return {
    active: true,
    phase: 'working' as const,
    microphoneMuted: false,
    localPiperInstallRequired: false,
    localPiperInstalling: false,
    activeOperations: [],
    events: [prompt],
    agentTurn,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START + 4_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVoiceModePresentation agent work', () => {
  it('counts the time the agent has been working, second by second', () => {
    const hook = renderHook((props) => useVoiceModePresentation(props), {
      initialProps: present({ sending: true, activeTurnId: 'turn_1', streamingText: '' }),
    });
    expect(hook.result.current.agentWork).toEqual({ label: 'Agent thinking', elapsed: '0:04' });

    act(() => { vi.advanceTimersByTime(2_000); });

    expect(hook.result.current.agentWork).toEqual({ label: 'Agent thinking', elapsed: '0:06' });
  });

  it('clears once the turn is over', () => {
    const hook = renderHook((props) => useVoiceModePresentation(props), {
      initialProps: present({ sending: true, activeTurnId: 'turn_1', streamingText: '' }),
    });

    hook.rerender(present({ sending: false, activeTurnId: null, streamingText: '' }));

    expect(hook.result.current.agentWork).toBeNull();
  });
});
