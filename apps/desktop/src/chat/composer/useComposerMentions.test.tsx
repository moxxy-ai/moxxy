import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SkillInfo } from '@moxxy/sdk';
import { useComposerMentions, type MentionKey } from './useComposerMentions';

const skills: SkillInfo[] = [
  { id: 'builtin/browser', name: 'browser', label: 'Moxxy Browser', aliases: ['moxxy_browser'], description: 'Drive the in-window browser' },
  { id: 'plugin/computer-control', name: 'computer-control', label: 'Computer Use', aliases: ['computer_use'], description: 'Operate desktop apps' },
];

/** The composer's draft and a real textarea, as the Composer wires them. */
function setup() {
  const textarea = document.createElement('textarea');
  document.body.append(textarea);
  const hook = renderHook(() => {
    const [draft, setDraft] = useState('');
    const ref = useRef<HTMLTextAreaElement>(textarea);
    textarea.value = draft; // the Composer's `value={draft}`
    return { draft, setDraft, mentions: useComposerMentions(skills, draft, setDraft, ref) };
  });
  const type = (value: string) => act(() => {
    hook.result.current.setDraft(value);
    hook.result.current.mentions.trackCaret({ selectionStart: value.length });
  });
  return { ...hook, textarea, type };
}

const key = (name: string, over: Partial<MentionKey> = {}): MentionKey => ({
  key: name, shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn(), ...over,
});

describe('useComposerMentions', () => {
  it('opens on the @ word the caret is in', () => {
    const { result, type } = setup();
    type('zrób baner @com');
    expect(result.current.mentions.open).toBe(true);
    expect(result.current.mentions.options.map((option) => option.label)).toEqual(['Computer Use']);
  });

  it('puts the pick into the draft on Enter and leaves the caret after it', async () => {
    const { result, type, textarea } = setup();
    type('zrób @com');
    const enter = key('Enter');
    let consumed = false;
    act(() => { consumed = result.current.mentions.handleKey(enter); });

    expect(consumed).toBe(true);
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(result.current.draft).toBe('zrób @computer_use ');
    expect(result.current.mentions.open).toBe(false);
    await waitFor(() => expect(textarea.selectionStart).toBe('zrób @computer_use '.length));
  });

  it('moves with the arrows and closes on Escape', () => {
    const { result, type } = setup();
    type('@');
    act(() => { result.current.mentions.handleKey(key('ArrowDown')); });
    expect(result.current.mentions.active).toBe(1);
    act(() => { result.current.mentions.handleKey(key('Escape')); });
    expect(result.current.mentions.open).toBe(false);
    expect(result.current.draft).toBe('@');
  });

  it('leaves the keys to the composer while the menu is closed, Shift+Enter, and an IME composition', () => {
    const { result, type } = setup();
    type('bez menu');
    expect(result.current.mentions.handleKey(key('Enter'))).toBe(false);
    type('@');
    expect(result.current.mentions.handleKey(key('Enter', { shiftKey: true }))).toBe(false);
    expect(result.current.mentions.handleKey(key('Enter', { nativeEvent: { isComposing: true } }))).toBe(false);
  });

  it('picks a row by its index, as a click on it does', () => {
    const { result, type } = setup();
    type('@');
    act(() => result.current.mentions.pick(1));
    expect(result.current.draft).toBe('@moxxy_browser ');
  });
});
