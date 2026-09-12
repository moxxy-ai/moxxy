import { expect, it } from 'vitest';
import { workflowApprovalItemsSchema } from './workflow-approval.js';

it('validates approval results at remote boundaries without changing the displayed scope', () => {
  const item = { id: '07a3ed71-ebc0-458f-acb0-9db5a5636632', workflowId: 'workflow', workflowName: 'Test',
    revision: 'revision', runId: 'run', tool: 'Write', input: { path: 'test.txt' }, createdAt: 100, status: 'pending' };
  expect(workflowApprovalItemsSchema.parse([item])).toEqual([item]);
  expect(() => workflowApprovalItemsSchema.parse([{ ...item, status: 'approved-by-default' }])).toThrow();
  expect(() => workflowApprovalItemsSchema.parse([{ ...item, id: '../another' }])).toThrow();
  expect(() => workflowApprovalItemsSchema.parse([{ ...item, createdAt: 0 }])).toThrow();
  expect(() => workflowApprovalItemsSchema.parse([{ ...item, admin: true }])).toThrow();
});
