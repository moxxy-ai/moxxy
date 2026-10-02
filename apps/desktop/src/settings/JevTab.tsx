import { Button, TextInput } from '@moxxy/desktop-ui';
import { Section, Switch } from './settings-primitives';
import { useJevSettings } from './useJevSettings';

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 'var(--radius-card)',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--color-text-dim)',
  fontSize: 'var(--type-meta)',
};

/** Render-only surface for Jev in Computer Use: the switch and the TypeSafe key. State lives in the hook. */
export function JevTab(): JSX.Element {
  const jev = useJevSettings();

  return (
    <Section
      title="Jev"
      description="Jev finds the controls a Computer Use step names and checks what each step did. Without it, Computer Use works one action at a time."
    >
      <section style={cardStyle} aria-labelledby="jev-switch-title">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <h3 id="jev-switch-title" style={{ margin: 0, fontSize: 'var(--type-section)' }}>Use Jev in Computer Use</h3>
            <p style={{ ...noteStyle, marginTop: 5 }}>
              {jev.hasKey
                ? 'Turning it off keeps the key stored. It applies from the next Computer Use action, on every surface.'
                : 'Add a TypeSafe API key below to turn it on.'}
            </p>
          </div>
          <Switch
            on={jev.enabled}
            label="Use Jev in Computer Use"
            disabled={jev.loading || jev.busy || !jev.hasKey}
            busy={jev.busy}
            onClick={() => void jev.setEnabled(!jev.enabled)}
          />
        </div>
      </section>

      <section style={cardStyle} aria-labelledby="jev-key-title">
        <div>
          <h3 id="jev-key-title" style={{ margin: 0, fontSize: 'var(--type-section)' }}>Key</h3>
          <p style={{ ...noteStyle, marginTop: 5 }}>
            Stored encrypted in this device vault. Window contents of the app being operated are sent to TypeSafe while Jev is on.
          </p>
        </div>
        {jev.editing ? (
          <>
            <label htmlFor="jev-key" style={{ fontSize: 'var(--type-meta)' }}>
              TypeSafe API key{jev.hasKey ? ' · replaces the stored key' : ''}
            </label>
            <TextInput
              id="jev-key"
              type="password"
              value={jev.keyDraft}
              onChange={(event) => jev.setKeyDraft(event.target.value)}
              placeholder={jev.hasKey ? 'Paste a replacement key' : 'Paste your TypeSafe API key'}
              autoComplete="off"
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="cta" disabled={jev.busy || !jev.keyDraft.trim()} onClick={() => void jev.saveKey()}>
                {jev.busy ? 'Saving…' : 'Save key'}
              </Button>
              {jev.hasKey && (
                <Button variant="secondary" disabled={jev.busy} onClick={jev.cancelChange}>Cancel</Button>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span role="status" style={noteStyle}>A key is saved in this device vault.</span>
            <Button variant="secondary" disabled={jev.busy} onClick={jev.changeKey}>Change key</Button>
          </div>
        )}
      </section>

      {jev.error && (
        <div role="alert" style={{ color: 'var(--color-red)', fontSize: 'var(--type-meta)' }}>{jev.error}</div>
      )}
    </Section>
  );
}
