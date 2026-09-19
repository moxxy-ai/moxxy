import type { ComputerControlService, PendingToolCall, PermissionContext } from '@moxxy/sdk';
import type { AskResponse } from '@moxxy/desktop-ipc-contract';

const physicalTools = new Set([
  'computer_click',
  'computer_type',
  'computer_type_window',
  'computer_key',
  'computer_scroll',
  'computer_drag',
  'computer_action',
  'computer_select_text',
  'computer_clipboard',
]);

/** Only a human permission round-trip may restore the previously active target. */
export async function withComputerApprovalFocus(
  service: ComputerControlService | undefined,
  sessionId: string,
  call: PendingToolCall,
  context: PermissionContext,
  signal: AbortSignal | undefined,
  ask: () => Promise<AskResponse>,
): Promise<AskResponse> {
  if (
    process.platform !== 'win32' ||
    !service?.approvalFocus ||
    !context.turnId ||
    !physicalTools.has(call.name)
  )
    return ask();
  const input = call.input;
  if (
    !input ||
    typeof input !== 'object' ||
    !('windowId' in input) ||
    typeof input.windowId !== 'string'
  )
    return ask();
  const owner = {
    sessionId,
    turnId: context.turnId,
    windowId: input.windowId,
    callId: String(call.callId),
    hostPid: process.pid,
  };
  let prepared = false;
  try {
    await service.approvalFocus({ ...owner, stage: 'begin', approved: false });
    prepared = true;
  } catch {
    console.warn(
      '[moxxy] Could not prepare permission focus restoration; normal target checks remain active.',
    );
  }
  let response: AskResponse | undefined;
  try {
    response = await ask();
    return response;
  } finally {
    if (prepared) {
      try {
        await service.approvalFocus({
          ...owner,
          stage: 'finish',
          approved: !signal?.aborted && !!response && !!response.mode && response.mode !== 'deny',
        });
      } catch {
        console.warn('[moxxy] Permission focus restoration unavailable; observe the target again.');
      }
    }
  }
}
