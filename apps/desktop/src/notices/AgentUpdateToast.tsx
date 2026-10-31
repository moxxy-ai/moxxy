import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import type { AgentCliNoticeView } from '../chat/useAgentCliNotice';
import { AgentMark } from './AgentMark';

/**
 * One agent's card: who it is about, where it stands, and the one thing to
 * do. Pressing Update turns the same card into its progress, so nothing jumps.
 * Render-only; `useAgentCliNotices` holds the state.
 */
export function AgentUpdateToast({ notice }: { readonly notice: AgentCliNoticeView }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const verb = notice.notice.action === 'install' ? 'Install' : 'Update';
  const percent = notice.fraction === null ? null : Math.round(notice.fraction * 100);
  return (
    <div
      className="toast agent-update"
      data-testid="agent-update-toast"
      data-provider={notice.notice.provider}
      data-failed={notice.failed ? 'true' : undefined}
      title={notice.notice.text}
    >
      <AgentMark provider={notice.notice.provider} name={notice.agentName} />
      <div className="agent-update__main">
        <span className="toast__title">{notice.title}</span>
        <span className="agent-update__detail" data-expanded={expanded ? 'true' : undefined}>
          {notice.detail}
        </span>
        {notice.failed && notice.detail.length > 120 && (
          <button type="button" className="agent-update__more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
        {notice.running && (
          <div className="agent-update__progress">
            <div className="setup-progress" data-indeterminate={percent === null ? 'true' : undefined}>
              <div className="setup-progress__fill" style={percent === null ? undefined : { transform: `scaleX(${notice.fraction ?? 0})` }} />
            </div>
            {percent !== null && <span className="agent-update__percent">{percent}%</span>}
          </div>
        )}
      </div>
      {!notice.running && notice.fix && (
        <button type="button" className="agent-update__fix" aria-label={`${verb} ${notice.agentName}`} onClick={notice.fix}>
          {notice.failed ? 'Try again' : verb}
        </button>
      )}
      {notice.dismiss && !notice.running && (
        <button type="button" aria-label="Close" className="toast__dismiss agent-update__close" data-tip="Hide until a newer version" onClick={notice.dismiss}>
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}
