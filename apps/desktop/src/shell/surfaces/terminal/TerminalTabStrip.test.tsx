import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TerminalTabStrip } from './TerminalTabStrip';
import { AGENT_TAB } from './useTerminalTabs';

describe('TerminalTabStrip', () => {
  const tabs = [
    { id: 't1', title: 'Terminal 1' },
    { id: 't2', title: 'Terminal 2' },
  ];

  it("shows the agent's terminal first, then the project's tabs, the shown one selected", () => {
    render(<TerminalTabStrip tabs={tabs} active="t2" onSelect={vi.fn()} onOpen={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Agent', 'Terminal 1', 'Terminal 2']);
    expect(screen.getByRole('tab', { name: 'Terminal 2' })).toHaveAttribute('aria-selected', 'true');
  });

  it('picks a tab, opens a new one, and closes one with its ×, never the Agent tab', () => {
    const onSelect = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    render(<TerminalTabStrip tabs={tabs} active={AGENT_TAB} onSelect={onSelect} onOpen={onOpen} onClose={onClose} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Terminal 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 2' }));

    expect(onSelect).toHaveBeenCalledWith('t1');
    expect(onOpen).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledWith('t2');
    expect(screen.queryByRole('button', { name: 'Close Agent' })).toBeNull();
  });

  it('closes a tab on a middle click, the way a browser tab closes', () => {
    const onClose = vi.fn();
    render(<TerminalTabStrip tabs={tabs} active={AGENT_TAB} onSelect={vi.fn()} onOpen={vi.fn()} onClose={onClose} />);
    fireEvent(screen.getByRole('tab', { name: 'Terminal 1' }), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onClose).toHaveBeenCalledWith('t1');
  });
});
