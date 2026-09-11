import { computerControlCommandSchema, computerControlSnapshotSchema, z } from '@moxxy/sdk';
import type { HandlerContext } from './context.js';

export async function handleComputerSnapshot({session}: HandlerContext, raw: unknown) {
  z.object({}).strict().parse(raw);
  const service = session.computerControl;
  if (!service) return [];
  const snapshots = z.array(computerControlSnapshotSchema).max(256).parse(await service.snapshot());
  if (snapshots.some((snapshot) => snapshot.sessionId !== session.id)) throw new Error('Computer Use session mismatch');
  return snapshots;
}

export async function handleComputerControl({session}: HandlerContext, raw: unknown): Promise<void> {
  const command = computerControlCommandSchema.parse(raw);
  if (command.sessionId !== session.id) throw new Error('Computer Use session mismatch');
  const service = session.computerControl;
  if (!service) throw new Error('Computer Use control is not supported by this session');
  await service.control(command);
}
