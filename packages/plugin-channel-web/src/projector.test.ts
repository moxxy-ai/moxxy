import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { EventProjector } from './projector.js';

// Minimal event factory — only the fields the projector reads.
function ev(partial: Record<string, unknown>): MoxxyEvent {
  return { turnId: 't1', sessionId: 's1', source: 'system', id: 'e', seq: 0, ts: 0, ...partial } as unknown as MoxxyEvent;
}

const sampleDoc = { root: { kind: 'element', tag: 'view', props: {}, children: [] } };

describe('EventProjector', () => {
  it('emits a view frame from a present_view tool_result', () => {
    const p = new EventProjector();
    expect(p.project(ev({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: { fallbackText: 'fb' } }))).toEqual([]);
    const frames = p.project(ev({ type: 'tool_result', callId: 'c1', ok: true, output: { ast: sampleDoc } }));
    expect(frames).toHaveLength(1);
    const f = frames[0]!;
    expect(f.kind).toBe('view');
    if (f.kind !== 'view') return;
    expect(f.doc).toEqual(sampleDoc);
    expect(f.replaces).toBeNull();
    expect(f.fallbackText).toBe('fb');
  });

  it('sets `replaces` to the prior view id on the second view', () => {
    const p = new EventProjector();
    p.project(ev({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: {} }));
    const first = p.project(ev({ type: 'tool_result', callId: 'c1', ok: true, output: { ast: sampleDoc } }))[0]!;
    p.project(ev({ type: 'tool_call_requested', callId: 'c2', name: 'present_view', input: {} }));
    const second = p.project(ev({ type: 'tool_result', callId: 'c2', ok: true, output: { ast: sampleDoc } }))[0]!;
    if (first.kind !== 'view' || second.kind !== 'view') throw new Error('expected views');
    expect(second.replaces).toBe(first.viewId);
    expect(second.viewId).not.toBe(first.viewId);
  });

  it('carries the view name from the AST root onto the frame', () => {
    const p = new EventProjector();
    p.project(ev({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: {} }));
    const namedDoc = { root: { kind: 'element', tag: 'view', props: { name: 'search' }, children: [] } };
    const f = p.project(ev({ type: 'tool_result', callId: 'c1', ok: true, output: { ast: namedDoc } }))[0]!;
    expect(f.kind === 'view' && f.name).toBe('search');
  });

  it('omits name when the view has none', () => {
    const p = new EventProjector();
    p.project(ev({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: {} }));
    const f = p.project(ev({ type: 'tool_result', callId: 'c1', ok: true, output: { ast: sampleDoc } }))[0]!;
    expect(f.kind === 'view' && f.name).toBeUndefined();
  });

  it('ignores tool_result for non-present_view calls', () => {
    const p = new EventProjector();
    expect(p.project(ev({ type: 'tool_result', callId: 'x', ok: true, output: { ast: sampleDoc } }))).toEqual([]);
  });

  it('emits a file-diff frame from a Write/Edit tool_result carrying a display', () => {
    const p = new EventProjector();
    const display = {
      kind: 'file-diff',
      path: 'src/foo.ts',
      mode: 'update',
      added: 2,
      removed: 1,
      hunks: [
        {
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 3,
          lines: [
            { kind: 'context', text: 'a', oldNo: 1, newNo: 1 },
            { kind: 'del', text: 'b', oldNo: 2 },
            { kind: 'add', text: 'b2', newNo: 2 },
            { kind: 'add', text: 'c', newNo: 3 },
          ],
        },
      ],
    };
    const frames = p.project(ev({ type: 'tool_result', callId: 'w1', name: 'Write', ok: true, output: { forModel: 'Updated', display } }));
    expect(frames).toEqual([{ kind: 'file-diff', turnId: 't1', display }]);
  });

  it('does NOT emit a file-diff frame for a failed write result', () => {
    const p = new EventProjector();
    const display = { kind: 'file-diff', path: 'x', mode: 'create', added: 1, removed: 0, hunks: [] };
    expect(p.project(ev({ type: 'tool_result', callId: 'w2', ok: false, output: { display } }))).toEqual([]);
  });

  it('hides synthesized [ui-action] prompts but shows real ones', () => {
    const p = new EventProjector();
    expect(p.project(ev({ type: 'user_prompt', text: '[ui-action] ...' }))).toEqual([]);
    const frames = p.project(ev({ type: 'user_prompt', text: 'find flights' }));
    expect(frames[0]).toMatchObject({ kind: 'message', role: 'user', text: 'find flights' });
  });

  it('emits assistant message + done status, and tool status for other tools', () => {
    const p = new EventProjector();
    expect(p.project(ev({ type: 'tool_call_requested', callId: 'c', name: 'web_fetch', input: {} }))[0]).toMatchObject({
      kind: 'status',
      phase: 'tool',
    });
    const frames = p.project(ev({ type: 'assistant_message', content: 'done!', stopReason: 'end_turn' }));
    expect(frames.find((f) => f.kind === 'message')).toMatchObject({ role: 'assistant', text: 'done!' });
    expect(frames.find((f) => f.kind === 'status')).toMatchObject({ phase: 'done' });
  });

  it('does NOT emit a done status when the assistant stops to use a tool', () => {
    const p = new EventProjector();
    const frames = p.project(ev({ type: 'assistant_message', content: 'thinking', stopReason: 'tool_use' }));
    expect(frames.some((f) => f.kind === 'status' && f.phase === 'done')).toBe(false);
    expect(frames.some((f) => f.kind === 'message')).toBe(true);
  });

  it('skips empty assistant messages but still ends the turn', () => {
    const p = new EventProjector();
    const frames = p.project(ev({ type: 'assistant_message', content: '   ', stopReason: 'end_turn' }));
    expect(frames.some((f) => f.kind === 'message')).toBe(false);
    expect(frames.some((f) => f.kind === 'status' && f.phase === 'done')).toBe(true);
  });

  it('emits an error status for a failed present_view tool_result', () => {
    const p = new EventProjector();
    p.project(ev({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: {} }));
    const frames = p.project(ev({ type: 'tool_result', callId: 'c1', ok: false, error: { message: 'bad', kind: 'threw' } }));
    expect(frames).toEqual([{ kind: 'status', turnId: 't1', phase: 'error', text: 'view failed to render' }]);
  });

  it('emits nothing for a present_view result missing an ast', () => {
    const p = new EventProjector();
    p.project(ev({ type: 'tool_call_requested', callId: 'c1', name: 'present_view', input: {} }));
    expect(p.project(ev({ type: 'tool_result', callId: 'c1', ok: true, output: {} }))).toEqual([]);
  });

  it('maps error events to an error status', () => {
    const p = new EventProjector();
    expect(p.project(ev({ type: 'error', message: 'boom', kind: 'fatal' }))).toEqual([
      { kind: 'status', turnId: 't1', phase: 'error', text: 'boom' },
    ]);
  });

  it('handles two present_view calls in one turn, each replacing the last', () => {
    const p = new EventProjector();
    p.project(ev({ type: 'tool_call_requested', callId: 'a', name: 'present_view', input: {} }));
    const first = p.project(ev({ type: 'tool_result', callId: 'a', ok: true, output: { ast: sampleDoc } }))[0]!;
    p.project(ev({ type: 'tool_call_requested', callId: 'b', name: 'present_view', input: {} }));
    const second = p.project(ev({ type: 'tool_result', callId: 'b', ok: true, output: { ast: sampleDoc } }))[0]!;
    if (first.kind !== 'view' || second.kind !== 'view') throw new Error('views');
    expect(second.replaces).toBe(first.viewId);
  });

  it('ignores event types it does not render', () => {
    const p = new EventProjector();
    expect(p.project(ev({ type: 'tool_call_approved', callId: 'c' }))).toEqual([]);
    expect(p.project(ev({ type: 'provider_request' }))).toEqual([]);
  });

  it('stays correct after a long run of aborted present_view calls (pending map bounded)', () => {
    // Each present_view tool_call without a matching tool_result simulates an
    // aborted/errored turn — its pending entry would otherwise leak forever.
    // After many such aborts the projector must remain functional and still
    // render a fresh, fully-resolved view.
    const p = new EventProjector();
    for (let i = 0; i < 500; i++) {
      expect(p.project(ev({ type: 'tool_call_requested', callId: `abort${i}`, name: 'present_view', input: {} }))).toEqual([]);
    }
    p.project(ev({ type: 'tool_call_requested', callId: 'live', name: 'present_view', input: {} }));
    const frames = p.project(ev({ type: 'tool_result', callId: 'live', ok: true, output: { ast: sampleDoc } }));
    expect(frames).toHaveLength(1);
    expect(frames[0]!.kind).toBe('view');
  });
});
