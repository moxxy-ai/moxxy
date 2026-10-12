import { accountLimitText } from '@moxxy/chat-model';
import type { AccountLimitView } from '../useAccountLimit';

/** The agent's account limit above the message box: used up until it resets, or nearly used up. */
export function AccountLimitBar({ limit, nowMs }: AccountLimitView): JSX.Element {
  return (
    <div className="account-limit" data-testid="composer-account-limit" data-state={limit.limit.state} role="status">
      {accountLimitText(limit, nowMs)}
    </div>
  );
}
