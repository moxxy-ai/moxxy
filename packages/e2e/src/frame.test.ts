import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8 } from './bytes.js';
import { FrameOpener, FrameSealer } from './frame.js';

const key = (): Uint8Array => sha256(utf8('test-key'));

describe('frame', () => {
  it('seals and opens a round trip', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(key());
    const msg = utf8('hello world');
    expect([...opener.open(sealer.seal(msg))]).toEqual([...msg]);
  });

  it('preserves ordering across many frames', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(key());
    for (let i = 0; i < 50; i++) {
      const m = utf8(`msg-${i}`);
      expect([...opener.open(sealer.seal(m))]).toEqual([...m]);
    }
  });

  it('rejects a tampered ciphertext', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(key());
    const frame = sealer.seal(utf8('secret'));
    frame[frame.length - 1] ^= 0x01;
    expect(() => opener.open(frame)).toThrow();
  });

  it('rejects a tampered sequence number', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(key());
    const frame = sealer.seal(utf8('secret'));
    frame[0] ^= 0x01; // mutate the seq header (bound as AAD)
    expect(() => opener.open(frame)).toThrow();
  });

  it('rejects a replayed frame', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(key());
    const frame = sealer.seal(utf8('once'));
    opener.open(frame);
    expect(() => opener.open(frame)).toThrow(/replayed|out-of-order/);
  });

  it('rejects reordered frames', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(key());
    const f0 = sealer.seal(utf8('zero'));
    const f1 = sealer.seal(utf8('one'));
    opener.open(f1); // accept seq 1 first
    expect(() => opener.open(f0)).toThrow(/out-of-order/); // seq 0 now stale
  });

  it('rejects a frame opened with the wrong key', () => {
    const sealer = new FrameSealer(key());
    const opener = new FrameOpener(sha256(utf8('other-key')));
    expect(() => opener.open(sealer.seal(utf8('secret')))).toThrow();
  });
});
