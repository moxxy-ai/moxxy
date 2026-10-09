import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import {
  __resetReplySoundForTests,
  setReplySoundPreference,
  useReplySoundPreference,
} from './useReplySoundPreference';

/** Desktop IPC to the main process is the one boundary stood in here. */
function installPrefs(stored: Record<string, unknown>): Array<[string, unknown]> {
  const calls: Array<[string, unknown]> = [];
  __setApiOverride({
    invoke: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return name === 'prefs.read' ? stored : undefined;
    },
    subscribe: () => () => undefined,
  } as never);
  return calls;
}

function Probe(): JSX.Element {
  return <output data-testid="probe">{useReplySoundPreference() ? 'on' : 'off'}</output>;
}

afterEach(() => {
  cleanup();
  __resetReplySoundForTests();
  __setApiOverride(null);
});

describe('useReplySoundPreference', () => {
  it('is on until the stored preference says otherwise', async () => {
    installPrefs({});
    render(<Probe />);

    expect(screen.getByTestId('probe')).toHaveTextContent('on');
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('on'));
  });

  it('reads a stored off', async () => {
    installPrefs({ replySound: false });
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('off'));
  });

  it('switches at once and stores the choice', () => {
    const calls = installPrefs({});
    render(<Probe />);

    act(() => setReplySoundPreference(false));

    expect(screen.getByTestId('probe')).toHaveTextContent('off');
    expect(calls).toContainEqual(['prefs.update', { replySound: false }]);
  });

  it('keeps a choice made before the stored one arrived', async () => {
    installPrefs({ replySound: true });
    render(<Probe />);

    act(() => setReplySoundPreference(false));
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId('probe')).toHaveTextContent('off');
  });
});
