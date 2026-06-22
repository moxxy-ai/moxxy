import { asset } from '@/lib/asset';

/**
 * Just the pixel-art mark — reused on its own in the collapsed icon rail
 * where there's no room for the wordmark.
 */
export function LogoGlyph({ size = 32 }: { readonly size?: number }): JSX.Element {
  return (
    <img
      src={asset('logo.png')}
      alt="MoxxyAI"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Sidebar masthead — the pixel-art MoxxyAI mark plus the "Workspaces"
 * wordmark stacked beside it. Sits flush at the top of the rail.
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
      <LogoGlyph size={32} />
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
