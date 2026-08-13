import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextMeter, contextLevel } from './ContextMeter';
import { compact } from './Telemetry';

/**
 * The context gauge is the readout a supervisor actually watches during a long
 * run, and it deliberately shows no number at rest. That makes two things
 * load-bearing: the ticks must be truthful at the edges, and the meaning must
 * still reach a screen reader without them.
 */

describe('contextLevel', () => {
  it('changes at the two thresholds that mean something', () => {
    expect(contextLevel(0)).toBe('nominal');
    expect(contextLevel(0.69)).toBe('nominal');
    expect(contextLevel(0.7)).toBe('caution');
    expect(contextLevel(0.89)).toBe('caution');
    expect(contextLevel(0.9)).toBe('critical');
    expect(contextLevel(1)).toBe('critical');
  });
});

describe('ContextMeter', () => {
  it('lights no segment at zero, and every segment when full', () => {
    const { container, unmount } = render(<ContextMeter fraction={0} />);
    expect(container.querySelectorAll('i[data-on]')).toHaveLength(0);
    unmount();

    const full = render(<ContextMeter fraction={1} />);
    expect(full.container.querySelectorAll('i[data-on]')).toHaveLength(12);
  });

  it('lights at least one segment for any non-zero usage', () => {
    // A gauge that reads empty while the window is filling is worse than no
    // gauge: 1% of a 200k window is 2000 tokens, which is not nothing.
    const { container } = render(<ContextMeter fraction={0.01} />);
    expect(container.querySelectorAll('i[data-on]').length).toBeGreaterThanOrEqual(1);
  });

  it('clamps out-of-range fractions instead of overflowing the gauge', () => {
    const under = render(<ContextMeter fraction={-1} />);
    expect(under.container.querySelectorAll('i[data-on]')).toHaveLength(0);
    under.unmount();
    const over = render(<ContextMeter fraction={4} />);
    expect(over.container.querySelectorAll('i[data-on]')).toHaveLength(12);
  });

  it('states its reading for assistive tech, since nothing is painted at rest', () => {
    render(<ContextMeter fraction={0.42} />);
    const meter = screen.getByRole('meter');
    expect(meter).toHaveAttribute('aria-valuenow', '42');
    expect(meter).toHaveAttribute('aria-label', 'Context window 42% used');
  });
});

describe('compact', () => {
  it('keeps small counts exact and abbreviates the ones that would smear', () => {
    expect(compact(0)).toBe('0');
    expect(compact(999)).toBe('999');
    expect(compact(1_000)).toBe('1.0k');
    expect(compact(12_400)).toBe('12.4k');
    // Past 100k the decimal is noise in a 12px cell.
    expect(compact(128_412)).toBe('128k');
    expect(compact(1_234_567)).toBe('1.2M');
  });
});
