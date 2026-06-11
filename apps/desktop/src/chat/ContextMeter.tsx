import { useState } from 'react';
import { Button } from '@moxxy/desktop-ui';
import { useContextUsage } from '@moxxy/client-core';
import { UsageModal } from './UsageModal';

/**
 * Compact context-fill gauge for the composer footer. Shows the share of
 * the model's context window the conversation currently occupies (escalating
 * pink → amber → red), and opens the {@link UsageModal} on click for the full
 * token breakdown plus a one-tap compaction.
 *
 * Shown as soon as the active model's context window is known (on connect) —
 * at 0% before the first reply, filling as the conversation grows. Hidden
 * only when the window size can't be resolved (no model/provider yet).
 */
export function ContextMeter({ workspaceId }: { readonly workspaceId: string }): JSX.Element | null {
  const usage = useContextUsage(workspaceId);
  const [open, setOpen] = useState(false);

  if (usage.fraction == null) return null;

  const f = usage.fraction;
  const color = f >= 0.85 ? 'var(--color-red)' : f >= 0.6 ? 'var(--color-amber)' : 'var(--color-primary)';
  const label = `${Math.round(f * 100)}%`;

  return (
    <>
      <Button
        variant="chip"
        aria-label={`Context ${label} used — open usage`}
        title={`Context ${label} used · click for usage & compaction`}
        onClick={() => setOpen(true)}
        style={{ gap: 7, padding: '6px 10px', fontSize: 12 }}
      >
        <span
          aria-hidden
          style={{
            width: 30,
            height: 5,
            borderRadius: 999,
            background: 'color-mix(in srgb, var(--color-text-dim) 22%, transparent)',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: 'block',
              width: `${Math.round(f * 100)}%`,
              height: '100%',
              borderRadius: 999,
              background: color,
            }}
          />
        </span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{label}</span>
      </Button>
      {open && <UsageModal usage={usage} workspaceId={workspaceId} onClose={() => setOpen(false)} />}
    </>
  );
}
