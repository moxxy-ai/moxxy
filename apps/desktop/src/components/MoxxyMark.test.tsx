import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MoxxyMark } from './MoxxyMark';

describe('MoxxyMark', () => {
  it('draws its two strands in DIFFERENT colours', () => {
    // The interlace is carried entirely by the colour change at each crossing,
    // so one hue for both strands collapses the mark into a solid eight-pointed
    // rosette. The ink strand must stay inheritable and the other must not.
    const { container } = render(
      <span style={{ color: 'var(--color-sidebar-text)' }}>
        <MoxxyMark size={24} />
      </span>,
    );
    const strokes = [...container.querySelectorAll('g[stroke]')].map((g) =>
      g.getAttribute('stroke'),
    );
    expect(strokes).toContain('currentColor');
    expect(strokes).toContain('var(--color-primary)');
    expect(new Set(strokes).size).toBeGreaterThan(1);
  });
});
