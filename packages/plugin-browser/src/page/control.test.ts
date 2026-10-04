import { describe, expect, it } from 'vitest';
import { BrowserControl } from './control.js';

function control() {
  let changes = 0;
  const c = new BrowserControl(() => changes++);
  return { c, changes: () => changes };
}

describe('BrowserControl', () => {
  it('starts with the agent allowed to drive', () => {
    const { c } = control();
    expect(c.state).toEqual({ driver: 'agent', turnId: null });
    expect(c.refusal()).toBeNull();
  });

  it('refuses the agent once the user takes over, and lets it drive again on resume', () => {
    const { c, changes } = control();
    c.noteAgentTurn('T1');
    c.takeOver();
    expect(c.state).toEqual({ driver: 'user', turnId: 'T1' });
    expect(c.refusal()).toMatch(/user has taken over the browser/);
    c.resume();
    expect(c.state.driver).toBe('agent');
    expect(c.refusal()).toBeNull();
    expect(changes()).toBe(3);
  });

  it('takes over when the user presses on the page while the agent is not pressing', () => {
    const { c } = control();
    c.noteUserInput();
    expect(c.state.driver).toBe('user');
  });

  it('does not count the agent’s own press as the user’s', async () => {
    const { c } = control();
    await c.during(async () => c.noteUserInput());
    expect(c.state.driver).toBe('agent');
  });

  it('counts the user’s press again once the agent’s has finished, even if it threw', async () => {
    const { c } = control();
    await expect(
      c.during(async () => {
        throw new Error('missed');
      }),
    ).rejects.toThrow('missed');
    c.noteUserInput();
    expect(c.state.driver).toBe('user');
  });

  it('hands the browser back when a new turn comes — the user’s next message is the go-ahead', () => {
    const { c } = control();
    c.noteAgentTurn('T1');
    c.takeOver();
    c.noteAgentTurn('T1');
    expect(c.state.driver).toBe('user');
    c.noteAgentTurn('T2');
    expect(c.state).toEqual({ driver: 'agent', turnId: 'T2' });
  });

  it('reports no change when nothing changed', () => {
    const { c, changes } = control();
    c.resume();
    c.noteAgentTurn('T1');
    c.noteAgentTurn('T1');
    c.takeOver();
    c.takeOver();
    expect(changes()).toBe(2);
  });
});
