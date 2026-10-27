/**
 * The two-column provider/model grid.
 *
 *   [ provider list ] │ [ models for the hovered provider ]
 *
 * The left column lists the connected providers (with an active dot), the
 * OAuth-login agents apart from the API-key models as in Settings, each kind
 * under a heading with its name; clicking one "browses" it
 * without committing. The right column lists that
 * provider's models. Providers that advertise live discovery replace their
 * build-time fallback catalog with the current `/v1/models` result. Picking a
 * model commits via the parent's onPick.
 *
 * Modal-less: the host (the combined Model & context panel) owns the
 * surrounding chrome, so this renders just the grid.
 */

import { useState } from 'react';
import type { ProviderInfo } from './types';
import { useLiveProviderModels } from './useLiveProviderModels';
import { CustomModelForm } from './CustomModelForm';
import { useConnectedProviders } from './useConnectedProviders';
import { PROVIDER_KINDS } from '../../settings/provider-kinds';

export function ProviderModelGrid({
  workspaceId,
  providers,
  activeProvider,
  activeModel,
  onPick,
}: {
  /** Whose Settings say which providers are connected; without one every provider shows. */
  readonly workspaceId?: string | null;
  readonly providers: ReadonlyArray<ProviderInfo>;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onPick: (provider: string, model: string | null, contextWindow?: number) => void;
}): JSX.Element {
  // The provider highlighted in the left column. Defaults to the
  // workspace's active provider so the grid opens showing the current
  // model set. Decoupled from `activeProvider` because the user may
  // browse without committing.
  const groups = useConnectedProviders(workspaceId, providers, activeProvider);
  const shown = [...groups.agents, ...groups.models];
  const [browsed, setHoveredProvider] = useState<string>(
    activeProvider ?? providers[0]?.name ?? '',
  );
  // A provider that is not offered is never browsed: its models could not be picked.
  const firstShown = shown[0];
  const hoveredProvider =
    firstShown === undefined || shown.some((p) => p.name === browsed) ? browsed : firstShown.name;
  const [customModelOpen, setCustomModelOpen] = useState(false);
  const liveModels = useLiveProviderModels(providers, hoveredProvider);
  const currentModels = liveModels.models.map((id) => ({ id }));

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'clamp(148px, 30%, 190px) minmax(0, 1fr)',
        gap: 0,
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        height: 'clamp(180px, 38dvh, 320px)',
        minHeight: 0,
      }}
    >
      <ul
        role="listbox"
        aria-label="Providers"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 6,
          background: 'var(--color-input-soft)',
          borderRight: '1px solid var(--color-card-border)',
          overflowY: 'auto',
          minHeight: 0,
        }}
      >
        {shown.length === 0 && (
          <li
            style={{
              padding: '8px 10px',
              fontSize: 'var(--type-row)',
              color: 'var(--color-text-dim)',
            }}
          >
            No connected providers
          </li>
        )}
        {[
          { ...PROVIDER_KINDS.agents, items: groups.agents },
          { ...PROVIDER_KINDS.models, items: groups.models },
        ]
          .filter((group) => group.items.length > 0)
          .map((group, index) => (
            <li
              key={group.title}
              // A hairline and some air between the kinds, as in Settings, so
              // the split reads before any provider does.
              style={index > 0 ? { marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--color-card-border)' } : undefined}
            >
              <ul role="group" aria-label={group.title} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                <li
                  role="presentation"
                  style={{
                    padding: '8px 8px 6px',
                    fontSize: 'var(--type-label)',
                    fontWeight: 650,
                    color: 'var(--color-text)',
                  }}
                >
                  {group.title}
                </li>
                {group.items.map((p) => (
                  <ProviderOption
                    key={p.name}
                    name={p.name}
                    active={p.name === activeProvider}
                    hovered={p.name === hoveredProvider}
                    onBrowse={() => setHoveredProvider(p.name)}
                  />
                ))}
              </ul>
            </li>
          ))}
      </ul>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface)',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <header
          style={{
            padding: '8px 10px',
            minHeight: 'var(--frame-control)',
            boxSizing: 'border-box',
            borderBottom: '1px solid var(--color-card-border)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span
            style={{
              flex: 1,
              fontSize: 'var(--type-meta)',
              fontWeight: 700,
              color: 'var(--color-text-dim)',
            }}
          >
            Models · {hoveredProvider || '—'}
          </span>
          {liveModels.canFetchLive ? (
            <button
              type="button"
              onClick={() => void liveModels.refresh()}
              disabled={!hoveredProvider || liveModels.status === 'loading'}
              title="Fetch the live model list from the provider's API"
              style={{
                fontSize: 'var(--type-meta)',
                padding: '4px 10px',
                borderRadius: 'var(--radius-block)',
                color: 'var(--color-primary-strong)',
                border: '1px solid var(--color-primary-soft)',
                background: 'var(--color-primary-soft)',
                fontWeight: 600,
                opacity:
                  liveModels.status === 'loading' || !hoveredProvider ? 0.6 : 1,
              }}
            >
              {liveModels.status === 'loading' ? 'Loading models…' : 'Refresh models'}
            </button>
          ) : (
            <span
              className="mono"
              title="Built-in provider — models ship with the moxxy CLI"
              style={{
                fontSize: 'var(--type-label)',
                color: 'var(--color-text-dim)',
              }}
            >
              Built-in
            </span>
          )}
        </header>
        {customModelOpen ? (
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <CustomModelForm
              provider={hoveredProvider}
              onCancel={() => setCustomModelOpen(false)}
              onSubmit={(model, contextWindow) => onPick(hoveredProvider, model, contextWindow)}
            />
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label="Models"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 6,
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
          {!liveModels.canFetchLive && (
            <li>
              <button
                type="button"
                role="option"
                aria-selected={
                  hoveredProvider === activeProvider && activeModel === null
                }
                onClick={() => onPick(hoveredProvider, null)}
                style={modelRowStyle(
                  hoveredProvider === activeProvider && activeModel === null,
                )}
              >
                <span style={{ flex: 1, fontStyle: 'italic' }}>Default</span>
                <span style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
                  runner's config
                </span>
              </button>
            </li>
          )}
          {currentModels.length === 0 && (
            <li
              style={{
                padding: '12px 10px',
                fontSize: 'var(--type-row)',
                color: 'var(--color-text-dim)',
              }}
            >
              {liveModels.status === 'loading'
                ? 'Loading models from the provider…'
                : liveModels.canFetchLive
                  ? 'No models are currently available from this provider.'
                  : 'No models advertised by this provider.'}
            </li>
          )}
          {currentModels.map((m) => {
            const isCurrent =
              hoveredProvider === activeProvider && activeModel === m.id;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isCurrent}
                  onClick={() => onPick(hoveredProvider, m.id)}
                  style={modelRowStyle(isCurrent)}
                >
                  <span
                    className="mono"
                    style={{
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {m.id}
                  </span>
                  {hoveredProvider === 'local' && m.id.endsWith(':cloud') && (
                    <span style={{ fontSize: 'var(--type-meta)', color: 'var(--color-text-dim)' }}>
                      Cloud via Ollama
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {liveModels.status === 'error' && liveModels.error && (
              <li
                role="alert"
                style={{
                  padding: '10px',
                  margin: '6px 4px 0',
                  fontSize: 'var(--type-meta)',
                  color: 'var(--color-red)',
                  background: 'var(--color-red-wash)',
                  border: '1px solid var(--color-red-border)',
                  borderRadius: 'var(--radius-block)',
                }}
              >
                {liveModels.error}
            </li>
          )}
            <li>
              <button
                type="button"
                onClick={() => setCustomModelOpen(true)}
                style={modelRowStyle(false)}
              >
                Custom model…
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  );
}

function ProviderOption({
  name,
  active,
  hovered,
  onBrowse,
}: {
  readonly name: string;
  readonly active: boolean;
  readonly hovered: boolean;
  readonly onBrowse: () => void;
}): JSX.Element {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={hovered}
        onClick={onBrowse}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '6px 8px',
          fontSize: 'var(--type-row)',
          borderRadius: 'var(--radius-block)',
          color: hovered ? 'var(--color-text)' : 'var(--color-text-muted)',
          background: hovered ? 'var(--color-surface)' : 'transparent',
          fontWeight: hovered ? 600 : 500,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ flex: 1 }}>{name}</span>
        {active && (
          <span
            title="Active provider"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-green)',
            }}
          />
        )}
      </button>
    </li>
  );
}

// ---- styles ----

function modelRowStyle(active: boolean): React.CSSProperties {
  return {
    width: '100%',
    textAlign: 'left',
    padding: '6px 8px',
    fontSize: 'var(--type-row)',
    borderRadius: 'var(--radius-block)',
    background: active ? 'var(--color-primary-soft)' : 'transparent',
    color: active ? 'var(--color-primary-strong)' : 'var(--color-text)',
    fontWeight: active ? 600 : 500,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  };
}
