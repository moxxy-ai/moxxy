export interface WorkflowApprovalScope {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly revision: string;
  readonly runId: string;
}

export type WorkflowApprovalChoice = 'allow_once' | 'allow_always' | 'deny';
export interface WorkflowApprovalItem extends WorkflowApprovalScope {
  readonly id: string;
  readonly tool: string;
  readonly input: unknown;
  readonly createdAt: number;
  readonly status: 'pending' | 'allowed' | 'denied' | 'cancelled' | 'interrupted' | 'revoked';
  readonly choice?: WorkflowApprovalChoice;
}

export interface WorkflowApprovalsView {
  list(): Promise<ReadonlyArray<WorkflowApprovalItem>>;
  decide(id: string, choice: WorkflowApprovalChoice): Promise<void>;
  revoke(id: string): Promise<void>;
  cancel(id: string): Promise<void>;
}
import { z } from 'zod';

export const workflowApprovalItemSchema = z
  .object({
    id: z.string().uuid(),
    workflowId: z.string().min(1),
    workflowName: z.string().min(1),
    revision: z.string().min(1),
    runId: z.string().min(1),
    tool: z.string().min(1),
    input: z.unknown(),
    createdAt: z.number().finite().positive(),
    status: z.enum(['pending', 'allowed', 'denied', 'cancelled', 'interrupted', 'revoked']),
    choice: z.enum(['allow_once', 'allow_always', 'deny']).optional(),
  })
  .strict()
  .transform((item) => ({ ...item, input: item.input }));
export const workflowApprovalItemsSchema = z.array(workflowApprovalItemSchema);
