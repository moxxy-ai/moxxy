import { useMemo, useState } from 'react';
import type { ConnectionPhase, NodeProbe, OnboardingStatus } from '@shared/ipc';
import { useOnboarding } from '@/lib/useOnboarding';

interface OnboardingWizardProps {
  /** Current supervisor phase so we know when to advance + can show
   *  CLI install progress against the live connection state. */
  readonly phase?: ConnectionPhase;
  /** Fires when the wizard is fully satisfied. The parent then
   *  removes us and renders the main chat surface. */
  readonly onComplete: () => void;
}

type Step = 'welcome' | 'node' | 'cli' | 'provider' | 'done';

/**
 * Multi-step onboarding. Each step has a clear explanation so a
 * fresh user knows what's happening; nothing fails silently.
 *
 *   1. Welcome — quick orientation.
 *   2. Node — detect, deep-link to install if absent.
 *   3. CLI  — auto-install via npm, with progress.
 *   4. Provider — pick + paste key (chained to `moxxy vault set` and
 *      `provider.setActive`).
 *   5. Done — short summary, hands off to the parent.
 *
 * The hook re-probes whenever the connection phase changes so a
 * successful CLI install advances the user automatically.
 */
export function OnboardingWizard({
  phase,
  onComplete,
}: OnboardingWizardProps): JSX.Element {
  const ob = useOnboarding(phase);
  const step = useMemo<Step>(() => deriveStep(ob.status, ob.node), [ob.status, ob.node]);

  if (step === 'done') {
    // Defer the parent call to the next tick so the render finishes.
    queueMicrotask(onComplete);
  }

  return (
    <main className="app-main bp-grid">
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: '2rem',
        }}
      >
        <div
          className="elev"
          style={{
            width: '100%',
            maxWidth: 560,
            padding: '2rem 2.25rem',
            background: 'var(--color-bg-card)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-block)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <Header step={step} />
          <Stepper current={step} />
          <Body step={step} ob={ob} />
        </div>
      </div>
    </main>
  );
}

function deriveStep(
  status: OnboardingStatus | null,
  node: NodeProbe | null,
): Step {
  if (!status || !node) return 'welcome';
  if (!node.installed) return 'node';
  if (!status.cliInstalled) return 'cli';
  if (!status.hasProvider) return 'provider';
  return 'done';
}

function Header({ step }: { readonly step: Step }): JSX.Element {
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
      <h1
        style={{
          margin: 0,
          fontSize: '1.6rem',
          fontWeight: 700,
          letterSpacing: '-0.025em',
        }}
      >
        <span className="grad-text">Let's set up moxxy</span>
      </h1>
      <p
        style={{
          margin: 0,
          fontSize: '0.9rem',
          color: 'var(--color-text-muted)',
        }}
      >
        {step === 'welcome' &&
          "We'll guide you through this — it takes about a minute."}
        {step === 'node' && 'moxxy needs Node.js. Install it and come back.'}
        {step === 'cli' && "We'll install the moxxy CLI for you."}
        {step === 'provider' && 'One last step: pick a provider + paste your key.'}
        {step === 'done' && 'All set — opening the chat now.'}
      </p>
    </header>
  );
}

function Stepper({ current }: { readonly current: Step }): JSX.Element {
  const order: Array<{ id: Step; label: string }> = [
    { id: 'node', label: 'Node.js' },
    { id: 'cli', label: 'moxxy CLI' },
    { id: 'provider', label: 'Provider' },
  ];
  const reached = (s: Step): boolean => {
    if (current === 'welcome') return false;
    if (current === 'done') return true;
    if (current === 'node') return s === 'node';
    if (current === 'cli') return s === 'node' || s === 'cli';
    return true; // provider step => all earlier reached
  };
  const active = (s: Step): boolean => current === s;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '0.5rem',
      }}
    >
      {order.map((o, idx) => (
        <div
          key={o.id}
          data-active={active(o.id)}
          data-reached={reached(o.id)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          <div
            style={{
              height: 4,
              borderRadius: 2,
              background: active(o.id)
                ? 'var(--color-primary)'
                : reached(o.id)
                  ? 'var(--color-green)'
                  : 'var(--color-border)',
            }}
          />
          <span
            className="mono"
            style={{
              fontSize: '0.65rem',
              color: active(o.id)
                ? 'var(--color-text)'
                : 'var(--color-text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            {idx + 1}. {o.label}
          </span>
        </div>
      ))}
    </div>
  );
}

function Body({
  step,
  ob,
}: {
  readonly step: Step;
  readonly ob: ReturnType<typeof useOnboarding>;
}): JSX.Element {
  if (step === 'welcome' || ob.loading) {
    return (
      <p style={{ color: 'var(--color-text-dim)' }}>Looking things over…</p>
    );
  }
  if (step === 'node') return <NodeStep ob={ob} />;
  if (step === 'cli') return <CliStep ob={ob} />;
  if (step === 'provider') return <ProviderStep ob={ob} />;
  return (
    <p style={{ color: 'var(--color-text-dim)' }}>
      Everything's ready — taking you to the chat…
    </p>
  );
}

function NodeStep({
  ob,
}: {
  readonly ob: ReturnType<typeof useOnboarding>;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Explanation>
        Node.js is the runtime moxxy is built on. It's a free download
        from <strong>nodejs.org</strong>. After you install it, come
        back here and click <strong>Re-check</strong>.
      </Explanation>
      <ButtonRow>
        <PrimaryButton
          onClick={() => void ob.openExternal('https://nodejs.org/en/download')}
        >
          Open nodejs.org
        </PrimaryButton>
        <GhostButton onClick={() => void ob.refresh()}>Re-check</GhostButton>
      </ButtonRow>
    </div>
  );
}

function CliStep({
  ob,
}: {
  readonly ob: ReturnType<typeof useOnboarding>;
}): JSX.Element {
  const showLog = ob.install.running || ob.install.progress.length > 0;
  const failed =
    ob.install.lastExitCode !== null && ob.install.lastExitCode !== 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Explanation>
        We'll run <Code>npm install -g @moxxy/cli</Code> for you. This
        adds the <Code>moxxy</Code> command to your system so the
        desktop (and other shells) can use it.
      </Explanation>
      {failed && (
        <Banner kind="error">
          Install exited with code {ob.install.lastExitCode}. You can
          retry, or run the command yourself from a terminal.
        </Banner>
      )}
      {ob.install.error && <Banner kind="error">{ob.install.error}</Banner>}
      <ButtonRow>
        <PrimaryButton
          disabled={ob.install.running}
          onClick={() => void ob.install.run()}
        >
          {ob.install.running ? 'Installing…' : 'Install moxxy'}
        </PrimaryButton>
        <GhostButton onClick={() => void ob.refresh()}>Re-check</GhostButton>
      </ButtonRow>
      {showLog && <InstallLog lines={ob.install.progress} />}
    </div>
  );
}

