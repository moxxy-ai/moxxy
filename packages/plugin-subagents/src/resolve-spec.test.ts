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

describe('resolveSpec — recursion fan-out guard', () => {
  // Untrusted model output can fan out 8 children; if each child inherits the
  // full registry (including dispatch_agent) the depth is unbounded (8^N).
  const parentTools = ['Read', 'Bash', 'dispatch_agent'];
  const depsGuarded = {
    getAgent: () => undefined,
    getToolNames: () => parentTools,
  };

  it('defaults an unrestricted child to the parent tools MINUS dispatch_agent', () => {
    const spec = resolveSpec(input(), depsGuarded);
    expect(spec.allowedTools).toEqual(['Read', 'Bash']);
    expect(spec.allowedTools).not.toContain('dispatch_agent');
  });

  it('preserves full inheritance (undefined allowlist) when getToolNames is not wired', () => {
    const spec = resolveSpec(input(), { getAgent: () => undefined });
    expect(spec.allowedTools).toBeUndefined();
  });

  it('lets the caller explicitly re-grant dispatch_agent', () => {
    const spec = resolveSpec(
      input({ allowedTools: ['Read', 'dispatch_agent'] }),
      depsGuarded,
    );
    expect(spec.allowedTools).toEqual(['Read', 'dispatch_agent']);
  });

  it('lets a kind re-grant dispatch_agent via its allowedTools', () => {
    const def: AgentDef = {
      name: 'recurser',
      description: 'x',
      allowedTools: ['dispatch_agent', 'Read'],
    };
    const spec = resolveSpec(input({ agentType: 'recurser' }), {
      getAgent: (n: string) => (n === 'recurser' ? def : undefined),
      getToolNames: () => parentTools,
    });
    expect(spec.allowedTools).toEqual(['dispatch_agent', 'Read']);
  });
});

describe('resolveSpec — label de-duplication', () => {
  const deps = depsWith(undefined); // unknown kind → DEFAULT_AGENT (name "default")

  it('suffixes a 1-based index for same-kind siblings in a multi-agent batch', () => {
    const a = resolveSpec(input(), deps, { index: 0, total: 3 });
    const b = resolveSpec(input(), deps, { index: 1, total: 3 });
    const c = resolveSpec(input(), deps, { index: 2, total: 3 });
    expect([a.label, b.label, c.label]).toEqual(['default-1', 'default-2', 'default-3']);
  });

  it('keeps the bare kind name for a single-agent batch', () => {
    const spec = resolveSpec(input(), deps, { index: 0, total: 1 });
    expect(spec.label).toBe('default');
  });

  it('never overrides an explicit caller label', () => {
    const spec = resolveSpec(input({ label: 'mine' }), deps, { index: 1, total: 4 });
    expect(spec.label).toBe('mine');
  });
});
