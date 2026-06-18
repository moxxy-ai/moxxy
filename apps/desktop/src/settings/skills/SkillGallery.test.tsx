/**
 * SkillGallery renderer tests:
 *   1. Cards render one per skill (name + description).
 *   2. Typing in the shared SearchBox filters the cards by name/description,
 *      and a non-matching query shows the empty-match note.
 *
 * Guards the t1-searchbox dedup: the search row is now the shared SearchBox
 * primitive, so the filter must keep working through it.
 */

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SkillFile } from '@moxxy/desktop-ipc-contract';
import { SkillGallery } from './SkillGallery';

const SKILLS: ReadonlyArray<SkillFile> = [
  { name: 'web-research', editable: true, description: 'Search the web and synthesize.' },
  { name: 'invoice-parser', editable: true, description: 'Extract line items from PDFs.' },
];

function renderGallery(skills: ReadonlyArray<SkillFile> = SKILLS): void {
  render(
    <SkillGallery skills={skills} onPick={() => undefined} onCreate={() => undefined} onGenerate={() => undefined} />,
  );
}

describe('SkillGallery', () => {
  it('renders one card per skill', () => {
    renderGallery();
    expect(screen.getByText('web-research')).toBeTruthy();
    expect(screen.getByText('invoice-parser')).toBeTruthy();
  });

  it('filters cards as you type in the search box (matches name)', () => {
    renderGallery();
    const search = screen.getByPlaceholderText('Search skills…');
    fireEvent.change(search, { target: { value: 'invoice' } });
    expect(screen.queryByText('web-research')).toBeNull();
    expect(screen.getByText('invoice-parser')).toBeTruthy();
  });

  it('filters by description, case-insensitively', () => {
    renderGallery();
    const search = screen.getByPlaceholderText('Search skills…');
    fireEvent.change(search, { target: { value: 'SYNTHESIZE' } });
    expect(screen.getByText('web-research')).toBeTruthy();
    expect(screen.queryByText('invoice-parser')).toBeNull();
  });

  it('shows the no-match note when nothing matches', () => {
    renderGallery();
    const search = screen.getByPlaceholderText('Search skills…');
    fireEvent.change(search, { target: { value: 'zzz-nope' } });
    expect(screen.queryByText('web-research')).toBeNull();
    expect(screen.queryByText('invoice-parser')).toBeNull();
    expect(screen.getByText(/No skills match/i)).toBeTruthy();
  });
});
