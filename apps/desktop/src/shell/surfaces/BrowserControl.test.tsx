import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AgentCursor, BrowserControlBar } from './BrowserControl.js';

afterEach(cleanup);

describe('AgentCursor', () => {
  it('stands at the agent’s point and glides there over the time main gave it', () => {
    render(<AgentCursor cursor={{ x: 70, y: 100, phase: 'moving', durationMs: 130, press: 0 }} onArrived={() => {}} />);
    const cursor = screen.getByTestId('agent-cursor');

    expect(cursor.style.left).toBe('70px');
    expect(cursor.style.top).toBe('100px');
    expect(cursor.style.transitionDuration).toBe('130ms');
    expect(cursor.getAttribute('data-phase')).toBe('moving');
  });

  it('says when it has arrived', () => {
    const arrived = vi.fn();
    render(<AgentCursor cursor={{ x: 1, y: 2, phase: 'moving', durationMs: 100, press: 0 }} onArrived={arrived} />);

    fireEvent.transitionEnd(screen.getByTestId('agent-cursor'));

    expect(arrived).toHaveBeenCalled();
  });

  it('rings once per press, and not before the first', () => {
    const { rerender } = render(
      <AgentCursor cursor={{ x: 1, y: 2, phase: 'moving', durationMs: 0, press: 0 }} onArrived={() => {}} />,
    );
    expect(screen.queryByTestId('agent-cursor-ring')).toBeNull();

    rerender(<AgentCursor cursor={{ x: 1, y: 2, phase: 'delivered', durationMs: 0, press: 1 }} onArrived={() => {}} />);

    expect(screen.getByTestId('agent-cursor-ring')).toBeTruthy();
  });

  it('draws nothing when there is no pointer', () => {
    render(<AgentCursor cursor={null} onArrived={() => {}} />);
    expect(screen.queryByTestId('agent-cursor')).toBeNull();
  });
});

describe('BrowserControlBar', () => {
  it('offers to take over or stop while the agent drives', () => {
    const takeOver = vi.fn();
    const stop = vi.fn();
    render(<BrowserControlBar mode="agent" onTakeOver={takeOver} onResume={() => {}} onStop={stop} />);

    expect(screen.getByRole('status').textContent).toMatch(/Moxxy is using the browser/);
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
    expect(takeOver).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it('offers to hand it back once the person has it', () => {
    const resume = vi.fn();
    render(<BrowserControlBar mode="user" onTakeOver={() => {}} onResume={resume} onStop={() => {}} />);

    expect(screen.getByRole('status').textContent).toMatch(/You have the browser/);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
    expect(resume).toHaveBeenCalled();
  });

  it('is not there when nobody is working in the browser', () => {
    const { container } = render(
      <BrowserControlBar mode={null} onTakeOver={() => {}} onResume={() => {}} onStop={() => {}} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
