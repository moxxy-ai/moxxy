import { z } from 'zod';

/** Why an action did not go through, with the model's next step. One table for every platform. */
const hints = {
  app_not_allowed: 'Ask for this app with computer_request_access, or finish the task without it.',
  app_not_found: 'Check the name with computer_list_apps and use the bundle identifier or app id it returns.',
  ambiguous_app: 'Several apps match that name; pick one id from computer_list_apps.',
  tier_insufficient: 'The grant for this app does not allow this action; ask the user for a higher level with computer_request_access or use a read-only path.',
  permissions_not_granted: 'The operating system has not granted Accessibility or Screen Recording; ask the user to allow it in System Settings, then try again.',
  permissions_pending: 'The user has not answered the permission prompt yet; wait for the answer before acting.',
  user_stopped: 'The user stopped Computer Use; do not act again until they ask.',
  user_intervened: 'The user took over the mouse or keyboard; the action was paused. Observe again once they resume.',
  screen_locked: 'The screen is locked; ask the user to unlock it.',
  not_frontmost: 'Another app came to the front; call computer_get_app_state for the target app and retry only if it is still needed.',
  target_blocked: 'A dialog or sheet covers the target; handle it first, based on a fresh computer_get_app_state.',
  hit_test_mismatch: 'Something else is at that point now; call computer_get_app_state and target by element_index.',
  point_outside_frame: 'Use coordinates inside the latest screenshot of this window.',
  screen_changed: 'The pixels at the target changed since the last screenshot; call computer_get_app_state before clicking.',
  stale_state: 'That index or point belongs to an older state; call computer_get_app_state and use its indices.',
  no_state: 'Call computer_get_app_state for this app first; actions use its indices and screenshot coordinates.',
  unsupported_action: 'This element does not support that action; use an action listed for it or click by coordinates.',
  canvas: 'The point is on a canvas without accessibility; use computer_mouse, computer_drag or keyboard shortcuts on the screenshot coordinates.',
  would_replace_content: 'Typing would replace the whole field; select the insertion point first or confirm with the user.',
  system_key_combo: 'System key combinations need the systemKeyCombos grant from computer_request_access.',
  clipboard_not_granted: 'Clipboard access needs the clipboardRead or clipboardWrite grant from computer_request_access.',
  own_window: 'That target belongs to Moxxy itself; act only on the granted app.',
  protected_path: 'A save dialog points at a protected location; choose a different folder or ask the user.',
  no_progress: 'The same action left the app unchanged twice; try another method (element action, keyboard shortcut, menu or coordinates).',
  invalid_key: 'Use xdotool key syntax such as "Return", "Tab", "super+c", "ctrl+shift+Tab", "Page_Down" or "KP_0".',
  timeout: 'The app did not respond in time; the action was not retried. Observe again before deciding.',
  helper_failed: 'The native helper stopped; the action was not retried. Observe again with a new connection.',
} as const;

export type ErrorCode = keyof typeof hints;
export const errorCodes = Object.keys(hints) as ErrorCode[];
const errorCodeSchema = z.enum(errorCodes as [ErrorCode, ...ErrorCode[]]);

export function hintFor(code: ErrorCode): string {
  return hints[code];
}

/** Technical result of one action; `delivered` means sent, never verified. */
export const actionResultSchema = z.object({
  outcome: z.enum(['delivered', 'ineffective', 'unsupported', 'blocked']),
  code: errorCodeSchema.optional(),
  hint: z.string().max(1000).optional(),
  method: z.enum(['ax', 'input']).optional(),
}).strict();
export type ActionResult = z.infer<typeof actionResultSchema>;

export function describeResult(result: ActionResult): string {
  if (result.outcome === 'delivered') return 'Action delivered; verify its effect in the new state before relying on it.';
  const hint = result.hint ?? (result.code ? hintFor(result.code) : undefined);
  return [`Action ${result.outcome}${result.code ? ` (${result.code})` : ''}.`, hint].filter(Boolean).join(' ');
}

export class ComputerUseError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(`${message}. ${hintFor(code)}`);
    this.name = 'ComputerUseError';
    this.code = code;
  }
}
