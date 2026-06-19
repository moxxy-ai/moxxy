/**
 * The detected-counts summary is the screen-reader-visible record of what was
 * redacted. Each category chip renders a visual `Label · N`, but the raw `·`
 * reads as noise, so the chip must carry a clean accessible name ("Emails: 3")
 * and hide the decorative glyph from the accessibility tree.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PiiCounts } from '@moxxy/anonymizer';
import { Counts } from './Counts';

describe('Counts accessibility', () => {
  it('gives each category chip a clean accessible label, not the raw `·`', () => {
    const counts = { email: 3, phone: 1 } as unknown as PiiCounts;
    render(<Counts counts={counts} total={4} />);

    expect(screen.getByLabelText('Emails: 3')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone numbers: 1')).toBeInTheDocument();
    // The summary chip is plain text and reads fine on its own.
    expect(screen.getByText('4 redacted')).toBeInTheDocument();
  });

  it('shows the empty state without any category chips when nothing was detected', () => {
    render(<Counts counts={{} as PiiCounts} total={0} />);
    expect(screen.getByText(/nothing detected yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/:/)).not.toBeInTheDocument();
  });
});
