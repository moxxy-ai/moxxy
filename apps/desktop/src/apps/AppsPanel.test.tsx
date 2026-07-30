import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { AppsPanel } from './AppsPanel';

/**
 * Apps is the installable-app gallery and NOTHING else.
 *
 * It used to carry Channels / Workflows / Schedules / Webhooks as sub-nav chips.
 * Once those became their own rail destinations the same surfaces were reachable
 * from two places at once, which is the defect this pins shut: a chip reappearing
 * here would mean the IA had quietly grown a second door.
 */

function installApi(): void {
  __setApiOverride({
    invoke: vi.fn(async () => ({})),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
}

afterEach(() => __setApiOverride(null));

describe('AppsPanel', () => {
  it('shows the gallery', () => {
    installApi();
    render(<AppsPanel />);
    // Either the registered apps or the empty state — what matters is that the
    // gallery is what this destination renders.
    const hasCards = screen.queryAllByRole('listitem').length > 0;
    const isEmpty = screen.queryByText('No apps available.') !== null;
    expect(hasCards || isEmpty).toBe(true);
  });

  it('carries no automation or channel sub-nav', () => {
    installApi();
    render(<AppsPanel />);
    for (const gone of ['channels', 'workflows', 'schedules', 'webhooks']) {
      expect(
        screen.queryByTestId(`apps-tab-${gone}`),
        `Apps grew a second door to ${gone}`,
      ).toBeNull();
    }
  });
});
