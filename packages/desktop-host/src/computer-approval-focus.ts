import type { ComputerControlService, PendingToolCall, PermissionContext } from '@moxxy/sdk';
import type { AskResponse } from '@moxxy/desktop-ipc-contract';

/** Tools whose input goes to the target window, so the window must be in front again after the prompt. */
const physicalTools = new Set([
  'computer_click',
  'computer_type_text',
  'computer_press_key',
  'computer_scroll',
  'computer_drag',
  'computer_perform_secondary_action',
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
    !('app' in input) ||
    typeof input.app !== 'string'
  )
    return ask();
  const owner = {
    sessionId,
    turnId: context.turnId,
    // The helper finds the window it last observed for this app.
    windowId: input.app,
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
