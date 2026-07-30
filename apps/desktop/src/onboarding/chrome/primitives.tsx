/**
 * Shared onboarding step primitives — the small building blocks every step
 * composes: StepCard (title + sub + body), Nav (Back / Next footer),
 * PrimaryButton (the gradient CTA), SuccessRow (the green confirmed row),
 * and Pulse (the avatar loading row). Style tokens live in ./styles; this
 * module is otherwise self-contained so it stays a dependency leaf.
 */

import { MoxxyMark } from '@/components/MoxxyMark';
import { primaryBtnStyle, secondaryBtnStyle } from './styles';

// ---- StepCard -------------------------------------------------------------

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-16)' }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 'var(--type-section)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          {title}
        </h2>
        {/* The one place the wizard speaks in the prose voice: this is the
         *  sentence explaining the step, not a readout. */}
        <p
          className="prose"
          style={{
            margin: 'var(--space-6) 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 'var(--type-ui)',
          }}
        >
          {sub}
        </p>
      </header>
      {children}
    </div>
  );
}

// ---- Nav ------------------------------------------------------------------

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
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-4)' }}>
      <button type="button" onClick={onBack} style={secondaryBtnStyle}>
        Back
      </button>
      <PrimaryButton onClick={onNext} disabled={nextDisabled}>
        {nextLabel}
      </PrimaryButton>
    </div>
  );
}

// ---- PrimaryButton --------------------------------------------------------

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

// ---- SecondaryButton ------------------------------------------------------

/** Outline button for the lower-emphasis action next to a PrimaryButton
 *  (e.g. "Open nodejs.org" beside "Install automatically"). */
export function SecondaryButton({
  children,
  style,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  return (
    <button
      type="button"
      {...rest}
      style={{
        ...secondaryBtnStyle,
        opacity: rest.disabled ? 0.5 : 1,
        cursor: rest.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

// ---- SuccessRow -----------------------------------------------------------

export function SuccessRow({ text }: { readonly text: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-8)',
        minHeight: 'var(--frame-row)',
        padding: '0 var(--space-8)',
        background: 'var(--color-success-soft)',
        border: '1px solid var(--color-success-soft-border)',
        borderRadius: 'var(--radius-chip)',
        fontSize: 'var(--type-row)',
        color: 'var(--color-success-soft-text)',
        fontWeight: 500,
      }}
    >
      {/* Nominal is nominal: the same green LED that reports it everywhere else,
       *  not a badge invented for this one row. */}
      <span className="led" data-state="done" aria-hidden />
      {text}
    </div>
  );
}

// ---- Pulse ----------------------------------------------------------------

export function Pulse({ label }: { readonly label: string }): JSX.Element {
  return (
    <div
      style={{
        padding: 'var(--space-8) var(--space-12)',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
        borderRadius: 'var(--radius-block)',
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-8)',
        fontSize: 'var(--type-row)',
        color: 'var(--color-text-muted)',
      }}
    >
      <MoxxyMark size={28} className="moxxy-avatar-loader moxxy-avatar-loader--sm" />
      {label}
    </div>
  );
}
