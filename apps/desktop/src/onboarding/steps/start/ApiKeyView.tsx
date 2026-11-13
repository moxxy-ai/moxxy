/**
 * The path for people who already have an API key: pick the service, paste
 * the key, connect. A service that signs in through the browser shows the
 * shared sign-in instead. Presentational: {@link useApiKeyConnect} holds it.
 */

import { Button, Select } from '@moxxy/desktop-ui';
import { Fields, PrimaryButton, StepCard, inputStyle } from '../../chrome';
import { OAuthSignIn } from '../../../settings/shared/OAuthSignIn';
import type { ApiKeyConnect } from '../../useApiKeyConnect';

const fieldLabel: React.CSSProperties = {
  fontSize: 'var(--type-row)',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
};

export function ApiKeyView({ connect, onBack }: { readonly connect: ApiKeyConnect; readonly onBack: () => void }): JSX.Element {
  const label = connect.services.find((s) => s.value === connect.service)?.label ?? connect.service;
  return (
    <StepCard
      title="Connect with an API key"
      sub="Paste the key from your account page. Moxxy keeps it encrypted on this computer."
    >
      <Fields>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabel}>Service</span>
          <Select value={connect.service} onChange={(e) => connect.setService(e.target.value)} style={inputStyle}>
            {connect.services.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        {connect.signsInWithBrowser ? (
          <OAuthSignIn key={connect.service} provider={connect.service} name={label} onSignedIn={connect.onSignedIn} />
        ) : (
          <>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={fieldLabel}>API key</span>
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={connect.secret}
                onChange={(e) => connect.setSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && connect.canConnect) void connect.connect();
                }}
                style={inputStyle}
              />
            </label>
            {connect.openKeyPage && (
              <button type="button" className="onboard-link" onClick={connect.openKeyPage}>
                Where do I get a key?
              </button>
            )}
            <PrimaryButton onClick={() => void connect.connect()} disabled={!connect.canConnect}>
              {connect.saving ? 'Connecting…' : 'Connect'}
            </PrimaryButton>
          </>
        )}
        {connect.error && (
          <p role="alert" className="onboard-error">
            {connect.error}
          </p>
        )}
      </Fields>
      <footer className="onboard-start__foot">
        <Button variant="secondary" size="lg" onClick={onBack}>
          Back
        </Button>
      </footer>
    </StepCard>
  );
}
