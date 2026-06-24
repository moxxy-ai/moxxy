import { useState } from 'react';
import { Button, Modal } from '@moxxy/desktop-ui';
import { useContextUsage } from '@moxxy/client-core';
import type { SessionInfo } from '../agent-picker/types';
import { ProviderModelGrid } from '../agent-picker/ProviderModelGrid';
import { UsagePanel, fillColor } from './UsagePanel';

/**
 * The composer's right-aligned model control — a subtle, borderless text label
 * (the active model name, falling back to the provider) rather than a chip
 * button, so it reads as quiet status that happens to be clickable. Clicking it
 * opens the combined "Model & context" panel: the provider/model picker on top,
 * the context-window usage + one-click compaction below. It stands in for both
 * the old Model chip and the old standalone context meter.
 */
export function ModelContextControl({
  workspaceId,
  info,
  selectedModel,
  disabled,
  onPick,
}: {
  readonly workspaceId: string;
  readonly info: SessionInfo;
  readonly selectedModel: string | null;
  readonly disabled: boolean;
  readonly onPick: (provider: string, model: string | null) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const usage = useContextUsage(workspaceId);
  // Model name only (per design): the override when set, else the active
  // provider (its runner-default model isn't named until the first response).
  const label = selectedModel ?? info.activeProvider ?? 'Model';

  return (
    <>
      <Button
        variant="ghost"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Model & context"
        aria-label={
          usage.fraction != null
            ? `Model ${label}, context ${pct(usage.fraction)} used — open model & context`
            : `Model ${label} — open model & context`
        }
        style={{
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 3,
          padding: '4px 9px',
          fontSize: 12.5,
          minWidth: 96,
          maxWidth: 220,
          fontWeight: 600,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <span
            style={{
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {label}
          </span>
          <span aria-hidden style={{ color: 'var(--color-text-dim)' }}>
            ▾
          </span>
        </span>
        {usage.fraction != null && <ContextMeter fraction={usage.fraction} />}
      </Button>
      {open && (
        <Modal title="Model & context" width={620} onClose={() => setOpen(false)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
                Model
              </h3>
              <ProviderModelGrid
                providers={info.providers}
                activeProvider={info.activeProvider}
                activeModel={selectedModel}
                onPick={(p, m) => {
                  onPick(p, m);
                  setOpen(false);
                }}
              />
            </section>
            <UsagePanel usage={usage} workspaceId={workspaceId} />
          </div>
        </Modal>
      )}
    </>
  );
}

function pct(f: number): string {
  return `${Math.round(f * 100)}%`;
}

/**
 * The inline context-window mini-meter that rides under the model name: a hair-
 * thin fill bar plus a tabular percent, color-ramped (amber/red) as the window
 * fills — a quiet at-a-glance gauge that the full panel expands on. Sized to sit
 * inside the ghost button without changing its rhythm.
 */
function ContextMeter({ fraction }: { readonly fraction: number }): JSX.Element {
  const f = Math.max(0, Math.min(1, fraction));
  const color = fillColor(f);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span
        style={{
          flex: 1,
          height: 3,
          borderRadius: 999,
          background: 'color-mix(in srgb, var(--color-text-dim) 22%, transparent)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${f * 100}%`,
            height: '100%',
            borderRadius: 999,
            background: color,
            transition: 'width 240ms ease',
          }}
        />
      </span>
      <span
        className="mono"
        style={{
          flexShrink: 0,
          fontSize: 9.5,
          fontWeight: 600,
          lineHeight: 1,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {pct(f)}
      </span>
    </span>
  );
}
