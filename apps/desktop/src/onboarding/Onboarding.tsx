/**
 * Unified onboarding. One declarative, per-step-gated flow (see
 * ONBOARDING_STEPS) drives both cases over the shared step-flow engine:
 *
 *   - First run (until `prefs.onboardingComplete`): a linear walk through
 *     welcome → sign-in → (node) → CLI → provider → workspace → done.
 *   - Recovery gate (a prerequisite went missing while the app runs): the
 *     same steps, but only the unmet ones apply and the flow auto-resolves
 *     + closes itself once satisfied.
 *
 * The Shell + step primitives + the branded Clerk <SignIn> appearance live
 * in ./chrome. The Clerk publishable key comes from
 * `VITE_CLERK_PUBLISHABLE_KEY`; if unset the auth step is auto-satisfied so
 * dev builds without a Clerk app configured aren't blocked.
 */

import { useEffect, useState } from 'react';
import { toErrorMessage } from '@/lib/errors';
import { SignedIn, SignedOut, SignIn, useUser } from '@clerk/clerk-react';
import { api } from '@/lib/api';
import { usePrefs } from '@/lib/usePrefs';
import { useDesks } from '@/lib/useDesks';
import { useOnboarding } from '@/lib/useOnboarding';
import { useStepFlow, type FlowStep } from '@/lib/step-flow';
import { Icon } from '@/lib/Icon';
import type { ConnectionPhase } from '@moxxy/desktop-ipc-contract';

import {
  CLERK_KEY,
  brandedClerkAppearance,
  Shell,
  StepCard,
  Nav,
  PrimaryButton,
  SuccessRow,
  Pulse,
  inputStyle,
  secondaryBtnStyle,
  pickerBtnStyle,
  authCardStyle,
} from './chrome';

interface Props {
  readonly phase?: ConnectionPhase;
  readonly onComplete: () => void;
}


/**
 * Gate context the onboarding steps are evaluated against. `full` is the
 * first-run case (nothing set up yet); otherwise we're a recovery gate
 * (the app is running but a prerequisite — CLI / provider / node — went
 * missing), and only the unmet steps apply.
 */
interface OnboardingCtx {
  readonly full: boolean;
  readonly cliInstalled: boolean;
  readonly hasProvider: boolean;
  readonly nodeInstalled: boolean;
  readonly nodeProbed: boolean;
  readonly cliMissing: boolean;
  readonly signedIn: boolean;
  readonly clerkConfigured: boolean;
}

/**
 * One declarative onboarding flow, gated per step. First-run walks every
 * step linearly; the recovery gate auto-resolves to whichever prerequisite
 * is missing. Both are the same list with different `applies`/`satisfied`
 * predicates over the same {@link useStepFlow} engine.
 */
const ONBOARDING_STEPS: ReadonlyArray<FlowStep<OnboardingCtx>> = [
  { id: 'welcome', label: 'Welcome', applies: (c) => c.full },
  {
    id: 'auth',
    label: 'Sign in',
    applies: (c) => c.full,
    satisfied: (c) => c.signedIn || !c.clerkConfigured,
  },
  {
    id: 'node',
    label: 'Install Node',
    applies: (c) => c.nodeProbed && !c.nodeInstalled,
    satisfied: (c) => c.nodeInstalled,
  },
  {
    id: 'cli',
    label: 'Install moxxy',
    applies: (c) => c.full || c.cliMissing,
    satisfied: (c) => c.cliInstalled,
  },
  {
    id: 'provider',
    label: 'Pick a provider',
    applies: (c) => c.full || !c.hasProvider,
    satisfied: (c) => c.hasProvider,
  },
  { id: 'workspace', label: 'First workspace', applies: (c) => c.full },
  { id: 'done', label: "You're set", applies: (c) => c.full },
];

/**
 * Unified onboarding surface. Shown both on true first run (until
 * `prefs.onboardingComplete`) and as a recovery gate (CLI/provider/node
 * missing). One step list, gated per step — see {@link ONBOARDING_STEPS}.
 */
