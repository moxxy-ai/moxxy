/**
 * The agent's self-sovereign identity for proxy: a long-lived Ed25519 keypair.
 *
 * The public key alone determines two things, with no account system involved:
 *   - the **fingerprint** carried out-of-band in the QR (`?fp=`), which the
 *     phone pins and uses to authenticate the agent during the handshake;
 *   - the **uuid** subdomain (`uuid = base32(sha256(pubkey))`), which the relay
 *     re-derives after verifying a signature, so only the holder of the private
 *     key can register/reclaim it (preimage-bound, like a WireGuard node key).
 *
 * Because the QR pins the fingerprint, the phone can independently recompute the
 * expected uuid and reject any URL whose subdomain doesn't match — making the
 * subdomain itself verifiable, not just trusted.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base32Encode, base64urlDecode, base64urlEncode } from './bytes.js';

/** Number of base32 chars in the uuid label (16 × 5 = 80 bits of preimage strength). */
export const UUID_LABEL_LENGTH = 16;

export interface Identity {
  /** Ed25519 secret key (32 bytes). Never leaves the agent. */
  readonly secretKey: Uint8Array;
  /** Ed25519 public key (32 bytes). The identity. */
  readonly publicKey: Uint8Array;
}

/** Generate a fresh agent identity. */
export function generateIdentity(): Identity {
  const { secretKey, publicKey } = ed25519.keygen();
  return { secretKey, publicKey };
}

/** Recover the public key from a stored secret key. */
export function publicKeyFromSecret(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

/** The QR-carried fingerprint: base64url of the raw 32-byte public key. */
export function fingerprint(publicKey: Uint8Array): string {
  return base64urlEncode(publicKey);
}

/** Parse a fingerprint string back to the 32-byte public key (throws if malformed). */
export function publicKeyFromFingerprint(fp: string): Uint8Array {
  const key = base64urlDecode(fp);
  if (key.length !== 32) throw new Error(`bad fingerprint: expected 32 bytes, got ${key.length}`);
  return key;
}

/** Derive the stable uuid subdomain label from a public key. */
export function deriveUuid(publicKey: Uint8Array): string {
  return base32Encode(sha256(publicKey)).slice(0, UUID_LABEL_LENGTH);
}

/** Sign a message with the identity's secret key (Ed25519). */
export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

/** Verify an Ed25519 signature against a public key. */
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}
