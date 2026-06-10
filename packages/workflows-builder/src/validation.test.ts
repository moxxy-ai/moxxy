import { describe, expect, it, vi } from 'vitest';
import { addStep, emptyState, setBranchTargets, updateMeta, updateNode } from './operations.js';
import { mapErrorsToNodes, save, validate, ValidationError, type BuilderBridge } from './validation.js';
import { WORKFLOW_ERROR_KEY } from './types.js';

function fixture() {
  let s = emptyState('demo');
  s = updateMeta(s, { description: 'demo workflow' });
  s = addStep(s, { kind: 'prompt', id: 'a' });
  s = updateNode(s, 'a', { action: 'do a' });
  s = addStep(s, { kind: 'condition', id: 'gate', after: 'a' });
  s = updateNode(s, 'gate', { action: 'good?' });
  s = setBranchTargets(s, 'gate', 'then', ['a']);
  return s;
}

describe('mapErrorsToNodes', () => {
  it('buckets step-mentioning issues under the named node', () => {
    const s = fixture();
    const mapped = mapErrorsToNodes(
      [
        'steps: step "gate" needs unknown step "ghost"',
        'awaitInput: step "a": awaitInput requires the resume channel, which is not available in this build',
        'name: name must be slug-like',
      ],
      s,
    );
    expect(mapped.gate).toEqual(['steps: step "gate" needs unknown step "ghost"']);
    expect(mapped.a).toEqual([
      'awaitInput: step "a": awaitInput requires the resume channel, which is not available in this build',
    ]);
    expect(mapped[WORKFLOW_ERROR_KEY]).toEqual(['name: name must be slug-like']);
  });

  it('maps duplicate-id issues to the node', () => {
    const s = fixture();
    const mapped = mapErrorsToNodes(['steps: duplicate step id "a"'], s);
    expect(mapped.a).toEqual(['steps: duplicate step id "a"']);
  });

  it('falls back to the workflow bucket when no known step is named', () => {
    const s = fixture();
    const mapped = mapErrorsToNodes(['steps: step "unknown_one" needs unknown step "x"'], s);
    expect(mapped[WORKFLOW_ERROR_KEY]).toHaveLength(1);
  });
});

describe('validate bridge', () => {
  it('serializes and returns mapped errors', async () => {
    const bridge: BuilderBridge = {
      validateDraft: vi.fn(async () => ({ ok: false, errors: ['steps: step "a" needs unknown step "z"'] })),
      save: vi.fn(),
    };
    const { result, errors } = await validate(bridge, fixture());
    expect(bridge.validateDraft).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(errors.a).toBeDefined();
  });
});

describe('save bridge', () => {
  it('validates then saves on success', async () => {
    const saved = { name: 'demo', scope: 'user', path: '/tmp/demo.yaml' };
    const bridge: BuilderBridge = {
      validateDraft: vi.fn(async () => ({ ok: true, errors: [] })),
      save: vi.fn(async () => saved),
    };
    const { result, yaml } = await save(bridge, fixture());
    expect(result).toEqual(saved);
    expect(yaml).toContain('name: demo');
    expect(bridge.save).toHaveBeenCalledOnce();
  });

  it('throws ValidationError without calling save when invalid', async () => {
    const bridge: BuilderBridge = {
      validateDraft: vi.fn(async () => ({ ok: false, errors: ['steps: step "a" needs unknown step "z"'] })),
      save: vi.fn(),
    };
    await expect(save(bridge, fixture())).rejects.toBeInstanceOf(ValidationError);
    expect(bridge.save).not.toHaveBeenCalled();
  });
});