export function Onboarding({ phase, onComplete }: Props): JSX.Element {
  const { prefs } = usePrefs();
  const ob = useOnboarding(phase);
  const { user } = useUser();

  const ctx: OnboardingCtx = {
    full: !(prefs?.onboardingComplete ?? false),
    cliInstalled: ob.status?.cliInstalled ?? false,
    hasProvider: ob.status?.hasProvider ?? false,
    nodeInstalled: ob.node?.installed ?? false,
    nodeProbed: ob.node !== null,
    cliMissing: phase?.phase === 'cli-missing',
    signedIn: !!user,
    clerkConfigured: !!CLERK_KEY,
  };
  // First run = a linear walk; a recovery gate auto-resolves to the
  // unmet prerequisite and closes itself once satisfied.
  const flow = useStepFlow(ONBOARDING_STEPS, ctx, {
    mode: ctx.full ? 'linear' : 'auto',
    onComplete,
  });

  return (
    <Shell steps={flow.steps} currentIndex={flow.index}>
      {renderStep(flow.currentId, flow.next, flow.isFirst ? null : flow.back, onComplete)}
    </Shell>
  );
}

function renderStep(
  id: string | null,
  next: () => void,
  back: (() => void) | null,
  onComplete: () => void,
): JSX.Element {
  const onBack = back ?? ((): void => undefined);
  switch (id) {
    case 'welcome':
      return <WelcomeStep onNext={next} />;
    case 'auth':
      return <AuthStep onNext={next} onBack={onBack} />;
    case 'node':
      return <NodeStep onNext={next} onBack={onBack} />;
    case 'cli':
      return <CliStep onNext={next} onBack={onBack} />;
    case 'provider':
      return <ProviderStep onNext={next} onBack={onBack} />;
    case 'workspace':
      return <WorkspaceStep onNext={next} onBack={onBack} />;
    case 'done':
      return <DoneStep onComplete={onComplete} />;
    default:
      return <></>;
  }
}

/** Node.js prerequisite — only applies when Node isn't detected. */
function NodeStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const ob = useOnboarding();
  const installed = ob.node?.installed ?? false;
  return (
    <StepCard
      title="Install Node.js"
      sub="Node.js is the runtime moxxy is built on — a free download from nodejs.org. Install it, then re-check."
    >
      {installed && <SuccessRow text={`Node ${ob.node?.version ?? ''} detected`} />}
      <PrimaryButton onClick={() => void ob.openExternal('https://nodejs.org/en/download')}>
        Open nodejs.org
      </PrimaryButton>
      <Nav
        onBack={onBack}
        onNext={installed ? onNext : () => void ob.refresh()}
        nextLabel={installed ? 'Continue' : 'Re-check'}
      />
    </StepCard>
  );
}

// ---------- Steps ----------------------------------------------------------

function WelcomeStep({ onNext }: { readonly onNext: () => void }): JSX.Element {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 18 }}
    >
      <img
        src="/avatar.gif"
        alt=""
        aria-hidden
        className="moxxy-avatar-loader"
        style={{ width: 220, height: 'auto', imageRendering: 'pixelated' }}
      />
      <div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>
          Hi, I&rsquo;m <span style={{ color: 'var(--color-primary-strong)' }}>Moxxy</span>.
        </h2>
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          Your personal AI workspaces, running on your machine. Bring your own
          provider keys, pick a model, and I&rsquo;ll do the rest.
        </p>
      </div>
      <PrimaryButton onClick={onNext}>
        Let&rsquo;s go <Icon name="chevron-right" size={14} />
      </PrimaryButton>
    </div>
  );
}

function AuthStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  if (!CLERK_KEY) {
    return (
      <StepCard
        title="Sign in"
        sub="Auth provider isn't configured for this build. Continuing as a local user."
      >
        <div
          style={{
            padding: '16px 18px',
            background: 'var(--color-card-bg)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 13,
            color: 'var(--color-text-muted)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            Local-only mode
          </div>
          <p style={{ margin: 0 }}>
            To enable Clerk-backed sign-in, set{' '}
            <code className="mono">VITE_CLERK_PUBLISHABLE_KEY</code> in the
            renderer env and rebuild.
          </p>
        </div>
        <Nav onBack={onBack} onNext={onNext} nextLabel="Continue" />
      </StepCard>
    );
  }
  return (
    <StepCard title="Sign in" sub="So your settings sync across machines.">
      <SignedOut>
        <div style={authCardStyle}>
          <SignIn
            routing="virtual"
            forceRedirectUrl="#"
            appearance={brandedClerkAppearance}
          />
        </div>
      </SignedOut>
      <SignedIn>
        <SignedInPanel onNext={onNext} />
      </SignedIn>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        <button type="button" onClick={onBack} style={secondaryBtnStyle}>
          Back
        </button>
        <button type="button" onClick={onNext} style={secondaryBtnStyle}>
          Skip sign-in
        </button>
      </div>
    </StepCard>
  );
}

function SignedInPanel({ onNext }: { readonly onNext: () => void }): JSX.Element {
  const { user } = useUser();
  const { update } = usePrefs();

  // Persist the Clerk identity into desktop prefs once on mount.
  useEffect(() => {
    if (!user) return;
    void update({
      clerkUserId: user.id,
      clerkDisplayName:
        user.fullName ??
        user.primaryEmailAddress?.emailAddress ??
        user.username ??
        null,
      signedInAt: Date.now(),
    });
    // We deliberately only run on first mount after user resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'var(--color-primary-soft)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 12,
          background: 'var(--color-primary)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
        }}
      >
        <Icon name="check" size={18} />
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Signed in as{' '}
          {user?.fullName ??
            user?.primaryEmailAddress?.emailAddress ??
            'you'}
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          Click Continue to install the moxxy runtime.
        </div>
      </div>
      <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
    </div>
  );
}

function CliStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  type State = 'probing' | 'present' | 'missing' | 'installing' | 'failed';
  const [state, setState] = useState<State>('probing');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('onboarding.status')
      .then((status) => {
        if (cancelled) return;
        setState(status.cliPath ? 'present' : 'missing');
      })
      .catch(() => {
        if (!cancelled) setState('missing');
      });
    const off = api().subscribe('onboarding.install.progress', (line: string) => {
      setLogLines((cur) => [...cur.slice(-200), line]);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const install = async (): Promise<void> => {
    setState('installing');
    setLogLines([]);
    setError(null);
    try {
      const code = await api().invoke('onboarding.installMoxxyCli');
      if (code === 0) setState('present');
      else {
        setState('failed');
        setError(`npm exit ${code}`);
      }
    } catch (e) {
      setState('failed');
      setError(toErrorMessage(e));
    }
  };

  return (
    <StepCard
      title="Install moxxy"
      sub="The moxxy CLI runs your agent locally. We use npm to install it."
    >
      {state === 'probing' && <Pulse label="Looking for moxxy on your PATH…" />}
      {state === 'present' && (
        <SuccessRow text="moxxy is installed and ready." />
      )}
      {(state === 'missing' || state === 'failed') && (
        <div
          style={{
            padding: '14px 16px',
            background: '#fdf2f8',
            border: '1px solid var(--color-card-border)',
            borderRadius: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {state === 'missing' ? 'moxxy isn\'t installed yet.' : 'Install failed.'}
          </div>
          {error && <div style={{ color: 'var(--color-red)' }}>{error}</div>}
          <PrimaryButton onClick={() => void install()}>
            {state === 'failed' ? 'Try again' : 'Install moxxy'}
          </PrimaryButton>
        </div>
      )}
      {state === 'installing' && (
        <>
          <Pulse label="Installing moxxy via npm…" />
          {logLines.length > 0 && (
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 10,
                background: '#0f172a',
                color: '#e2e8f0',
                borderRadius: 10,
                fontSize: 11,
                maxHeight: 180,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            >
              {logLines.slice(-40).join('\n')}
            </pre>
          )}
        </>
      )}
      <Nav onBack={onBack} onNext={onNext} nextDisabled={state !== 'present'} />
    </StepCard>
  );
}

function ProviderStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const [catalog, setCatalog] = useState<ReadonlyArray<string>>([
    'anthropic',
    'openai',
    'openai-codex',
  ]);
  const [provider, setProvider] = useState('anthropic');
  const [authKind, setAuthKind] = useState<'oauth' | 'api-key'>('api-key');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loginLog, setLoginLog] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void api()
      .invoke('settings.providerCatalog')
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setCatalog(list);
        setProvider((cur) => (list.includes(cur) ? cur : list[0]!));
      })
      .catch(() => {
        /* keep static fallback */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refresh the auth kind every time the selected provider changes so
  // the UI flips between "Paste API key" and "Sign in with browser".
  useEffect(() => {
    let cancelled = false;
    setDone(false);
    setError(null);
    void api()
      .invoke('onboarding.providerAuthKind', { provider })
      .then((kind) => {
        if (!cancelled) setAuthKind(kind);
      })
      .catch(() => {
        if (!cancelled) setAuthKind('api-key');
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Reuse the install-progress channel so the OAuth subprocess's
  // stdout (the URL prompt, success row, etc.) streams to the
  // log box.
  useEffect(() => {
    const off = api().subscribe('onboarding.install.progress', (line: string) => {
      setLoginLog((cur) => [...cur.slice(-80), line]);
    });
    return off;
  }, []);

  const saveKey = async (): Promise<void> => {
    if (!secret.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api().invoke('onboarding.saveProviderKey', {
        provider,
        secret: secret.trim(),
      });
      setSecret('');
      setDone(true);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const runOauthLogin = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    setLoginLog([]);
    try {
      const code = await api().invoke('onboarding.runProviderLogin', { provider });
      if (code === 0) setDone(true);
      else setError(`moxxy login exit ${code}`);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <StepCard
      title="Connect a provider"
      sub={
        authKind === 'oauth'
          ? "We'll open your browser to finish signing in. Tokens land in the vault, encrypted."
          : "Drop in an API key from your provider. It's encrypted by the moxxy vault."
      }
    >
      <div
        style={{
          padding: '16px 18px',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Provider
          </span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={inputStyle}
          >
            {catalog.map((name) => (
              <option key={name} value={name}>
                {name}
                {name === 'openai-codex' ? ' · OAuth' : ''}
              </option>
            ))}
          </select>
        </label>
        {authKind === 'api-key' && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
              API key
            </span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="sk-…"
              style={inputStyle}
            />
          </label>
        )}
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
        {done && (
          <SuccessRow
            text={
              authKind === 'oauth'
                ? `Signed in to ${provider}.`
                : 'Key saved to the vault.'
            }
          />
        )}
        {authKind === 'oauth' ? (
          <PrimaryButton onClick={() => void runOauthLogin()} disabled={saving}>
            {saving ? 'Waiting for browser…' : done ? `Re-link ${provider}` : `Sign in with ${provider}`}
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => void saveKey()} disabled={saving || !secret.trim()}>
            {saving ? 'Saving…' : done ? 'Update key' : 'Save key'}
          </PrimaryButton>
        )}
        {authKind === 'oauth' && loginLog.length > 0 && (
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 10,
              background: '#0f172a',
              color: '#e2e8f0',
              borderRadius: 10,
              fontSize: 11,
              maxHeight: 140,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {loginLog.slice(-20).join('\n')}
          </pre>
        )}
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel={done ? 'Continue' : 'Skip for now'} />
    </StepCard>
  );
}

function WorkspaceStep({
  onNext,
  onBack,
}: {
  readonly onNext: () => void;
  readonly onBack: () => void;
}): JSX.Element {
  const desks = useDesks();
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState('My workspace');
  const [creating, setCreating] = useState(false);

  const onPickFolder = async (): Promise<void> => {
    const f = await desks.pickFolder();
    if (f) {
      setFolder(f);
      setName(f.split('/').filter(Boolean).pop() ?? 'My workspace');
    }
  };

  const onCreate = async (): Promise<void> => {
    if (!folder || !name.trim()) return;
    setCreating(true);
    try {
      const desk = await desks.create(name.trim(), folder);
      if (desk) await desks.setActive(desk.id);
      onNext();
    } finally {
      setCreating(false);
    }
  };

  const hasAny = desks.desks.length > 0;

  return (
    <StepCard
      title="Pick a workspace"
      sub="A workspace is a folder I'll operate in. You can add more later."
    >
      {hasAny && (
        <SuccessRow
          text={`You already have ${desks.desks.length} workspace${desks.desks.length === 1 ? '' : 's'}.`}
        />
      )}
      <div
        style={{
          padding: '16px 18px',
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <button type="button" onClick={() => void onPickFolder()} style={pickerBtnStyle}>
          <Icon name="workspace" size={16} />
          {folder ? folder : 'Choose a folder…'}
        </button>
        {folder && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </label>
        )}
        <PrimaryButton
          onClick={() => void onCreate()}
          disabled={!folder || !name.trim() || creating}
        >
          {creating ? 'Creating…' : 'Create workspace'}
        </PrimaryButton>
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel="Skip for now" />
    </StepCard>
  );
}

function DoneStep({ onComplete }: { readonly onComplete: () => void }): JSX.Element {
  const { update } = usePrefs();
  const onFinish = async (): Promise<void> => {
    await update({ onboardingComplete: true });
    onComplete();
  };
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 18,
      }}
    >
      <img
        src="/avatar.gif"
        alt=""
        aria-hidden
        style={{ width: 200, height: 'auto', imageRendering: 'pixelated' }}
      />
      <div>
        <h2 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>You&rsquo;re all set!</h2>
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          Open your workspaces, send your first message, and tell me what we&rsquo;re building today.
        </p>
      </div>
      <PrimaryButton onClick={() => void onFinish()}>
        Open my workspaces <Icon name="chevron-right" size={14} />
      </PrimaryButton>
    </div>
  );
}
