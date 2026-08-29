/**
 * The two-column provider/model grid.
 *
 *   [ provider list ] │ [ models for the hovered provider ]
 *
 * The left column lists providers (with an active dot); clicking one
 * "browses" it without committing. The right column lists that
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

export function ProviderModelGrid({
  providers,
  activeProvider,
  activeModel,
  onPick,
}: {
  readonly providers: ReadonlyArray<ProviderInfo>;
  readonly activeProvider: string | null;
  readonly activeModel: string | null;
  readonly onPick: (provider: string, model: string | null) => void;
}): JSX.Element {
  // The provider highlighted in the left column. Defaults to the
  // workspace's active provider so the grid opens showing the current
  // model set. Decoupled from `activeProvider` because the user may
  // browse without committing.
  const [hoveredProvider, setHoveredProvider] = useState<string>(
    activeProvider ?? providers[0]?.name ?? '',
  );
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
        {providers.length === 0 && (
          <li
            style={{
              padding: '8px 10px',
              fontSize: 'var(--type-row)',
              color: 'var(--color-text-dim)',
            }}
          >
            No providers
          </li>
        )}
        {providers.map((p) => {
          const isActive = p.name === activeProvider;
          const isHovered = p.name === hoveredProvider;
          return (
            <li key={p.name}>
              <button
                type="button"
                role="option"
                aria-selected={isHovered}
                onClick={() => setHoveredProvider(p.name)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  fontSize: 'var(--type-row)',
                  borderRadius: 'var(--radius-block)',
                  color: isHovered ? 'var(--color-text)' : 'var(--color-text-muted)',
                  background: isHovered ? 'var(--color-surface)' : 'transparent',
                  fontWeight: isHovered ? 600 : 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ flex: 1 }}>{p.name}</span>
                {isActive && (
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
        })}
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
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
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
                letterSpacing: '0.04em',
              }}
            >
              built-in
            </span>
          )}
        </header>
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
        </ul>
      </div>
    </div>
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
