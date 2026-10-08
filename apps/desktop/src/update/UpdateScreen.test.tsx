/**
 * The installer screen draws exactly the model it is given: the steps and how
 * far they are, a measured or a moving bar, and the buttons a state calls for.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UpdateScreen } from './UpdateScreen';
import type { UpdateScreenModel } from './update-screen-model';

afterEach(cleanup);

const updating: UpdateScreenModel = {
  kind: 'updating',
  title: 'Updating Moxxy',
  subtitle: 'Version 0.6.0',
  steps: [
    { key: 'app', label: 'Download the update', status: 'running', detail: '42%' },
    { key: 'restart', label: 'Restart Moxxy', status: 'pending' },
  ],
  progress: 0.42,
  busy: true,
  notes: [],
  footer: 'Nothing for you to do — Moxxy restarts by itself.',
  actions: [],
};
const handlers = () => ({ onRetry: vi.fn(), onClose: vi.fn(), onExited: vi.fn() });
const show = (model: UpdateScreenModel, leaving = false) => {
  const on = handlers();
  render(<UpdateScreen model={model} leaving={leaving} {...on} />);
  return on;
};

describe('UpdateScreen', () => {
  it('names what is happening and lists the steps with their state', () => {
    show(updating);

    expect(screen.getByRole('dialog', { name: 'Updating Moxxy' })).toBeTruthy();
    expect(screen.getByText('Version 0.6.0')).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual(['running', 'pending']);
    expect(rows[0]?.textContent).toContain('Download the update');
    expect(rows[0]?.textContent).toContain('42%');
    expect(rows[0]?.getAttribute('aria-current')).toBe('step');
  });

  it('measures the bar when the model does', () => {
    show(updating);

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect((bar.firstElementChild as HTMLElement).style.transform).toBe('scaleX(0.42)');
  });

  it('lets the bar just move when there is nothing to measure', () => {
    show({ ...updating, progress: null });

    const bar = screen.getByRole('progressbar');
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(bar.getAttribute('data-indeterminate')).toBe('true');
  });

  it('has no bar and no buttons once nothing is running', () => {
    show({ ...updating, kind: 'ready', busy: false, progress: null, footer: null });

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers another try and a way out when the update failed', () => {
    const on = show({ ...updating, kind: 'failed', busy: false, progress: null, footer: null, actions: ['retry', 'close'] });

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(on.onRetry).toHaveBeenCalledTimes(1);
    expect(on.onClose).toHaveBeenCalledTimes(1);
  });

  it('says what a person should know and waits for them to open Moxxy', () => {
    const on = show({ ...updating, kind: 'ready', busy: false, progress: null, footer: null, notes: ['The previous copy was kept in /backup'], actions: ['close'] });

    expect(screen.getByText('The previous copy was kept in /backup')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Moxxy' }));

    expect(on.onClose).toHaveBeenCalledTimes(1);
  });

  it('reports that it has left once its exit has played', () => {
    const on = show(updating, true);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-leaving')).toBe('true');

    fireEvent.animationEnd(dialog);

    expect(on.onExited).toHaveBeenCalledTimes(1);
  });

  it('does not take a child finishing its entrance for its own exit', () => {
    const on = show(updating, true);

    fireEvent.animationEnd(screen.getAllByRole('listitem')[0] as HTMLElement);

    expect(on.onExited).not.toHaveBeenCalled();
  });
});
