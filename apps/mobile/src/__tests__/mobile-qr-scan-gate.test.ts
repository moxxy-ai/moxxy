import { describe, expect, it } from 'vitest';
import { createQrScanGate } from '../qrScanGate';

describe('mobile QR scan gate', () => {
  it('stays idle until armed and then accepts only one QR payload', () => {
    const gate = createQrScanGate();

    expect(gate.tryAcquire()).toBe(false);

    gate.arm();

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.reset();

    expect(gate.tryAcquire()).toBe(false);
  });

  it('ignores camera callbacks while the gate is disarmed', async () => {
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

  // openScanner now auto-arms (reset + arm); the one-shot acquire still
  // dedupes the burst of onBarcodeScanned callbacks, and closeScanner's
  // reset means a re-open re-arms from scratch.
  it('auto-armed open flow accepts the first payload, dedupes the rest, and re-arms after close', () => {
    const gate = createQrScanGate();

    gate.reset();
    gate.arm();
    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.reset();
    expect(gate.tryAcquire()).toBe(false);

    gate.reset();
    gate.arm();
    expect(gate.tryAcquire()).toBe(true);
  });
});
