import { Icon } from '@moxxy/desktop-ui';

/** "Offline · on-device" shield pill — shown on an offline app's gallery card
 *  and in its header so the guarantee is visible at the point of use. */
export function OfflineBadge(): JSX.Element {
  return (
    <span
      title="Runs entirely on your machine — nothing is uploaded"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--color-green)',
        background: 'color-mix(in oklab, var(--color-green) 14%, transparent)',
        border: '1px solid color-mix(in oklab, var(--color-green) 35%, transparent)',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon name="lock" size={12} />
      Offline · on-device
    </span>
  );
}
