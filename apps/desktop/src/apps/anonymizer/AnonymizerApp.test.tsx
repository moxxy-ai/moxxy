/**
 * Component tests for the redesigned anonymizer flow (Import → Settings →
 * Output). The redaction engine is real (`@moxxy/anonymizer`); only the host
 * boundaries are stubbed:
 *   - the NER Worker (loads a ~300 MB model) → a no-op fake, so the on-device
 *     name pass simply yields nothing and structured redaction still runs.
 *   - the desktop IPC api → a fake, so Save routes without a native dialog.
 *
 * What's asserted: pasting text produces redacted output, the Filters
 * multi-select toggles a category on/off and the output follows, the segmented
 * mode control changes the redaction style, and Copy uses the clipboard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import { AnonymizerApp } from './AnonymizerApp';

/** A Worker that never loads a model and never replies — `detectNames` then
 *  short-circuits, so NER contributes no spans (structured redaction is intact). */
class SilentWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(): void {}
  terminate(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

beforeEach(() => {
  vi.stubGlobal('Worker', SilentWorker as never);
  __setApiOverride({ invoke: vi.fn(() => Promise.resolve(null)), subscribe: vi.fn(() => () => {}) } as never);
});

afterEach(() => {
  __setApiOverride(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SAMPLE = 'Email a@b.com and call 415-555-0100.';

function paste(text: string): void {
  fireEvent.click(screen.getByTestId('anon-src-paste'));
  fireEvent.change(screen.getByTestId('anon-paste'), { target: { value: text } });
}

describe('AnonymizerApp redesigned flow', () => {
  it('shows an empty output state until text is provided', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    expect(screen.getByTestId('anon-output-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('anon-output')).not.toBeInTheDocument();
  });

  it('redacts pasted text with the default filters', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);

    const out = screen.getByTestId('anon-output');
    expect(out.textContent).toContain('[EMAIL]');
    expect(out.textContent).toContain('[PHONE]');
    expect(out.textContent).not.toContain('a@b.com');
  });

  it('Filters is a multi-select dropdown that toggles a category', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);

    // Default count reflects all structured categories + the names group.
    const trigger = screen.getByTestId('anon-filter-select');
    expect(screen.getByTestId('anon-filter-select-count').textContent).not.toBe('0');

    // Open the panel and turn Emails off.
    fireEvent.click(trigger);
    const panel = screen.getByTestId('anon-filter-select-panel');
    const emailCheckbox = within(screen.getByTestId('anon-filter-select-opt-email')).getByRole(
      'checkbox',
    );
    expect(emailCheckbox).toBeChecked();
    fireEvent.click(emailCheckbox);

    // Email is no longer redacted; phone still is.
    const out = screen.getByTestId('anon-output');
    expect(out.textContent).toContain('a@b.com');
    expect(out.textContent).not.toContain('[EMAIL]');
    expect(out.textContent).toContain('[PHONE]');
    expect(panel).toBeInTheDocument();
  });

  it('"None" clears every filter so nothing structured is redacted', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);

    fireEvent.click(screen.getByTestId('anon-filter-select'));
    fireEvent.click(screen.getByTestId('anon-filter-select-none'));

    expect(screen.getByTestId('anon-filter-select-count').textContent).toBe('0');
    const out = screen.getByTestId('anon-output');
    expect(out.textContent).toContain('a@b.com');
    expect(out.textContent).not.toContain('[EMAIL]');
  });

  it('switching redaction mode changes the token style', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);

    fireEvent.click(screen.getByTestId('anon-mode-pseudonym'));
    const out = screen.getByTestId('anon-output');
    expect(out.textContent).toContain('EMAIL_1');
    expect(out.textContent).not.toContain('[EMAIL]');
  });

  it('Copy writes the redacted text to the clipboard', () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);
    fireEvent.click(screen.getByTestId('anon-copy'));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]?.[0]).toContain('[EMAIL]');
  });

  it('the Apps back button exits', () => {
    const onExit = vi.fn();
    render(<AnonymizerApp onExit={onExit} />);
    fireEvent.click(screen.getByRole('button', { name: /Apps/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('"Send to chat" hands the redacted text + a title to sendToSession', () => {
    const sendToSession = vi.fn();
    render(<AnonymizerApp onExit={vi.fn()} sendToSession={sendToSession} />);
    paste(SAMPLE);
    fireEvent.click(screen.getByTestId('anon-send-chat'));

    expect(sendToSession).toHaveBeenCalledTimes(1);
    const payload = sendToSession.mock.calls[0]?.[0];
    expect(payload.text).toContain('[EMAIL]');
    expect(payload.text).not.toContain('a@b.com');
    expect(payload.title).toMatch(/Redacted document/);
    expect(payload.meta).toMatchObject({ source: 'anonymizer' });
  });

  it('"Send to chat" is hidden when the capability was not granted', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);
    expect(screen.queryByTestId('anon-send-chat')).not.toBeInTheDocument();
  });
});
