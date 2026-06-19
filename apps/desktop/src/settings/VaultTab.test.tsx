/**
 * VaultTab tests — deleting an encrypted secret is irreversible and other
 * providers/MCP servers may depend on it, so a single trash click must NOT
 * drop the key. It routes through a destructive ConfirmModal: onRemove fires
 * only after the user confirms, and never when they cancel.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { VaultTab } from './VaultTab';

function renderVault(): { onRemove: ReturnType<typeof vi.fn> } {
  const onRemove = vi.fn(() => Promise.resolve());
  render(
    <VaultTab
      vault={[{ name: 'OPENAI_API_KEY' }]}
      onAdd={() => Promise.resolve()}
      onRemove={onRemove}
    />,
  );
  return { onRemove };
}

describe('VaultTab deletion', () => {
  it('does not delete on the first trash click — it asks for confirmation', () => {
    const { onRemove } = renderVault();
    fireEvent.click(screen.getByRole('button', { name: /delete openai_api_key/i }));
    // The destructive confirm dialog is up; nothing deleted yet.
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /delete key/i })).toBeTruthy();
  });

  it('deletes only after the user confirms', () => {
    const { onRemove } = renderVault();
    fireEvent.click(screen.getByRole('button', { name: /delete openai_api_key/i }));
    // The confirm button lives inside the dialog (its accessible name is the
    // label text "Delete", not the trash icon's "Delete OPENAI_API_KEY").
    const dialog = screen.getByRole('dialog', { name: /delete key/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    expect(onRemove).toHaveBeenCalledWith('OPENAI_API_KEY');
  });

  it('does not delete when the user cancels', () => {
    const { onRemove } = renderVault();
    fireEvent.click(screen.getByRole('button', { name: /delete openai_api_key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: /delete key/i })).toBeNull();
  });
});
