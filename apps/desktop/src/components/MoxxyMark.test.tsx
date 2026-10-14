import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MoxxyMark } from './MoxxyMark';

describe('MoxxyMark', () => {
  it('paints the shipped mark raster at the requested size', () => {
    // The mark is a rendered picture (metal ribbon, lit eyes), not a vector, so
    // every surface paints the one cut-out raster the brand build ships.
    render(<MoxxyMark size={24} className="moxxy-avatar-loader" />);

    const mark = screen.getByRole('img', { name: 'moxxy' });
    expect(mark.tagName).toBe('IMG');
    expect(mark.getAttribute('src')).toMatch(/(^|\/)moxxy-mark\.png$/);
    expect(mark.getAttribute('width')).toBe('24');
    expect(mark.getAttribute('height')).toBe('24');
    expect(mark).toHaveClass('moxxy-avatar-loader');
  });

  it('cannot be dragged out of the window as a file', () => {
    render(<MoxxyMark />);
    expect(screen.getByRole('img', { name: 'moxxy' })).toHaveAttribute('draggable', 'false');
  });
});
