import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { usePopover, type PopoverPlacement } from './usePopover';

function Harness({
  placement,
  rect,
  onOpenChange,
}: {
  readonly placement: PopoverPlacement;
  readonly rect: Partial<DOMRect>;
  readonly onOpenChange?: (open: boolean) => void;
}): JSX.Element {
  const popover = usePopover<HTMLButtonElement, HTMLDivElement>({ ...placement, onOpenChange });
  return (
    <>
      <button
        ref={(el) => {
          // jsdom has no layout, so give the anchor the box the test is about.
          if (el) el.getBoundingClientRect = () => rect as DOMRect;
          (popover.anchorRef as { current: HTMLButtonElement | null }).current = el;
        }}
        onClick={popover.toggle}
      >
        anchor
      </button>
      {popover.open && popover.style && (
        <div ref={popover.menuRef} role="menu" style={popover.style}>
          <button role="menuitem">one</button>
        </div>
      )}
    </>
  );
}

const anchor = (): HTMLElement => screen.getByText('anchor');

describe('usePopover', () => {
  it('opens above its anchor, pinned to the anchor\'s left edge', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
    render(
      <Harness
        placement={{ side: 'top', align: 'start', width: 240 }}
        rect={{ top: 740, bottom: 780, left: 12, right: 268 }}
      />,
    );
    fireEvent.click(anchor(), { detail: 1 });
    const menu = screen.getByRole('menu');
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.bottom).toBe('66px'); // 800 − 740 + a 6px gap
    expect(menu.style.left).toBe('12px');
    expect(menu.style.width).toBe('240px');
    expect(menu.style.transformOrigin).toBe('bottom left');
  });

  it('opens below its anchor, pinned to the right edge and kept on screen', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
    render(
      <Harness
        placement={{ side: 'bottom', align: 'end', width: 160 }}
        rect={{ top: 10, bottom: 34, left: 60, right: 84 }}
      />,
    );
    fireEvent.click(anchor(), { detail: 1 });
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('40px');
    // 84 − 160 would run off the left edge; it stops at the margin instead.
    expect(menu.style.left).toBe('8px');
    expect(menu.style.transformOrigin).toBe('top right');
  });

  it('reports open and close, so a row can keep its actions up', () => {
    const onOpenChange = vi.fn();
    render(
      <Harness
        placement={{ side: 'bottom', align: 'end', width: 160 }}
        rect={{ top: 0, bottom: 20, left: 0, right: 20 }}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(anchor(), { detail: 1 });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
