import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyEvent } from '@moxxy/sdk';
import { EventBlockView } from '../blocks/EventBlockView';
import { ModeTranscriptContext } from './ModeTranscriptContext';
import { readModeEvents } from './mode-events';
import { PlanNextContext, planNextActions, usePlanNext, type PlanNext } from './plan-next';
import { __resetPlanDismissals } from './plan-dismissals';

afterEach(() => {
  cleanup();
  localStorage.clear();
  __resetPlanDismissals();
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

  it('stays open when the agent says more after it in the same turn', () => {
    const message = planText();
    const modes = readModeEvents([prompt('plan it', 't1'), planned('default'), message, ev('assistant_message', { content: 'Waiting for you.', stopReason: 'end_turn', source: 'model' })]);
    expect(modes.openPlanId).toBe(message.id);
  });

  it('is the newest plan once the person asked for another', () => {
    const first = planText();
    const second = planText();
    const modes = readModeEvents([planned('default'), first, prompt('change step 2', 't2'), ev('plugin_event', {
      pluginId: '@moxxy/mode-plan', subtype: 'plan_completed', source: 'plugin', turnId: 't2', payload: { steps: 2 },
    }), { ...second, turnId: 't2' } as MoxxyEvent]);
    expect(modes.openPlanId).toBe(second.id);
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
  function renderPlan(options: { run: ((next: PlanNext, note?: string) => void) | null; after?: MoxxyEvent }): void {
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

  it('also offers to rewrite or dismiss it', () => {
    renderPlan({ run: vi.fn() });
    expect(within(screen.getByTestId('mode-outcome')).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Implement', 'Run as goal', 'Rewrite', 'Dismiss',
    ]);
  });

  it('rewrites it with what the person says does not fit', () => {
    const run = vi.fn();
    renderPlan({ run });
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox', { name: 'What should change' }), { target: { value: 'Skip step 2' } });
    fireEvent.click(send);
    expect(run).toHaveBeenCalledWith('rewrite', 'Skip step 2');
  });

  it('goes back to the answers when the rewrite is cancelled', () => {
    renderPlan({ run: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Rewrite' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'What should change' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Implement' })).toBeInTheDocument();
  });

  it('dismisses it for good: no answers, and it says so, also after the window opens again', () => {
    renderPlan({ run: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull();
    expect(screen.getByTestId('mode-outcome')).toHaveTextContent('Dismissed');

    cleanup();
    __resetPlanDismissals();
    seq -= 2;
    renderPlan({ run: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Implement' })).toBeNull();
    expect(screen.getByTestId('mode-outcome')).toHaveTextContent('Dismissed');
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

  it('rewrites in plan mode, with what the person said', async () => {
    const calls = installApi();
    const onSend = vi.fn();
    const { result } = renderHook(() => usePlanNext({ workspaceId: 'ws', ready: true, busy: false, onSend }));

    result.current?.('rewrite', 'Skip step 2');

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('Rewrite the plan above. What does not fit:\n\nSkip step 2'));
    expect(calls.map((c) => c.args)).toEqual([{ workspaceId: 'ws', mode: 'plan' }]);
  });

  it('is not on offer while a turn runs or the runner is away', () => {
    installApi();
    const onSend = vi.fn();
    expect(renderHook(() => usePlanNext({ workspaceId: 'ws', ready: true, busy: true, onSend })).result.current).toBeNull();
    expect(renderHook(() => usePlanNext({ workspaceId: 'ws', ready: false, busy: false, onSend })).result.current).toBeNull();
  });
});
