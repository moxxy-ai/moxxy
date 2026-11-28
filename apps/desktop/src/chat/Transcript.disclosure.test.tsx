import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { afterEach, describe, expect, it } from 'vitest';
import { asEventId, asSessionId, asToolCallId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { Transcript } from './Transcript';

afterEach(cleanup);

const sessionId = asSessionId('read-session');
const turnId = asTurnId('read-turn');
const stamp = (seq: number) => ({ id: asEventId(String(seq)), seq, ts: seq * 1000, sessionId, turnId });
const first = asToolCallId('first');
const retry = asToolCallId('retry');
const work: MoxxyEvent[] = [
  { ...stamp(1), type: 'user_prompt', source: 'user', text: 'Read the report.' },
  { ...stamp(2), type: 'tool_call_requested', source: 'model', callId: first, name: 'Read', input: { file_path: 'missing.txt' } },
  { ...stamp(3), type: 'tool_result', source: 'tool', callId: first, ok: false, output: 'File not found' },
  { ...stamp(4), type: 'tool_call_requested', source: 'model', callId: retry, name: 'Read', input: { file_path: 'report.txt' } },
  { ...stamp(5), type: 'tool_result', source: 'tool', callId: retry, ok: true, output: 'Report contents' },
];
const answer: MoxxyEvent = { ...stamp(6), type: 'assistant_message', source: 'model', content: 'The report is ready.', stopReason: 'end_turn' };
const compactTools = new Map([['Read', { verb: 'Reading', noun: { one: 'file', other: 'files' } }]]);
const geometry = { viewportHeight: 700, itemHeight: 48 };

function transcript(events: MoxxyEvent[], sending: boolean) {
  // Supply layout measurements because jsdom does not measure the real virtual list.
  return <VirtuosoMockContext.Provider value={geometry}>
    <Transcript events={events} sending={sending} extensions={[]} streamingText="" compactTools={compactTools} />
  </VirtuosoMockContext.Provider>;
}

describe('the last tool group in a turn', () => {
  it('keeps the open retry details and keyboard focus when the answer arrives', async () => {
    const { rerender } = render(transcript(work, true));
    const history = await screen.findByTestId('block-work-group');
    const header = await within(history).findByRole('button');
    fireEvent.click(header);
    fireEvent.click(within(screen.getByTestId('block-live-tools')).getByRole('button'));
    const failed = screen.getByRole('button', { name: /missing.txt.*failed/ });
    fireEvent.click(failed);
    failed.focus();
    expect(screen.getByText('File not found')).toBeVisible();

    rerender(transcript([...work, answer], true));
    expect(await screen.findByText('The report is ready.')).toBeVisible();
    rerender(transcript([...work, answer], false));
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(failed).toHaveFocus();
    expect(screen.getByText('File not found')).toBeVisible();
    fireEvent.click(header);
    expect(screen.queryByText('File not found')).toBeNull();
  });

  it('leaves a group closed by the user compact and available to reopen', async () => {
    const { rerender } = render(transcript(work, true));
    const history = await screen.findByTestId('block-work-group');
    const header = await within(history).findByRole('button');
    fireEvent.click(header);
    fireEvent.click(header);
    rerender(transcript([...work, answer], false));
    const summary = await screen.findByRole('button', { name: 'Read 1 file' });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(screen.getByRole('button', { name: /missing.txt.*failed/ })).toBeVisible();
  });
});
