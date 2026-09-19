import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WorkflowDeleteButton } from './WorkflowDeleteButton';

afterEach(cleanup);
it('requires confirmation, allows cancellation and keeps an error visible', async () => {
  const deleted: string[] = [];
  render(<WorkflowDeleteButton name="daily" remove={async name => { deleted.push(name); return false; }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete daily' }));
  expect(deleted).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(deleted).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Delete daily' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() => expect(deleted).toEqual(['daily']));
  expect(screen.getByRole('dialog')).toBeTruthy();
});
