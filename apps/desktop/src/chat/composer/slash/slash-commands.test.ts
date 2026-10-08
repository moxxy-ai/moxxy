import { describe, expect, it } from 'vitest';
import { slashInvocation, slashOptions, slashQuery, type SlashSource } from './slash-commands';

const source: SlashSource = {
  modes: ['default', 'plan', 'goal', 'research'],
  activeMode: 'default',
  modeBusy: false,
  autoApprove: false,
  skills: [
    { id: 'builtin/browser', name: 'browser', label: 'Moxxy Browser', aliases: ['moxxy_browser'], description: 'Drive the in-window browser' },
    { id: 'user/emil', name: 'emil-design-eng', description: 'Interface polish' },
  ],
  commands: [
    { name: 'compact', description: 'Summarize older turns' },
    { name: 'new', description: 'Start a fresh run', aliases: ['reset'] },
    { name: 'exit', description: 'Quit' },
    { name: 'help', description: 'List commands' },
    { name: 'pair', description: 'Pair a chat', channels: ['telegram'] },
  ],
};

const names = (query: string, from: SlashSource = source): string[] => slashOptions(from, query).map((o) => o.name);

describe('slashQuery', () => {
  it('is the word after a slash that starts the draft', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/pl')).toBe('pl');
  });

  it('is nothing once the draft has a second word, or does not start with the slash', () => {
    expect(slashQuery('/plan the move')).toBeNull();
    expect(slashQuery('see /plan')).toBeNull();
    expect(slashQuery('/Users/me/file.txt')).toBeNull();
  });
});

describe('slashOptions', () => {
  it('offers the modes, then the skills, then the actions', () => {
    const options = slashOptions(source, '');

    expect(options.map((o) => o.section)).toEqual([
      'Modes', 'Modes', 'Modes', 'Modes',
      'Skills', 'Skills',
      'Actions', 'Actions', 'Actions',
    ]);
    expect(options.map((o) => o.name)).toEqual([
      'default', 'plan', 'goal', 'research',
      'moxxy_browser', 'emil-design-eng',
      'auto-approve', 'compact', 'new',
    ]);
  });

  it('names a mode the way the rest of the app does, and marks the one that is on', () => {
    const plan = slashOptions({ ...source, activeMode: 'plan' }, 'plan')[0];

    expect(plan).toMatchObject({ label: 'Plan', hint: 'Reads only, then writes a plan', active: true });
    expect(plan?.action).toEqual({ kind: 'mode', mode: 'plan' });
  });

  it('arms a goal instead of switching to its mode, which needs an objective', () => {
    expect(slashOptions(source, 'goal')[0]?.action).toEqual({ kind: 'goal' });
  });

  it('greys the modes out while a turn is running', () => {
    const options = slashOptions({ ...source, modeBusy: true }, '');

    expect(options.filter((o) => o.section === 'Modes').every((o) => o.disabled)).toBe(true);
    expect(options.find((o) => o.name === 'compact')?.disabled).toBeFalsy();
  });

  it('puts a skill in as its mention', () => {
    const browser = slashOptions(source, 'brow')[0];

    expect(browser).toMatchObject({ section: 'Skills', label: 'Moxxy Browser' });
    expect(browser?.action).toEqual({ kind: 'skill', token: 'moxxy_browser' });
  });

  it('says whether auto-approve is on', () => {
    expect(slashOptions({ ...source, autoApprove: true }, 'auto')[0]).toMatchObject({ active: true });
  });

  it('leaves out the actions that mean nothing in this window', () => {
    expect(names('')).not.toContain('exit');
    expect(names('')).not.toContain('help');
    expect(names('')).not.toContain('pair');
  });

  it('narrows as the word is typed: a name that starts with it before one that only holds it', () => {
    expect(names('re')).toEqual(['research', 'new']);
    expect(names('zzz')).toEqual([]);
  });

  it('shows a handful of skills until a word narrows them', () => {
    const many = { ...source, skills: Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, name: `skill-${i}` })) };

    expect(slashOptions(many, '').filter((o) => o.section === 'Skills')).toHaveLength(6);
  });
});

describe('slashInvocation', () => {
  it('reads a typed line that names an option and gives it words', () => {
    const typed = slashInvocation('/goal ship the redesign', source);

    expect(typed?.option.action).toEqual({ kind: 'goal' });
    expect(typed?.rest).toBe('ship the redesign');
  });

  it('finds an action by its other name', () => {
    expect(slashInvocation('/reset now', source)?.option.name).toBe('new');
  });

  it('leaves a path, an unknown word and a skill to be sent as written', () => {
    expect(slashInvocation('/Users/me/notes.md explain this', source)).toBeNull();
    expect(slashInvocation('/nope do it', source)).toBeNull();
    expect(slashInvocation('/moxxy_browser open the site', source)).toBeNull();
  });

  it('is nothing for one word alone: the menu answers that', () => {
    expect(slashInvocation('/plan', source)).toBeNull();
  });
});
