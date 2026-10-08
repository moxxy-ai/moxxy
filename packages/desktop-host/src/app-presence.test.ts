import { describe, expect, it } from 'vitest';
import { appPresence, type PresenceWindow } from './app-presence';

const win = (focused: boolean, destroyed = false): PresenceWindow => ({
  isDestroyed: () => destroyed,
  isFocused: () => {
    if (destroyed) throw new Error('Object has been destroyed');
    return focused;
  },
});

describe('appPresence', () => {
  it('says the main window has the keyboard', () => {
    expect(appPresence({ main: win(true), widget: null, others: [] })).toEqual({ focused: 'main', widgetOpen: false });
  });

  it('says the Mini Chat has the keyboard while the main window is hidden behind it', () => {
    expect(appPresence({ main: win(false), widget: win(true), others: [] })).toEqual({
      focused: 'widget',
      widgetOpen: true,
    });
  });

  it('says the app is in the background when none of its windows has the keyboard', () => {
    expect(appPresence({ main: win(false), widget: win(false), others: [win(false)] })).toEqual({
      focused: null,
      widgetOpen: true,
    });
  });

  it('counts another window of the app, a sign-in one, as the app in front', () => {
    expect(appPresence({ main: win(false), widget: null, others: [win(true)] })).toEqual({
      focused: 'other',
      widgetOpen: false,
    });
  });

  it('never asks a destroyed window, and does not count a destroyed Mini Chat as open', () => {
    expect(appPresence({ main: win(true, true), widget: win(true, true), others: [win(true, true)] })).toEqual({
      focused: null,
      widgetOpen: false,
    });
  });

  it('stands with no window at all, as on macOS with every window closed', () => {
    expect(appPresence({ main: null, widget: null, others: [] })).toEqual({ focused: null, widgetOpen: false });
  });
});
