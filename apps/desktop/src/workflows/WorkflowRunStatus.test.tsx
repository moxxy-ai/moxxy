import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { WorkflowRunStatus } from './WorkflowRunStatus';

afterEach(cleanup);
it.each([
  ['cancelled', false, 'Stopped'], ['failed', false, 'Failed'],
  ['paused', true, 'Awaiting input'], ['completed', true, 'Completed'],
  [undefined, false, 'Failed'], [undefined, true, 'Completed'],
] as const)('renders %s without conflating cancellation, failure and completion', (status, ok, label) => {
  render(<WorkflowRunStatus result={{ status, ok }} />);
  expect(screen.getByText(label)).toBeTruthy();
});
