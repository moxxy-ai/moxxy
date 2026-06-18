/**
 * SkillsView load-effect regression: the skill body is fetched once when a
 * skill is selected, keyed off the STABLE `readSkill` callback — not the whole
 * `useSettings()` return, which is a fresh object literal every render. A
 * re-render with a new `s` (e.g. from an unrelated refresh / session-info push)
 * must NOT re-fetch and clobber the user's in-progress edits.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SkillsView } from './SkillsView';
import type { useSettings } from '@moxxy/client-core';

type Settings = ReturnType<typeof useSettings>;

// One stable readSkill shared across the fresh `s` objects, mirroring the real
// `useCallback([])` in useSettings.
const readSkill = vi.fn(async (name: string) => `body of ${name}`);

function makeSettings(): Settings {
  // Fresh object literal each call — exactly what useSettings() returns.
  return {
    skills: [{ name: 'alpha', editable: true }],
    readSkill,
    writeSkill: vi.fn(async () => {}),
    deleteSkill: vi.fn(async () => {}),
  } as unknown as Settings;
}

beforeEach(() => {
  readSkill.mockClear();
});

describe('SkillsView', () => {
  it('does not re-fetch the body when a fresh settings object is passed', async () => {
    const { rerender } = render(<SkillsView s={makeSettings()} />);

    // Select the skill → one fetch.
    fireEvent.click(screen.getByText('alpha'));
    await waitFor(() => expect(readSkill).toHaveBeenCalledTimes(1));

    // Re-render with a brand-new settings object (same stable readSkill).
    rerender(<SkillsView s={makeSettings()} />);
    rerender(<SkillsView s={makeSettings()} />);

    // Still only one fetch — the effect keys off readSkill, not `s`.
    await waitFor(() => expect(readSkill).toHaveBeenCalledTimes(1));
    expect(readSkill).toHaveBeenCalledTimes(1);
  });

  it('preserves an in-progress edit across an unrelated re-render', async () => {
    const { rerender } = render(<SkillsView s={makeSettings()} />);
    fireEvent.click(screen.getByText('alpha'));
    await waitFor(() => expect(readSkill).toHaveBeenCalledTimes(1));

    // Enter edit mode (the segmented toggle renders lowercase text) and type.
    fireEvent.click(screen.getByRole('tab', { name: 'edit' }));
    const textarea = await screen.findByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'my unsaved edits' } });
    expect((textarea as HTMLTextAreaElement).value).toBe('my unsaved edits');

    // Unrelated re-render with a fresh `s` must not reset the textarea.
    rerender(<SkillsView s={makeSettings()} />);
    await waitFor(() =>
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('my unsaved edits'),
    );
  });
});
