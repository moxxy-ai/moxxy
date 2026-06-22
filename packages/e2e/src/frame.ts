/**
 * Per-message AEAD framing for the post-handshake channel.
 *
 * Each frame: seq(8 BE) ‖ nonce(24) ‖ XChaCha20-Poly1305(key, nonce, aad=seq).
 *
 * The sequence number is bound as AAD and enforced strictly increasing by the
 * receiver, so the relay (the adversary on the wire) cannot replay, reorder, or
 * drop-and-resend a frame without the open failing. XChaCha's 192-bit random
 * nonce means we never have to synchronise a nonce counter across the wire.
 *
 * A sealer/opener pair is one-directional; a SecureChannel keeps one of each,
 * keyed by the directional keys from the handshake.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { concatBytes, readU64be, u64be } from './bytes.js';

const SEQ = 8;
const NONCE = 24;
const HEADER = SEQ + NONCE; // 32

/** Seals outgoing plaintext into authenticated frames with a monotonic counter. */
export class FrameSealer {
  private seq = 0;
  constructor(private readonly key: Uint8Array) {}

  seal(plaintext: Uint8Array): Uint8Array {
    const seqBytes = u64be(this.seq);
    const nonce = randomBytes(NONCE);
    const ct = xchacha20poly1305(this.key, nonce, seqBytes).encrypt(plaintext);
    this.seq += 1;
    return concatBytes(seqBytes, nonce, ct);
  }
}

/** Opens incoming frames, rejecting any whose sequence is not strictly increasing. */
export class FrameOpener {
  /** Highest sequence accepted so far; -1 means "nothing yet". */
  private lastSeq = -1;
  constructor(private readonly key: Uint8Array) {}

  open(frame: Uint8Array): Uint8Array {
    if (frame.length < HEADER) throw new Error('proxy-e2e: frame too short');
    const seqBytes = frame.slice(0, SEQ);
    const seq = readU64be(seqBytes);
    if (seq <= this.lastSeq) {
      throw new Error(`proxy-e2e: out-of-order/replayed frame (seq ${seq} <= ${this.lastSeq})`);
    }
    const nonce = frame.slice(SEQ, HEADER);
    const ct = frame.slice(HEADER);
    // Throws if the tag (over ciphertext + seq AAD) doesn't verify.
    const pt = xchacha20poly1305(this.key, nonce, seqBytes).decrypt(ct);
    this.lastSeq = seq;
    return pt;
  }
}
