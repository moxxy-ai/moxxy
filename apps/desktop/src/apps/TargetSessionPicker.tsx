/**
 * Picker for the session an ambient trigger (webhook / schedule / workflow)
 * runs and displays in. Lists every session grouped by desk (from
 * {@link useDesks}); the empty value means "no pinned session" (fire-once
 * across runners / deliver in-process). When the trigger is bound to a session
 * that no longer exists, a fallback option keeps the stored name visible so the
 * user can see — and change — a dangling binding.
 */

import { useDesks } from '@moxxy/client-core';

const selectStyle: React.CSSProperties = {
  fontSize: '0.72rem',
  padding: '2px 6px',
  borderRadius: 7,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-card)',
  color: 'var(--color-text)',
  maxWidth: 220,
};

export function TargetSessionPicker({
  value,
  valueName,
  onChange,
  label = 'Runs in',
}: {
  readonly value: string | null;
  /** Resolved display name of `value` (its session title), or null. */
  readonly valueName: string | null;
  readonly onChange: (sessionId: string | null) => void;
  readonly label?: string;
}): JSX.Element {
  const { desks } = useDesks();
  const known = value === null || desks.some((d) => d.sessions.some((s) => s.id === value));

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--color-text-dim)' }}>
      {label}
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        style={selectStyle}
      >
        <option value="">Any session (unpinned)</option>
        {/* A binding to a since-deleted session would otherwise show blank — keep
            the stored name (or id) selectable so the dangling pin is visible. */}
        {!known && value !== null && (
          <option value={value}>{valueName ?? value} (missing)</option>
        )}
        {desks.map((desk) => (
          <optgroup key={desk.id} label={desk.name}>
            {desk.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
