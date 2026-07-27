import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Ed25519 detached-signature verification over exact bytes.
 *
 * Lives in the SDK rather than beside its first caller because two different
 * things now depend on it, and one of them is policy. Policy has to bind on a
 * machine with no plugins installed at all, so the verifier it uses cannot sit
 * inside a plugin: a control that a user can disable by uninstalling something
 * is not a control.
 *
 * Verifies over the bytes as received, never over a re-serialisation of the
 * parsed object. Canonicalising first would let two different documents share a
 * signature whenever the parser and the serialiser disagree about anything,
 * which is how signature-verification bypasses usually happen.
 *
 * Returns false rather than throwing on a malformed key or signature: to a
 * caller "this did not verify" and "this could not be parsed" warrant the same
 * response, and a throw here would tempt a try/catch that swallows both into a
 * success path.
 */
export function verifyEd25519(
  bytes: Uint8Array,
  signatureB64: string,
  publicKeyPem: string,
): boolean {
  if (!publicKeyPem || !signatureB64) return false;
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(null, Buffer.from(bytes), key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
