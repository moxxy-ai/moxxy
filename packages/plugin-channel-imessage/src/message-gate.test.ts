import { describe, expect, it } from 'vitest';
import { gateInboundMessage, type GateState } from './message-gate.js';
import { MAX_INBOUND_TEXT_CHARS } from './schema.js';

const OWNER = '+19998887777';
const FRIEND = '+15550001111';
const STRANGER = '+14440002222';

const chatFor = (handle: string): string => `iMessage;-;${handle}`;

function state(overrides: Partial<GateState> = {}): GateState {
  return {
    ownerHandles: new Set([OWNER]),
    allowedHandles: new Set([FRIEND]),
    isOwnSend: () => false,
    ...overrides,
  };
}

function msg(opts: {
  chatGuid: string;
  text?: string | null;
  isFromMe?: boolean;
  sender?: string;
  guid?: string;
  tempGuid?: string;
}): Record<string, unknown> {
  return {
    guid: opts.guid ?? 'msg-1',
    ...(opts.tempGuid ? { tempGuid: opts.tempGuid } : {}),
    text: opts.text ?? 'hi',
    isFromMe: opts.isFromMe ?? false,
    ...(opts.sender ? { handle: { address: opts.sender } } : {}),
    chats: [{ guid: opts.chatGuid }],
  };
}

describe('gateInboundMessage', () => {
  it('accepts an allow-listed sender text message and targets their chat', () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: chatFor(FRIEND), text: 'hi there', sender: FRIEND }));
    expect(v).toEqual({ ok: true, chatGuid: chatFor(FRIEND), text: 'hi there' });
  });

  it("accepts the owner's own self-chat message (isFromMe in an owner chat)", () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: chatFor(OWNER), text: 'note to self', isFromMe: true }));
    expect(v).toEqual({ ok: true, chatGuid: chatFor(OWNER), text: 'note to self' });
  });

  it('drops an isFromMe message in a FOREIGN chat (owner talking to others)', () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: chatFor(FRIEND), isFromMe: true }));
    expect(v).toEqual({ ok: false, reason: 'own message in a foreign chat' });
  });

  it("drops the bot's OWN outbound echo by guid (loop protection)", () => {
    const st = state({ isOwnSend: (id) => id === 'echo-guid' });
    const v = gateInboundMessage(
      st,
      msg({ chatGuid: chatFor(OWNER), isFromMe: true, guid: 'echo-guid' }),
    );
    expect(v).toEqual({ ok: false, reason: 'own outbound echo (guid)' });
  });

  it("drops the bot's OWN outbound echo by tempGuid", () => {
    const st = state({ isOwnSend: (id) => id === 'temp-xyz' });
    const v = gateInboundMessage(
      st,
      msg({ chatGuid: chatFor(FRIEND), sender: FRIEND, guid: 'g2', tempGuid: 'temp-xyz' }),
    );
    expect(v).toEqual({ ok: false, reason: 'own outbound echo (tempGuid)' });
  });

  it('drops an un-allow-listed sender (silent — no reply)', () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: chatFor(STRANGER), sender: STRANGER }));
    expect(v).toEqual({ ok: false, reason: 'sender not allow-listed' });
  });

  it('drops group messages (v1 is direct-message only)', () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: 'iMessage;+;chat123', sender: FRIEND }));
    expect(v).toEqual({ ok: false, reason: 'not a 1:1 direct message' });
  });

  it('resolves the sender from the chat guid when the message has no handle', () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: chatFor(FRIEND) }));
    expect(v).toEqual({ ok: true, chatGuid: chatFor(FRIEND), text: 'hi' });
  });

  it('drops self-chat when no owner handles are configured (fail closed)', () => {
    const v = gateInboundMessage(
      state({ ownerHandles: new Set() }),
      msg({ chatGuid: chatFor(OWNER), isFromMe: true }),
    );
    expect(v).toEqual({ ok: false, reason: 'own message in a foreign chat' });
  });

  it('drops schema-invalid payloads without throwing', () => {
    expect(gateInboundMessage(state(), null)).toEqual({ ok: false, reason: 'invalid message shape' });
    expect(gateInboundMessage(state(), 'garbage')).toEqual({
      ok: false,
      reason: 'invalid message shape',
    });
    expect(gateInboundMessage(state(), { text: 'no guid', chats: [] })).toEqual({
      ok: false,
      reason: 'invalid message shape',
    });
  });

  it('drops a message with no chat', () => {
    expect(gateInboundMessage(state(), { guid: 'm', text: 'x' })).toEqual({
      ok: false,
      reason: 'message without a chat',
    });
  });

  it('rejects oversized text at the schema boundary', () => {
    const v = gateInboundMessage(
      state(),
      msg({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: 'a'.repeat(MAX_INBOUND_TEXT_CHARS + 1) }),
    );
    expect(v).toEqual({ ok: false, reason: 'invalid message shape' });
  });

  it('drops empty / whitespace-only text', () => {
    const v = gateInboundMessage(state(), msg({ chatGuid: chatFor(FRIEND), sender: FRIEND, text: '   ' }));
    expect(v).toEqual({ ok: false, reason: 'no message text' });
  });
});
