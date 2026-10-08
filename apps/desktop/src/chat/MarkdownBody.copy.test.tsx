import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownBody } from './MarkdownBody';

/**
 * A quotation, a code block and a table are the parts of a message someone
 * takes somewhere else, so each can be copied on its own. The system clipboard
 * is the one thing replaced: jsdom has none.
 */

const writeText = vi.fn(async (_text: string) => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});
afterEach(cleanup);

const MESSAGE = [
  'A paragraph of the answer.',
  '',
  '- a list item',
  '',
  '> The third query timed out.',
  '',
  '```ts',
  'export const radius = 4;',
  '```',
  '',
  '| Suite | Tests |',
  '|---|---|',
  '| contrast | 68 |',
].join('\n');

describe('MarkdownBody — copying a block', () => {
  it('offers a copy control on a quotation, a code block and a table', () => {
    render(<MarkdownBody text={MESSAGE} streaming={false} />);
    expect(screen.getByRole('button', { name: 'Copy quote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy table' })).toBeInTheDocument();
    // Running text is copied with the whole message, under it.
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('copies only that block, and says so', async () => {
    render(<MarkdownBody text={MESSAGE} streaming={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy quote' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('The third query timed out.'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toHaveAttribute('data-copied', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('export const radius = 4;'));

    fireEvent.click(screen.getByRole('button', { name: 'Copy table' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Suite\tTests\ncontrast\t68'));
  });

  it('keeps the control out of what is copied and out of the block’s own box', () => {
    const { container } = render(<MarkdownBody text={MESSAGE} streaming={false} />);
    for (const block of container.querySelectorAll('.md-block')) {
      const control = block.querySelector('.md-block__copy');
      expect(control?.parentElement).toBe(block);
      expect(block.firstElementChild?.contains(control)).toBe(false);
    }
  });
});
