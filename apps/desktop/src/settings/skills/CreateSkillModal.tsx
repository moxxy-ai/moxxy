/**
 * "New skill" modal — a filename field + a Markdown body editor with light
 * client-side validation (must end in `.md`, no path separators, no collision
 * with an existing skill). When opened from the Generate flow it seeds the
 * body with the AI draft and derives a suggested filename from its frontmatter.
 */

import { useState } from 'react';
import { Button, Modal, TextArea, TextInput } from '@moxxy/desktop-ui';

export function CreateSkillModal({
  initial,
  existing,
  onCancel,
  onSubmit,
}: {
  readonly initial?: string;
  readonly existing: ReadonlyArray<string>;
  readonly onCancel: () => void;
  readonly onSubmit: (name: string, content: string) => Promise<void>;
}): JSX.Element {
  const suggestedFromBody = (text: string | undefined): string => {
    if (!text) return 'untitled-skill.md';
    const match = text.match(/name:\s*([\w-]+)/i);
    return match ? `${match[1]}.md` : 'new-skill.md';
  };
  const [name, setName] = useState(suggestedFromBody(initial));
  const [body, setBody] = useState(
    initial ??
      `---
name: my-skill
description: One-sentence summary of when to use this.
---

# My skill

Describe the inputs, the steps to take, and any constraints here.
`,
  );
  const [busy, setBusy] = useState(false);
  const isMd = name.endsWith('.md');
  // Allowlist mirroring the vault rule: a leading alphanumeric, then only
  // [A-Za-z0-9._-], ending in `.md`, and no `..` anywhere. This blocks BOTH
  // slash kinds, leading dots, drive prefixes, and embedded `..` traversal —
  // the prior `!/[/]/` check let backslash paths and `sub\..\evil.md` through.
  const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name) && !name.includes('..');
  const collision = existing.includes(name);
  const canSubmit = safeName && !collision && body.trim().length > 0 && !busy;

  return (
    <Modal title="New skill" onClose={onCancel} width={640}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!canSubmit) return;
          setBusy(true);
          await onSubmit(name.trim(), body);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Filename
          </span>
          <TextInput
            tone="soft"
            mono
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my-skill.md"
            spellCheck={false}
          />
          {!isMd ? (
            <span style={{ fontSize: 11.5, color: 'var(--color-red)' }}>
              Filename must end in .md
            </span>
          ) : (
            !safeName && (
              <span style={{ fontSize: 11.5, color: 'var(--color-red)' }}>
                Use letters, digits, and . _ - only (no slashes, spaces, or “..”).
              </span>
            )
          )}
          {collision && (
            <span style={{ fontSize: 11.5, color: 'var(--color-red)' }}>
              A skill with this name already exists.
            </span>
          )}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Markdown body
          </span>
          <TextArea
            mono
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            style={{
              minHeight: 260,
              padding: '12px 14px',
              fontSize: 12.5,
              lineHeight: 1.55,
              background: 'var(--color-main-bg)',
            }}
          />
        </label>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="cta"
            type="submit"
            disabled={!canSubmit}
            style={{ opacity: canSubmit ? 1 : 0.5 }}
          >
            {busy ? 'Saving…' : 'Create skill'}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
