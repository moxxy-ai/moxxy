import type { ReactNode } from 'react';

/**
 * A round control in the composer's row. Icon-only: the tooltip and the
 * accessible name carry the word. A state that has to be read without hovering
 * ("Listening…") passes its own text as children and sets `wide`.
 */
export function ComposerButton({
  children,
  label,
  onClick,
  tone = 'idle',
  wide = false,
  disabled = false,
}: {
  readonly children: ReactNode;
  readonly label: string;
  readonly onClick?: () => void;
  readonly tone?: 'idle' | 'recording' | 'busy';
  /** Room for a word beside the icon. */
  readonly wide?: boolean;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="composer-btn tip"
      data-tone={tone}
      data-wide={wide ? 'true' : undefined}
      data-tip={label}
      data-tip-side="top"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
