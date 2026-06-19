/**
 * Providers tab — the model providers the connected runner can route to. Each
 * provider is a Row with a deterministic colour-tinted initial Tile, a
 * ready/inactive StatusDot, an enable/disable Switch (persisted on the
 * runner; the ACTIVE provider can't be disabled), and a Configure sheet for
 * the API key (vault) plus — for admin-registered providers — the stored
 * baseURL / default model. "Add provider" opens the shared agent-task modal:
 * the user names the vendor, moxxy registers it in a hidden background turn.
 */

import { useState } from 'react';
import { api, type useSettings } from '@moxxy/client-core';
import { Button, Icon, IconButton, Modal, TextInput } from '@moxxy/desktop-ui';
import { Section, CardList, Row, Tile, StatusDot, Switch, Badge, EmptyState } from './settings-primitives';
import { AgentTaskModal } from './shared/AgentTaskModal';
import { OAuthSignIn } from './shared/OAuthSignIn';
import { PROVIDER_PROMPT_TEMPLATE } from './provider-prompt';

type ProviderRow = ReturnType<typeof useSettings>['providers'][number];

/** Reasoning-effort levels offered for providers whose models support it.
 *  Mirrors the CLI's proven `config.context.reasoning` path. The order +
 *  values match the contract's `ReasoningEffort` (and the runner protocol's
 *  `ReasoningEffortLevel`), so the chosen level forwards verbatim. */
const REASONING_LEVELS = ['off', 'low', 'medium', 'high'] as const;
type ReasoningLevel = (typeof REASONING_LEVELS)[number];

// The runner's `session.reasoning` is session-scoped and resets when its runner
// restarts, so we remember the user's per-provider pick here to seed the
// selector on reopen and to re-apply it. The LIVE effect comes from the
// `settings.setReasoning` IPC call below — this is just the UI's memory.
const REASONING_PREF_KEY = 'moxxy.reasoning.effort';

