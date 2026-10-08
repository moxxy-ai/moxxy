import type { ReactNode } from 'react';

/**
 * An icon-only control in a bar. The accessible name says what a press does;
 * the tooltip says the same to the eye and opens downwards, into the window.
 */
export function BarButton({
  children,
  label,
  tip,
  pressed,
  live = false,
  disabled = false,
  testId,
  hotkey,
  onClick,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly tip: string;
  /** For a control that switches something on and off. */
  readonly pressed?: boolean;
  /** What it switches on is running now, so it takes the accent. */
  readonly live?: boolean;
  readonly disabled?: boolean;
  readonly testId?: string;
  /** The keymap binding this press is, written on the control while the modifier is held. */
  readonly hotkey?: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="btn-quiet tip"
      data-tip={tip}
      data-tip-side="bottom"
      data-tone={live ? 'live' : undefined}
      data-testid={testId}
      data-hotkey={hotkey}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
