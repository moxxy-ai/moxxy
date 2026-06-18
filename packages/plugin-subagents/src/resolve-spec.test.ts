import { describe, expect, it } from 'vitest';
import type { AgentDef } from '@moxxy/sdk';
import { type AgentSpecInput, resolveSpec } from './dispatch-agent.js';

// The existing dispatch-agent.test.ts only exercises end-to-end spawning with
// `getAgent: () => undefined`, so the AgentDef-merge branch of resolveSpec is
// never reached. These pin the precedence directly (caller > kind > built-in
// DEFAULT) — the merge that a regression letting def win over the caller, or
// dropping the maxIterations passthrough, would silently break.

const fullDef: AgentDef = {
  name: 'researcher',
  description: 'deep research',
  systemPrompt: 'def-prompt',
  model: 'def-model',
  mode: 'research',
  allowedTools: ['Read', 'Grep'],
  maxIterations: 12,
};

const depsWith = (def: AgentDef | undefined) => ({
  getAgent: (name: string) => (name === 'researcher' ? def : undefined),
});

const input = (over: Partial<AgentSpecInput> = {}): AgentSpecInput => ({
  prompt: 'do the thing',
  ...over,
});

describe('resolveSpec', () => {
  it('uses the kind def fields when the caller omits them', () => {
    const spec = resolveSpec(input({ agentType: 'researcher' }), depsWith(fullDef));
    expect(spec.systemPrompt).toBe('def-prompt');
    expect(spec.model).toBe('def-model');
    expect(spec.mode).toBe('research');
    expect(spec.allowedTools).toEqual(['Read', 'Grep']);
    expect(spec.agentType).toBe('researcher');
    expect(spec.label).toBe('researcher'); // label defaults to def.name
  });

  it('lets caller fields override the kind def for each field', () => {
    const spec = resolveSpec(
      input({
        agentType: 'researcher',
        systemPrompt: 'caller-prompt',
        model: 'caller-model',
        mode: 'goal',
        allowedTools: ['Bash'],
        label: 'my-label',
      }),
      depsWith(fullDef),
    );
    expect(spec.systemPrompt).toBe('caller-prompt');
    expect(spec.model).toBe('caller-model');
    expect(spec.mode).toBe('goal');
    expect(spec.allowedTools).toEqual(['Bash']);
    expect(spec.label).toBe('my-label');
    expect(spec.prompt).toBe('do the thing');
  });

  it('flows def.maxIterations through even though the input schema omits it', () => {
    const spec = resolveSpec(input({ agentType: 'researcher' }), depsWith(fullDef));
    expect(spec.maxIterations).toBe(12);
  });

  it('omits maxIterations when the def does not set one', () => {
    const def: AgentDef = { name: 'researcher', description: 'x' };
    const spec = resolveSpec(input({ agentType: 'researcher' }), depsWith(def));
    expect('maxIterations' in spec).toBe(false);
  });

  it('falls back to DEFAULT_AGENT on an unknown agentType (label "default")', () => {
    const spec = resolveSpec(input({ agentType: 'nonexistent' }), depsWith(fullDef));
    expect(spec.label).toBe('default'); // DEFAULT_AGENT.name
    expect(spec.systemPrompt).toBeUndefined();
    expect(spec.model).toBeUndefined();
    expect(spec.allowedTools).toBeUndefined();
    // The requested kind string is echoed verbatim, even on fallback.
    expect(spec.agentType).toBe('nonexistent');
  });

  it('defaults agentType to "default" when the caller omits it', () => {
    const spec = resolveSpec(input(), depsWith(fullDef));
    expect(spec.agentType).toBe('default');
    expect(spec.label).toBe('default');
  });
});
