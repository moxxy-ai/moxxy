import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { PreferencesTab } from './PreferencesTab';

afterEach(() => __setApiOverride(null));

describe('PreferencesTab', () => {
  it('leaves the Voice Mode engine to Settings → Voice', () => {
    // Desktop IPC to the main process is the one boundary stood in here.
    __setApiOverride({
      invoke: (async () => undefined) as never,
      subscribe: (() => () => undefined) as never,
    } as never);

    render(<PreferencesTab />);

    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.queryByTestId('voice-engine-local')).toBeNull();
    expect(screen.queryByText('Voice engine')).toBeNull();
  });
});
