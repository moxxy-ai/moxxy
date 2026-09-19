import { expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StartupSplash } from './StartupSplash';
import { STARTUP_WAIT_MS } from './useStartupWait';

it('explains a stalled stage without restarting or hiding its diagnostics', async () => {
  expect(STARTUP_WAIT_MS).toBe(30_000);
  const view=render(<StartupSplash stage="runner" message="Starting the runner" delayMs={20} details={<p>Runner is attaching</p>} />);
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('longer than expected'));
  expect(screen.getByText('Runner is attaching')).toBeTruthy();
  expect(screen.queryByRole('button', {name:/restart|stop/i})).toBeNull();
  view.rerender(<StartupSplash stage="extension" message="Loading extension" delayMs={20} />);
  expect(screen.queryByRole('alert')).toBeNull();
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  view.unmount();
});

it('does not reset a stalled stage when unrelated state rerenders', async () => {
  const view=render(<StartupSplash stage="runner" delayMs={10} />);
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  view.rerender(<StartupSplash stage="runner" delayMs={10} details={<p>New diagnostic line</p>} />);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByText('New diagnostic line')).toBeTruthy();
  view.unmount();
});
