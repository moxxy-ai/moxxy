import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { coreTxnDir } from '../core-update.js';
import { snapshotDir } from './shared.js';

describe('core-tools shared helpers', () => {
  it('snapshotDir nests "snapshot" under the txn dir', () => {
    const moxxyDir = '/tmp/.moxxy';
    const txnId = 'core-abc123';
    expect(snapshotDir(moxxyDir, txnId)).toBe(path.join(coreTxnDir(moxxyDir, txnId), 'snapshot'));
  });

  it('produces distinct snapshot dirs for distinct txns', () => {
    expect(snapshotDir('/x', 'a')).not.toBe(snapshotDir('/x', 'b'));
  });
});
