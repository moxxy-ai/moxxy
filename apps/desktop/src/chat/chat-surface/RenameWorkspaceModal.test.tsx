/**
 * A rejected rename (runner down, name conflict, mid-flight disconnect) must
 * not strand the modal in a disabled 'Renaming…' state — it must clear the busy
 * lock, surface the reason, and let the user retry.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { assertDefined } from '@moxxy/sdk';
import { RenameWorkspaceModal } from './RenameWorkspaceModal';

const desk = { id: 'd1', name: 'old name', cwd: '/tmp/work' };

describe('RenameWorkspaceModal — rejected rename', () => {
  it('clears the busy lock and surfaces the error instead of stranding on "Renaming…"', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('name already taken'));
    render(<RenameWorkspaceModal desk={desk} onSubmit={onSubmit} onClose={() => {}} />);

    const input = screen.getByDisplayValue('old name');
    fireEvent.change(input, { target: { value: 'new name' } });
    const submit = screen.getByRole('button', { name: 'Rename' });
    fireEvent.click(submit);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('name already taken'));
    // Button is re-enabled (no longer "Renaming…") so the user can retry.
    expect(screen.getByRole('button', { name: 'Rename' })).not.toBeDisabled();
  });

  it('does not double-submit while a rename is already in flight', async () => {
    let resolve: (() => void) | undefined;
    const onSubmit = vi.fn().mockImplementation(
      () => new Promise<void>((r) => (resolve = r)),
    );
    render(<RenameWorkspaceModal desk={desk} onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByDisplayValue('old name'), { target: { value: 'new name' } });
    const form = screen.getByRole('button', { name: /Renam/ }).closest('form');
    assertDefined(form, 'rename form element');
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    resolve?.();
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
