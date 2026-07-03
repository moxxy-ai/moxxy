import { describe, expect, it, vi } from 'vitest';
import type { PendingToolCall, PermissionContext } from '@moxxy/sdk';
import {
  createWhatsAppPermissionController,
  formatPermissionPrompt,
  parsePermissionReply,
} from './permission.js';

const call: PendingToolCall = {
  callId: 'c1',
  name: 'write_file',
  input: { path: '/tmp/x', content: 'hi' },
} as PendingToolCall;
const ctx = {} as PermissionContext;

describe('parsePermissionReply', () => {
  it('maps allow/session/deny synonyms', () => {
    expect(parsePermissionReply('1')?.mode).toBe('allow');
    expect(parsePermissionReply('yes')?.mode).toBe('allow');
    expect(parsePermissionReply('2')?.mode).toBe('allow_session');
    expect(parsePermissionReply('always')?.mode).toBe('allow_session');
    expect(parsePermissionReply('3')?.mode).toBe('deny');
    expect(parsePermissionReply('no')?.mode).toBe('deny');
  });

  it('returns null for unrecognized replies', () => {
    expect(parsePermissionReply('maybe later')).toBeNull();
    expect(parsePermissionReply('')).toBeNull();
  });
});

describe('formatPermissionPrompt', () => {
  it('names the tool and lists the numbered options', () => {
    const text = formatPermissionPrompt(call);
    expect(text).toContain('write_file');
    expect(text).toContain('1 = allow once');
    expect(text).toContain('3 = deny');
  });
});

describe('WhatsAppPermissionController', () => {
  it('denies immediately when no sender is wired', async () => {
    const ctrl = createWhatsAppPermissionController();
    const decision = await ctrl.resolver.check(call, ctx);
    expect(decision.mode).toBe('deny');
  });

  it('prompts, then resolves on the operator reply', async () => {
    const ctrl = createWhatsAppPermissionController();
    const sent: string[] = [];
    ctrl.setSender(async (t) => void sent.push(t));

    const pending = ctrl.resolver.check(call, ctx);
    await vi.waitFor(() => expect(ctrl.hasPending()).toBe(true));
    expect(sent[0]).toContain('write_file');

    expect(ctrl.offerReply('1')).toBe(true);
    expect((await pending).mode).toBe('allow');
    expect(ctrl.hasPending()).toBe(false);
  });

  it('allow_session skips subsequent prompts for the same tool', async () => {
    const ctrl = createWhatsAppPermissionController();
    ctrl.setSender(async () => {});
    const first = ctrl.resolver.check(call, ctx);
    await vi.waitFor(() => expect(ctrl.hasPending()).toBe(true));
    ctrl.offerReply('2');
    expect((await first).mode).toBe('allow_session');

    // Second call for the same tool name resolves WITHOUT a new prompt.
    const second = await ctrl.resolver.check(call, ctx);
    expect(second.mode).toBe('allow_session');
    expect(ctrl.hasPending()).toBe(false);
  });

  it('ignores an unrecognized reply (keeps the prompt pending)', async () => {
    const ctrl = createWhatsAppPermissionController();
    ctrl.setSender(async () => {});
    void ctrl.resolver.check(call, ctx);
    await vi.waitFor(() => expect(ctrl.hasPending()).toBe(true));
    expect(ctrl.offerReply('huh?')).toBe(false);
    expect(ctrl.hasPending()).toBe(true);
  });

  it('abortAll denies in-flight prompts so callers never hang', async () => {
    const ctrl = createWhatsAppPermissionController();
    ctrl.setSender(async () => {});
    const pending = ctrl.resolver.check(call, ctx);
    await vi.waitFor(() => expect(ctrl.hasPending()).toBe(true));
    ctrl.abortAll('channel closed');
    expect((await pending).mode).toBe('deny');
    expect(ctrl.hasPending()).toBe(false);
  });
});
