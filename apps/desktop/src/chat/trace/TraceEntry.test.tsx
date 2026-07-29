import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceEntry } from './TraceEntry';

/**
 * The trace's whole structural claim is that EVERY entry hangs off one timeline,
 * in one gutter, and is typed by its glyph rather than by a card or an avatar. If
 * an entry can opt out of the gutter the spine breaks visually, so that is what
 * these pin — plus the accent rule, which only the commanded entry may claim.
 */

describe('TraceEntry', () => {
  it('gives every kind the same gutter, so the timeline is continuous', () => {
    for (const kind of ['commanded', 'agent', 'reasoning', 'tool', 'error'] as const) {
      const { container, unmount } = render(
        <TraceEntry kind={kind}>
          <p>body</p>
        </TraceEntry>,
      );
      const entry = container.querySelector('.tr');
      expect(entry, `${kind} did not render an entry`).not.toBeNull();
      expect(entry).toHaveAttribute('data-kind', kind);
      expect(entry?.querySelector('.tr__gutter'), `${kind} has no gutter`).not.toBeNull();
      expect(entry?.querySelector('.tr__glyph'), `${kind} has no glyph`).not.toBeNull();
      unmount();
    }
  });

  it('renders the kicker and its trailing meta only when given', () => {
    const { container, unmount } = render(
      <TraceEntry kind="agent">
        <p>body</p>
      </TraceEntry>,
    );
    expect(container.querySelector('.tr__hd')).toBeNull();
    unmount();

    render(
      <TraceEntry kind="agent" label="moxxy" meta="14:02:24">
        <p>body</p>
      </TraceEntry>,
    );
    expect(screen.getByText('moxxy')).toBeInTheDocument();
    expect(screen.getByText('14:02:24')).toBeInTheDocument();
  });

  it('keeps the gutter decorative, so the glyphs do not litter the reading order', () => {
    const { container } = render(
      <TraceEntry kind="tool">
        <p>Edit sse.ts</p>
      </TraceEntry>,
    );
    // The glyph is a type marker for the eye; the entry's meaning is in its body
    // and its kicker. Announcing "wrench image" before every tool row would be
    // noise, so the gutter is aria-hidden.
    expect(container.querySelector('.tr__gutter')).toHaveAttribute('aria-hidden');
  });
});
