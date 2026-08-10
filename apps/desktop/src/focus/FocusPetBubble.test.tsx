import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FocusPetBubble } from './FocusPetBubble';

describe('FocusPetBubble task loader', () => {
  it('keeps the square still and sequences its four illuminated corners clockwise', () => {
    const { container } = render(
      <FocusPetBubble
        content={{
          kind: 'task',
          title: 'Voice Mode',
          text: 'Working on your request',
          busy: true,
        }}
        onActivate={vi.fn()}
        onHide={vi.fn()}
      />,
    );

    expect(container.querySelector('.focus-task-spinner')).toBeNull();
    const loader = container.querySelector('.focus-task-loader');
    expect(loader).toBeTruthy();
    expect(Array.from(loader?.querySelectorAll('[data-corner]') ?? []).map(
      (corner) => corner.getAttribute('data-corner'),
    )).toEqual(['top-left', 'top-right', 'bottom-right', 'bottom-left']);

    const css = document.getElementById('focus-keyframes')?.textContent ?? '';
    expect(css).toContain('@keyframes focus-task-corner');
    expect(css).toContain('animation-delay: 900ms');
    expect(css).not.toContain('focus-task-spin');
    expect(css).not.toContain('rotate(360deg)');
  });
});
