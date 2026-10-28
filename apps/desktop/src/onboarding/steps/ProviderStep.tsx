/**
 * The provider-connect step — pick a provider from the catalog (coding agents
 * and model APIs in their own groups), then either paste an API key (api-key
 * providers) or run the real OAuth login (oauth providers) via the shared
 * {@link OAuthSignIn} flow. Presentational: {@link useProviderConnect} holds the
 * state. Applies on first run and whenever the recovery gate finds no provider.
 */

import { Select } from '@moxxy/desktop-ui';
import { StepCard, Fields, Nav, PrimaryButton, SuccessRow, inputStyle } from '../chrome';
import { OAuthSignIn } from '../../settings/shared/OAuthSignIn';
import { CardList } from '../../settings/settings-primitives';
import { AgentConnectionRow } from '../../settings/agents/AgentConnectionRow';
import { useProviderConnect } from '../useProviderConnect';

export function ProviderStep({
  onNext,
  onBack,
  notice,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
  readonly notice?: string | null;
}): JSX.Element {
  const connect = useProviderConnect();
  const { authKind, agent } = connect;

  return (
    <StepCard
      title="Connect a provider"
      sub={
        authKind === 'oauth'
          ? "We'll open your browser to finish signing in. Tokens land in the vault, encrypted."
          : "Drop in an API key from your provider. It's encrypted by the moxxy vault."
      }
    >
      <Fields>
        {notice && <p role="status" style={{ margin: 0, color: 'var(--color-text-muted)' }}>{notice}</p>}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 'var(--type-row)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Provider
          </span>
          <Select
            value={connect.provider}
            onChange={(e) => connect.setProvider(e.target.value)}
            style={inputStyle}
          >
            {connect.groups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
        {authKind === 'api-key' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 'var(--type-row)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
              API key
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={connect.secret}
              onChange={(e) => connect.setSecret(e.target.value)}
              placeholder="sk-…"
              style={inputStyle}
            />
          </label>
        )}
        {connect.error && (
          <p role="alert" style={{ margin: 0, fontSize: 'var(--type-row)', color: 'var(--color-red)' }}>
            {connect.error}
          </p>
        )}
        {connect.done && authKind === 'api-key' && <SuccessRow text="Key saved to the vault." />}
        {agent.rows.length > 0 && (
          <CardList>
            {agent.rows.map((row) => (
              <AgentConnectionRow
                key={row.entry.name}
                row={row}
                onAction={(action) => {
                  if (action === 'install' || action === 'update') agent.run(row.entry.name, action);
                  else if (action === 'check') agent.check();
                }}
                onCheck={agent.check}
              />
            ))}
          </CardList>
        )}
        {authKind === 'oauth' ? (
          <OAuthSignIn provider={connect.provider} onSignedIn={connect.onOauthSignedIn} />
        ) : (
          <PrimaryButton onClick={() => void connect.saveKey()} disabled={connect.saving || !connect.secret.trim()}>
            {connect.saving ? 'Saving…' : connect.done ? 'Update key' : 'Save key'}
          </PrimaryButton>
        )}
      </Fields>
      <Nav onBack={onBack} onNext={onNext} skip={!connect.done} />
    </StepCard>
  );
}
