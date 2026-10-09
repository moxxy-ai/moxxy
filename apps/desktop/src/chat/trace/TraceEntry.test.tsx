import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceEntry, type TraceKind } from './TraceEntry';

/**
 * An entry's kind decides which side of the conversation it sits on. These pin
 * that mapping, and where the label, the time and the actions go for each side.
 */

function entry(kind: TraceKind, props: Partial<Parameters<typeof TraceEntry>[0]> = {}) {
  const { container, unmount } = render(
    <TraceEntry kind={kind} {...props}>
      <p>body</p>
    </TraceEntry>,
  );
  const el = container.querySelector('.tr');
  if (!el) throw new Error(`${kind} did not render an entry`);
  return { el, unmount };
}

describe('TraceEntry', () => {
  it('puts what the person said on their side and the answer on the agent side', () => {
    const user = entry('commanded');
    expect(user.el).toHaveAttribute('data-role', 'user');
    user.unmount();

    const agent = entry('agent');
    expect(agent.el).toHaveAttribute('data-role', 'agent');
  });

  it('reads tool work, reasoning and sub-agents as quiet activity', () => {
    for (const kind of ['tool', 'reasoning', 'subagent', 'diff', 'terminal'] as const) {
      const { el, unmount } = entry(kind);
      expect(el, kind).toHaveAttribute('data-role', 'activity');
      unmount();
    }
  });

  it('reads triggers, stops and errors as notes', () => {
    for (const kind of ['trigger', 'system', 'error'] as const) {
      const { el, unmount } = entry(kind);
      expect(el, kind).toHaveAttribute('data-role', 'note');
      expect(el).toHaveAttribute('data-kind', kind);
      unmount();
    }
  });

  it('draws no timeline gutter', () => {
    const { el } = entry('tool');
    expect(el.querySelector('.tr__gutter')).toBeNull();
    expect(el.querySelector('.tr__glyph')).toBeNull();
  });

  it('heads an entry only when it has a label', () => {
    const bare = entry('error');
    expect(bare.el.querySelector('.tr__hd')).toBeNull();
    bare.unmount();

    entry('error', { label: 'Error', meta: '14:02' });
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('14:02').closest('.tr__hd')).not.toBeNull();
  });

  it('keeps the count of an activity beside its body, where it can always be read', () => {
    const { el } = entry('subagent', { meta: '3 tool calls' });
    expect(screen.getByText('3 tool calls').closest('.tr__hd')).not.toBeNull();
    expect(el.querySelector('.tr__foot')).toBeNull();
  });

  it('puts the time and the actions of a message under it', () => {
    const { el } = entry('agent', { meta: '14:02', actions: <button type="button">Copy</button> });
    const foot = el.querySelector('.tr__foot');
    expect(foot).not.toBeNull();
    expect(foot).toContainElement(screen.getByText('14:02'));
    expect(foot).toContainElement(screen.getByRole('button', { name: 'Copy' }));
    expect(el.querySelector('.tr__hd')).toBeNull();
  });

  it('leaves a message without a time or actions with no footer', () => {
    const { el } = entry('commanded');
    expect(el.querySelector('.tr__foot')).toBeNull();
  });
});
