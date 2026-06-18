import { asset } from '@/lib/asset';
export function EmptyState({ ready }: { readonly ready: boolean }): JSX.Element {
  return (
    <div
      style={{
        flex: 1,
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div>
        <img
          src={asset('logo.png')}
          alt=""
          aria-hidden="true"
          className={ready ? '' : 'moxxy-avatar-loader'}
          style={{
            width: 200,
            height: 'auto',
            display: 'block',
            margin: '0 auto 20px',
          }}
        />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
          {ready ? 'Ready when you are' : 'Getting your workspace ready…'}
        </h2>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-dim)', fontSize: 13.5 }}>
          {ready
            ? 'Send a message to kick off this workspace.'
            : 'Hang tight — this only takes a moment.'}
        </p>
      </div>
    </div>
  );
}
