import { useEffect, useRef, useState } from 'react';
import { Button, Modal, TextInput } from '@moxxy/desktop-ui';
import { toErrorMessage } from '@moxxy/client-core';

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
  const [error, setError] = useState<string | null>(null);
  // The parent closes the modal on success, so a slow/failed rename can resolve
  // after unmount — guard the setState calls so we don't touch a dead component.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canSubmit = name.trim().length > 0 && name.trim() !== desk.name;
  return (
    <Modal title="Rename workspace" onClose={onClose}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit || busy) return;
          setBusy(true);
          setError(null);
          try {
            await onSubmit(name.trim());
          } catch (err) {
            // A rejected rename (runner down, name conflict, mid-flight
            // disconnect) must clear the busy lock and surface the reason —
            // otherwise the modal strands disabled showing 'Renaming…'.
            if (mounted.current) setError(toErrorMessage(err));
          } finally {
            if (mounted.current) setBusy(false);
          }
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
        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--color-red)' }}>
            {error}
          </p>
        )}
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
