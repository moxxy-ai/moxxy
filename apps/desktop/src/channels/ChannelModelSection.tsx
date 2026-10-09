import { Button } from '@moxxy/desktop-ui';
import { ProviderModelGrid } from '../chat/agent-picker/ProviderModelGrid';
import type { ChannelModelState } from './useChannelModel';

/** The model a channel's bot runs — presentational; state lives in `useChannelModel`. */
export function ChannelModelSection({ state }: { readonly state: ChannelModelState }): JSX.Element {
  return (
    <section data-testid="channel-model" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      <div className="section-head">Model</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 'var(--type-ui)' }}>
          {state.label}
        </span>
        <Button variant="secondary" onClick={state.picking ? state.closePicker : state.openPicker} disabled={state.busy}>
          {state.picking ? 'Cancel' : 'Change'}
        </Button>
        {!state.isDefault && (
          <Button variant="secondary" onClick={() => void state.resetToDefault()} disabled={state.busy}>
            Use default
          </Button>
        )}
      </div>
      <p style={{ margin: 0, maxWidth: '62ch', fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
        Only this bot uses it — the app keeps its own model. Applies from the next message; you can also
        switch with /model in the chat.
      </p>
      {state.picking && (
        <ProviderModelGrid
          providers={state.providers}
          activeProvider={state.activeProvider}
          activeModel={state.activeModel}
          onPick={(provider, model) => void state.pick(provider, model)}
        />
      )}
      {state.error && (
        <p role="alert" style={{ margin: 0, fontSize: 'var(--type-meta)', color: 'var(--color-pink)' }}>
          {state.error}
        </p>
      )}
    </section>
  );
}
