/**
 * The onboarding wizard Shell — the fixed two-column frame (a calm, near-white
 * step rail on the left + a scrolling content pane on the right) that wraps
 * whichever step is current. Stateless: it renders the passed step list,
 * highlights `currentIndex`, and slots `children` into the pane.
 *
 * The palette matches the splash / loading / chat surfaces (near-white
 * `rgb(252,252,255)`) so first-run feels continuous with the rest of the app.
 */

import { Icon } from '@moxxy/desktop-ui';
import { asset } from '@/lib/asset';

const SURFACE = 'rgb(252, 252, 255)';
const RAIL_BG = 'rgb(248, 248, 252)';

export function Shell({
  steps,
  currentIndex,
  children,
}: {
  readonly steps: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly currentIndex: number;
  readonly children: React.ReactNode;
}): JSX.Element {
  const idx = currentIndex;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: SURFACE,
        display: 'grid',
        gridTemplateColumns: '300px 1fr',
        overflow: 'hidden',
      }}
    >
      <aside
        style={{
          background: RAIL_BG,
          borderRight: '1px solid var(--color-card-border)',
          padding: '28px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img
            src={asset('new-animation.gif')}
            alt=""
            aria-hidden
            style={{ height: 40, width: 'auto', objectFit: 'contain', imageRendering: 'pixelated' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>MoxxyAI</span>
            <span
              style={{
                fontSize: 10.5,
                color: 'var(--color-text-dim)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              Workspaces
            </span>
          </div>
        </header>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>
            Let&rsquo;s get you set up
          </h1>
          <p style={{ margin: '6px 0 0', color: 'var(--color-text-muted)', fontSize: 13, lineHeight: 1.6 }}>
            A few quick steps and your own AI workspace is running locally.
          </p>
        </div>
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {steps.map((s, i) => {
            const done = i < idx;
            const current = i === idx;
            return (
              <li
                key={s.id}
                aria-current={current ? 'step' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background: current ? 'var(--color-primary-soft)' : 'transparent',
                  color: current
                    ? 'var(--color-primary-strong)'
                    : done
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-dim)',
                  fontWeight: current ? 600 : 500,
                  fontSize: 13,
                  transition: 'background 120ms ease, color 120ms ease',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    flexShrink: 0,
                    borderRadius: 999,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: done
                      ? 'var(--color-green)'
                      : current
                        ? 'var(--color-primary)'
                        : 'transparent',
                    border: done || current ? 'none' : '1.5px solid var(--color-card-border-strong)',
                    color: done || current ? '#fff' : 'var(--color-text-dim)',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {done ? <Icon name="check" size={12} /> : i + 1}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>
        <span style={{ flex: 1 }} />
        <footer style={{ fontSize: 11, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
          You can revisit this anytime from Settings → About.
        </footer>
      </aside>
      <main
        style={{
          background: SURFACE,
          display: 'grid',
          placeItems: 'center',
          padding: '32px 40px',
          overflowY: 'auto',
        }}
      >
        <div style={{ width: '100%', maxWidth: 520 }}>{children}</div>
      </main>
    </div>
  );
}
