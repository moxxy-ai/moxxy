import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = new URL('../packages/plugin-computer-control/native/tests/Run-ComputerUseTests.ps1', import.meta.url);

// Windows PowerShell 5.1 — the only PowerShell on a stock Windows 10 or 11, and
// the one the test-kit instructions name — reads a script without a byte-order
// mark in the ANSI code page, so the Polish samples stop it from parsing at all.
test('the Windows computer-use test script opens in Windows PowerShell 5.1', () => {
  const bytes = readFileSync(script);
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'the script must start with a UTF-8 byte-order mark');
});
