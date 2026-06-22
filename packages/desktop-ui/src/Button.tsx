/**
 * Button primitives — the resting inline style + the right global className for
 * each look the desktop uses. Hover/active styling comes from the app's global
 * CSS (`.btn-cta`, `.btn-outline`, `.btn-chip`, `.btn-ghost`, `.btn-icon` in
 * styles.css), so a primitive that emits the matching className inherits those.
 * The package itself ships the keyboard-focus ring + disabled affordance (via an
 * injected `.moxxy-btn` rule) so a host that does NOT load the desktop's CSS
 * (the advertised future web channel) still gets an accessible focus indicator.
 *
 * `variant` picks the look; `style`/`className` are merged last so a call site
 * can still tweak padding, swap a background (e.g. a red destructive action),
 * or add an icon gap without re-deriving the whole object.
 */
import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export type ButtonVariant = 'primary' | 'cta' | 'secondary' | 'chip' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'lg';

// Marker class carried by every primitive button so the package can ship its
// own keyboard-focus ring + disabled affordance, instead of relying on each
// host app's global CSS (a future web channel gets these for free). The rules
// are low-specificity so a host's variant styling still wins where it overlaps.
const MARKER = 'moxxy-btn';
const BTN_STYLE_ID = 'moxxy-btn-states';

function ensureButtonStates(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(BTN_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = BTN_STYLE_ID;
  style.textContent = [
    `.${MARKER}{cursor:pointer;}`,
    `.${MARKER}:focus-visible{outline:2px solid var(--color-primary-strong,#2563eb);outline-offset:2px;}`,
    `.${MARKER}:disabled{opacity:0.55;cursor:not-allowed;}`,
  ].join('');
  document.head.appendChild(style);
}

// Inject eagerly on module load (idempotent + SSR-safe) so the focus ring is
// present before the first button paints.
ensureButtonStates();

// ReferenceError-safe dev check — `process` may be undefined in a bare browser
// bundle (the advertised future web channel), so reach it via globalThis and
// don't touch it unguarded. (@types/node isn't a dep of this UI-only package.)
function isDev(): boolean {
  try {
    const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
    return proc?.env?.NODE_ENV !== 'production';
  } catch {
    return false;
  }
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * - `primary` — solid accent fill (the modal-footer confirm look)
   * - `cta` — gradient call-to-action (`btn-cta`)
   * - `secondary` — bordered/ghost-outline ("Cancel"/"Close"/"Back")
   * - `chip` — small bordered pill
   * - `ghost` — borderless, transparent
   * - `danger` — solid red destructive fill
   */
  readonly variant?: ButtonVariant;
  /** `sm` (default) = `8px 14px`/13px; `lg` = the larger onboarding size. */
  readonly size?: ButtonSize;
}

const VARIANT: Record<ButtonVariant, { className?: string; style: CSSProperties }> = {
  primary: { style: { background: 'var(--color-primary-strong)', color: '#fff', border: 'none' } },
  cta: {
    className: 'btn-cta',
    style: { background: 'var(--grad-cta)', color: '#fff', border: 'none' },
  },
  secondary: {
    className: 'btn-outline',
    style: {
      background: 'var(--color-surface)',
      color: 'var(--color-text-muted)',
      border: '1px solid var(--color-card-border)',
    },
  },
  chip: {
    className: 'btn-chip',
    style: {
      background: 'var(--color-surface)',
      color: 'var(--color-text-muted)',
      border: '1px solid var(--color-card-border)',
      fontSize: 12.5,
      padding: '6px 12px',
    },
  },
  ghost: {
    className: 'btn-ghost',
    style: { background: 'transparent', color: 'var(--color-text-muted)', border: 'none' },
  },
  danger: { style: { background: 'var(--color-red)', color: '#fff', border: 'none' } },
};

const BASE: CSSProperties = {
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 10,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
};

export function Button({
  variant = 'secondary',
  size = 'sm',
  className,
  style,
  type = 'button',
  ...rest
}: ButtonProps): JSX.Element {
  const v = VARIANT[variant];
  const merged: CSSProperties = {
    ...BASE,
    ...(size === 'lg' ? { padding: '10px 18px', fontSize: 14 } : {}),
    ...v.style,
    ...style,
  };
  const cls = [MARKER, v.className, className].filter(Boolean).join(' ');
  return <button type={type} className={cls} style={merged} {...rest} />;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Square edge length in px (width = height). Default 28. */
  readonly size?: number;
  /** Corner radius in px. Default 8. */
  readonly radius?: number;
  /** Draw a card border + surface fill (the rail's collapse affordance). */
  readonly bordered?: boolean;
}

export function IconButton({
  size = 28,
  radius = 8,
  bordered = false,
  className,
  style,
  type = 'button',
  children,
  ...rest
}: IconButtonProps): JSX.Element {
  // Icon-only buttons announce as an empty button to screen readers unless they
  // carry an accessible name. Nudge call sites in dev when none is present.
  if (isDev()) {
    const labelled =
      Boolean(rest['aria-label']) ||
      Boolean(rest['aria-labelledby']) ||
      Boolean(rest.title) ||
      hasTextContent(children);
    if (!labelled) {
      console.warn(
        '[IconButton] missing accessible name: pass aria-label, aria-labelledby, title, or text children.',
      );
    }
  }
  const merged: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    color: 'var(--color-text-dim)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(bordered
      ? { border: '1px solid var(--color-card-border)', background: 'var(--color-surface)' }
      : {}),
    ...style,
  };
  const cls = [MARKER, 'btn-icon', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} style={merged} {...rest}>
      {children}
    </button>
  );
}

// True only when children carry a non-whitespace string (an SVG-only child is
// invisible to AT, so it doesn't count as an accessible name).
function hasTextContent(children: React.ReactNode): boolean {
  if (children == null || children === false) return false;
  if (typeof children === 'string') return children.trim().length > 0;
  if (typeof children === 'number') return true;
  if (Array.isArray(children)) return children.some(hasTextContent);
  return false;
}
