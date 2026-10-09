import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Shell } from './Shell';

/**
 * First run is one form with a line of steps over it. It has no sidebar: there
 * is nothing to move between yet, and a column of step names beside the form
 * read as navigation that could not be used.
 */

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'cli', label: 'Install moxxy' },
  { id: 'provider', label: 'Pick a provider' },
  { id: 'workspace', label: 'First workspace' },
  { id: 'done', label: "You're set" },
];

function renderShell(currentIndex: number) {
  return render(
    <Shell steps={STEPS} currentIndex={currentIndex}>
      <button type="button">Continue</button>
    </Shell>,
  );
}

describe('the onboarding frame', () => {
  it('is one form with no sidebar beside it', () => {
    const { container } = renderShell(1);

    expect(container.querySelector('aside')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(within(screen.getByRole('main')).getByRole('button', { name: 'Continue' })).toBeTruthy();
  });

  it('says which step this is, out of how many', () => {
    renderShell(1);

    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
  });

  it('draws one mark per step: the ones behind done, this one current, the rest ahead', () => {
    renderShell(2);
    const marks = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');

    expect(marks.map((mark) => mark.dataset.state)).toEqual(['done', 'done', 'current', 'ahead', 'ahead']);
    expect(marks[2]).toHaveAttribute('aria-current', 'step');
    expect(marks.filter((mark) => mark.hasAttribute('aria-current'))).toHaveLength(1);
  });

  it('names every step for someone who cannot see the marks', () => {
    renderShell(0);
    const marks = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');

    expect(marks.map((mark) => mark.textContent)).toEqual(STEPS.map((step) => step.label));
  });

  it('counts a single step as the one step it is', () => {
    render(
      <Shell steps={[{ id: 'provider', label: 'Pick a provider' }]} currentIndex={0}>
        <span>form</span>
      </Shell>,
    );

    expect(screen.queryByText(/^Step /u)).toBeNull();
    expect(screen.queryByRole('list', { name: 'Setup steps' })).toBeNull();
  });
});
