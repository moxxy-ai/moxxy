import { describe, expect, it } from 'vitest';
import {
  EMPTY_GPT_LIVE_EXCHANGE,
  acceptGptLiveTurn,
  claimGptLiveUserTurn,
  flushGptLiveExchange,
} from './gpt-live-exchange';

const user = (turnId: string, text: string) => ({ role: 'user' as const, turnId, text });
const assistant = (text: string) => ({ role: 'assistant' as const, turnId: `a-${text.length}`, text });

describe('GPT-Live exchange pairing', () => {
  it('pairs the user turn with the reply that answers it', () => {
    const afterUser = acceptGptLiveTurn(EMPTY_GPT_LIVE_EXCHANGE, user('u1', 'Jaka jest stolica Francji?'));
    expect(afterUser.exchange).toBeNull();

    const afterReply = acceptGptLiveTurn(afterUser.state, assistant('Stolicą Francji jest Paryż.'));

    expect(afterReply.exchange).toEqual({
      userText: 'Jaka jest stolica Francji?',
      assistantText: 'Stolicą Francji jest Paryż.',
    });
    expect(afterReply.state).toEqual(EMPTY_GPT_LIVE_EXCHANGE);
  });

  it('joins consecutive user turns that one reply answers', () => {
    let step = acceptGptLiveTurn(EMPTY_GPT_LIVE_EXCHANGE, user('u1', 'Cześć.'));
    step = acceptGptLiveTurn(step.state, user('u2', 'Jaka jest pogoda?'));
    step = acceptGptLiveTurn(step.state, assistant('Nie mam dostępu do pogody.'));

    expect(step.exchange).toEqual({
      userText: 'Cześć. Jaka jest pogoda?',
      assistantText: 'Nie mam dostępu do pogody.',
    });
  });

  it('does not record speech with no user turn behind it (acknowledgements, spoken task results)', () => {
    const step = acceptGptLiveTurn(EMPTY_GPT_LIVE_EXCHANGE, assistant('Jasne, już to przekazuję.'));

    expect(step.exchange).toBeNull();
  });

  it('hands a delegated user turn to the agent instead of the voice record', () => {
    let step = acceptGptLiveTurn(EMPTY_GPT_LIVE_EXCHANGE, user('u1', 'Uruchom testy w projekcie.'));
    const claimed = claimGptLiveUserTurn(step.state, 'u1');

    expect(claimed.text).toBe('Uruchom testy w projekcie.');
    step = acceptGptLiveTurn(claimed.state, assistant('Jasne, już to przekazuję.'));
    expect(step.exchange).toBeNull();
    expect(claimGptLiveUserTurn(claimed.state, 'u1').text).toBeNull();
  });

  it('ignores blank turns', () => {
    const step = acceptGptLiveTurn(EMPTY_GPT_LIVE_EXCHANGE, user('u1', '   '));

    expect(step.exchange).toBeNull();
    expect(step.state).toEqual(EMPTY_GPT_LIVE_EXCHANGE);
  });

  it('flushes unanswered speech when the call ends so nothing the user said is lost', () => {
    const { state } = acceptGptLiveTurn(EMPTY_GPT_LIVE_EXCHANGE, user('u1', 'Halo?'));

    expect(flushGptLiveExchange(state)).toEqual({ userText: 'Halo?' });
    expect(flushGptLiveExchange(EMPTY_GPT_LIVE_EXCHANGE)).toBeNull();
  });
});
