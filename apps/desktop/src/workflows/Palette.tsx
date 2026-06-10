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
      <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-dim)' }}>
        Add step
      </span>
      {STEP_KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          data-testid={`palette-add-${k.kind}`}
          title={k.description}
          onClick={() => add(k.kind)}
          style={{
            fontSize: '0.72rem',
            fontWeight: 600,
            padding: '0.25rem 0.6rem',
            color: accentHex(k.accent),
            background: 'var(--color-bg-card)',
            border: `1.5px solid ${accentHex(k.accent)}`,
            borderRadius: 'var(--radius-block)',
          }}
        >
          + {k.label}
        </button>
      ))}
    </div>
  );
}