const PROVIDERS: ReadonlyArray<{ id: string; label: string; hint?: string }> = [
  { id: 'anthropic', label: 'Anthropic (Claude)', hint: 'console.anthropic.com' },
  { id: 'openai', label: 'OpenAI (GPT)', hint: 'platform.openai.com' },
  { id: 'openai-codex', label: 'OpenAI Codex' },
];

function ProviderStep({
  ob,
}: {
  readonly ob: ReturnType<typeof useOnboarding>;
}): JSX.Element {
  const [provider, setProvider] = useState<string>(PROVIDERS[0]!.id);
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!secret.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await ob.saveProviderKey({ provider, secret: secret.trim() });
      setSecret('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}
    >
      <Explanation>
        Pick a provider and paste your API key. The key goes straight
        into <Code>moxxy vault</Code> — encrypted at rest, never
        visible to the desktop app.
      </Explanation>
      <Field label="Provider">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          style={inputStyle}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.hint ? ` — ${p.hint}` : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="API key">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="sk-…"
          autoFocus
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
        />
      </Field>
      {error && <Banner kind="error">{error}</Banner>}
      <ButtonRow>
        <PrimaryButton type="submit" disabled={!secret.trim() || saving}>
          {saving ? 'Saving…' : 'Save and continue'}
        </PrimaryButton>
      </ButtonRow>
    </form>
  );
}

// ---- shared bits ---------------------------------------------------------

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem 0.7rem',
  fontSize: '0.9rem',
  color: 'var(--color-text)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-block)',
  outline: 'none',
};

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.3rem',
        fontSize: '0.75rem',
        color: 'var(--color-text-dim)',
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function Explanation({
  children,
}: {
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <p
      style={{
        margin: 0,
        fontSize: '0.9rem',
        lineHeight: 1.55,
        color: 'var(--color-text-muted)',
      }}
    >
      {children}
    </p>
  );
}

function ButtonRow({
  children,
}: {
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
      {children}
    </div>
  );
}

function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  const { children, disabled, ...rest } = props;
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        padding: '0.55rem 1rem',
        fontWeight: 600,
        background: 'var(--color-primary)',
        color: 'var(--color-bg)',
        borderRadius: 'var(--radius-block)',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function GhostButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  const { children, ...rest } = props;
  return (
    <button
      {...rest}
      style={{
        padding: '0.55rem 1rem',
        fontWeight: 600,
        color: 'var(--color-text-dim)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
      }}
    >
      {children}
    </button>
  );
}

function Banner({
  kind,
  children,
}: {
  readonly kind: 'error' | 'info';
  readonly children: React.ReactNode;
}): JSX.Element {
  const tint =
    kind === 'error'
      ? 'color-mix(in oklab, var(--color-pink) 12%, transparent)'
      : 'color-mix(in oklab, var(--color-primary) 12%, transparent)';
  const border =
    kind === 'error' ? 'var(--color-pink)' : 'var(--color-primary)';
  return (
    <p
      role="alert"
      style={{
        margin: 0,
        padding: '0.5rem 0.75rem',
        background: tint,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radius-block)',
        fontSize: '0.85rem',
      }}
    >
      {children}
    </p>
  );
}

function InstallLog({
  lines,
}: {
  readonly lines: ReadonlyArray<string>;
}): JSX.Element {
  return (
    <pre
      className="mono"
      style={{
        margin: 0,
        padding: '0.5rem 0.75rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-block)',
        fontSize: '0.7rem',
        color: 'var(--color-text-muted)',
        maxHeight: 200,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
      }}
    >
      {lines.join('\n')}
    </pre>
  );
}

function Code({
  children,
}: {
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <code
      style={{
        padding: '0.1rem 0.35rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 4,
        fontSize: '0.85em',
      }}
    >
      {children}
    </code>
  );
}
