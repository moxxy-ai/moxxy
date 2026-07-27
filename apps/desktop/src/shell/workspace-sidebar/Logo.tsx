import { MoxxyMark } from '@/components/MoxxyMark';
/**
 * Sidebar masthead: the MoxxyAI mark plus the "Workspaces" wordmark stacked
 * beside it. Sits flush at the top of the dark rail, so the mark's ink strand
 * picks up the rail's own text colour.
 */
export function Logo(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '18px 18px 14px',
      }}
    >
      <MoxxyMark size={32} />
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-0.01em' }}>
          MoxxyAI
        </span>
        <span
          style={{
            fontSize: 10.5,
            color: 'var(--color-sidebar-text-dim)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          Workspaces
        </span>
      </div>
    </div>
  );
}
