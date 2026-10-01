import { z } from 'zod';

export const computerControlStateSchema = z.enum([
  'idle', 'background', 'foreground', 'waiting_for_focus',
  'paused_by_user', 'recovering', 'stopped', 'failed',
]);
const identity = z.string().min(1).max(160);
export const computerControlOwnerSchema = z.object({ sessionId: identity, turnId: identity }).strict();
/** `takeover` pauses like `pause`, hides the agent cursor and lets go of any held key or button. */
export const computerControlCommandSchema = computerControlOwnerSchema.extend({
  command: z.enum(['pause', 'resume', 'stop', 'takeover']),
}).strict();
/** Where an action is in its life; the cursor overlay and the PiP draw from it. */
export const computerCursorPhaseSchema = z.enum(['idle', 'moving', 'executing', 'delivered', 'failed']);
const fraction = z.number().min(0).max(1);
/** The agent cursor as a fraction of the target window, so any surface can draw it over that window. */
export const computerCursorSchema = z.object({ phase: computerCursorPhaseSchema, x: fraction, y: fraction }).strict();
/** The app and window being operated; the window title is application content shown to the human only. */
export const computerTargetSchema = z.object({ app: identity, window: z.string().max(200).nullable() }).strict();
export const computerControlSnapshotSchema = computerControlOwnerSchema.extend({
  state: computerControlStateSchema,
  windowId: identity.nullable(),
  /** Absent while no cursor is shown (before the first observation, after Stop or a helper failure). */
  cursor: computerCursorSchema.optional(),
  target: computerTargetSchema.optional(),
}).strict();

export type ComputerControlState = z.infer<typeof computerControlStateSchema>;
export type ComputerCursor = z.infer<typeof computerCursorSchema>;
export type ComputerTarget = z.infer<typeof computerTargetSchema>;
export const computerApprovalFocusSchema = computerControlOwnerSchema.extend({
  windowId: identity, callId: identity, hostPid: z.number().int().min(1).max(2147483647),
  stage: z.enum(['begin', 'finish']), approved: z.boolean(),
}).strict();
export type ComputerApprovalFocus = z.infer<typeof computerApprovalFocusSchema>;
export type ComputerControlCommand = z.infer<typeof computerControlCommandSchema>;
export type ComputerControlSnapshot = z.infer<typeof computerControlSnapshotSchema>;
export interface ComputerControlService {
  approvalFocus?(command: ComputerApprovalFocus): Promise<void>;
  /** Empty when this session has no live Computer Use turn. */
  snapshot(): Promise<ReadonlyArray<ComputerControlSnapshot>>;
  /** Human control only: never starts a helper or grants tool permission. */
  control(command: ComputerControlCommand): Promise<void>;
  /** Pushes this session's turns after every change, so surfaces never poll; returns the unsubscribe. */
  subscribe?(listener: (turns: ReadonlyArray<ComputerControlSnapshot>) => void): () => void;
}
