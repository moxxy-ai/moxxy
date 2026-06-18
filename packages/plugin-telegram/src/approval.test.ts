import { describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '@moxxy/sdk';
import { TelegramApprovalResolver } from './approval.js';

const req = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  title: 'Run plan?',
  body: 'Details',
  options: [
    { id: 'approve', label: 'Approve' },
    { id: 'cancel', label: 'Cancel' },
  ],
  defaultOptionId: 'approve',
  ...over,
});

describe('TelegramApprovalResolver', () => {
  it('falls back to defaultOptionId when no decider is attached', async () => {
    const r = new TelegramApprovalResolver();
    expect((await r.confirm(req())).optionId).toBe('approve');
  });

  it('falls back to options[0] then "approve" when no default is set', async () => {
    const r = new TelegramApprovalResolver();
    expect((await r.confirm(req({ defaultOptionId: undefined }))).optionId).toBe('approve');
    const noOpts = await r.confirm(req({ defaultOptionId: undefined, options: [] }));
    expect(noOpts.optionId).toBe('approve');
    const firstWins = await r.confirm(
      req({ defaultOptionId: undefined, options: [{ id: 'x', label: 'X' }] }),
    );
    expect(firstWins.optionId).toBe('x');
  });

  it('routes to the decider and resolves via resolvePending', async () => {
    const r = new TelegramApprovalResolver();
    r.setDecider(async () => {});
    const promise = r.confirm(req());
    // The pending id is appr_1 (nextId starts at 1).
    expect(r.resolvePending('appr_1', 'cancel')).toBe(true);
    expect(await promise).toEqual({ optionId: 'cancel' });
    // Pending is removed; a second resolve is a no-op.
    expect(r.resolvePending('appr_1', 'approve')).toBe(false);
  });

  it('resolvePendingWithText carries the follow-up text', async () => {
    const r = new TelegramApprovalResolver();
    r.setDecider(async () => {});
    const promise = r.confirm(req());
    expect(r.resolvePendingWithText('appr_1', 'approve', 'go ahead')).toBe(true);
    expect(await promise).toEqual({ optionId: 'approve', text: 'go ahead' });
  });

  it('returns false for resolving an unknown id', () => {
    const r = new TelegramApprovalResolver();
    expect(r.resolvePending('nope', 'approve')).toBe(false);
    expect(r.resolvePendingWithText('nope', 'approve', 'x')).toBe(false);
  });

  it('resolves with the default + error text when the decider rejects', async () => {
    const r = new TelegramApprovalResolver();
    r.setDecider(async () => {
      throw new Error('render boom');
    });
    const decision = await r.confirm(req());
    expect(decision.optionId).toBe('approve');
    expect(decision.text).toContain('render boom');
    // The failed pending is cleaned up.
    expect(r.resolvePending('appr_1', 'cancel')).toBe(false);
  });

  it('decider rejection falls back to "cancel" when no default/options exist', async () => {
    const r = new TelegramApprovalResolver();
    r.setDecider(async () => {
      throw new Error('x');
    });
    const decision = await r.confirm(req({ defaultOptionId: undefined, options: [] }));
    expect(decision.optionId).toBe('cancel');
  });

  it('abortAll resolves every pending with the default and clears the map', async () => {
    const r = new TelegramApprovalResolver();
    r.setDecider(async () => {});
    const a = r.confirm(req());
    const b = r.confirm(req({ defaultOptionId: 'cancel' }));
    r.abortAll('channel closed');
    expect(await a).toEqual({ optionId: 'approve', text: 'channel closed' });
    expect(await b).toEqual({ optionId: 'cancel', text: 'channel closed' });
    // Map cleared: the previously-pending ids no longer resolve.
    expect(r.resolvePending('appr_1', 'approve')).toBe(false);
    expect(r.resolvePending('appr_2', 'approve')).toBe(false);
  });

  it('getPending returns the pending without resolving it', async () => {
    const r = new TelegramApprovalResolver();
    const decider = vi.fn(async () => {});
    r.setDecider(decider);
    const promise = r.confirm(req());
    const pending = r.getPending('appr_1');
    expect(pending?.request.title).toBe('Run plan?');
    // Still pending — resolve it so the promise settles.
    r.resolvePending('appr_1', 'approve');
    await promise;
  });
});
