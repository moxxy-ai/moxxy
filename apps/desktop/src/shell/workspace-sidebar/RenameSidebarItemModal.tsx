import { useEffect, useState } from 'react';
import { Button, Modal, TextInput } from '@moxxy/desktop-ui';

export function RenameSidebarItemModal({
  title,
  defaultName,
  description,
  onSubmit,
  onCancel,
}: {
  readonly title: string;
  readonly defaultName: string;
  readonly description: string;
  readonly onSubmit: (name: string) => void;
  readonly onCancel: () => void;
}): JSX.Element {
  const draft = useRenameDraft(defaultName);
  return (
    <Modal title={title} onClose={onCancel} width={420}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.canSubmit) onSubmit(draft.trimmedName);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 13.5,
            color: 'var(--color-text-muted)',
            lineHeight: 1.55,
          }}
        >
          {description}
        </p>
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
          <TextInput
            autoFocus
            value={draft.name}
            onChange={(e) => draft.setName(e.target.value)}
          />
        </label>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            disabled={!draft.canSubmit}
            style={{ opacity: draft.canSubmit ? 1 : 0.5 }}
          >
            Rename
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

function useRenameDraft(defaultName: string): {
  readonly name: string;
  readonly trimmedName: string;
  readonly canSubmit: boolean;
  readonly setName: (name: string) => void;
} {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    setName(defaultName);
  }, [defaultName]);

  const trimmedName = name.trim();
  return {
    name,
    trimmedName,
    canSubmit: trimmedName.length > 0 && trimmedName !== defaultName.trim(),
    setName,
  };
}
