import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { DiscordTurnRenderer, splitForDiscord } from './render.js';

const ev = (partial: Record<string, unknown>): MoxxyEvent => partial as unknown as MoxxyEvent;

describe('DiscordTurnRenderer', () => {
  it('accumulates chunks, prefers the final assistant message, reports updates', () => {
    const r = new DiscordTurnRenderer();
    expect(r.accept(ev({ type: 'assistant_chunk', delta: 'Hel' }))).toBe(true);
    expect(r.accept(ev({ type: 'assistant_chunk', delta: 'lo' }))).toBe(true);
    expect(r.snapshot()).toBe('Hello');
    expect(r.accept(ev({ type: 'assistant_message', content: 'Hello, world.' }))).toBe(true);
    expect(r.snapshot()).toBe('Hello, world.');
    // Unknown events don't change the frame.
    expect(r.accept(ev({ type: 'user_prompt', content: 'x' }))).toBe(false);
  });

  it('renders tool activity as a quote block with statuses', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'tool_call_requested', callId: 'c1', name: 'read_file', input: { path: '/tmp/x' } }));
    expect(r.snapshot()).toContain('> - `read_file` (path=/tmp/x) — running…');
    r.accept(ev({ type: 'tool_result', callId: 'c1', ok: true, output: 'ok' }));
    expect(r.snapshot()).toMatch(/`read_file`.*— done /);
    r.accept(ev({ type: 'tool_call_requested', callId: 'c2', name: 'bash', input: {} }));
    r.accept(ev({ type: 'tool_call_denied', callId: 'c2', reason: 'denied by user' }));
    expect(r.snapshot()).toContain('denied: denied by user');
  });

  it('surfaces error events', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'error', kind: 'provider', message: 'boom' }));
    expect(r.snapshot()).toContain('❗ **provider**: boom');
  });

  it('reset clears everything', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'assistant_chunk', delta: 'x' }));
    r.reset();
    expect(r.snapshot()).toBe('');
  });
});

describe('splitForDiscord (2000-char cap)', () => {
  it('returns single part under the limit and [] for empty', () => {
    expect(splitForDiscord('hi')).toEqual(['hi']);
    expect(splitForDiscord('')).toEqual([]);
  });

  it('splits on newline boundaries and keeps every part under the cap', () => {
    const line = 'a'.repeat(80);
    const text = Array.from({ length: 60 }, () => line).join('\n'); // ~4860 chars
    const parts = splitForDiscord(text, 500);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(500);
    // No content lost: rejoining with newlines reproduces the original lines.
    expect(parts.join('\n')).toBe(text);
  });

  it('closes and reopens a code fence across a cut (with its info string)', () => {
    const fenceBody = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
    const text = 'intro\n```diff\n' + fenceBody + '\n```\noutro';
    const parts = splitForDiscord(text, 120);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(120);
    // Every part is fence-balanced (an even number of ``` markers).
    for (const p of parts) {
      const fences = p.match(/```/g) ?? [];
      expect(fences.length % 2).toBe(0);
    }
    // A middle part reopens with the original info string.
    const middle = parts.slice(1, -1);
    expect(middle.some((p) => p.startsWith('```diff\n'))).toBe(true);
  });

  it('handles oversized single lines (no newline under the budget)', () => {
    const text = 'x'.repeat(5000);
    const parts = splitForDiscord(text, 1000);
    expect(parts.join('')).toBe(text);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(1000);
  });
});
