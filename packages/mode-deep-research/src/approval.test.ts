import type { ApprovalDecision, ApprovalRequest, ModeContext } from '@moxxy/sdk';
import { describe, expect, it, vi } from 'vitest';

import { runQueryApprovalGate, runSynthesisApprovalGate } from './approval.js';
import { MAX_REDRAFTS } from './constants.js';

/** Build a ModeContext whose only meaningful member is `approval`. */
function ctxWithApproval(
  confirm: (req: ApprovalRequest) => Promise<ApprovalDecision>,
): ModeContext {
  return { approval: { name: 'fake', confirm } } as unknown as ModeContext;
}

const headlessCtx = {} as unknown as ModeContext;

describe('runQueryApprovalGate', () => {
  it('auto-approves headlessly when no resolver is present', async () => {
    const res = await runQueryApprovalGate(headlessCtx, 'plan', 3, 0);
    expect(res).toEqual({ outcome: { kind: 'approve' }, redraftCount: 0 });
  });

  it('approve maps to an approve outcome and preserves redraftCount', async () => {
    const ctx = ctxWithApproval(async () => ({ optionId: 'approve' }));
    const res = await runQueryApprovalGate(ctx, 'plan', 2, 1);
    expect(res).toEqual({ outcome: { kind: 'approve' }, redraftCount: 1 });
  });

  it('cancel maps to a cancel outcome and preserves redraftCount', async () => {
    const ctx = ctxWithApproval(async () => ({ optionId: 'cancel' }));
    const res = await runQueryApprovalGate(ctx, 'plan', 2, 1);
    expect(res).toEqual({ outcome: { kind: 'cancel' }, redraftCount: 1 });
  });

  it('redraft carries feedback text and increments the count', async () => {
    const ctx = ctxWithApproval(async () => ({ optionId: 'redraft', text: 'narrow scope' }));
    const res = await runQueryApprovalGate(ctx, 'plan', 2, 0);
    expect(res).toEqual({
      outcome: { kind: 'redraft', feedback: 'narrow scope' },
      redraftCount: 1,
    });
  });

  it('redraft with no text yields null feedback', async () => {
    const ctx = ctxWithApproval(async () => ({ optionId: 'redraft' }));
    const res = await runQueryApprovalGate(ctx, 'plan', 2, 0);
    expect(res.outcome).toEqual({ kind: 'redraft', feedback: null });
  });

  it('the (MAX_REDRAFTS+1)th redraft trips the cap, not before', async () => {
    const ctx = ctxWithApproval(async () => ({ optionId: 'redraft' }));
    // The last allowed redraft: redraftCount goes from MAX_REDRAFTS-1 to MAX_REDRAFTS.
    const allowed = await runQueryApprovalGate(ctx, 'plan', 1, MAX_REDRAFTS - 1);
    expect(allowed.outcome.kind).toBe('redraft');
    expect(allowed.redraftCount).toBe(MAX_REDRAFTS);
    // One more pushes nextCount past the cap.
    const capped = await runQueryApprovalGate(ctx, 'plan', 1, MAX_REDRAFTS);
    expect(capped.outcome.kind).toBe('redraft-cap-exceeded');
    expect(capped.redraftCount).toBe(MAX_REDRAFTS + 1);
  });
});

describe('runSynthesisApprovalGate', () => {
  it('auto-synthesizes headlessly when no resolver is present', async () => {
    const res = await runSynthesisApprovalGate(headlessCtx, 'digest');
    expect(res).toEqual({ kind: 'synthesize' });
  });

  it('synthesize option maps to synthesize', async () => {
    const confirm = vi.fn(async () => ({ optionId: 'synthesize' }));
    const res = await runSynthesisApprovalGate(ctxWithApproval(confirm), 'digest');
    expect(res).toEqual({ kind: 'synthesize' });
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('cancel option maps to cancel', async () => {
    const res = await runSynthesisApprovalGate(
      ctxWithApproval(async () => ({ optionId: 'cancel' })),
      'digest',
    );
    expect(res).toEqual({ kind: 'cancel' });
  });
});
