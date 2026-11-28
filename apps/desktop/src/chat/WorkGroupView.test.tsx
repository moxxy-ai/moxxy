import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildRenderNodes, type WorkNode } from '@moxxy/client-core';
import { asEventId, asTurnId, asSessionId, asToolCallId, type MoxxyEvent } from '@moxxy/sdk';
import { transcriptNodes } from './transcript-nodes';
import { WorkGroupView } from './WorkGroupView';
import { ToolBlock } from './blocks/ToolBlock';
import { workGroupLabel } from './useWorkGroup';

afterEach(cleanup);

const group = (over: Partial<WorkNode> = {}): WorkNode => ({
  kind: 'work',
  id: 'work:a',
  nodes: [],
  steps: 12,
  startedAtMs: 0,
  endedAtMs: 252_000,
  ...over,
});

describe('workGroupLabel', () => {
  it('says how long the agent worked and in how many steps', () => {
    expect(workGroupLabel(group())).toEqual({ label: 'Worked for 4m 12s', steps: '12 steps' });
    expect(workGroupLabel(group({ endedAtMs: 9_400, steps: 1 }))).toEqual({ label: 'Worked for 9s', steps: '1 step' });
    expect(workGroupLabel(group({ endedAtMs: 3_900_000 }))).toEqual({ label: 'Worked for 1h 5m', steps: '12 steps' });
  });

  it('says only that it worked when the time is unknown or too short to say', () => {
    expect(workGroupLabel(group({ startedAtMs: null })).label).toBe('Worked');
    expect(workGroupLabel(group({ endedAtMs: 400 })).label).toBe('Worked');
  });
});

