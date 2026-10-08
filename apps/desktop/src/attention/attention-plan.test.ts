import { describe, expect, it } from 'vitest';
import type { AppPresence } from '@moxxy/desktop-ipc-contract';
import { planAttention } from './attention-plan';
import type { Call } from './calls-for-attention';

const answered = (sessionId: string): Call => ({ sessionId, reason: 'answered' });
const asked = (sessionId: string): Call => ({ sessionId, reason: 'asked' });

const IN_MAIN: AppPresence = { focused: 'main', widgetOpen: false };
const AWAY: AppPresence = { focused: null, widgetOpen: false };
const WIDGET_BESIDE_WORK: AppPresence = { focused: null, widgetOpen: true };
const IN_WIDGET: AppPresence = { focused: 'widget', widgetOpen: true };

/** Chat `a` is the active one and is on screen in the main window, unless a case says otherwise. */
const plan = (over: Partial<Parameters<typeof planAttention>[0]>): ReturnType<typeof planAttention> =>
  planAttention({ calls: [], mainChatId: 'a', activeId: 'a', presence: IN_MAIN, sound: true, banners: true, ...over });

describe('planAttention', () => {
  it('does nothing for the chat being read in the main window', () => {
    expect(plan({ calls: [answered('a'), asked('a')] })).toEqual({ ring: false, banners: [] });
  });

  it('rings for another chat, with no banner while the app has the keyboard', () => {
    expect(plan({ calls: [answered('b')] })).toEqual({ ring: true, banners: [] });
    expect(plan({ calls: [asked('b')] })).toEqual({ ring: true, banners: [] });
  });

  it('rings for the active chat when the main window shows another view', () => {
    expect(plan({ calls: [answered('a')], mainChatId: null })).toEqual({ ring: true, banners: [] });
  });

  it('rings and shows a banner for every chat once the app is in the background', () => {
    expect(plan({ calls: [answered('a'), asked('b')], presence: AWAY })).toEqual({
      ring: true,
      banners: [answered('a'), asked('b')],
    });
  });

  it('rings for the chat the Mini Chat shows, but leaves the banner out: the widget is on screen', () => {
    expect(plan({ calls: [answered('a'), answered('b')], mainChatId: null, presence: WIDGET_BESIDE_WORK })).toEqual({
      ring: true,
      banners: [answered('b')],
    });
  });

  it('does nothing for the chat being read in the Mini Chat', () => {
    expect(plan({ calls: [answered('a')], mainChatId: null, presence: IN_WIDGET })).toEqual({ ring: false, banners: [] });
    expect(plan({ calls: [answered('b')], mainChatId: null, presence: IN_WIDGET })).toEqual({ ring: true, banners: [] });
  });

  it('treats another window of the app as the app in front, reading no chat', () => {
    expect(plan({ calls: [answered('a')], presence: { focused: 'other', widgetOpen: false } })).toEqual({
      ring: true,
      banners: [],
    });
  });

  it('keeps each switch to its own channel', () => {
    expect(plan({ calls: [answered('b')], presence: AWAY, sound: false })).toEqual({ ring: false, banners: [answered('b')] });
    expect(plan({ calls: [answered('b')], presence: AWAY, banners: false })).toEqual({ ring: true, banners: [] });
  });

  it('plans nothing without a call', () => {
    expect(plan({ presence: AWAY })).toEqual({ ring: false, banners: [] });
  });
});
