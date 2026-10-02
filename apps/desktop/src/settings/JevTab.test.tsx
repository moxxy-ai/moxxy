import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { JevTab } from './JevTab';

// Desktop IPC to the main process is the one boundary stood in here: a vault in memory.
function installVault(initial: ReadonlyArray<string> = []) {
  const names = new Set(initial);
  const invoke = vi.fn(async (command: string, args?: { name: string }) => {
    if (command === 'settings.vaultEntries') return [...names].map((name) => ({ name }));
    if (command === 'settings.vaultSet' && args) names.add(args.name);
    if (command === 'settings.vaultDelete' && args) names.delete(args.name);
    return undefined;
  });
  __setApiOverride({ invoke, subscribe: () => () => undefined } as never);
  return invoke;
}

afterEach(() => __setApiOverride(null));

describe('JevTab', () => {
  it('takes a key on a fresh install and turns Jev on', async () => {
    const invoke = installVault();
    render(<JevTab />);

    const toggle = await screen.findByRole('switch', { name: 'Use Jev in Computer Use' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/TypeSafe API key/u), { target: { value: 'test-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.vaultSet', { name: 'TYPESAFE_API_KEY', value: 'test-key' }));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Change key' })).toBeTruthy();
    expect(screen.queryByLabelText(/TypeSafe API key/u)).toBeNull();
  });

  it('switches Jev off without touching the stored key', async () => {
    const invoke = installVault(['TYPESAFE_API_KEY']);
    render(<JevTab />);

    const toggle = await screen.findByRole('switch', { name: 'Use Jev in Computer Use' });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    fireEvent.click(toggle);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.vaultSet', { name: 'JEV_DISABLED', value: '1' }));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
    expect(invoke).not.toHaveBeenCalledWith('settings.vaultDelete', { name: 'TYPESAFE_API_KEY' });
  });

  it('replaces a stored key through Change key', async () => {
    const invoke = installVault(['TYPESAFE_API_KEY']);
    render(<JevTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Change key' }));
    fireEvent.change(screen.getByLabelText(/TypeSafe API key/u), { target: { value: 'new-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.vaultSet', { name: 'TYPESAFE_API_KEY', value: 'new-key' }));
  });
});
