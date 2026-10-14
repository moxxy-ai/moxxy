import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Logo } from './Logo';

describe('sidebar masthead', () => {
  it('shows the blinking mark beside the MoxxyAI name', () => {
    render(<Logo />);
    expect(screen.getByRole('img', { name: 'moxxy' })).toHaveClass('moxxy-mark-blink');
    expect(screen.getByText('MoxxyAI')).toBeTruthy();
  });
});
