import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScheduleHistory } from './ScheduleHistory';

it('shows the skipped occurrence and its reason separately from the last completed result', () => {
  render(<ScheduleHistory schedule={{ source: 'workflow', workflowName: 'Daily report',
    lastResult: 'ok', lastSkippedAt: 1_800_000_000_000,
    lastSkipReason: 'Previous workflow execution is still running or awaiting approval' }} />);
  expect(screen.getByText(/workflow · Daily report · last ok/)).toBeTruthy();
  expect(screen.getByText(/Skipped occurrence/)).toBeTruthy();
  expect(screen.getByText(/still running or awaiting approval/)).toBeTruthy();
});

it('does not invent skipped occurrences for older schedule summaries', () => {
  render(<ScheduleHistory schedule={{ source: 'manual', lastResult: null }} />);
  expect(screen.getByText('manual')).toBeTruthy();
  expect(screen.queryByText(/Skipped occurrence/)).toBeNull();
});
