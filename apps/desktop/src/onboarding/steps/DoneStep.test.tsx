import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DoneStep } from './DoneStep';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
}));

vi.mock('@moxxy/client-core', () => ({
  usePrefs: () => ({ prefs: null, loading: false, update: mocks.update }),
}));

describe('DoneStep', () => {
  beforeEach(() => {
    mocks.update.mockReset();
  });

  it('opens the app immediately while the completion preference persists in the background', () => {
    const neverResolves = new Promise<void>(() => undefined);
    mocks.update.mockReturnValue(neverResolves);
    const onComplete = vi.fn();
    render(<DoneStep onComplete={onComplete} />);

    fireEvent.click(screen.getByRole('button', { name: /open my workspaces/i }));

    expect(mocks.update).toHaveBeenCalledWith({ onboardingComplete: true });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
