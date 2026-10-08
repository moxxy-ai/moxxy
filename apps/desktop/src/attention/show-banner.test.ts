import { afterEach, describe, expect, it, vi } from 'vitest';
import { showBanner } from './show-banner';

/**
 * The system's notification centre is outside the app, so its constructor is
 * the one thing stood in for: this records what the app hands over.
 */
class RecordedNotification {
  static permission = 'granted';
  static shown: RecordedNotification[] = [];
  onclick: (() => void) | null = null;
  readonly close = vi.fn();
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    RecordedNotification.shown.push(this);
  }
}

afterEach(() => {
  RecordedNotification.shown = [];
  RecordedNotification.permission = 'granted';
  vi.unstubAllGlobals();
});

const BANNER = { title: 'Muffins', body: 'Bake for 20 minutes.', tag: 'session-1', onOpen: () => undefined };

describe('showBanner', () => {
  it('hands the system the text, silent, under the chat as its tag so a newer one replaces it', () => {
    vi.stubGlobal('Notification', RecordedNotification);

    showBanner(BANNER);

    expect(RecordedNotification.shown).toHaveLength(1);
    expect(RecordedNotification.shown[0]).toMatchObject({
      title: 'Muffins',
      options: { body: 'Bake for 20 minutes.', tag: 'session-1', silent: true },
    });
  });

  it('opens the chat and puts the banner away when it is clicked', () => {
    vi.stubGlobal('Notification', RecordedNotification);
    const onOpen = vi.fn();

    showBanner({ ...BANNER, onOpen });
    const shown = RecordedNotification.shown[0];
    shown?.onclick?.();

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(shown?.close).toHaveBeenCalledTimes(1);
  });

  it('shows nothing where the system refuses notifications', () => {
    RecordedNotification.permission = 'denied';
    vi.stubGlobal('Notification', RecordedNotification);

    showBanner(BANNER);

    expect(RecordedNotification.shown).toEqual([]);
  });

  it('shows nothing where there is no notification centre', () => {
    vi.stubGlobal('Notification', undefined);

    expect(() => showBanner(BANNER)).not.toThrow();
  });
});
