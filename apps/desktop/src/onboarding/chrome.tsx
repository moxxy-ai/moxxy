/**
 * Shared onboarding chrome — the wizard Shell + stepper, the step
 * primitives (StepCard / Nav / PrimaryButton / SuccessRow / Pulse), the
 * branded Clerk <SignIn> appearance, and the shared style tokens. Both
 * the orchestration (Onboarding) and the step components import from here,
 * so it stays a dependency leaf (no import back into Onboarding).
 */

import { Icon } from '@/lib/Icon';

export const CLERK_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/**
 * Strip every piece of Clerk's default chrome (card border + shadow,
 * brand header, "Secured by Clerk" footer, OAuth icons) and recolour
 * the bits we keep so the embedded SignIn reads as part of our
 * wizard. The footer's "Development mode" badge is added by Clerk's
 * dev key — it's intentional and disappears when you swap in a
 * production key.
 */
export const brandedClerkAppearance = {
  variables: {
    colorPrimary: '#ec4899',
    colorBackground: '#ffffff',
    colorText: '#0f172a',
    colorTextSecondary: '#475569',
    colorInputBackground: '#f7f8fc',
    colorInputText: '#0f172a',
    colorDanger: '#ef4444',
    borderRadius: '10px',
    fontFamily:
      "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  },
  layout: {
    logoPlacement: 'none',
    showOptionalFields: false,
    socialButtonsVariant: 'blockButton',
    socialButtonsPlacement: 'top',
    helpPageUrl: '',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: {
      width: '100%',
      maxWidth: 'none',
      boxShadow: 'none',
      border: 'none',
      background: 'transparent',
    },
    card: {
      width: '100%',
      maxWidth: 'none',
      background: 'transparent',
      boxShadow: 'none',
      border: 'none',
      padding: 0,
    },
    main: { width: '100%', gap: 14, padding: 0 },
    form: { width: '100%', gap: 12 },
    // Header is hidden via title/subtitle styles below, but the
    // container still reserves its padding — collapse it so the OAuth
    // row sits flush with the card top.
    header: { display: 'none', padding: 0, margin: 0 },
    // The field hint ("Example format: name@example.com") rendered
    // BELOW the input was floating over the Continue button. Drop it
    // — the placeholder + autocomplete is enough.
    formFieldHintText: { display: 'none' },
    formFieldInfoText: { display: 'none' },
    formFieldSuccessText: { display: 'none' },
    formFieldRow: { gap: 6 },
    formFieldAction: { color: 'var(--color-primary-strong)' },
    headerTitle: { display: 'none' },
    headerSubtitle: { display: 'none' },
    logoBox: { display: 'none' },
    footer: { display: 'none' },
    footerAction: { display: 'none' },
    socialButtons: { gap: 8 },
    socialButtonsBlockButton: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      border: '1px solid var(--color-card-border)',
      background: '#fff',
      color: 'var(--color-text)',
      fontWeight: 600,
      borderRadius: 10,
      boxShadow: 'none',
      height: 42,
      minHeight: 42,
      lineHeight: 1,
      padding: '0 14px',
      overflow: 'visible',
      '&:hover': { background: '#f7f8fc', border: '1px solid var(--color-card-border-strong)' },
      '&::after': { display: 'none' },
      '&::before': { display: 'none' },
    },
    socialButtonsBlockButtonText: { fontWeight: 600, fontSize: 13, lineHeight: 1 },
    socialButtonsBlockButtonArrow: { display: 'none' },
    dividerLine: { background: 'var(--color-card-border)' },
    dividerText: {
      color: 'var(--color-text-dim)',
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
    },
    formFieldLabel: {
      fontSize: 12.5,
      fontWeight: 600,
      color: 'var(--color-text-muted)',
      marginBottom: 2,
    },
    formFieldInput: {
      width: '100%',
      height: 42,
      minHeight: 42,
      background: '#f7f8fc',
      border: '1px solid var(--color-card-border)',
      borderRadius: 10,
      padding: '0 12px',
      fontSize: 14,
      lineHeight: 1.2,
      color: 'var(--color-text)',
      boxShadow: 'none',
      transition: 'border-color 120ms ease, box-shadow 120ms ease',
      '&:focus, &:focus-visible': {
        outline: 'none',
        border: '1px solid var(--color-primary)',
        boxShadow: '0 0 0 3px rgba(236, 72, 153, 0.15)',
      },
      '&::placeholder': { color: 'var(--color-text-dim)' },
    },
    formButtonPrimary: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      width: '100%',
      height: 42,
      minHeight: 42,
      lineHeight: 1,
      padding: '0 16px',
      background: 'var(--grad-cta)',
      color: '#fff',
      fontWeight: 600,
      fontSize: 13.5,
      borderRadius: 10,
      boxShadow: '0 8px 18px -12px rgba(236, 72, 153, 0.55)',
      textTransform: 'none',
      letterSpacing: 0,
      overflow: 'visible',
      '&:hover': { filter: 'brightness(1.05)' },
      '&::after': { display: 'none' },
      '&::before': { display: 'none' },
    },
    formButtonPrimaryArrow: { display: 'none' },
    spinner: { color: '#fff' },
    identityPreviewEditButton: { color: 'var(--color-primary-strong)' },
  },
} as const;

// ---------- Shell ----------------------------------------------------------

