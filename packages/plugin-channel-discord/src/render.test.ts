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

  it("says the agent's limit is used up and when it resets, as the desktop does", () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'plugin_event', pluginId: '@moxxy/agent-connection', subtype: 'account_limit', payload: { provider: 'codex-agent', agent: 'Codex', limit: { state: 'reached', windowMinutes: 300 } } }));
    expect(r.snapshot()).toContain("⛔ **Codex's 5-hour limit is used up**");
  });

  it('surfaces error events', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'error', kind: 'provider', message: 'boom' }));
    expect(r.snapshot()).toContain('❗ **provider**: boom');
  });

  it('renders a file diff as a summary line and a diff fence after the body', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'tool_call_requested', callId: 'c1', name: 'Edit', input: { file_path: 'src/app.ts' } }));
    r.accept(ev({ type: 'assistant_message', content: 'Done.' }));
    r.accept(
      ev({
        type: 'tool_result',
        callId: 'c1',
        ok: true,
        output: {
          forModel: 'edited',
          display: {
            kind: 'file-diff',
            path: 'src/app.ts',
            mode: 'update',
            added: 1,
            removed: 1,
            hunks: [
              {
                oldStart: 3,
                oldLines: 1,
                newStart: 3,
                newLines: 1,
                lines: [
                  { kind: 'del', text: 'const b = 2;', oldNo: 3 },
                  { kind: 'add', text: 'const b = 3;', newNo: 3 },
                ],
              },
            ],
          },
        },
      }),
    );
    const frame = r.snapshot();
    expect(frame).toContain('**Update src/app.ts** — Added 1 line, removed 1 line');
    expect(frame).toContain('```diff\n@@ -3,1 +3,1 @@\n-const b = 2;\n+const b = 3;\n```');
    expect(frame.indexOf('Done.')).toBeLessThan(frame.indexOf('```diff'));
  });

  it('shows only the summary line for a diff with no hunks', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'tool_call_requested', callId: 'c1', name: 'Write', input: {} }));
    r.accept(
      ev({
        type: 'tool_result',
        callId: 'c1',
        ok: true,
        output: { forModel: 'wrote', display: { kind: 'file-diff', path: 'big.json', mode: 'create', added: 5000, removed: 0, hunks: [], truncated: true } },
      }),
    );
    expect(r.snapshot()).toContain('**Create big.json**');
    expect(r.snapshot()).not.toContain('```');
  });

  it('notes a spawned agent', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'plugin_event', pluginId: '@moxxy/subagents', subtype: 'subagent_started', payload: { label: 'researcher' } }));
    expect(r.snapshot()).toContain('> 🤖 spawned agent **researcher**');
  });

  const stepList = (steps: ReadonlyArray<{ text: string; status: string }>) => ({
    forModel: 'list updated',
    display: { kind: 'step-list', steps },
  });

  it('folds every step-list tool result into one list of the latest steps', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'tool_call_requested', callId: 's1', name: 'TaskCreate', input: {} }));
    r.accept(ev({ type: 'tool_result', callId: 's1', ok: true, output: stepList([{ text: 'Read the logs', status: 'pending' }]) }));
    r.accept(ev({ type: 'tool_call_requested', callId: 's2', name: 'TaskUpdate', input: {} }));
    r.accept(
      ev({
        type: 'tool_result',
        callId: 's2',
        ok: true,
        output: stepList([
          { text: 'Read the logs', status: 'completed' },
          { text: 'Fix the bug', status: 'in_progress' },
          { text: 'Run the tests', status: 'pending' },
          { text: 'Ask for review', status: 'cancelled' },
        ]),
      }),
    );
    const frame = r.snapshot();
    expect(frame).toContain('> 📋 **Steps · 2 of 4 done**');
    expect(frame).toContain('> ✓ Read the logs');
    expect(frame).toContain('> ● **Fix the bug**');
    expect(frame).toContain('> ○ Run the tests');
    expect(frame).toContain('> ✗ ~~Ask for review~~');
    expect(frame.match(/Steps ·/g)).toHaveLength(1);
    expect(frame).not.toContain('`TaskCreate`');
    expect(frame).not.toContain('`TaskUpdate`');
  });

  it('names how many images the tools returned and keeps each image once', () => {
    const r = new DiscordTurnRenderer();
    const shot = { mediaType: 'image/png', base64: 'AAAA' };
    r.accept(ev({ type: 'tool_call_requested', callId: 'i1', name: 'screenshot', input: {} }));
    r.accept(ev({ type: 'tool_result', callId: 'i1', ok: true, output: { forModel: 'screen', ...shot } }));
    r.accept(ev({ type: 'tool_call_requested', callId: 'i2', name: 'screenshot', input: {} }));
    r.accept(ev({ type: 'tool_result', callId: 'i2', ok: true, output: { forModel: 'screen', ...shot } }));
    expect(r.images()).toEqual([shot]);
    expect(r.snapshot()).toContain('> 🖼 1 image came back');
  });

  it('says while the turn runs that the agent of a connection is using the computer, and how to stop it', () => {
    const r = new DiscordTurnRenderer({ agentName: () => 'Codex' });
    r.accept(
      ev({ type: 'tool_call_requested', callId: 'u1', name: 'mcp__computer-use__type_text', input: { app: 'Arc' }, executedBy: 'provider' }),
    );
    expect(r.snapshot()).toContain('🖥 **Codex is using your computer · Arc** — send /cancel to stop');
    expect(r.snapshot({ final: true })).not.toContain('using your computer');
  });

  it('names the agent generically when the session does not say which agent it is', () => {
    const r = new DiscordTurnRenderer();
    r.accept(ev({ type: 'tool_call_requested', callId: 'u1', name: 'computer-use_screenshot', input: {}, executedBy: 'provider' }));
    expect(r.snapshot()).toContain('🖥 **The agent is using your computer** — send /cancel to stop');
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
