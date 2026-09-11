import { z } from 'zod';

export const computerControlStateSchema = z.enum([
  'idle', 'background', 'foreground', 'waiting_for_focus',
  'paused_by_user', 'recovering', 'stopped', 'failed',
]);
const identity = z.string().min(1).max(160);
export const computerControlOwnerSchema = z.object({ sessionId: identity, turnId: identity }).strict();
export const computerControlCommandSchema = computerControlOwnerSchema.extend({
  command: z.enum(['pause', 'resume', 'stop']),
}).strict();
export const computerControlSnapshotSchema = computerControlOwnerSchema.extend({
  state: computerControlStateSchema,
  windowId: identity.nullable(),
}).strict();

export type ComputerControlState = z.infer<typeof computerControlStateSchema>;
export type ComputerControlCommand = z.infer<typeof computerControlCommandSchema>;
export type ComputerControlSnapshot = z.infer<typeof computerControlSnapshotSchema>;
export interface ComputerControlService {
  /** Empty when this session has no live Computer Use turn. */
  snapshot(): Promise<ReadonlyArray<ComputerControlSnapshot>>;
  /** Human control only: never starts a helper or grants tool permission. */
  control(command: ComputerControlCommand): Promise<void>;
}
