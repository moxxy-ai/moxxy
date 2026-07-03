import { describe, expect, it } from 'vitest';
import { gateInboundMessage, MAX_TEXT_CHARS, type GateState } from './message-gate.js';
import type { WaInboundMessage } from './socket.js';

const OWNER = '15550000000@s.whatsapp.net';
const FRIEND = '15551111111@s.whatsapp.net';
const STRANGER = '15559999999@s.whatsapp.net';

function state(overrides: Partial<GateState> = {}): GateState {
  return {
    ownJid: OWNER,
    allowedJids: new Set([OWNER, FRIEND]),
    isOwnSend: () => false,
    ...overrides,
  };
}

function textMsg(remoteJid: string, text: string, fromMe = false, id = 'm1'): WaInboundMessage {
  return { key: { remoteJid, fromMe, id }, message: { conversation: text } };
}

describe('gateInboundMessage', () => {
  it('accepts an allow-listed sender text message', () => {
    const v = gateInboundMessage(state(), 'notify', textMsg(FRIEND, 'hi there'));
    expect(v).toEqual({ ok: true, kind: 'text', jid: FRIEND, text: 'hi there' });
  });

  it("accepts the owner's own Note-to-Self message (fromMe in own chat)", () => {
    const v = gateInboundMessage(state(), 'notify', textMsg(OWNER, 'note to self', true));
    expect(v.ok && v.kind === 'text' && v.jid).toBe(OWNER);
  });

  it('drops a fromMe message in a FOREIGN chat (owner talking to others)', () => {
    const v = gateInboundMessage(state(), 'notify', textMsg(FRIEND, 'private reply', true));
    expect(v).toEqual({ ok: false, reason: 'own message in a foreign chat' });
  });

  it("drops the bot's OWN outbound echo by message id (loop protection)", () => {
    const st = state({ isOwnSend: (id) => id === 'echo-1' });
    const v = gateInboundMessage(st, 'notify', textMsg(FRIEND, 'my own send', false, 'echo-1'));
    expect(v).toEqual({ ok: false, reason: 'own outbound echo' });
  });

  it('drops an un-allow-listed sender', () => {
    const v = gateInboundMessage(state(), 'notify', textMsg(STRANGER, 'let me in'));
    expect(v).toEqual({ ok: false, reason: 'sender not allow-listed' });
  });

  it('drops non-notify upserts (history sync / append)', () => {
    expect(gateInboundMessage(state(), 'append', textMsg(FRIEND, 'x')).ok).toBe(false);
    expect(gateInboundMessage(state(), 'history', textMsg(FRIEND, 'x')).ok).toBe(false);
  });

  it('drops status broadcasts', () => {
    const v = gateInboundMessage(state(), 'notify', textMsg('status@broadcast', 'x'));
    expect(v.ok).toBe(false);
  });

  it('validates the key shape (missing remoteJid rejected)', () => {
    const v = gateInboundMessage(state(), 'notify', { key: { fromMe: false }, message: { conversation: 'x' } });
    expect(v).toEqual({ ok: false, reason: 'invalid message key shape' });
  });

  it('caps oversized text', () => {
    const big = 'a'.repeat(MAX_TEXT_CHARS + 1);
    const v = gateInboundMessage(state(), 'notify', textMsg(FRIEND, big));
    expect(v).toEqual({ ok: false, reason: 'text over size cap' });
  });

  it('unwraps ephemeral + extendedText messages', () => {
    const msg: WaInboundMessage = {
      key: { remoteJid: FRIEND, fromMe: false, id: 'e1' },
      message: {
        ephemeralMessage: { message: { extendedTextMessage: { text: 'ephemeral hi' } } },
      },
    };
    const v = gateInboundMessage(state(), 'notify', msg);
    expect(v).toEqual({ ok: true, kind: 'text', jid: FRIEND, text: 'ephemeral hi' });
  });

  it('accepts a voice/audio message and reports mime + declared size', () => {
    const msg: WaInboundMessage = {
      key: { remoteJid: FRIEND, fromMe: false, id: 'a1' },
      message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus', fileLength: '2048', ptt: true } },
    };
    const v = gateInboundMessage(state(), 'notify', msg);
    expect(v).toEqual({
      ok: true,
      kind: 'audio',
      jid: FRIEND,
      mimeType: 'audio/ogg; codecs=opus',
      declaredBytes: 2048,
    });
  });

  it('rejects an audio message whose declared size exceeds the cap', () => {
    const msg: WaInboundMessage = {
      key: { remoteJid: FRIEND, fromMe: false, id: 'a2' },
      message: { audioMessage: { mimetype: 'audio/ogg', fileLength: 999_999_999 } },
    };
    const v = gateInboundMessage(state(), 'notify', msg);
    expect(v).toEqual({ ok: false, reason: 'audio over size cap' });
  });

  it('drops empty/unsupported content', () => {
    expect(gateInboundMessage(state(), 'notify', textMsg(FRIEND, '   ')).ok).toBe(false);
    const image: WaInboundMessage = {
      key: { remoteJid: FRIEND, fromMe: false, id: 'i1' },
      message: { imageMessage: { url: 'x' } },
    };
    expect(gateInboundMessage(state(), 'notify', image)).toEqual({
      ok: false,
      reason: 'unsupported message type',
    });
  });

  it('drops a fromMe self-chat message when ownJid is not yet known', () => {
    const v = gateInboundMessage(state({ ownJid: null }), 'notify', textMsg(OWNER, 'x', true));
    expect(v).toEqual({ ok: false, reason: 'own message in a foreign chat' });
  });
});
