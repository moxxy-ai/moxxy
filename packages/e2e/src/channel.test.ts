import { describe, expect, it } from 'vitest';
import { utf8 } from './bytes.js';
import { connectInitiator, connectResponder, type MessageTransport } from './channel.js';
import { generateIdentity } from './identity.js';

/**
 * A pair of in-memory transports modelling the relay link: a message sent on one
 * end is delivered (async, ordered) to the other. An optional per-direction
 * `mutate` hook lets a test play the tampering relay.
 */
function makePair(opts: {
  mutateAtoB?: (d: Uint8Array) => Uint8Array | null;
  mutateBtoA?: (d: Uint8Array) => Uint8Array | null;
} = {}): [MessageTransport, MessageTransport] {
  let aMsg: ((d: Uint8Array) => void) | null = null;
  let bMsg: ((d: Uint8Array) => void) | null = null;
  let aClose: (() => void) | null = null;
  let bClose: (() => void) | null = null;
  let open = true;

  const deliver = (
    to: () => ((d: Uint8Array) => void) | null,
    mutate: ((d: Uint8Array) => Uint8Array | null) | undefined,
    d: Uint8Array,
  ): void => {
    if (!open) return;
    const out = mutate ? mutate(d) : d;
    if (out === null) return; // dropped by the relay
    queueMicrotask(() => to()?.(out));
  };

  const a: MessageTransport = {
    send: (d) => deliver(() => bMsg, opts.mutateAtoB, d),
    onMessage: (h) => {
      aMsg = h;
    },
    onClose: (h) => {
      aClose = h;
    },
    close: () => {
      if (!open) return;
      open = false;
      queueMicrotask(() => {
        aClose?.();
        bClose?.();
      });
    },
  };
  const b: MessageTransport = {
    send: (d) => deliver(() => aMsg, opts.mutateBtoA, d),
    onMessage: (h) => {
      bMsg = h;
    },
    onClose: (h) => {
      bClose = h;
    },
    close: () => {
      if (!open) return;
      open = false;
      queueMicrotask(() => {
        aClose?.();
        bClose?.();
      });
    },
  };
  return [a, b];
}

const collect = (ch: { onMessage: (cb: (p: Uint8Array) => void) => void }): string[] => {
  const out: string[] = [];
  ch.onMessage((p) => out.push(new TextDecoder().decode(p)));
  return out;
};

describe('SecureChannel', () => {
  it('establishes and exchanges messages both ways', async () => {
    const agent = generateIdentity();
    const [phoneT, agentT] = makePair();

    const [phone, agentCh] = await Promise.all([
      connectInitiator(phoneT, agent.publicKey),
      connectResponder(agentT, agent),
    ]);

    const gotByAgent = collect(agentCh);
    const gotByPhone = collect(phone);

    phone.send(utf8('hello from phone'));
    agentCh.send(utf8('hello from agent'));
    await new Promise((r) => setTimeout(r, 5));

    expect(gotByAgent).toEqual(['hello from phone']);
    expect(gotByPhone).toEqual(['hello from agent']);
  });

  it('buffers messages received before a handler is registered', async () => {
    const agent = generateIdentity();
    const [phoneT, agentT] = makePair();
    const [phone, agentCh] = await Promise.all([
      connectInitiator(phoneT, agent.publicKey),
      connectResponder(agentT, agent),
    ]);

    phone.send(utf8('early'));
    await new Promise((r) => setTimeout(r, 5)); // arrives before onMessage set

    const got = collect(agentCh); // registered late → should flush backlog
    expect(got).toEqual(['early']);
  });

  it('rejects the handshake when the phone pins the wrong key (spoofing)', async () => {
    const agent = generateIdentity();
    const attacker = generateIdentity();
    const [phoneT, agentT] = makePair();

    // The agent responds with its real key, but the phone pins the attacker's.
    void connectResponder(agentT, agent);
    await expect(connectInitiator(phoneT, attacker.publicKey)).rejects.toThrow(/pinned fingerprint/);
  });

  it('closes the channel when the relay tampers with a frame', async () => {
    const agent = generateIdentity();
    let tamperArmed = false;
    const [phoneT, agentT] = makePair({
      mutateAtoB: (d) => {
        // Leave the handshake (first message) intact; corrupt the first data frame.
        if (!tamperArmed) {
          tamperArmed = true;
          return d;
        }
        const copy = d.slice();
        copy[copy.length - 1] ^= 0x01;
        return copy;
      },
    });

    const [phone, agentCh] = await Promise.all([
      connectInitiator(phoneT, agent.publicKey),
      connectResponder(agentT, agent),
    ]);

    const got = collect(agentCh);
    let closed = false;
    agentCh.onClose(() => {
      closed = true;
    });

    phone.send(utf8('tampered payload'));
    await new Promise((r) => setTimeout(r, 5));

    expect(got).toEqual([]); // never delivered
    expect(closed).toBe(true); // channel torn down on tamper
  });
});