export function Shell({
  steps,
  currentIndex,
  children,
}: {
  readonly steps: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly currentIndex: number;
  readonly children: React.ReactNode;
}): JSX.Element {
  const idx = currentIndex;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-app-bg)',
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        overflow: 'hidden',
      }}
    >
      <aside
        style={{
          background: 'var(--color-card-bg)',
          borderRight: '1px solid var(--color-card-border)',
          padding: '24px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img
            src="/logo.png"
            alt=""
            aria-hidden
            width={32}
            height={32}
            style={{ imageRendering: 'pixelated', borderRadius: 8 }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>MoxxyAI</span>
            <span
              style={{
                fontSize: 10.5,
                color: 'var(--color-text-dim)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              Workspaces
            </span>
          </div>
        </header>
        <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>
          Let&rsquo;s get you set up.
        </h1>
        <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 13.5 }}>
          A few quick steps and you&rsquo;ll have your own AI workspace running locally.
        </p>
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {steps.map((s, i) => {
            const done = i < idx;
            const current = i === idx;
            return (
              <li
                key={s.id}
                aria-current={current ? 'step' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 10px',
                  borderRadius: 9,
                  background: current ? 'var(--color-primary-soft)' : 'transparent',
                  color: current
                    ? 'var(--color-primary-strong)'
                    : done
                      ? 'var(--color-text-muted)'
                      : 'var(--color-text-dim)',
                  fontWeight: current ? 600 : 500,
                  fontSize: 13,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 999,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: done
                      ? 'var(--color-green)'
                      : current
                        ? 'var(--color-primary)'
                        : 'var(--color-card-border)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {done ? <Icon name="check" size={12} /> : i + 1}
                </span>
                {s.label}
              </li>
            );
          })}
        </ol>
        <span style={{ flex: 1 }} />
        <footer
          className="mono"
          style={{ fontSize: 10.5, color: 'var(--color-text-dim)' }}
        >
          You can run through this again from Settings → About at any time.
        </footer>
      </aside>
      <main
        style={{
          display: 'grid',
          placeItems: 'center',
          padding: '24px 32px',
          overflowY: 'auto',
        }}
      >
        <div style={{ width: '100%', maxWidth: 540 }}>{children}</div>
      </main>
    </div>
  );
}

// ---------- Shared primitives ---------------------------------------------

export function StepCard({
  title,
  sub,
  children,
}: {
  readonly title: string;
  readonly sub: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{title}</h2>
        <p
          style={{
            margin: '6px 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 13.5,
            lineHeight: 1.6,
          }}
        >
          {sub}
        </p>
      </header>
      {children}
    </div>
  );
}

export function Nav({
  onBack,
  onNext,
  nextLabel = 'Continue',
  nextDisabled,
}: {
  readonly onBack: () => void;
  readonly onNext: () => void;
  readonly nextLabel?: string;
  readonly nextDisabled?: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
      <button type="button" onClick={onBack} style={secondaryBtnStyle}>
        Back
      </button>
      <PrimaryButton onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
      </PrimaryButton>
    </div>
  );
}

export function PrimaryButton({
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      className={`btn-cta ${rest.className ?? ''}`.trim()}
      style={{
        ...primaryBtnStyle,
        opacity: rest.disabled ? 0.5 : 1,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}

export function SuccessRow({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        background: '#dcfce7',
        border: '1px solid #bbf7d0',
        borderRadius: 10,
        fontSize: 13,
        color: '#166534',
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          background: 'var(--color-green)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Icon name="check" size={13} />
      </span>
      {text}
    </div>
  );
}

export function Pulse({ label }: { readonly label: string }): JSX.Element {
  return (
    <div
      style={{
        padding: '14px 16px',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
        color: 'var(--color-text-muted)',
      }}
    >
      <img
        src="/avatar.gif"
        alt=""
        aria-hidden
        className="moxxy-avatar-loader moxxy-avatar-loader--sm"
        style={{ width: 28, height: 'auto', imageRendering: 'pixelated' }}
      />
      {label}
    </div>
  );
}

export const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--color-text)',
  background: '#fff',
  border: '1px solid var(--color-card-border)',
  borderRadius: 10,
  outline: 'none',
};

export const primaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  color: '#fff',
  background: 'var(--grad-cta)',
  border: 'none',
  borderRadius: 10,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  boxShadow: '0 10px 20px -12px rgba(236, 72, 153, 0.55)',
};

export const secondaryBtnStyle: React.CSSProperties = {
  padding: '10px 18px',
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: '1px solid var(--color-card-border)',
  borderRadius: 10,
};

export const pickerBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  fontSize: 13,
  color: 'var(--color-text)',
  background: '#f7f8fc',
  border: '1px dashed var(--color-card-border-strong)',
  borderRadius: 10,
  textAlign: 'left',
  width: '100%',
};

// --- Auth styles -----------------------------------------------------------

/** Outer wrapper that draws our card chrome so the SignIn component
 *  (whose own card is now hidden via appearance.elements.card) sits
 *  inside the same chrome as every other onboarding step. overflow
 *  stays visible so the embedded button's box-shadow halo isn't
 *  clipped at the card edge. */
export const authCardStyle: React.CSSProperties = {
  padding: '20px 18px 18px',
  background: 'var(--color-card-bg)',
  border: '1px solid var(--color-card-border)',
  borderRadius: 12,
  overflow: 'visible',
};