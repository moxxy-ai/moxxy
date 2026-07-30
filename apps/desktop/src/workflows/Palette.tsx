import { STEP_KINDS, type BuilderAction, type StepKind } from '@moxxy/workflows-builder';
import { accentHex } from './accents';

/** The add-node palette: one chip per step kind, color-coded. */
export function Palette({ dispatch }: { dispatch: (a: BuilderAction) => void }): JSX.Element {
  const add = (kind: StepKind): void => dispatch({ type: 'add-step', input: { kind } });
  return (
    <div
      data-testid="palette"
      style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}
    >
      <span
        style={{
          fontSize: 'var(--type-label)',
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--color-text-dim)',
        }}
      >
        Add step
      </span>
      {STEP_KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          data-testid={`palette-add-${k.kind}`}
          title={k.description}
          onClick={() => add(k.kind)}
          className="btn-box"
          // A step-kind chip is the frame's control, sized and shaped like every
          // other one; only the LEADING GLYPH carries the kind's categorical hue.
          // A 1.5px outline in eight competing colours turned the palette into
          // the loudest thing on the canvas.
          style={{
            width: 'auto',
            gap: 'var(--space-6)',
            padding: '0 var(--space-8)',
            fontSize: 'var(--type-meta)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              flexShrink: 0,
              borderRadius: 'var(--radius-pill)',
              background: accentHex(k.accent),
            }}
          />
          {k.label}
        </button>
      ))}
    </div>
  );
}
