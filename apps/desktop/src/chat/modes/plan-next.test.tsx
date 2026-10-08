import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { EventBlockView } from '../blocks/EventBlockView';
import { ModeTranscriptContext } from './ModeTranscriptContext';
import { readModeEvents } from './mode-events';
import { PlanNextContext, planNextActions, usePlanNext, type PlanNext } from './plan-next';

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

let seq = 0;
function ev(type: string, extra: Record<string, unknown>): MoxxyEvent {
  seq += 1;
  return { type, id: `e${seq}`, seq, ts: seq, sessionId: 's', turnId: 't1', ...extra } as unknown as MoxxyEvent;
}
const planned = (recommendedMode: string): MoxxyEvent =>
  ev('plugin_event', {
    pluginId: '@moxxy/mode-plan',
    subtype: 'plan_completed',
    source: 'plugin',
    payload: { title: 'Move it', steps: 3, questions: 0, recommendedMode },
  });
const planText = (): MoxxyEvent =>
  ev('assistant_message', { content: '# Move it\n\nBody.', stopReason: 'end_turn', source: 'system' });
const prompt = (text: string, turnId: string): MoxxyEvent => ev('user_prompt', { text, source: 'user', turnId });

describe('readModeEvents, the plan still waiting for a decision', () => {
  it('is the plan nothing has followed', () => {
    const message = planText();
    const modes = readModeEvents([prompt('plan it', 't1'), planned('default'), message]);
    expect(modes.openPlanId).toBe(message.id);
  });

  it('is none once the person has answered it', () => {
    const modes = readModeEvents([planned('default'), planText(), prompt('change step 2', 't2')]);
    expect(modes.openPlanId).toBeNull();
  });

  it('is none in a conversation with no plan', () => {
    const modes = readModeEvents([ev('assistant_message', { content: 'Hello.', stopReason: 'end_turn', source: 'model' })]);
    expect(modes.openPlanId).toBeNull();
  });
});

describe('planNextActions', () => {
  it('leads with supervised work unless the plan says it can run alone', () => {
    const run = vi.fn();
    expect(planNextActions('default', run).map((a) => [a.label, a.tone])).toEqual([
      ['Implement', 'primary'],
      ['Run as goal', 'neutral'],
    ]);
    expect(planNextActions('goal', run).map((a) => [a.label, a.tone])).toEqual([
      ['Run as goal', 'primary'],
      ['Implement', 'neutral'],
    ]);
    expect(planNextActions(undefined, run).map((a) => a.label)).toEqual(['Implement', 'Run as goal']);
  });
});

describe('the plan card', () => {
  function renderPlan(options: { run: ((next: PlanNext) => void) | null; after?: MoxxyEvent }): void {
    const message = planText();
    const events = [planned('default'), message, ...(options.after ? [options.after] : [])];
    render(
      <ModeTranscriptContext.Provider value={readModeEvents(events)}>
        <PlanNextContext.Provider value={options.run}>
          <EventBlockView event={message} />
        </PlanNextContext.Provider>
      </ModeTranscriptContext.Provider>,
    );
  }

  it('offers to carry the plan out, one filled answer and one quiet', () => {
    const run = vi.fn();
    renderPlan({ run });

    const implement = screen.getByRole('button', { name: 'Implement' });
    const goal = screen.getByRole('button', { name: 'Run as goal' });
    expect(implement).toHaveClass('ask-btn');
    expect(implement).toHaveAttribute('data-tone', 'primary');
    expect(goal).toHaveAttribute('data-tone', 'neutral');

    fireEvent.click(implement);
    fireEvent.click(goal);
    expect(run.mock.calls).toEqual([['implement'], ['goal']]);
  });

  it('offers nothing on a plan the conversation has moved past', () => {
    renderPlan({ run: vi.fn(), after: prompt('change step 2', 't2') });
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull();
  });

  it('offers nothing where the plan cannot be acted on', () => {
    renderPlan({ run: null });
    expect(screen.getByTestId('mode-outcome')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull();
  });
});

describe('usePlanNext', () => {
  function installApi(): Array<{ channel: string; args: unknown }> {
    const calls: Array<{ channel: string; args: unknown }> = [];
    __setApiOverride({
      invoke: ((channel: string, args?: unknown) => {
        calls.push({ channel, args });
        return Promise.resolve(undefined);
      }) as never,
      subscribe: (() => () => undefined) as never,
    } as never);
    return calls;
  }

  it('implements under the default mode, switching before it sends', async () => {
    const calls = installApi();
    const onSend = vi.fn(() => calls.push({ channel: 'sent', args: null }));
    const { result } = renderHook(() => usePlanNext({ workspaceId: 'ws', ready: true, busy: false, onSend }));

    result.current?.('implement');

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Implement the approved plan above.'));
    expect(calls.map((c) => [c.channel, c.args])).toEqual([
      ['session.setMode', { workspaceId: 'ws', mode: 'default' }],
      ['sent', null],
    ]);
  });

  it('runs as a goal that hands back to the default mode, not to planning', async () => {
    const calls = installApi();
    const onSend = vi.fn();
    const { result } = renderHook(() => usePlanNext({ workspaceId: 'ws', ready: true, busy: false, onSend }));

    result.current?.('goal');

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Execute the approved plan above.'));
    expect(calls.map((c) => c.args)).toEqual([
      { workspaceId: 'ws', mode: 'default' },
      { workspaceId: 'ws', mode: 'goal' },
    ]);
  });

  it('is not on offer while a turn runs or the runner is away', () => {
    installApi();
    const onSend = vi.fn();
    expect(renderHook(() => usePlanNext({ workspaceId: 'ws', ready: true, busy: true, onSend })).result.current).toBeNull();
    expect(renderHook(() => usePlanNext({ workspaceId: 'ws', ready: false, busy: false, onSend })).result.current).toBeNull();
  });
});
