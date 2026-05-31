import { useState } from 'react';
import { Button, Modal, TextInput } from '@moxxy/desktop-ui';

export function RenameWorkspaceModal({
  desk,
  onSubmit,
  onClose,
}: {
  readonly desk: { id: string; name: string; cwd: string };
  readonly onSubmit: (name: string) => Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const [name, setName] = useState(desk.name);
  const [busy, setBusy] = useState(false);
  const canSubmit = name.trim().length > 0 && name.trim() !== desk.name;
  return (
    <Modal title="Rename workspace" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setBusy(true);
          await onSubmit(name.trim());
          setBusy(false);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Name
          </span>
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div
          className="mono"
          style={{
            fontSize: 11.5,
            color: 'var(--color-text-dim)',
            wordBreak: 'break-all',
          }}
        >
          {desk.cwd}
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!canSubmit || busy}
            style={{ opacity: canSubmit && !busy ? 1 : 0.5 }}
          >
            {busy ? 'Renaming…' : 'Rename'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
