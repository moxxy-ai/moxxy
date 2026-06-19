/**
 * CreateSkillModal validation tests — the filename allowlist is a defense-in-depth
 * boundary before the host-side writeSkill, so it must reject path-traversal
 * tricks (backslash, embedded `..`, slashes, drive prefixes) and never invoke
 * onSubmit with a hostile name.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CreateSkillModal } from './CreateSkillModal';

function renderModal(): { onSubmit: ReturnType<typeof vi.fn> } {
  const onSubmit = vi.fn(() => Promise.resolve());
  render(
    <CreateSkillModal existing={['taken.md']} onCancel={() => undefined} onSubmit={onSubmit} />,
  );
  return { onSubmit };
}

function setName(value: string): void {
  fireEvent.change(screen.getByPlaceholderText('my-skill.md'), { target: { value } });
}

describe('CreateSkillModal filename validation', () => {
  it('accepts a plain .md name', () => {
    const { onSubmit } = renderModal();
    setName('research.md');
    const create = screen.getByRole('button', { name: /create skill/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(onSubmit).toHaveBeenCalledWith('research.md', expect.any(String));
  });

  it.each([
    'sub/evil.md', // forward slash
    'sub\\..\\evil.md', // backslash traversal — the old !/[/]/ rule let this through
    '..\\x.md', // backslash drive-ish prefix
    'a..b.md', // embedded `..`
    '.hidden.md', // leading dot
    'has space.md', // space
    'no-extension', // missing .md
  ])('rejects the hostile name %s and never submits', (bad) => {
    const { onSubmit } = renderModal();
    setName(bad);
    const create = screen.getByRole('button', { name: /create skill/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    // The button is disabled, but assert the click is a no-op regardless.
    fireEvent.click(create);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a collision with an existing skill', () => {
    const { onSubmit } = renderModal();
    setName('taken.md');
    const create = screen.getByRole('button', { name: /create skill/i }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