function reasoningEffortFor(providerName: string): ReasoningLevel {
  try {
    const raw = localStorage.getItem(REASONING_PREF_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    const v = map[providerName];
    return REASONING_LEVELS.includes(v as ReasoningLevel) ? (v as ReasoningLevel) : 'off';
  } catch {
    return 'off';
  }
}

function setReasoningEffortFor(providerName: string, level: ReasoningLevel): void {
  try {
    const raw = localStorage.getItem(REASONING_PREF_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[providerName] = level;
    localStorage.setItem(REASONING_PREF_KEY, JSON.stringify(map));
  } catch {
    // best-effort; a missing localStorage just means the choice doesn't persist
  }
}

/** True when the provider's model catalog advertises reasoning support — now a
 *  typed field on `ProviderEntry`, populated runner-side from the model
 *  descriptors (see `settings.providers` in @moxxy/desktop-host). */
function providerSupportsReasoning(p: ProviderRow): boolean {
  return p.supportsReasoning === true;
}

export function ProvidersTab({
  providers,
  onToggle,
  onConfigure,
  onSetKey,
  onRefresh,
  search,
}: {
  readonly providers: ReturnType<typeof useSettings>['providers'];
  readonly onToggle: (name: string, enabled: boolean) => Promise<void>;
  readonly onConfigure: (
    name: string,
    patch: { baseURL?: string; defaultModel?: string },
  ) => Promise<void>;
  readonly onSetKey: (keyName: string, value: string) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly search?: React.ReactNode;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState<ProviderRow | null>(null);
  // Per-row in-flight set: a toggle is fire-and-forget against the runner, so
  // disable that row's Switch until it settles. Without this a slow/failing
  // toggle looks inert and the user re-clicks, queuing conflicting calls.
  const [toggling, setToggling] = useState<ReadonlySet<string>>(() => new Set());
  const toggleProvider = (name: string, enabled: boolean): void => {
    if (toggling.has(name)) return;
    setToggling((cur) => new Set(cur).add(name));
    void onToggle(name, enabled).finally(() => {
      setToggling((cur) => {
        const next = new Set(cur);
        next.delete(name);
        return next;
      });
    });
  };
  return (
    <Section
      title="Providers"
      count={providers.length}
      description="Model providers the runner can route to. Toggle one off to exclude it; configure adds the API key (and endpoint for custom vendors)."
      search={search}
      actions={
        <Button variant="cta" onClick={() => setAdding(true)} style={{ gap: 7 }}>
          <Icon name="plus" size={14} />
          Add provider
        </Button>
      }
    >
      {providers.length === 0 ? (
        <EmptyState icon="spark" text="No providers known to the connected runner." />
      ) : (
        <CardList>
          {providers.map((p) => {
            const { bg, fg } = tintFor(p.name);
            return (
              <Row
                key={p.name}
                testId={`provider-row-${p.name}`}
                tile={
                  <Tile bg={bg} fg={fg}>
                    {p.name.slice(0, 1).toUpperCase()}
                  </Tile>
                }
                title={p.name}
                subtitle={subtitleFor(p)}
                trailing={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                    {p.active && <Badge>Active</Badge>}
                    <StatusDot ok={p.ready} okLabel="Ready" offLabel="Inactive" />
                    <IconButton
                      aria-label={`Configure ${p.name}`}
                      onClick={() => setConfiguring(p)}
                      size={28}
                    >
                      <Icon name="sliders" size={14} />
                    </IconButton>
                    <Switch
                      on={p.enabled}
                      label={`${p.enabled ? 'Disable' : 'Enable'} ${p.name}`}
                      // The runner refuses to disable the ACTIVE provider —
                      // disable the control too so the row matches reality.
                      // Also disable while a toggle is in flight to stop
                      // re-clicks queuing conflicting enable/disable calls.
                      disabled={(p.active && p.enabled) || toggling.has(p.name)}
                      onClick={() => toggleProvider(p.name, !p.enabled)}
                    />
                  </span>
                }
              />
            );
          })}
        </CardList>
      )}
      {adding && (
        <AgentTaskModal
          title="Add provider"
          label="Describe the provider"
          placeholder="e.g. DeepSeek — I'll add the API key to the vault afterwards."
          hint="Moxxy registers the provider in the background with the vendor's well-known defaults. Your API key stays in the vault."
          buildPrompt={PROVIDER_PROMPT_TEMPLATE}
          onComplete={onRefresh}
          doneLabel="Done"
          onClose={() => setAdding(false)}
        />
      )}
      {configuring && (
        <ConfigureProviderModal
          provider={configuring}
          onConfigure={onConfigure}
          onSetKey={onSetKey}
          onRefresh={onRefresh}
          onClose={() => setConfiguring(null)}
        />
      )}
    </Section>
  );
}

function subtitleFor(p: ProviderRow): string {
  if (!p.enabled) return 'Disabled · excluded from activation';
  if (p.ready) return 'Active · credentials resolved';
  return p.authKind === 'oauth'
    ? 'Inactive · sign in to connect'
    : 'Inactive · add a key to use';
}

/**
 * Configure sheet — two independent forms:
 *   - API key → vault under the provider's canonical key name, then the
 *     runner re-probes credentials so the readiness dot flips live. OAuth
 *     providers get a hint instead (their credential is a login, not a key).
 *   - Endpoint (admin-registered providers only): stored baseURL + default
 *     model, applied to the live registry and persisted to providers.json.
 */
function ConfigureProviderModal({
  provider,
  onConfigure,
  onSetKey,
  onRefresh,
  onClose,
}: {
  readonly provider: ProviderRow;
  readonly onConfigure: (
    name: string,
    patch: { baseURL?: string; defaultModel?: string },
  ) => Promise<void>;
  readonly onSetKey: (keyName: string, value: string) => Promise<void>;
  readonly onRefresh: () => Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [baseURL, setBaseURL] = useState(provider.baseURL ?? '');
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel ?? '');
  const [reasoning, setReasoning] = useState<ReasoningLevel>(() => reasoningEffortFor(provider.name));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>, doneNote: string): Promise<void> => {
    // Guard against overlapping runs: a native <select> fires onChange for each
    // intermediate option during an arrow-key sweep, which would otherwise queue
    // racing setReasoning IPC mutations. Drop calls while one is in flight.
    if (busy) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await fn();
      setSaved(doneNote);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const isAdmin = provider.kind === 'admin';
  const configDirty =
    isAdmin &&
    ((baseURL.trim() !== (provider.baseURL ?? '') && baseURL.trim().length > 0) ||
      (defaultModel.trim() !== (provider.defaultModel ?? '') && defaultModel.trim().length > 0));

  return (
    <Modal title={`Configure ${provider.name}`} onClose={onClose} width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {provider.authKind === 'oauth' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
              This provider signs in with OAuth — no API key to store. We'll open your browser to
              finish; any pasted token stays in the encrypted vault.
            </p>
            <OAuthSignIn
              provider={provider.name}
              onSignedIn={() => {
                void onRefresh();
              }}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={fieldLabelStyle}>
              API key · stored in the vault as <code style={{ fontSize: 11.5 }}>{provider.keyName}</code>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <TextInput
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-…"
                style={{ flex: 1 }}
                data-testid="provider-key-input"
              />
              <Button
                variant="primary"
                disabled={key.length === 0 || busy}
                onClick={() =>
                  void run(async () => {
                    await onSetKey(provider.keyName, key);
                    setKey('');
                  }, 'Key saved — readiness re-checked.')
                }
              >
                Save key
              </Button>
            </div>
          </div>
        )}

        {isAdmin && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={fieldLabelStyle}>Endpoint</label>
            <TextInput
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.vendor.com/v1"
              className="mono"
              data-testid="provider-baseurl-input"
            />
            <label style={fieldLabelStyle}>Default model</label>
            {provider.modelIds && provider.modelIds.length > 0 ? (
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                style={selectStyle}
                data-testid="provider-defaultmodel-select"
              >
                {provider.modelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ) : (
              <TextInput
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                placeholder="model-id"
                className="mono"
              />
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="primary"
                disabled={!configDirty || busy}
                onClick={() =>
                  void run(async () => {
                    const patch: { baseURL?: string; defaultModel?: string } = {};
                    if (baseURL.trim() && baseURL.trim() !== provider.baseURL) patch.baseURL = baseURL.trim();
                    if (defaultModel.trim() && defaultModel.trim() !== provider.defaultModel) {
                      patch.defaultModel = defaultModel.trim();
                    }
                    await onConfigure(provider.name, patch);
                  }, 'Configuration saved.')
                }
              >
                Save configuration
              </Button>
            </div>
          </div>
        )}

        {!isAdmin && provider.authKind !== 'oauth' && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Built-in provider — endpoint and model list ship with moxxy; only the key is configurable.
          </p>
        )}

        {providerSupportsReasoning(provider) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={fieldLabelStyle}>Reasoning effort</label>
            <select
              value={reasoning}
              disabled={busy}
              aria-busy={busy}
              onChange={(e) => {
                const next = e.target.value as ReasoningLevel;
                setReasoning(next);
                setReasoningEffortFor(provider.name, next);
                // Apply it live on the runner (maps onto config.context.reasoning).
                void run(
                  () => api().invoke('settings.setReasoning', { effort: next }),
                  next === 'off' ? 'Reasoning effort cleared.' : `Reasoning effort set to ${next}.`,
                );
              }}
              style={selectStyle}
              data-testid="provider-reasoning-select"
            >
              {REASONING_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level === 'off' ? 'Off' : level[0]!.toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--color-text-dim)', lineHeight: 1.5 }}>
              How much the model thinks before answering. Higher effort is slower but deeper.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12.5, color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
        {saved && !error && (
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--color-green, #16a34a)' }}>{saved}</p>
        )}
      </div>
    </Modal>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
};

const selectStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid var(--color-card-border)',
  background: 'var(--color-card-bg)',
  fontSize: 13,
  fontFamily: 'inherit',
  color: 'inherit',
};

/** Deterministic soft tint per provider name, so each tile is distinct
 *  but on-brand (pastel bg, saturated fg from the same hue). */
function tintFor(name: string): { bg: string; fg: string } {
  // Accumulate the full rolling hash (kept in 32-bit range to avoid float
  // precision loss) and take the modulo ONCE at the end — truncating to
  // 0..359 inside the loop collapsed entropy and collided distinct names.
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = ((h % 360) + 360) % 360;
  return { bg: `hsl(${hue} 72% 95%)`, fg: `hsl(${hue} 55% 42%)` };
}
