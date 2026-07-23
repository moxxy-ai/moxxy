import type { VoiceToolActivity } from '@moxxy/client-core';
import { Icon, type IconName } from '@moxxy/desktop-ui';

const ACTIVITY_VIEW: Readonly<Record<VoiceToolActivity, {
  readonly icon: IconName;
  readonly label: string;
}>> = Object.freeze({
  research: { icon: 'search', label: 'Checking information' },
  editing: { icon: 'pencil', label: 'Writing changes' },
  command: { icon: 'terminal', label: 'Running commands' },
  verification: { icon: 'check', label: 'Checking the result' },
  application: { icon: 'globe', label: 'Working in the app' },
  generic: { icon: 'wrench', label: 'Working on your request' },
});

/** Presentational reflection of the safe activity category produced by the hook. */
export function VoiceActivityIndicator({
  activity,
}: {
  readonly activity: VoiceToolActivity;
}): JSX.Element {
  const view = ACTIVITY_VIEW[activity];
  return (
    <div className="voice-call-activity" aria-label="Current activity">
      <div className="voice-call-activity-panel">
        <span className="voice-call-activity-icon" aria-hidden="true">
          <Icon name={view.icon} size={17} />
        </span>
        <span className="voice-call-activity-copy">
          <strong>{view.label}</strong>
          <small>In progress</small>
        </span>
        <span className="voice-call-activity-flow" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </div>
    </div>
  );
}
