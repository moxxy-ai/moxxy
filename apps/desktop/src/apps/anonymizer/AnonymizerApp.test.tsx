/**
 * Component tests for the redesigned anonymizer flow (Import → Settings →
 * Output). The redaction engine is real (`@moxxy/anonymizer`); only the host
 * boundaries are stubbed:
 *   - the NER Worker (loads a ~109 MB model) → a no-op fake, so the on-device
 *     name pass simply yields nothing and structured redaction still runs.
 *   - the desktop IPC api → a fake, so Save routes without a native dialog.
 *
 * What's asserted: pasting text produces redacted output, the Filters
 * multi-select toggles a category on/off and the output follows, the segmented
 * mode control changes the redaction style, and Copy uses the clipboard.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { SendToSessionPayload } from '@moxxy/client-core';
import { AnonymizerApp } from './AnonymizerApp';
import type { NerToken } from './ner/aggregate';

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

    // Open the panel and turn Emails off. Rows are ARIA `option`s (aria-selected),
    // not checkboxes — selection toggles by activating the row.
    fireEvent.click(trigger);
    const panel = screen.getByTestId('anon-filter-select-panel');
    const emailOption = screen.getByTestId('anon-filter-select-opt-email');
    expect(emailOption).toHaveAttribute('role', 'option');
    expect(emailOption).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(emailOption);

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
    const sendToSession = vi.fn((_p: SendToSessionPayload) => true);
    render(<AnonymizerApp onExit={vi.fn()} sendToSession={sendToSession} />);
    paste(SAMPLE);
    fireEvent.click(screen.getByTestId('anon-send-chat'));

    expect(sendToSession).toHaveBeenCalledTimes(1);
    const payload = sendToSession.mock.calls[0]![0];
    expect(payload.text).toContain('[EMAIL]');
    expect(payload.text).not.toContain('a@b.com');
    expect(payload.title).toMatch(/Redacted document/);
    expect(payload.meta).toMatchObject({ source: 'anonymizer' });
  });

  it('"Send to chat" surfaces a notice (no silent no-op) when there is no active session', () => {
    // sendToSession returns false when no workspace is active — the app must say so.
    const sendToSession = vi.fn((_p: SendToSessionPayload) => false);
    render(<AnonymizerApp onExit={vi.fn()} sendToSession={sendToSession} />);
    paste(SAMPLE);
    fireEvent.click(screen.getByTestId('anon-send-chat'));

    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('anon-status').textContent).toMatch(/no active session/i);
  });

  it('"Send to chat" is hidden when the capability was not granted', () => {
    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);
    expect(screen.queryByTestId('anon-send-chat')).not.toBeInTheDocument();
  });

  it('Copy does NOT report success and surfaces a notice when the clipboard write rejects', async () => {
    const writeText = vi.fn(() => Promise.reject(new Error('denied')));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AnonymizerApp onExit={vi.fn()} />);
    paste(SAMPLE);
    fireEvent.click(screen.getByTestId('anon-copy'));

    await waitFor(() =>
      expect(screen.getByTestId('anon-status').textContent).toMatch(/couldn't copy/i),
    );
    // The button never falsely flips to "Copied".
    expect(screen.getByTestId('anon-copy').textContent).toContain('Copy redacted');
    expect(screen.getByTestId('anon-copy').textContent).not.toContain('Copied');
  });

  it('a dropped file larger than the cap is rejected before it is read', () => {
    const arrayBuffer = vi.fn(() => Promise.resolve(new ArrayBuffer(0)));
    render(<AnonymizerApp onExit={vi.fn()} />);
    const dropzone = screen.getByTestId('anon-dropzone');
    // 200 MB file — over the 50 MB cap. arrayBuffer() must never be called.
    const file = { name: 'huge.txt', size: 200 * 1_000_000, arrayBuffer } as unknown as File;
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(screen.getByTestId('anon-import-error').textContent).toMatch(/too large/i);
  });
});

/** A controllable model worker: records posted infer requests and lets the test
 *  reply to a SPECIFIC (possibly stale) request out of order. */
interface PostedInfer {
  readonly type: string;
  readonly id: number;
  readonly text: string;
}
class ReplyableWorker {
  static instances: ReplyableWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  readonly posted: PostedInfer[] = [];
  constructor() {
    ReplyableWorker.instances.push(this);
  }
  postMessage(msg: PostedInfer): void {
    this.posted.push(msg);
  }
  terminate(): void {}
  reply(id: number, tokens: NerToken[]): void {
    this.onmessage?.({ data: { type: 'result', id, tokens } } as MessageEvent);
  }
}

describe('AnonymizerApp NER race safety', () => {
  beforeEach(() => {
    ReplyableWorker.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('Worker', ReplyableWorker as never);
    __setApiOverride({
      invoke: vi.fn(() => Promise.resolve(null)),
      subscribe: vi.fn(() => () => {}),
    } as never);
  });
  afterEach(() => {
    __setApiOverride(null);
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does NOT apply NER spans computed for stale text to the current (changed) input', async () => {
    render(<AnonymizerApp onExit={vi.fn()} />);

    // Paste a name-only document (no structured PII), let the NER debounce fire.
    fireEvent.click(screen.getByTestId('anon-src-paste'));
    fireEvent.change(screen.getByTestId('anon-paste'), { target: { value: 'Zelnor Kael' } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    const worker = ReplyableWorker.instances[0]!;
    const staleReq = worker.posted.at(-1)!;
    expect(staleReq.text).toBe('Zelnor Kael');

    // The text changes to something SHORTER before the slow model replies.
    fireEvent.change(screen.getByTestId('anon-paste'), { target: { value: 'Hi' } });

    // Now the FIRST (stale) request resolves out of order, carrying a person span
    // whose offsets [0,11] are valid for 'Zelnor Kael' but would, applied to the
    // 2-char 'Hi', either corrupt or drop content (redact() never clamps spans).
    await act(async () => {
      worker.reply(staleReq.id, [
        { entity: 'B-PER', word: 'Zelnor', index: 0, score: 0.99 },
        { entity: 'I-PER', word: 'Kael', index: 1, score: 0.99 },
      ]);
    });

    // The guard drops the stale spans: the current output is the untouched 'Hi'.
    const out = screen.getByTestId('anon-output');
    expect(out.textContent).toBe('Hi');
    expect(out.textContent).not.toContain('[PERSON]');
  });
});
