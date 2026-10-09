import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { BrowserPane } from './BrowserPane';

/**
 * In a file of its own: React reports a state update made while another
 * component renders once per pair of components, so a pane rendered earlier in
 * the same file would have used the report up.
 */

afterEach(() => {
  cleanup();
  __setApiOverride(null as never);
});

it('tells the address bar which page is in front after the render, never during it', async () => {
  // The IPC boundary: there is no Electron main here.
  __setApiOverride({
    invoke: (() => Promise.resolve(undefined)) as never,
    subscribe: (() => () => undefined) as never,
  } as never);
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  render(<BrowserPane workspaceId="w1" />);

  expect(await screen.findByDisplayValue('google.com')).toBeTruthy();
  const duringRender = errors.mock.calls
    .map(([line]) => String(line))
    .filter((line) => line.includes('Cannot update a component'));
  expect(duringRender).toEqual([]);
});
