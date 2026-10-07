import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { CommandPalette, type PalettePlace } from './CommandPalette';

/** ⌘K is the second way to every place in the app; the account menu is the first. */

const PLACES: ReadonlyArray<PalettePlace> = [
  { id: 'chat', label: 'Runs', icon: 'chat', disabled: false },
  { id: 'settings', label: 'Settings', icon: 'settings', disabled: false },
  { id: 'automations', label: 'Automations', icon: 'workflow', disabled: true },
];

beforeEach(() => {
  __setApiOverride({
    invoke: vi.fn(async (command: string) =>
      command === 'session.info'
        ? { commands: [{ name: 'compact', description: 'Compact context' }] }
        : null,
    ),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

function renderPalette(onPlace = vi.fn(), onClose = vi.fn()) {
  render(<CommandPalette workspaceId="ws" places={PLACES} onPlace={onPlace} onClose={onClose} />);
  return { onPlace, onClose, field: screen.getByRole('combobox') };
}

describe('CommandPalette places', () => {
  it('lists the places beside the session actions', async () => {
    renderPalette();
    expect(screen.getByRole('option', { name: /Settings/ })).toBeTruthy();
    expect(await screen.findByRole('option', { name: /Compact/ })).toBeTruthy();
  });

  it('finds a place by typing and goes there on Enter', () => {
    const { field, onPlace, onClose } = renderPalette();
    fireEvent.change(field, { target: { value: 'sett' } });
    expect(screen.queryByRole('option', { name: /Runs/ })).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onPlace).toHaveBeenCalledWith('settings');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('goes there on click', () => {
    const { onPlace } = renderPalette();
    fireEvent.click(screen.getByRole('option', { name: /Runs/ }));
    expect(onPlace).toHaveBeenCalledWith('chat');
  });

  it('shows a locked place but will not go to it', () => {
    const { field, onPlace } = renderPalette();
    fireEvent.change(field, { target: { value: 'autom' } });
    const locked = screen.getByRole('option', { name: /Automations/ });
    expect(locked).toBeDisabled();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('is only actions when it is given no places', async () => {
    render(<CommandPalette workspaceId="ws" onClose={vi.fn()} />);
    expect(await screen.findByRole('option', { name: /Compact/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Settings/ })).toBeNull();
  });
});
