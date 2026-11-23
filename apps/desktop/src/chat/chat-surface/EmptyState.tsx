import { MoxxyMark } from '@/components/MoxxyMark';
import { ChatLoading } from './ChatLoading';

export function EmptyState({ ready }: { readonly ready: boolean }): JSX.Element {
  if (!ready) return <ChatLoading label="Getting your workspace ready…" />;
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
          <MoxxyMark size={200} />
        </div>
        <h2 style={{ margin: 0, fontSize: 'var(--type-section)', fontWeight: 700 }}>
          Ready when you are
        </h2>
        <p style={{ margin: '6px 0 0', color: 'var(--color-text-dim)', fontSize: 'var(--type-ui)' }}>
          Send a message to kick off this workspace.
        </p>
      </div>
    </div>
  );
}
