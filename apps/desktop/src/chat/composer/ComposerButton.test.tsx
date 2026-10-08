import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ComposerButton } from './ComposerButton';
import { SendButton } from './SendButton';

/**
 * The composer's controls sit side by side at the window's foot, so a tooltip
 * beside one covers its neighbour and one below it has no room.
 */

afterEach(cleanup);

describe('the composer controls', () => {
  it('open their tooltips upward, clear of the control beside them', () => {
    render(
      <>
        <ComposerButton label="Voice input">mic</ComposerButton>
        <SendButton running={false} action="Send" disabled={false} onStop={() => {}} />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Voice input' })).toHaveAttribute('data-tip-side', 'top');
    expect(screen.getByRole('button', { name: 'Send' })).toHaveAttribute('data-tip-side', 'top');
  });

  it('keeps the tooltip upward when Send becomes Stop', () => {
    render(<SendButton running action="Send" disabled={false} onStop={() => {}} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('data-tip-side', 'top');
  });
});
