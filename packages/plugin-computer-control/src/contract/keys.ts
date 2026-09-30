import { ComputerUseError } from './outcome.js';

export type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta';
/** One chord: modifiers in canonical order and at most one key (none when only modifiers are held). */
export interface KeyCombo { readonly modifiers: readonly Modifier[]; readonly key: string | null }
export type KeyPlatform = 'darwin' | 'win32';

const MODIFIER_ORDER: readonly Modifier[] = ['ctrl', 'alt', 'shift', 'meta'];

// `meta` is Command on macOS and the Windows key on Windows.
const MODIFIERS: Readonly<Record<string, Modifier>> = {
  ctrl: 'ctrl', control: 'ctrl', control_l: 'ctrl', control_r: 'ctrl',
  alt: 'alt', option: 'alt', opt: 'alt', alt_l: 'alt', alt_r: 'alt',
  shift: 'shift', shift_l: 'shift', shift_r: 'shift',
  super: 'meta', super_l: 'meta', super_r: 'meta', meta: 'meta', meta_l: 'meta', meta_r: 'meta',
  cmd: 'meta', command: 'meta', win: 'meta', windows: 'meta',
};

// xdotool keysym names (case-insensitive) → neutral key names the helpers map to virtual keys.
// Delete is forward delete, as in xdotool; BackSpace removes the character before the caret.
const NAMED_KEYS: Readonly<Record<string, string>> = {
  return: 'enter', enter: 'enter', tab: 'tab', iso_left_tab: 'tab', escape: 'escape', esc: 'escape',
  backspace: 'backspace', delete: 'forward_delete', del: 'forward_delete', insert: 'insert',
  space: 'space', up: 'up', down: 'down', left: 'left', right: 'right', home: 'home', end: 'end',
  page_up: 'page_up', prior: 'page_up', pageup: 'page_up', page_down: 'page_down', next: 'page_down', pagedown: 'page_down',
  caps_lock: 'caps_lock', help: 'help', menu: 'menu',
  kp_enter: 'numpad_enter', kp_add: 'numpad_add', kp_subtract: 'numpad_subtract', kp_multiply: 'numpad_multiply',
  kp_divide: 'numpad_divide', kp_decimal: 'numpad_decimal', kp_equal: 'numpad_equal',
  comma: ',', period: '.', slash: '/', backslash: '\\', minus: '-', plus: '+', equal: '=', semicolon: ';',
  apostrophe: "'", grave: '`', bracketleft: '[', bracketright: ']', parenleft: '(', parenright: ')',
  exclam: '!', at: '@', numbersign: '#', dollar: '$', percent: '%', asciicircum: '^', ampersand: '&',
  asterisk: '*', underscore: '_', colon: ':', quotedbl: '"', less: '<', greater: '>', question: '?',
  braceleft: '{', braceright: '}', bar: '|', asciitilde: '~',
};

function namedKey(token: string): string | undefined {
  const lower = token.toLowerCase();
  const named = NAMED_KEYS[lower];
  if (named) return named;
  const numpad = /^kp_(\d)$/.exec(lower);
  if (numpad) return `numpad_${numpad[1]}`;
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower;
  return undefined;
}

function splitTokens(text: string): string[] {
  if (text === '+') return ['+'];
  // "ctrl++" holds ctrl and presses plus.
  if (text.endsWith('++')) return [...text.slice(0, -2).split('+'), '+'];
  return text.split('+');
}

/** Parse one xdotool-style chord ("Return", "super+c", "ctrl+shift+Tab", "KP_0"). */
export function parseKeyCombo(text: string): KeyCombo {
  const trimmed = text.trim();
  if (trimmed === '') throw new ComputerUseError('invalid_key', 'Key combo is empty');
  const modifiers = new Set<Modifier>();
  const keys: string[] = [];
  for (const raw of splitTokens(trimmed)) {
    const token = raw.trim();
    if (token === '') throw new ComputerUseError('invalid_key', `Key combo "${text}" has an empty part`);
    const modifier = MODIFIERS[token.toLowerCase()];
    if (modifier) { modifiers.add(modifier); continue; }
    const key = namedKey(token) ?? ([...token].length === 1 ? token : undefined);
    if (key === undefined) throw new ComputerUseError('invalid_key', `Key combo has an unknown key "${token}"`);
    keys.push(key);
  }
  if (keys.length > 1) throw new ComputerUseError('invalid_key', `Key combo "${text}" presses more than one key; send one key per chord and use computer_batch for sequences`);
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier));
  const key = keys[0] ?? null;
  // Under a modifier a letter names the physical key: cmd+C is cmd+c.
  const normalized = key !== null && ordered.length > 0 && /^[A-Z]$/.test(key) ? key.toLowerCase() : key;
  return { modifiers: ordered, key: normalized };
}

export function formatChord(combo: KeyCombo): string {
  return [...combo.modifiers, ...(combo.key === null ? [] : [combo.key])].join('+');
}

// Chords that act on the whole system rather than the target app (quit, switch, lock, Spaces).
const SYSTEM_COMBOS: Readonly<Record<KeyPlatform, ReadonlySet<string>>> = {
  darwin: new Set([
    'meta+q', 'shift+meta+q', 'alt+shift+meta+q', 'alt+meta+escape', 'meta+tab', 'shift+meta+tab', 'meta+space',
    'ctrl+meta+q', 'ctrl+f1', 'ctrl+f2', 'ctrl+f3', 'ctrl+f7', 'ctrl+f8', 'ctrl+up', 'ctrl+down',
  ]),
  win32: new Set([
    'ctrl+alt+forward_delete', 'alt+f4', 'alt+tab', 'alt+shift+tab', 'ctrl+alt+tab', 'ctrl+alt+shift+tab',
    'meta+l', 'meta+d', 'meta+r', 'meta+e', 'meta+s', 'meta+q', 'ctrl+escape', 'meta+i', 'meta+u', 'meta+x',
  ]),
};

export function isSystemKeyCombo(combo: KeyCombo, platform: KeyPlatform): boolean {
  return SYSTEM_COMBOS[platform].has(formatChord(combo).toLowerCase());
}

export type ClipboardFlag = 'clipboardRead' | 'clipboardWrite';

/** Clipboard grants a chord needs: paste reads the clipboard, copy and cut write it. */
export function clipboardFlagsFor(combo: KeyCombo): ClipboardFlag[] {
  const has = (modifier: Modifier) => combo.modifiers.includes(modifier);
  const key = combo.key?.toLowerCase();
  const flags = new Set<ClipboardFlag>();
  if (has('meta') || has('ctrl')) {
    if (key === 'v') flags.add('clipboardRead');
    if (key === 'c' || key === 'x') flags.add('clipboardWrite');
  }
  if (key === 'insert' && has('shift')) flags.add('clipboardRead');
  if (key === 'insert' && has('ctrl')) flags.add('clipboardWrite');
  if (key === 'forward_delete' && has('shift')) flags.add('clipboardWrite');
  return [...flags];
}
