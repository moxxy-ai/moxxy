import type { VoiceOperationKind } from '@moxxy/client-core';
import { Icon, type IconName } from '@moxxy/desktop-ui';
import type { VoiceOrbitView } from './voice-orbit';

const ICONS: Readonly<Record<VoiceOperationKind, IconName>> = Object.freeze({
  'web-search': 'search',
  'project-read': 'file',
  editing: 'pencil',
  verification: 'check',
  command: 'terminal',
  application: 'globe',
  delegation: 'agent',
  generic: 'wrench',
});

function stateLabel(state: VoiceOrbitView['items'][number]['state']): string {
  if (state === 'succeeded') return 'Completed';
  if (state === 'failed') return 'Failed';
  if (state === 'cancelled') return 'Cancelled';
  return 'In progress';
}

export function VoiceActiveOrbit({ orbit }: { readonly orbit: VoiceOrbitView }): JSX.Element {
  return (
    <div className="voice-orbit" aria-label="Current voice operations" aria-live="polite">
      {orbit.items.map((item) => (
        <div
          key={item.callId}
          className={`voice-orbit-item voice-orbit-item--slot-${item.slot} is-${item.state}`}
          data-call-id={item.callId}
        >
          <span className="voice-orbit-icon" aria-hidden="true">
            <Icon name={ICONS[item.kind]} size={15} />
          </span>
          <span className="voice-orbit-copy">
            <strong>{item.label}</strong>
            <small>{stateLabel(item.state)}</small>
          </span>
        </div>
      ))}
      {orbit.overflowCount > 0 && (
        <span className="voice-orbit-overflow">+{orbit.overflowCount} active</span>
      )}
    </div>
  );
}
