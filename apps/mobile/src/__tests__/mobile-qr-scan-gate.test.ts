import { describe, expect, it } from 'vitest';
import { createQrScanGate } from '../qrScanGate';

describe('mobile QR scan gate', () => {
  it('stays idle until the user arms scanning and then accepts only one QR payload', () => {
    const gate = createQrScanGate();

    expect(gate.tryAcquire()).toBe(false);

    gate.arm();

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.reset();

    expect(gate.tryAcquire()).toBe(false);
  });

  it('does not scan automatically before the explicit scan action', async () => {
    const gate = createQrScanGate();
    const scanned: string[] = [];

    async function handleScan(raw: string) {
      if (!gate.tryAcquire()) return;
      scanned.push(raw);
    }

    await handleScan('payload-1');
    gate.arm();
    await handleScan('payload-1');
    await handleScan('payload-1');

    expect(scanned).toEqual(['payload-1']);
  });
});
