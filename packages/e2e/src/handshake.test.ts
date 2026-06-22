import { describe, expect, it } from 'vitest';
import { generateIdentity } from './identity.js';
import {
  CLIENT_HELLO_LEN,
  finishInitiator,
  respond,
  SERVER_HELLO_LEN,
  startInitiator,
} from './handshake.js';

describe('handshake', () => {
  it('agrees on matching directional keys', () => {
    const agent = generateIdentity();
    const { clientHello, state } = startInitiator();
    expect(clientHello.length).toBe(CLIENT_HELLO_LEN);

    const { serverHello, keys: rKeys } = respond(clientHello, agent);
    expect(serverHello.length).toBe(SERVER_HELLO_LEN);

    const iKeys = finishInitiator(serverHello, state, agent.publicKey);

    // Initiator's send is responder's recv, and vice versa.
    expect([...iKeys.sendKey]).toEqual([...rKeys.recvKey]);
    expect([...iKeys.recvKey]).toEqual([...rKeys.sendKey]);
    // The two directions use different keys.
    expect([...iKeys.sendKey]).not.toEqual([...iKeys.recvKey]);
  });

  it('rejects a server identity that does not match the pin (spoofing)', () => {
    const agent = generateIdentity();
    const attacker = generateIdentity();
    const { clientHello, state } = startInitiator();
    const { serverHello } = respond(clientHello, attacker);

    expect(() => finishInitiator(serverHello, state, agent.publicKey)).toThrow(/pinned fingerprint/);
  });

  it('rejects a tampered ServerHello signature', () => {
    const agent = generateIdentity();
    const { clientHello, state } = startInitiator();
    const { serverHello } = respond(clientHello, agent);

    // Flip a bit inside the signature region (last 64 bytes).
    const tampered = serverHello.slice();
    tampered[tampered.length - 1] ^= 0x01;

    expect(() => finishInitiator(tampered, state, agent.publicKey)).toThrow();
  });

  it('rejects malformed lengths', () => {
    const agent = generateIdentity();
    expect(() => respond(new Uint8Array(10), agent)).toThrow(/ClientHello/);
    const { state } = startInitiator();
    expect(() => finishInitiator(new Uint8Array(10), state, agent.publicKey)).toThrow(/ServerHello/);
  });
});
