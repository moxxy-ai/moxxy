import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlinkingMoxxyMark } from './BlinkingMoxxyMark';
import markEyes from './moxxy-mark-eyes.json';

describe('BlinkingMoxxyMark', () => {
  it('is one picture of the mark to assistive tech, at the requested size', () => {
    render(<BlinkingMoxxyMark size={32} className="extra" />);

    const mark = screen.getByRole('img', { name: 'moxxy' });
    expect(mark).toHaveClass('moxxy-mark-blink', 'extra');
    expect(mark.style.width).toBe('32px');
    expect(mark.style.height).toBe('32px');
  });

  it('paints the mark without its eyes and draws the two eyes on top, where the brand build found them', () => {
    const { container } = render(<BlinkingMoxxyMark />);

    const picture = container.querySelector('img');
    expect(picture?.getAttribute('src')).toMatch(/(^|\/)moxxy-mark-eyeless\.png$/);
    expect(picture).toHaveAttribute('alt', '');

    const eyes = container.querySelectorAll('.moxxy-mark-blink__eye');
    expect(eyes).toHaveLength(2);
    markEyes.eyes.forEach((eye, i) => {
      const core = eyes[i]?.querySelector('.moxxy-mark-blink__core');
      expect(core?.getAttribute('x')).toBe(String(eye.x));
      expect(core?.getAttribute('y')).toBe(String(eye.y));
      expect(core?.getAttribute('width')).toBe(String(eye.width));
      expect(core?.getAttribute('height')).toBe(String(eye.height));
    });
  });

  it('keeps the ids of two marks on one screen apart', () => {
    const { container } = render(
      <>
        <BlinkingMoxxyMark />
        <BlinkingMoxxyMark />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
