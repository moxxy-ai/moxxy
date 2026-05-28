import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockView } from './block-view';
import type { Block } from '@/lib/runner-session';

describe('<BlockView />', () => {
  it('renders a user block with the prompt text', () => {
    const block: Block = { id: '1', kind: 'user', text: 'hello' };
    render(<BlockView block={block} />);
    expect(screen.getByTestId('block-user')).toHaveTextContent('hello');
  });

  it('renders a streaming assistant block with a cursor', () => {
    const block: Block = {
      id: '1',
      kind: 'assistant',
      text: 'hi',
      streaming: true,
    };
    render(<BlockView block={block} />);
    const el = screen.getByTestId('block-assistant');
    expect(el).toHaveAttribute('data-streaming', 'true');
    expect(el.querySelector('.streaming-cursor')).not.toBeNull();
  });

  it('renders a finalised assistant block without a cursor', () => {
    const block: Block = {
      id: '1',
      kind: 'assistant',
      text: 'hi',
      streaming: false,
    };
    render(<BlockView block={block} />);
    const el = screen.getByTestId('block-assistant');
    expect(el).toHaveAttribute('data-streaming', 'false');
    expect(el.querySelector('.streaming-cursor')).toBeNull();
  });

  it('renders a tool block with status + summary', () => {
    const block: Block = {
      id: '1',
      kind: 'tool',
      name: 'grep',
      status: 'done',
      summary: '12 matches',
    };
    render(<BlockView block={block} />);
    const el = screen.getByTestId('block-tool');
    expect(el).toHaveAttribute('data-status', 'done');
    expect(el).toHaveTextContent('grep');
    expect(el).toHaveTextContent('12 matches');
  });

  it('omits the summary when not provided', () => {
    const block: Block = {
      id: '1',
      kind: 'tool',
      name: 'grep',
      status: 'running',
    };
    render(<BlockView block={block} />);
    expect(screen.getByTestId('block-tool')).toHaveTextContent('grep');
  });

  it('renders a system block centred', () => {
    const block: Block = {
      id: '1',
      kind: 'system',
      text: 'switched to deep-research mode',
    };
    render(<BlockView block={block} />);
    expect(screen.getByTestId('block-system')).toHaveTextContent(
      'switched to deep-research mode',
    );
  });

  it('renders an error block with role=alert', () => {
    const block: Block = {
      id: '1',
      kind: 'error',
      text: 'provider rate-limited',
    };
    render(<BlockView block={block} />);
    const el = screen.getByTestId('block-error');
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveTextContent('provider rate-limited');
  });
});
