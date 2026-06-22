/**
 * Responsive header tab groups (`Segmented collapsible`).
 *
 * The header carries two pill groups — the LEFT view switcher
 * (Chat/Workflows/Collaborate/Apps) and, on Settings, the RIGHT tab group
 * (Providers/MCP/Skills/Vault/Mobile/…). When the window is narrow the inline
 * row would clip tabs off-screen, so each group folds into a single compact
 * button + dropdown so every destination stays reachable.
 *
 * jsdom has neither layout nor ResizeObserver, so we install a controllable
 * stub and pin the natural-vs-available widths to exercise both branches.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Segmented } from './ViewHeader';

// A ResizeObserver stub that lets the test fire a single observed callback.
let fireResize: (() => void) | null = null;
class FakeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {
    fireResize = () => this.cb([], this as unknown as ResizeObserver);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/**
 * Force the fit decision. The component reads `nav.scrollWidth` (the inline
 * row's natural width) and `container.clientWidth` (the squeezed width); we
 * override each getter on the shared prototype so every element reports the
 * value its branch needs.
 */
function pinWidths(natural: number, available: number): void {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() {
      return natural;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return available;
    },
  });
}

const TABS = [
  { id: 'providers', label: 'Providers' },
  { id: 'mcp', label: 'MCP' },
  { id: 'skills', label: 'Skills' },
  { id: 'vault', label: 'Vault' },
  { id: 'mobile', label: 'Mobile' },
] as const;

beforeEach(() => {
  fireResize = null;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Drop the geometry overrides between tests.
  for (const prop of ['scrollWidth', 'clientWidth'] as const) {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
  }
});

describe('Segmented (collapsible)', () => {
  it('renders all tabs inline when there is room (natural <= available)', () => {
    pinWidths(300, 800);
    render(
      <Segmented items={TABS} value="providers" onChange={vi.fn()} testIdPrefix="t-" collapsible />,
    );
    // Every tab is reachable inline; no collapsed button.
    for (const t of TABS) expect(screen.getByTestId(`t-${t.id}`)).toBeTruthy();
    expect(screen.queryByTestId('t-collapsed')).toBeNull();
  });

  it('folds into one button + dropdown when the row does not fit', () => {
    pinWidths(800, 300); // natural wider than available → collapse
    render(
      <Segmented items={TABS} value="vault" onChange={vi.fn()} testIdPrefix="t-" collapsible />,
    );

    // The inline pills are gone; a single compact control stands in, labelled
    // with the ACTIVE tab — and it is focusable / operable.
    const trigger = screen.getByTestId('t-collapsed');
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.textContent).toContain('Vault');
    // Closed: tabs are not yet in the tree (only behind the menu).
    expect(screen.queryByTestId('t-providers')).toBeNull();

    // Open the menu → every destination is reachable, active one marked.
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    for (const t of TABS) expect(screen.getByTestId(`t-${t.id}`)).toBeTruthy();
    expect(screen.getByTestId('t-vault').getAttribute('data-active')).toBe('true');
  });

  it('picking a tab from the dropdown fires onChange and closes the menu', () => {
    pinWidths(800, 300);
    const onChange = vi.fn();
    render(
      <Segmented items={TABS} value="providers" onChange={onChange} testIdPrefix="t-" collapsible />,
    );
    fireEvent.click(screen.getByTestId('t-collapsed'));
    fireEvent.click(screen.getByTestId('t-mobile'));
    expect(onChange).toHaveBeenCalledWith('mobile');
    // Menu closed after selection.
    expect(screen.getByTestId('t-collapsed').getAttribute('aria-expanded')).toBe('false');
  });

  it('Escape closes the open dropdown', () => {
    pinWidths(800, 300);
    render(
      <Segmented items={TABS} value="providers" onChange={vi.fn()} testIdPrefix="t-" collapsible />,
    );
    const trigger = screen.getByTestId('t-collapsed');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('re-expands when room returns (no hysteresis: measurer is independent)', () => {
    pinWidths(800, 300);
    const { rerender } = render(
      <Segmented items={TABS} value="providers" onChange={vi.fn()} testIdPrefix="t-" collapsible />,
    );
    expect(screen.getByTestId('t-collapsed')).toBeTruthy();

    // Widen the window and re-fire the observer: it must fold back out even
    // though the displayed row had been collapsed (the fit decision uses the
    // natural width snapshotted while expanded, not the shrunken live row).
    pinWidths(300, 800);
    act(() => fireResize?.());
    rerender(
      <Segmented items={TABS} value="providers" onChange={vi.fn()} testIdPrefix="t-" collapsible />,
    );
    expect(screen.queryByTestId('t-collapsed')).toBeNull();
    expect(screen.getByTestId('t-providers')).toBeTruthy();
  });

  it('non-collapsible Segmented always renders inline (unchanged behaviour)', () => {
    // No widths pinned, no collapse ever — the Appearance theme toggle path.
    render(<Segmented items={TABS} value="skills" onChange={vi.fn()} testIdPrefix="t-" />);
    for (const t of TABS) expect(screen.getByTestId(`t-${t.id}`)).toBeTruthy();
    expect(screen.queryByTestId('t-collapsed')).toBeNull();
  });

  it('blocks disabled inline tabs from firing navigation while keeping the active tab usable', () => {
    pinWidths(300, 800);
    const onChange = vi.fn();
    render(
      <Segmented
        items={TABS}
        value="providers"
        onChange={onChange}
        testIdPrefix="t-"
        disabledIds={new Set(['mcp', 'mobile'])}
        disabledReason="Session is still loading"
        collapsible
      />,
    );

    const disabledTab = screen.getByTestId('t-mcp');
    expect(disabledTab.getAttribute('aria-disabled')).toBe('true');
    expect(disabledTab.hasAttribute('disabled')).toBe(true);

    fireEvent.click(disabledTab);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('t-providers'));
    expect(onChange).toHaveBeenCalledWith('providers');
  });

  it('blocks disabled collapsed menu items and leaves the dropdown open', () => {
    pinWidths(800, 300);
    const onChange = vi.fn();
    render(
      <Segmented
        items={TABS}
        value="providers"
        onChange={onChange}
        testIdPrefix="t-"
        disabledIds={new Set(['mobile'])}
        disabledReason="Session is still loading"
        collapsible
      />,
    );

    const trigger = screen.getByTestId('t-collapsed');
    fireEvent.click(trigger);

    const disabledItem = screen.getByTestId('t-mobile');
    expect(disabledItem.getAttribute('aria-disabled')).toBe('true');
    expect(disabledItem.hasAttribute('disabled')).toBe(true);

    fireEvent.click(disabledItem);
    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });
});
