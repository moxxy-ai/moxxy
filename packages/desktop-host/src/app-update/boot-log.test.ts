import { describe, expect, it, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { appendBootLog, readBootLog, hasBootLog } from './boot-log';
import { appUpdateDir } from './resolve';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'boot-log-'));
});

describe('boot-log', () => {
  it('returns [] and reports absent when nothing is written', () => {
    expect(readBootLog(tmp)).toEqual([]);
    expect(hasBootLog(tmp)).toBe(false);
  });

  it('appends entries newest-last and stamps a ts', () => {
    appendBootLog(tmp, { phase: 'boot', picked: '0.0.1' });
    appendBootLog(tmp, { phase: 'boot', picked: 'floor', reason: 'no-active' });
    const log = readBootLog(tmp);
    expect(log).toHaveLength(2);
    expect(log[0]?.picked).toBe('0.0.1');
    expect(log[1]?.reason).toBe('no-active');
    expect(typeof log[0]?.ts).toBe('number');
    expect(hasBootLog(tmp)).toBe(true);
  });

  it('caps the log at 50 entries (rolling window)', () => {
    for (let i = 0; i < 70; i += 1) appendBootLog(tmp, { phase: 'boot', picked: String(i) });
    const log = readBootLog(tmp);
    expect(log).toHaveLength(50);
    // Oldest 20 dropped — newest retained, in order.
    expect(log[0]?.picked).toBe('20');
    expect(log[49]?.picked).toBe('69');
  });

  it('honors the limit argument (last N)', () => {
    for (let i = 0; i < 10; i += 1) appendBootLog(tmp, { phase: 'boot', picked: String(i) });
    const tail = readBootLog(tmp, 3);
    expect(tail.map((e) => e.picked)).toEqual(['7', '8', '9']);
  });

  it('tolerates a malformed log file (returns [], does not throw)', () => {
    mkdirSync(appUpdateDir(tmp), { recursive: true });
    writeFileSync(path.join(appUpdateDir(tmp), 'boot-log.json'), '{ not json');
    expect(readBootLog(tmp)).toEqual([]);
    // A subsequent append recovers cleanly.
    appendBootLog(tmp, { phase: 'confirm', picked: '1.0.0' });
    expect(readBootLog(tmp)).toHaveLength(1);
  });

  it('drops entries that are not well-formed', () => {
    mkdirSync(appUpdateDir(tmp), { recursive: true });
    writeFileSync(
      path.join(appUpdateDir(tmp), 'boot-log.json'),
      JSON.stringify([{ ts: 1, phase: 'boot' }, { nope: true }, 'string', 42]),
    );
    expect(readBootLog(tmp)).toHaveLength(1);
  });
});