describe('WorkGroupView', () => {
  it('keeps the actual browser action through wrapper calls and streaming thoughts, and names the next action', () => {
    const events: MoxxyEvent[] = [];
    const base = () => ({
      id: asEventId(String(events.length)), seq: events.length, ts: 1000 + events.length,
      sessionId: asSessionId('web'), turnId: asTurnId('visit'),
    });
    const request = (id: string, name: string, input: Record<string, unknown>) => events.push({
      ...base(), type: 'tool_call_requested', source: 'model', callId: asToolCallId(id), name, input,
    });
    const result = (id: string) => events.push({
      ...base(), type: 'tool_result', source: 'tool', callId: asToolCallId(id), ok: true, output: 'ok',
    });
    const view = () => {
      const tools = new Map([['browser_navigate', { verb: 'Opening', noun: { one: 'page', other: 'pages' } }]]);
      const nodes = transcriptNodes(buildRenderNodes(events, [], undefined, tools), { notes: new Map(), outcomes: new Map() }, true);
      const work = nodes.at(-1);
      if (work?.kind !== 'work') throw new Error('expected live work');
      return <WorkGroupView group={work} streamingReasoning="internal streaming text">{() => null}</WorkGroupView>;
    };
    events.push({ ...base(), source: 'user', type: 'user_prompt', text: 'Read an article' });
    request('nav', 'browser_navigate', { url: 'https://name:password@keengamer.com/a?token=private' });
    const { rerender } = render(view());
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Opening keengamer.com');
    result('nav');
    request('wrapper', 'execute', { code: 'internal source' });
    events.push({ ...base(), source: 'model', type: 'reasoning_message', content: 'internal thought' });
    rerender(view());
    expect(status).toHaveTextContent('Opened keengamer.com');
    request('back', 'browser_history', { action: 'back' });
    rerender(view());
    expect(status).toHaveTextContent('Going back to the previous page');
    result('back');
    result('wrapper');
    rerender(view());
    expect(status).toHaveTextContent('Returned to the previous page');
    expect(status).not.toHaveTextContent(/password|private|internal/);
    events.push({ ...base(), source: 'model', type: 'assistant_message', stopReason: 'tool_use', content: 'I’m checking the article title.' });
    rerender(view());
    expect(status).toBe(screen.getByRole('status'));
    expect(status).toHaveTextContent('I’m checking the article title.');
    request('finish', 'execute', { code: 'internal source' });
    rerender(view());
    expect(status).toHaveTextContent('I’m checking the article title.');
    request('inspect', 'browser_session', { action: { kind: 'html' } });
    rerender(view());
    expect(status).toHaveTextContent('Inspecting the page');
    result('inspect');
    rerender(view());
    expect(status).toHaveTextContent('Inspected the page');
  });

  it('updates one disclosure through alternating thoughts, browser tools and a failed attempt', () => {
    const events: MoxxyEvent[] = [];
    const base = () => ({
      id: asEventId(String(events.length)), seq: events.length, ts: events.length * 1000,
      sessionId: asSessionId('browser'), turnId: asTurnId('lookup'),
    });
    const active = () => {
      const nodes = transcriptNodes(buildRenderNodes(events, [], undefined, new Map([
        ['browser_snapshot', { verb: 'Reading', noun: { one: 'page', other: 'pages' } }],
      ])), { notes: new Map(), outcomes: new Map() }, true);
      const group = nodes.at(-1);
      if (group?.kind !== 'work') throw new Error('missing work row');
      return <WorkGroupView key={group.id} group={group}>{() => <p>Technical history</p>}</WorkGroupView>;
    };
    events.push({ ...base(), source: 'user', type: 'user_prompt', text: 'Find the article' });
    events.push({ ...base(), source: 'model', type: 'reasoning_message', content: 'Find the tab' });
    const { rerender } = render(active());
    const header = screen.getByRole('button', { name: /Thinking/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(header);
    events.push({ ...base(), source: 'model', type: 'tool_call_requested', callId: asToolCallId('a'), name: 'execute', input: { code: 'return browser.click()' } });
    events.push({ ...base(), source: 'tool', type: 'tool_result', callId: asToolCallId('a'), ok: false, output: 'Missing link' });
    events.push({ ...base(), source: 'model', type: 'tool_call_requested', callId: asToolCallId('b'), name: 'browser_snapshot', input: {} });
    rerender(active());
    expect(screen.getByRole('button', { name: /Reading 1 page.*1 failed.*3 steps/ })).toBe(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Reading 1 page');
    expect(header).not.toHaveTextContent('return browser');
    expect(screen.getByText('Technical history')).toBeVisible();
  });

  it('shows the working face during a retry and exposes unsuccessful attempts only in the history', () => {
    const base = { sessionId: asSessionId('retry'), turnId: asTurnId('visit'), seq: 0, ts: 0 };
    const request = { ...base, id: asEventId('click'), callId: asToolCallId('link'), type: 'tool_call_requested' as const,
      source: 'model' as const, name: 'browser_click', input: { element: 'Article link' } };
    const failure = { ...base, id: asEventId('failed'), callId: request.callId, type: 'tool_result' as const,
      source: 'tool' as const, ok: false, output: 'Link moved' };
    const attempt = { kind: 'tool-call' as const, id: 'click', request, outcome: failure };
    const retry = { ...attempt, id: 'retry', request: { ...request, callId: asToolCallId('retry') }, outcome: null };
    const view = (work: WorkNode) => <WorkGroupView group={work}>
      {() => work.nodes.map(node => {
        if (node.kind !== 'block' || node.block.kind !== 'tool-call') return null;
        const call = node.block;
        return <ToolBlock key={call.id} name={call.request.name} input={call.request.input} outcome={call.outcome} />;
      })}
    </WorkGroupView>;
    const first = group({ active: true, steps: 1, nodes: [{ kind: 'block', block: attempt }] });
    const { rerender } = render(view(first));
    const header = screen.getByRole('button', { expanded: false });
    expect(header).not.toHaveTextContent(/fail|steps?|calls?|clicked/i);
    const face = header.querySelector('img[src$="moxxy-mark-eyeless.png"]');
    expect(face).toBeVisible();
    expect(face?.closest('[aria-hidden="true"]')).not.toBeNull();
    rerender(view({ ...first, nodes: [...first.nodes, { kind: 'block', block: retry }], steps: 2 }));
    expect(header).toHaveTextContent('Clicking Article link');
    expect(header.querySelector('img')).toBe(face);
    fireEvent.click(header);
    expect(screen.getByRole('button', { name: /browser.click.*failed/i })).toBeVisible();
    fireEvent.click(header);
    const success = { ...retry, outcome: { ...failure, callId: retry.request.callId, ok: true, output: 'Article opened' } };
    rerender(view(group({ steps: 2, nodes: [...first.nodes, { kind: 'block', block: success }] })));
    expect(header).not.toHaveTextContent(/fail|steps?|calls?/i);
    expect(header.querySelector('img')).toBeNull();
    fireEvent.click(header);
    expect(header).toHaveTextContent('1 failed');
    expect(header).toHaveTextContent('2 steps');
    const failed = screen.getByRole('button', { name: /browser.click.*failed/i });
    fireEvent.click(failed);
    expect(screen.getByText('Link moved')).toBeVisible();
    const succeeded = screen.getByRole('button', { name: /Ran browser_click/i });
    fireEvent.click(succeeded);
    expect(screen.getByText('Article opened')).toBeVisible();
  });

  it('shows the work folded, and all of it when opened', () => {
    render(
      <WorkGroupView group={group()}>
        {() => <p>Found it in server.ts.</p>}
      </WorkGroupView>,
    );
    const header = screen.getByRole('button', { name: /Worked for 4m 12s/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(header).not.toHaveTextContent('12 steps');
    expect(screen.queryByText('Found it in server.ts.')).toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Found it in server.ts.')).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByText('Found it in server.ts.')).toBeNull();
  });
});
