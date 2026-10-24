import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import {
  __resetInAppToastsForTests,
  setInAppToastsPreference,
  useInAppToastsPreference,
} from './useInAppToastsPreference';

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
  return <output data-testid="probe">{useInAppToastsPreference() ? 'on' : 'off'}</output>;
}

afterEach(() => {
  cleanup();
  __resetInAppToastsForTests();
  __setApiOverride(null);
});

describe('useInAppToastsPreference', () => {
  it('is on for a preferences file written before the switch existed', async () => {
    installPrefs({ systemNotifications: false });
    render(<Probe />);

    await act(async () => undefined);

    expect(screen.getByTestId('probe')).toHaveTextContent('on');
  });

  it('reads a stored off', async () => {
    installPrefs({ inAppToasts: false });
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('off'));
  });

  it('switches at once and stores the choice under its own key', () => {
    const calls = installPrefs({});
    render(<Probe />);

    act(() => setInAppToastsPreference(false));

    expect(screen.getByTestId('probe')).toHaveTextContent('off');
    expect(calls).toContainEqual(['prefs.update', { inAppToasts: false }]);
  });
});
