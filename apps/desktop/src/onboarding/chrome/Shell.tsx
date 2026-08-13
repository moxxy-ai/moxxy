/**
 * The onboarding wizard Shell — the fixed two-column frame (the step rail on the
 * left + a scrolling content pane on the right) that wraps whichever step is
 * current. Stateless: it renders the passed step list, highlights
 * `currentIndex`, and slots `children` into the pane.
 *
 * It is the app's index column, one screen early: the same sidebar ground, the
 * same `index-group` micro-label, the same rows, and the same commanded strap
 * marking where you are. First run is the first thing a person sees, so it has to
 * teach the frame they are about to work in rather than be its own soft-cornered
 * wizard.
 */

import { MoxxyMark } from '@/components/MoxxyMark';
import { Icon } from '@moxxy/desktop-ui';

const SURFACE = 'var(--color-main-bg)';

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
        gridTemplateColumns: 'var(--frame-index) 1fr',
        overflow: 'hidden',
      }}
    >
      <aside
        style={{
          background: 'var(--color-sidebar-bg)',
          borderRight: '1px solid var(--color-card-border)',
          padding: 'var(--space-12) var(--space-8) var(--space-16)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-12)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-8)',
            padding: '0 var(--space-6)',
            height: 'var(--frame-bar)',
          }}
        >
          <MoxxyMark size={22} />
          <span
            style={{
              fontFamily: 'var(--font-chrome)',
              fontSize: 'var(--type-row)',
              fontWeight: 600,
              letterSpacing: '0.04em',
            }}
          >
            moxxy
          </span>
          <span
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-chrome)',
              fontSize: 'var(--type-label)',
              color: 'var(--color-text-dim)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {idx + 1}/{steps.length}
          </span>
        </header>
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
          <li className="index-group">
            <span className="index-group__label">setup</span>
          </li>
          {steps.map((s, i) => {
            const done = i < idx;
            const current = i === idx;
            return (
              <li
                key={s.id}
                className="session-row"
                aria-current={current ? 'step' : undefined}
                data-active={current}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-8)',
                  minHeight: 'var(--frame-row)',
                  padding: '2px var(--space-6) 2px var(--space-12)',
                  borderRadius: 'var(--radius-block)',
                  background: current ? 'var(--color-card-bg)' : 'transparent',
                  color: current
                    ? 'var(--color-sidebar-text)'
                    : done
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-dim)',
                  fontWeight: current ? 600 : 400,
                  fontSize: 'var(--type-row)',
                  transition: 'background var(--motion-shift) ease, color var(--motion-shift) ease',
                }}
              >
                {/* Done is state, so it reads as an LED like every other state in
                 *  the app; a step still ahead is just its number. */}
                {done ? (
                  <span className="led" data-state="done" aria-hidden />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 6,
                      textAlign: 'center',
                      flexShrink: 0,
                      fontFamily: 'var(--font-chrome)',
                      fontSize: 'var(--type-label)',
                      color: current ? 'var(--color-primary)' : 'var(--color-text-dim)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {i + 1}
                  </span>
                )}
                {s.label}
              </li>
            );
          })}
        </ol>
        <span style={{ flex: 1 }} />
        <footer
          style={{
            padding: '0 var(--space-6)',
            fontSize: 'var(--type-label)',
            color: 'var(--color-text-dim)',
            lineHeight: 1.5,
          }}
        >
          Revisit anytime from Settings <Icon name="chevron-right" size={9} /> About.
        </footer>
      </aside>
      <main
        style={{
          background: SURFACE,
          display: 'grid',
          placeItems: 'center',
          padding: 'var(--space-32) var(--space-40)',
          overflowY: 'auto',
        }}
      >
        <div style={{ width: '100%', maxWidth: 520 }}>{children}</div>
      </main>
    </div>
  );
}
