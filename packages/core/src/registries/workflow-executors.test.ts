import { describe, expect, it } from 'vitest';
import type { WorkflowExecutorDef } from '@moxxy/sdk';
import { WorkflowExecutorRegistry } from './workflow-executors.js';

const mk = (name: string): WorkflowExecutorDef => ({
  name,
  run: async () => ({}) as never,
});

describe('WorkflowExecutorRegistry', () => {
  it('auto-activates the first registered executor', () => {
    const r = new WorkflowExecutorRegistry();
    expect(r.getActive()).toBeNull();
    r.register(mk('dag'));
    expect(r.getActive()?.name).toBe('dag');
    r.register(mk('linear'));
    expect(r.getActive()?.name).toBe('dag'); // still the first
  });

  it('throws on duplicate register', () => {
    const r = new WorkflowExecutorRegistry();
    r.register(mk('dag'));
    expect(() => r.register(mk('dag'))).toThrow(/already registered/);
  });

  it('replace overwrites without throwing and keeps active', () => {
    const r = new WorkflowExecutorRegistry();
    r.register(mk('dag'));
    const replacement = mk('dag');
    r.replace(replacement);
    expect(r.getActive()).toBe(replacement);
    expect(r.list()).toHaveLength(1);
  });

  it('setActive switches; throws for unknown', () => {
    const r = new WorkflowExecutorRegistry();
    r.register(mk('dag'));
    r.register(mk('linear'));
    r.setActive('linear');
    expect(r.getActive()?.name).toBe('linear');
    expect(() => r.setActive('nope')).toThrow(/not registered/);
  });

  it('unregister clears the active slot rather than picking a successor', () => {
    const r = new WorkflowExecutorRegistry();
    r.register(mk('dag'));
    r.register(mk('linear'));
    r.unregister('dag');
    // getActive() returning null wrongly would silently disable workflows.
    expect(r.getActive()).toBeNull();
    expect(r.list().map((x) => x.name)).toEqual(['linear']);
  });
});
