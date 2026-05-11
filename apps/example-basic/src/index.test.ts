import { describe, expect, it, vi } from 'vitest';
import { runExample } from './index.js';

describe('example-basic', () => {
  it('runs end-to-end and prints the expected event sequence', async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    try {
      await runExample();
    } finally {
      spy.mockRestore();
    }
    expect(lines.some((l) => l.includes('user: use the greet tool'))).toBe(true);
    expect(lines.some((l) => l.includes('tool_use: greet({"name":"world"})'))).toBe(true);
    expect(lines.some((l) => l.includes('tool_result: Hello, world!'))).toBe(true);
    expect(lines.some((l) => l.includes('assistant: The greeting tool said'))).toBe(true);
  });
});
