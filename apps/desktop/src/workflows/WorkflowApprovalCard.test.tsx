import { expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkflowApprovalCard } from './WorkflowApprovalCard';

it('shows the exact workflow and action, and emits only the selected scoped decision', () => {
  const decisions: string[] = [];
  render(<WorkflowApprovalCard item={{ id: 'test', workflowId: 'wf', workflowName: 'Daily report', revision: 'r1', runId: 'run1', tool: 'Write', input: { path: 'report.txt' }, createdAt: 1, status: 'pending' }}
    busy={false} onDecide={choice => decisions.push(choice)} onRevoke={() => decisions.push('revoke')} />);
  expect(screen.getByText('Daily report')).toBeTruthy();
  expect(screen.getByText(/report.txt/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
  expect(decisions).toEqual(['allow_once']);
  expect(screen.getByRole('button', { name: 'Allow always for this workflow' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
});
