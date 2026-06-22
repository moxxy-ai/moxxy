/**
 * The proxy E2E handshake: an authenticated, forward-secret key agreement run
 * as the first two messages inside the tunnel, before any session traffic.
 *
 * Shape (station-to-station-lite / signed ephemeral ECDH):
 *   initiator (phone) ──ClientHello──▶ responder (agent)
 *     ClientHello = ephI_pub(32) ‖ nC(16)
 *   responder ──ServerHello──▶ initiator
 *     ServerHello = ephR_pub(32) ‖ nS(16) ‖ idPub(32) ‖ sig(64)
 *     sig = Ed25519.sign(transcript, idSecret)
 *     transcript = LABEL ‖ ephI_pub ‖ ephR_pub ‖ nC ‖ nS
 *
 * The initiator pins `idPub` against the QR fingerprint (constant-time) and
 * verifies `sig` over the transcript — so a relay (or anyone without the private
 * key) cannot impersonate the agent. Both sides derive the session keys from the
 * X25519 shared secret via HKDF; the ephemeral keys give forward secrecy. Keys
 * are split per direction to prevent reflection.
 *
 * The phone is NOT authenticated by key here — it authenticates with the bearer
 * token at the app layer (unchanged), which now travels encrypted inside this
 * channel.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { concatBytes, constantTimeEqual, utf8 } from './bytes.js';
import { sign, verify } from './identity.js';

const LABEL = utf8('moxxy/proxy-e2e/v1');
const HS_NONCE = 16;
const X_PUB = 32;
const ID_PUB = 32;
const SIG = 64;

export const CLIENT_HELLO_LEN = X_PUB + HS_NONCE; // 48
export const SERVER_HELLO_LEN = X_PUB + HS_NONCE + ID_PUB + SIG; // 144

/** Directional session keys, named from the owner's point of view. */
export interface SessionKeys {
  /** Key for frames this side SENDS. */
  readonly sendKey: Uint8Array;
  /** Key for frames this side RECEIVES. */
  readonly recvKey: Uint8Array;
}

/** Opaque initiator state carried between {@link startInitiator} and {@link finishInitiator}. */
export interface InitiatorState {
  readonly ephSecret: Uint8Array;
  readonly ephPublic: Uint8Array;
  readonly clientNonce: Uint8Array;
}

function transcript(
  ephIPub: Uint8Array,
  ephRPub: Uint8Array,
  nC: Uint8Array,
  nS: Uint8Array,
): Uint8Array {
  return concatBytes(LABEL, ephIPub, ephRPub, nC, nS);
}

function deriveKeys(shared: Uint8Array, nC: Uint8Array, nS: Uint8Array): { i2r: Uint8Array; r2i: Uint8Array } {
  const okm = hkdf(sha256, shared, concatBytes(nC, nS), LABEL, 64);
  return { i2r: okm.slice(0, 32), r2i: okm.slice(32, 64) };
}

/** Initiator (phone) step 1: produce the ClientHello and the state to finish later. */
export function startInitiator(): { clientHello: Uint8Array; state: InitiatorState } {
  const { secretKey: ephSecret, publicKey: ephPublic } = x25519.keygen();
  const clientNonce = randomBytes(HS_NONCE);
  return {
    clientHello: concatBytes(ephPublic, clientNonce),
    state: { ephSecret, ephPublic, clientNonce },
  };
}

/**
 * Responder (agent) step: consume the ClientHello, produce the signed
 * ServerHello, and derive the session keys. Throws on a malformed ClientHello.
 */
export function respond(
  clientHello: Uint8Array,
  identity: { secretKey: Uint8Array; publicKey: Uint8Array },
): { serverHello: Uint8Array; keys: SessionKeys } {
  if (clientHello.length !== CLIENT_HELLO_LEN) {
    throw new Error(`proxy-e2e: bad ClientHello length ${clientHello.length}`);
  }
  const ephIPub = clientHello.slice(0, X_PUB);
  const nC = clientHello.slice(X_PUB, X_PUB + HS_NONCE);

  const { secretKey: ephSecret, publicKey: ephRPub } = x25519.keygen();
  const nS = randomBytes(HS_NONCE);
  const sig = sign(transcript(ephIPub, ephRPub, nC, nS), identity.secretKey);

  const shared = x25519.getSharedSecret(ephSecret, ephIPub);
  const { i2r, r2i } = deriveKeys(shared, nC, nS);

  return {
    serverHello: concatBytes(ephRPub, nS, identity.publicKey, sig),
    keys: { sendKey: r2i, recvKey: i2r },
  };
}

/**
 * Initiator (phone) step 2: consume the ServerHello, verify the agent's pinned
 * identity + signature, and derive the session keys. Throws on length mismatch,
 * a fingerprint that doesn't match the pin, or an invalid signature — every
 * failure means "this is not the agent the QR named", so the caller must abort.
 */
export function finishInitiator(
  serverHello: Uint8Array,
  state: InitiatorState,
  pinnedPublicKey: Uint8Array,
): SessionKeys {
  if (serverHello.length !== SERVER_HELLO_LEN) {
    throw new Error(`proxy-e2e: bad ServerHello length ${serverHello.length}`);
  }
  let off = 0;
  const ephRPub = serverHello.slice(off, (off += X_PUB));
  const nS = serverHello.slice(off, (off += HS_NONCE));
  const idPub = serverHello.slice(off, (off += ID_PUB));
  const sig = serverHello.slice(off, (off += SIG));

  if (!constantTimeEqual(idPub, pinnedPublicKey)) {
    throw new Error('proxy-e2e: identity key does not match pinned fingerprint (possible spoofing)');
  }
  const t = transcript(state.ephPublic, ephRPub, state.clientNonce, nS);
  if (!verify(sig, t, idPub)) {
    throw new Error('proxy-e2e: handshake signature invalid (possible spoofing)');
  }

  const shared = x25519.getSharedSecret(state.ephSecret, ephRPub);
  const { i2r, r2i } = deriveKeys(shared, state.clientNonce, nS);
  return { sendKey: i2r, recvKey: r2i };
}
