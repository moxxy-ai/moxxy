import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LiveToolBlockData, ToolCallBlockData } from '@moxxy/chat-model';
import { asEventId, asSessionId, asToolCallId, asTurnId } from '@moxxy/sdk';
import { ToolBlock } from './blocks/ToolBlock';
import { LiveToolGroupView, ToolGroupView } from './ToolGroupView';

function read(id: string, path: string): ToolCallBlockData {
  return {
    kind: 'tool-call', id, outcome: null,
    request: {
      id: asEventId(id), seq: 1, ts: 1, sessionId: asSessionId('s'), turnId: asTurnId('t'),
      source: 'model', type: 'tool_call_requested', callId: asToolCallId(id), name: 'Read', input: { file_path: path },
    },
  };
}

describe('collapsed activity', () => {
  const pending = read('a', '/repo/package.json');
  const denied = { ...read('b', '/repo/private.txt'), outcome: { type: 'denied' as const, reason: 'Access denied' } };

  it('names the still active call when a later parallel call was denied, and keeps its reason in the details', () => {
    render(<ToolGroupView tools={[pending, denied]} />);
    const header = screen.getByRole('button', { name: /Reading package.json/, expanded: false });
    expect(header).not.toHaveTextContent(/failed|2 calls/);
    expect(screen.queryByText('Access denied')).toBeNull();
    fireEvent.click(header);
    expect(header).toHaveTextContent('1 failed');
    fireEvent.click(screen.getByRole('button', { name: /private.txt/ }));
    expect(screen.getByText('Access denied')).toBeVisible();
  });

  it('keeps an unsuccessful standalone command neutral until it is opened', () => {
    render(<ToolBlock name="Bash" input={{ command: 'echo hello' }} outcome={denied.outcome} />);
    const header = screen.getByRole('button', { expanded: false });
    expect(header).not.toHaveTextContent(/ran|failed|echo hello/i);
    fireEvent.click(header);
    expect(header).toHaveTextContent('failed');
    expect(screen.getByText('Access denied')).toBeVisible();
  });

  it('keeps a compact group to one caption and restores the settled summary', () => {
    const compact = { verb: 'Reading', noun: { one: 'file', other: 'files' }, previewKey: 'file_path' };
    const block: LiveToolBlockData = { kind: 'live-tools', id: 'group', closed: false,
      calls: [pending, denied].map(call => ({ ...call, compact })) };
    const { rerender } = render(<LiveToolGroupView block={block} />);
    expect(screen.getByRole('button', { name: /Reading package.json/, expanded: false })).toBeVisible();
    expect(screen.queryByText('/repo/private.txt')).toBeNull();
    rerender(<LiveToolGroupView block={{ ...block, closed: true, calls: [{ ...denied, compact }] }} />);
    expect(screen.getByRole('button', { name: /^Tool activity$/ })).toBeVisible();
    const success = { ...pending, compact, outcome: {
      ...pending.request, id: asEventId('result'), type: 'tool_result' as const, source: 'tool' as const, ok: true, output: 'contents',
    } };
    rerender(<LiveToolGroupView block={{ ...block, closed: true, calls: [success, { ...denied, compact }] }} />);
    expect(screen.getByRole('button', { name: /Read 1 file/ })).not.toHaveTextContent(/failed|2 calls/);
  });
});
