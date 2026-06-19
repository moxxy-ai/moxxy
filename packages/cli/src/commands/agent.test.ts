import { describe, expect, it } from 'vitest';
import { agentRunTurnOptions } from './agent.js';

describe('agentRunTurnOptions', () => {
  it('passes the coordinator-selected model into the peer turn', () => {
    expect(agentRunTurnOptions(' gpt-5.4-mini ')).toEqual({ model: 'gpt-5.4-mini' });
  });

  it('omits the option when no model was provided', () => {
    expect(agentRunTurnOptions(undefined)).toEqual({});
  });
});
