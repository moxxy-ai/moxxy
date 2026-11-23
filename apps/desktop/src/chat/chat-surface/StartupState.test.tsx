import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { EmptyState } from './EmptyState';
import { ChatLoading } from './ChatLoading';

it('announces the current activity once and clears it as soon as the chat is ready', () => {
  const { rerender } = render(<EmptyState ready={false} />);
  expect(screen.getByRole('status')).toHaveTextContent('Getting your workspace ready');
  expect(screen.queryByText(/only takes a moment/i)).toBeNull();
  rerender(<EmptyState ready />);
  expect(screen.queryByRole('status')).toBeNull();
  rerender(<ChatLoading />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading conversation');
});
