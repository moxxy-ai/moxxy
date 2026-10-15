import { BlinkingMoxxyMark } from '@/components/BlinkingMoxxyMark';
/**
 * Sidebar masthead: the blinking mark plus a one-line MoxxyAI wordmark, flush
 * at the top of the dark rail.
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
      <BlinkingMoxxyMark size={32} />
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
