import { useState } from 'react';
import { Button, Modal, TextInput } from '@moxxy/desktop-ui';

/**
 * Naming dialog shown after the user picks a folder for a new workspace.
 * Pre-fills the field with the folder's basename and echoes the full
 * path below so the user can confirm what they picked before creating.
 */
export function NameWorkspaceModal({
  defaultName,
  folder,
  onSubmit,
  onCancel,
}: {
  readonly defaultName: string;
  readonly folder: string;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState(defaultName);
  const canSubmit = name.trim().length > 0;
  return (
    <Modal title="New workspace" onClose={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(name);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontSize: 12.5,
            fontWeight: 600,
            color: 'var(--color-text-muted)',
          }}
        >
          Name
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div
          className="mono"
          style={{
            fontSize: 11.5,
            color: 'var(--color-text-dim)',
            wordBreak: 'break-all',
            padding: '8px 10px',
            background: 'var(--color-input-soft)',
            border: '1px solid var(--color-card-border)',
            borderRadius: 8,
          }}
        >
          {folder}
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.5 }}
          >
            Create
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
