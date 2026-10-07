/** Whether a thing is switched on, as a chip that switches it. */
export function StateToggle({
  enabled,
  name,
  onToggle,
  testId,
}: {
  readonly enabled: boolean;
  /** What is being switched; it names the action for a screen reader. */
  readonly name: string;
  readonly onToggle: (next: boolean) => void;
  readonly testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className="tag tag--press"
      data-tone={enabled ? 'good' : undefined}
      data-testid={testId}
      aria-pressed={enabled}
      aria-label={`${enabled ? 'Disable' : 'Enable'} ${name}`}
      onClick={() => onToggle(!enabled)}
    >
      {enabled ? 'On' : 'Paused'}
    </button>
  );
}
