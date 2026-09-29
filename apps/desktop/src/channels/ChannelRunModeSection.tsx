import type { ChannelRunModeState } from './useChannelRunMode';

/** How the channel's bot runs — presentational; state lives in `useChannelRunMode`. */
export function ChannelRunModeSection({ state }: { readonly state: ChannelRunModeState }): JSX.Element {
  return (
    <section data-testid="channel-run-mode" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div className="section-head">run mode</div>
      <div role="radiogroup" aria-label="Run mode" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        {state.options.map((o) => (
          <label key={o.mode} style={{ display: 'flex', gap: 'var(--space-8)', alignItems: 'flex-start', cursor: 'pointer' }}>
            <input
              type="radio"
              name="channel-run-mode"
              value={o.mode}
              checked={state.current === o.mode}
              disabled={state.busy}
              onChange={() => void state.choose(o.mode)}
            />
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 'var(--type-ui)' }}>{o.label}</span>
              <span style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {state.serviceLabel && (
        <p style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-text-muted)' }}>{state.serviceLabel}</p>
      )}
      {state.error && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-pink)' }}>
          {state.error}
        </p>
      )}
    </section>
  );
}
