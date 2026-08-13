import { MoxxyMark } from '@/components/MoxxyMark';
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
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <MoxxyMark size={200} className={ready ? '' : 'moxxy-avatar-loader'} />
        </div>
        <h2 style={{ margin: 0, fontSize: 'var(--type-section)', fontWeight: 700 }}>
          {ready ? 'Ready when you are' : 'Getting your workspace ready…'}
        </h2>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-dim)', fontSize: 'var(--type-ui)' }}>
          {ready
            ? 'Send a message to kick off this workspace.'
            : 'Hang tight — this only takes a moment.'}
        </p>
      </div>
    </div>
  );
}
