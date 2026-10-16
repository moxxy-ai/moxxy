import { Icon } from '@moxxy/desktop-ui';
import type { AgentCliNoticeView } from '../useAgentCliNotice';

/**
 * Above the message box while the active agent's CLI is missing, too old, or
 * behind the vendor's latest: the terminal's words, the fix, and — for an
 * update it can live without — a way to close it for that version.
 */
export function AgentCliBar({ notice }: { readonly notice: AgentCliNoticeView }): JSX.Element {
  const verb = notice.notice.action === 'install' ? 'Install' : 'Update';
  const doing = notice.notice.action === 'install' ? 'Installing' : 'Updating';
  return (
    <div className="agent-cli-bar" data-testid="composer-agent-cli" data-severity={notice.notice.severity} role="status">
      <span className="agent-cli-bar__text">
        {notice.running ? (notice.line ?? `${doing} ${notice.agentName}…`) : (notice.error ?? notice.notice.text)}
      </span>
      {!notice.running && (
        <button type="button" className="agent-cli-bar__fix" aria-label={`${verb} ${notice.agentName}`} onClick={notice.fix}>
          {notice.error ? 'Try again' : verb}
        </button>
      )}
      {notice.dismiss && !notice.running && (
        <button type="button" className="btn-quiet agent-cli-bar__close" aria-label="Close" data-tip="Hide until a newer version" onClick={notice.dismiss}>
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}
