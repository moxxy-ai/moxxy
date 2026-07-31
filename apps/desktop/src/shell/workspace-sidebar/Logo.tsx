import { MoxxyMark } from '@/components/MoxxyMark';
/**
 * Sidebar masthead: the mark plus a one-line MoxxyAI wordmark. Sits flush at
 * the top of the dark rail, so the mark's ink strand picks up the rail's own
 * text colour.
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
      <span
        style={{
          fontFamily: 'var(--font-prose)',
          fontSize: 'var(--type-ui)',
          fontWeight: 700,
          lineHeight: 1,
          letterSpacing: '-0.04em',
        }}
      >
        MoxxyAI
      </span>
    </div>
  );
}
