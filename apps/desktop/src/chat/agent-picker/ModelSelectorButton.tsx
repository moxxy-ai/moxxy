/**
 * Top-bar model selector (z.ai puts the model name top-left). A quiet pill
 * showing the active "provider/model" with a disclosure caret; opens the same
 * two-column {@link ProviderModelPicker} modal the composer used. Reuses
 * {@link useSessionAgent}, so it stays in sync with the composer's mode chip.
 */

import { useState } from 'react';
import { Icon } from '@moxxy/desktop-ui';
import { ProviderModelPicker } from './ProviderModelPicker';
import { useSessionAgent } from './useSessionAgent';

export function ModelSelectorButton({
  workspaceId,
}: {
  readonly workspaceId: string;
}): JSX.Element | null {
  const { info, selectedModel, label, pickProviderModel } = useSessionAgent(workspaceId);
  const [open, setOpen] = useState(false);

  if (!info) return null;

  return (
    <>
      <button
        type="button"
        className="btn-ghost"
        data-testid="topbar-model"
        onClick={() => setOpen(true)}
        title="Switch model"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 9,
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--color-text)',
          background: 'transparent',
          maxWidth: 280,
        }}
      >
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>
        <span aria-hidden style={{ color: 'var(--color-text-dim)', display: 'inline-flex' }}>
          <Icon name="chevron-right" size={14} style={{ transform: 'rotate(90deg)' }} />
        </span>
      </button>
      {open && (
        <ProviderModelPicker
          providers={info.providers}
          activeProvider={info.activeProvider}
          activeModel={selectedModel}
          onPick={(p, m) => {
            void pickProviderModel(p, m);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
