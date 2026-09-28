import { describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import {
  GPT_LIVE_RESULT_MAX_CHARS,
  GptLiveDelegations,
} from './gpt-live-delegation';

function runnerEvent(turnId: string, body: Record<string, unknown>): MoxxyEvent {
  return {
    id: asEventId(`${turnId}-${String(body.type)}`),
    seq: 1,
    ts: 1,
    sessionId: asSessionId('session-1'),
    turnId: asTurnId(turnId),
    ...body,
  } as MoxxyEvent;
}

const prompt = (turnId: string, text: string) =>
  runnerEvent(turnId, { type: 'user_prompt', source: 'user', text });
const reply = (turnId: string, content: string) =>
  runnerEvent(turnId, { type: 'assistant_message', source: 'model', content, stopReason: 'end_turn' });

describe('GptLiveDelegations', () => {
  it('waits for the delegated user turn when the delegation arrives first', () => {
    const delegations = new GptLiveDelegations();
    delegations.waitForUserTurn('item_1', 'turn_user_1');

    expect(delegations.takeWaitingFor('turn_other')).toBeNull();
    expect(delegations.takeWaitingFor('turn_user_1')).toBe('item_1');
    expect(delegations.takeWaitingFor('turn_user_1')).toBeNull();
  });

  it('lets a delegation without a user turn id take the next user turn', () => {
    const delegations = new GptLiveDelegations();
    delegations.waitForUserTurn('item_1', null);

    expect(delegations.takeWaitingFor('any_turn')).toBe('item_1');
  });

  it('returns the agent reply for the dispatched prompt when its turn completes', () => {
    const delegations = new GptLiveDelegations();
    delegations.dispatched('item_1', 'Uruchom testy w projekcie.');
    expect(delegations.inFlight).toBe(1);

    delegations.observe(prompt('agent_turn', 'Uruchom testy w projekcie.'));
    delegations.observe(reply('agent_turn', 'Uruchamiam.'));
    delegations.observe(reply('agent_turn', 'Wszystkie **141** testów przeszło.'));

    expect(delegations.complete('agent_turn', null)).toEqual({
      itemId: 'item_1',
      text: 'The Moxxy agent finished. Its reply: Wszystkie 141 testów przeszło.',
    });
    expect(delegations.inFlight).toBe(0);
    expect(delegations.complete('agent_turn', null)).toBeNull();
  });

  it('reports an agent failure plainly', () => {
    const delegations = new GptLiveDelegations();
    delegations.dispatched('item_1', 'Zrób deploy.');
    delegations.observe(prompt('agent_turn', 'Zrób deploy.'));

    expect(delegations.complete('agent_turn', 'provider timed out')).toEqual({
      itemId: 'item_1',
      text: 'The Moxxy agent could not finish the task: provider timed out',
    });
  });

  it('says so when the agent finished without a reply', () => {
    const delegations = new GptLiveDelegations();
    delegations.dispatched('item_1', 'Wyczyść cache.');
    delegations.observe(prompt('agent_turn', 'Wyczyść cache.'));

    expect(delegations.complete('agent_turn', null)?.text).toBe('The Moxxy agent finished without a reply.');
  });

  it('ignores turns it did not dispatch, and matches repeated prompts in order', () => {
    const delegations = new GptLiveDelegations();
    delegations.dispatched('item_1', 'Sprawdź status.');
    delegations.dispatched('item_2', 'Sprawdź status.');

    delegations.observe(prompt('typed_turn', 'Coś innego.'));
    delegations.observe(prompt('agent_a', 'Sprawdź status.'));
    delegations.observe(prompt('agent_b', 'Sprawdź status.'));

    expect(delegations.complete('typed_turn', null)).toBeNull();
    expect(delegations.complete('agent_b', null)?.itemId).toBe('item_2');
    expect(delegations.complete('agent_a', null)?.itemId).toBe('item_1');
  });

  it('fails a dispatch that never reached the agent', () => {
    const delegations = new GptLiveDelegations();
    delegations.dispatched('item_1', 'Uruchom testy.');

    expect(delegations.failDispatch('item_1', 'runner not connected')).toEqual({
      itemId: 'item_1',
      text: 'The Moxxy agent could not finish the task: runner not connected',
    });
    expect(delegations.inFlight).toBe(0);
  });

  it('bounds a long agent reply', () => {
    const delegations = new GptLiveDelegations();
    delegations.dispatched('item_1', 'Opisz repo.');
    delegations.observe(prompt('agent_turn', 'Opisz repo.'));
    delegations.observe(reply('agent_turn', 'a'.repeat(20_000)));

    const text = delegations.complete('agent_turn', null)?.text ?? '';
    expect(text.length).toBeLessThanOrEqual(GPT_LIVE_RESULT_MAX_CHARS);
    expect(text.endsWith('…')).toBe(true);
  });
});

const toolCall = (turnId: string, callId: string, name: string, input: unknown = {}) =>
  runnerEvent(`${turnId}-${callId}`, { type: 'tool_call_requested', source: 'model', callId, name, input, turnId });
const toolResult = (turnId: string, callId: string) =>
  runnerEvent(`${turnId}-${callId}-r`, { type: 'tool_result', source: 'tool', callId, output: 'ok', turnId });

function agentWorking(delegations: GptLiveDelegations, turnId = 'agent_turn'): void {
  delegations.dispatched('item_1', 'Uruchom testy.');
  delegations.observe(prompt(turnId, 'Uruchom testy.'));
}

describe('GptLiveDelegations progress', () => {
  it('describes what the delegated agent turn is doing, once per change', () => {
    const delegations = new GptLiveDelegations();
    agentWorking(delegations);

    expect(delegations.observe(toolCall('agent_turn', 'c1', 'bash', { command: 'pnpm test' })))
      .toBe('Progress of the running Moxxy task: the agent is running checks or tests.');
    expect(delegations.observe(toolCall('agent_turn', 'c2', 'bash', { command: 'pnpm vitest run' }))).toBeNull();
    expect(delegations.observe(toolCall('agent_turn', 'c3', 'Read')))
      .toBe('Progress of the running Moxxy task: the agent is reading the project.');
  });

  it('ignores tool calls of turns it did not start', () => {
    const delegations = new GptLiveDelegations();
    agentWorking(delegations);

    expect(delegations.observe(toolCall('typed_turn', 'c1', 'bash'))).toBeNull();
  });

  it('lists the operations of the delegated turn until their results land', () => {
    const delegations = new GptLiveDelegations();
    agentWorking(delegations);
    delegations.observe(toolCall('agent_turn', 'c1', 'web_search'));
    delegations.observe(toolCall('agent_turn', 'c2', 'edit_file'));

    expect(delegations.activeOperations.map((operation) => operation.kind)).toEqual(['web-search', 'editing']);
    delegations.observe(toolResult('agent_turn', 'c1'));
    expect(delegations.activeOperations.map((operation) => operation.callId)).toEqual(['c2']);
    delegations.complete('agent_turn', null);
    expect(delegations.activeOperations).toEqual([]);
  });
});

describe('GptLiveDelegations waiting slot', () => {
  it('holds one task while the agent is busy and hands it over when asked', () => {
    const delegations = new GptLiveDelegations();

    expect(delegations.hold('item_2', 'Zrób deploy.')).toEqual({
      held: true,
      notice: expect.stringMatching(/waiting.*start automatically.*has not started/i),
    });
    expect(delegations.heldPrompt).toBe('Zrób deploy.');
    expect(delegations.takeHeld()).toEqual({ itemId: 'item_2', prompt: 'Zrób deploy.' });
    expect(delegations.heldPrompt).toBeNull();
    expect(delegations.takeHeld()).toBeNull();
  });

  it('refuses a second waiting task and names the one already waiting', () => {
    const delegations = new GptLiveDelegations();
    delegations.hold('item_2', 'Zrób deploy.');

    const refused = delegations.hold('item_3', 'Wyślij raport.');

    expect(refused.held).toBe(false);
    expect(refused.notice).toMatch(/Zrób deploy\./);
    expect(refused.notice).toMatch(/not started/i);
    expect(delegations.heldPrompt).toBe('Zrób deploy.');
  });

  it('cancels the waiting task with an honest result for GPT-Live', () => {
    const delegations = new GptLiveDelegations();
    delegations.hold('item_2', 'Zrób deploy.');

    expect(delegations.cancelHeld('the user cancelled it')).toEqual({
      prompt: 'Zrób deploy.',
      result: {
        itemId: 'item_2',
        text: 'The waiting task was not run: the user cancelled it.',
      },
    });
    expect(delegations.cancelHeld('again')).toBeNull();
  });
});
