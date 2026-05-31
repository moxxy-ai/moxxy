/**
 * Button primitives — the resting inline style + the right global className for
 * each look the desktop uses. Hover/active/disabled/focus are all handled by
 * the app's global CSS (`button`, `.btn-cta`, `.btn-outline`, `.btn-chip`,
 * `.btn-ghost`, `.btn-icon` in styles.css), so a primitive that emits the
 * matching className inherits every interaction state for free.
 *
 * `variant` picks the look; `style`/`className` are merged last so a call site
 * can still tweak padding, swap a background (e.g. a red destructive action),
 * or add an icon gap without re-deriving the whole object.
 */
import type { ButtonHTMLAttributes, CSSProperties } from 'react';

export type ButtonVariant = 'primary' | 'cta' | 'secondary' | 'chip' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'lg';

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
      background: '#fff',
      color: 'var(--color-text-muted)',
      border: '1px solid var(--color-card-border)',
    },
  },
  chip: {
    className: 'btn-chip',
    style: {
      background: '#fff',
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
  const cls = [v.className, className].filter(Boolean).join(' ') || undefined;
  return <button type={type} className={cls} style={merged} {...rest} />;
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Square edge length in px (width = height). Default 28. */
  readonly size?: number;
  /** Corner radius in px. Default 8. */
  readonly radius?: number;
  /** Draw a card border + white fill (the rail's collapse affordance). */
  readonly bordered?: boolean;
}

export function IconButton({
  size = 28,
  radius = 8,
  bordered = false,
  className,
  style,
  type = 'button',
  ...rest
}: IconButtonProps): JSX.Element {
  const merged: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    color: 'var(--color-text-dim)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...(bordered ? { border: '1px solid var(--color-card-border)', background: '#fff' } : {}),
    ...style,
  };
  const cls = ['btn-icon', className].filter(Boolean).join(' ');
  return <button type={type} className={cls} style={merged} {...rest} />;
}
