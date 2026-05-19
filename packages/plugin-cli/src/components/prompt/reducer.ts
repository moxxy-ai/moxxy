export interface State {
  buffer: string;
  cursor: number;
  killBuffer: string;
  inPaste: boolean;
  pasteBuffer: string;
}

export type Action =
  | { type: 'insert'; text: string }
  | { type: 'insert-newline'; stripBackslashAtEnd: boolean }
  | { type: 'delete-back' }
  | { type: 'delete-forward' }
  | { type: 'delete-word-back' }
  | { type: 'cursor-left' }
  | { type: 'cursor-right' }
  | { type: 'word-back' }
  | { type: 'word-forward' }
  | { type: 'line-start' }
  | { type: 'line-end' }
  | { type: 'kill-to-line-end' }
  | { type: 'kill-to-line-start' }
  | { type: 'yank' }
  | { type: 'reset' }
  | { type: 'set'; buffer: string; cursor: number }
  | { type: 'paste-start' }
  | { type: 'paste-end'; overrideText?: string }
  | { type: 'paste-append'; data: string };

export const INITIAL: State = {
  buffer: '',
  cursor: 0,
  killBuffer: '',
  inPaste: false,
  pasteBuffer: '',
};

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'insert': {
      const next = state.buffer.slice(0, state.cursor) + action.text + state.buffer.slice(state.cursor);
      return { ...state, buffer: next, cursor: state.cursor + action.text.length };
    }
    case 'insert-newline': {
      // Insert a newline at the cursor. If stripBackslashAtEnd is true
      // AND the buffer ends with `\` AND the cursor is at the end,
      // strip the trailing backslash first (legacy line-continuation
      // syntax). Atomic — one reducer pass, no risk of half-updated
      // state between dispatches.
      const stripping =
        action.stripBackslashAtEnd &&
        state.buffer.endsWith('\\') &&
        state.cursor === state.buffer.length;
      const buf = stripping ? state.buffer.slice(0, -1) : state.buffer;
      const cur = stripping ? state.cursor - 1 : state.cursor;
      const next = buf.slice(0, cur) + '\n' + buf.slice(cur);
      return { ...state, buffer: next, cursor: cur + 1 };
    }
    case 'delete-back': {
      if (state.cursor === 0) return state;
      const next = state.buffer.slice(0, state.cursor - 1) + state.buffer.slice(state.cursor);
      return { ...state, buffer: next, cursor: state.cursor - 1 };
    }
    case 'delete-forward': {
      if (state.cursor >= state.buffer.length) return state;
      const next = state.buffer.slice(0, state.cursor) + state.buffer.slice(state.cursor + 1);
      return { ...state, buffer: next };
    }
    case 'delete-word-back': {
      if (state.cursor === 0) return state;
      const start = wordBackPos(state.buffer, state.cursor);
      const killed = state.buffer.slice(start, state.cursor);
      const next = state.buffer.slice(0, start) + state.buffer.slice(state.cursor);
      return { ...state, buffer: next, cursor: start, killBuffer: killed };
    }
    case 'cursor-left':
      return { ...state, cursor: Math.max(0, state.cursor - 1) };
    case 'cursor-right':
      return { ...state, cursor: Math.min(state.buffer.length, state.cursor + 1) };
    case 'word-back':
      return { ...state, cursor: wordBackPos(state.buffer, state.cursor) };
    case 'word-forward':
      return { ...state, cursor: wordForwardPos(state.buffer, state.cursor) };
    case 'line-start':
      return { ...state, cursor: lineStart(state.buffer, state.cursor) };
    case 'line-end':
      return { ...state, cursor: lineEnd(state.buffer, state.cursor) };
    case 'kill-to-line-end': {
      const end = lineEnd(state.buffer, state.cursor);
      const killed = state.buffer.slice(state.cursor, end);
      const next = state.buffer.slice(0, state.cursor) + state.buffer.slice(end);
      return { ...state, buffer: next, killBuffer: killed };
    }
    case 'kill-to-line-start': {
      const start = lineStart(state.buffer, state.cursor);
      const killed = state.buffer.slice(start, state.cursor);
      const next = state.buffer.slice(0, start) + state.buffer.slice(state.cursor);
      return { ...state, buffer: next, cursor: start, killBuffer: killed };
    }
    case 'yank': {
      if (!state.killBuffer) return state;
      const next =
        state.buffer.slice(0, state.cursor) + state.killBuffer + state.buffer.slice(state.cursor);
      return { ...state, buffer: next, cursor: state.cursor + state.killBuffer.length };
    }
    case 'reset':
      return { ...INITIAL, killBuffer: state.killBuffer };
    case 'set':
      return { ...state, buffer: action.buffer, cursor: clamp(action.cursor, 0, action.buffer.length) };
    case 'paste-start':
      return { ...state, inPaste: true, pasteBuffer: '' };
    case 'paste-end': {
      const text = action.overrideText !== undefined ? action.overrideText : state.pasteBuffer;
      const next = state.buffer.slice(0, state.cursor) + text + state.buffer.slice(state.cursor);
      return { ...state, buffer: next, cursor: state.cursor + text.length, inPaste: false, pasteBuffer: '' };
    }
    case 'paste-append':
      return { ...state, pasteBuffer: state.pasteBuffer + action.data };
    default:
      return state;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function isWordChar(c: string): boolean {
  return /[A-Za-z0-9_]/.test(c);
}

function wordBackPos(buffer: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && !isWordChar(buffer[i - 1]!)) i -= 1;
  while (i > 0 && isWordChar(buffer[i - 1]!)) i -= 1;
  return i;
}

function wordForwardPos(buffer: string, cursor: number): number {
  let i = cursor;
  while (i < buffer.length && !isWordChar(buffer[i]!)) i += 1;
  while (i < buffer.length && isWordChar(buffer[i]!)) i += 1;
  return i;
}

function lineStart(buffer: string, cursor: number): number {
  let i = cursor;
  while (i > 0 && buffer[i - 1] !== '\n') i -= 1;
  return i;
}

function lineEnd(buffer: string, cursor: number): number {
  let i = cursor;
  while (i < buffer.length && buffer[i] !== '\n') i += 1;
  return i;
}
