/**
 * Pointer and keyboard input for a page driven over CDP.
 *
 * Kept apart from the host so the rules a press follows — find the element,
 * check nothing covers it, move there, press — live in one place and read in
 * order. Every function takes the CDP channel and nothing else, so none of it
 * knows whether the page is a desktop view or a test browser.
 */

export interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Middle of a CDP quad (`[x1,y1,…,x4,y4]`), or null when it has no area. */
export function quadCentre(quad: unknown): Point | null {
  const box = quadBounds(quad);
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

/** The upright box around a CDP quad, or null when it is not one or has no area. */
function quadBounds(quad: unknown): { x: number; y: number; width: number; height: number } | null {
  if (!Array.isArray(quad) || quad.length < 8) return null;
  const numbers = quad.slice(0, 8).map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  const xs = [numbers[0], numbers[2], numbers[4], numbers[6]] as number[];
  const ys = [numbers[1], numbers[3], numbers[5], numbers[7]] as number[];
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  if (!(width > 0 && height > 0)) return null;
  return { x: Math.min(...xs), y: Math.min(...ys), width, height };
}

/** Top-left corner of a CDP quad, or null when it is not one. */
export function quadOrigin(quad: unknown): Point | null {
  if (!Array.isArray(quad) || quad.length < 8) return null;
  const numbers = quad.slice(0, 8).map(Number);
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  return {
    x: Math.min(numbers[0] as number, numbers[2] as number, numbers[4] as number, numbers[6] as number),
    y: Math.min(numbers[1] as number, numbers[3] as number, numbers[5] as number, numbers[7] as number),
  };
}

/**
 * Wait until the document has been parsed — at most `timeoutMs` — woken by the
 * page's own DOMContentLoaded. Before that its styles may not apply yet, and
 * an element measured then is somewhere else a moment later: a press aimed at
 * it lands on whatever moved into its place.
 */
export async function untilParsed(cdp: Cdp, timeoutMs: number): Promise<void> {
  try {
    await cdp.send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `document.readyState !== 'loading' || new Promise((done) => {
        const timer = setTimeout(() => done(false), ${Math.max(0, timeoutMs)});
        document.addEventListener('DOMContentLoaded', () => { clearTimeout(timer); done(true); }, { once: true });
      })`,
    });
  } catch {
    // A document being replaced has no context to ask; the caller measures what is there.
  }
}

/** Scroll an element into view and say where to press it now. */
export async function locate(cdp: Cdp, backendNodeId: number): Promise<Point | null> {
  try {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  } catch {
    // Not scrollable; it may already be in view.
  }
  const line = await middleOfLargestLine(cdp, backendNodeId);
  if (line) return line;
  try {
    const box = (await cdp.send('DOM.getBoxModel', { backendNodeId })) as { model?: { content?: unknown } };
    return quadCentre(box?.model?.content);
  } catch {
    // "Could not compute box model": not laid out — hidden, or inside a closed menu.
    return null;
  }
}

/**
 * The middle of an element's largest line box. A link that wraps has one box
 * per line, and the middle of the box around them all can fall between the
 * lines, on the sentence that holds the link — seen live on Wikipedia in the
 * narrow Browser pane, where the press then reached nothing that navigates.
 */
async function middleOfLargestLine(cdp: Cdp, backendNodeId: number): Promise<Point | null> {
  try {
    const reply = (await cdp.send('DOM.getContentQuads', { backendNodeId })) as { quads?: unknown };
    if (!Array.isArray(reply?.quads)) return null;
    let best: { x: number; y: number; width: number; height: number } | null = null;
    for (const quad of reply.quads) {
      const box = quadBounds(quad);
      if (box && (!best || box.width * box.height > best.width * best.height)) best = box;
    }
    return best ? { x: best.x + best.width / 2, y: best.y + best.height / 2 } : null;
  } catch {
    return null;
  }
}

/**
 * What a press at `point` would land on instead of the element, if anything.
 *
 * A click is dispatched at a position, and the page decides what is there. A
 * fixed banner over a button takes the click, the banner's own handler runs,
 * and the tool reports success for a press the button never saw — the agent
 * then reads an unchanged page and tries again. Asking the page what is
 * topmost at the point turns that into an error naming the thing in the way.
 *
 * Null means the press reaches the element (or something inside it, or the
 * label that forwards to it). When the page cannot answer, null too: a check
 * that cannot run must not block a click that would have worked.
 */
export async function coverAt(cdp: Cdp, backendNodeId: number, point: Point): Promise<string | null> {
  try {
    const hit = (await cdp.send('DOM.getNodeForLocation', {
      x: Math.round(point.x),
      y: Math.round(point.y),
      includeUserAgentShadowDOM: false,
      // false: a layer with `pointer-events: none` is passed through, as the
      // pointer passes through it. true would count it as the thing hit.
      ignorePointerEventsNone: false,
    })) as { backendNodeId?: number };
    if (hit?.backendNodeId === undefined || hit.backendNodeId === backendNodeId) return null;
    const target = await objectOf(cdp, backendNodeId);
    const top = await objectOf(cdp, hit.backendNodeId);
    if (!target || !top) return null;
    const reply = (await cdp.send('Runtime.callFunctionOn', {
      objectId: target,
      arguments: [{ objectId: top }],
      returnByValue: true,
      functionDeclaration: `function (top) {
        const inside = (a, b) => a === b || (a instanceof Node && b instanceof Node && a.contains(b));
        if (inside(this, top) || inside(top, this)) return null;
        const label = top.closest && top.closest('label');
        if (label && (label.control === this || label.contains(this))) return null;
        const host = top.getRootNode && top.getRootNode().host;
        if (host && inside(this, host)) return null;
        const owner = top.closest ? top.closest('[role=dialog],[aria-modal=true],dialog,[id],[class]') || top : top;
        const name = (owner.getAttribute && (owner.getAttribute('aria-label') || '')) ||
          (owner.innerText || owner.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
        const tag = (owner.tagName || 'element').toLowerCase();
        return name ? tag + ' "' + name + '"' : tag;
      }`,
    })) as { result?: { value?: unknown } };
    const value = reply?.result?.value;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

async function objectOf(cdp: Cdp, backendNodeId: number): Promise<string | null> {
  const handle = (await cdp.send('DOM.resolveNode', { backendNodeId })) as { object?: { objectId?: string } };
  return handle?.object?.objectId ?? null;
}

/** Whether the element refuses presses: a disabled control, or one marked so. */
export async function isDisabled(cdp: Cdp, backendNodeId: number): Promise<boolean> {
  try {
    const objectId = await objectOf(cdp, backendNodeId);
    if (!objectId) return false;
    const reply = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        if (this.disabled === true) return true;
        const marked = this.closest && this.closest('[aria-disabled=true],fieldset[disabled]');
        return Boolean(marked);
      }`,
    })) as { result?: { value?: unknown } };
    return reply?.result?.value === true;
  } catch {
    return false;
  }
}

/**
 * Arm a check that the page feels the next press on this element's document.
 *
 * A press can be dispatched perfectly and still reach nothing — a view hidden
 * behind another tab takes no input at all, and CDP reports success either
 * way. Installed before the press (awaited, so the listener is in place before
 * any input can arrive) and collected after it; the returned function resolves
 * true once a mousedown was seen, false at the deadline. The pending promise is
 * held by CDP, not on `window`, so the page has nothing to find.
 */
export async function armPressCheck(cdp: Cdp, backendNodeId: number, timeoutMs: number): Promise<() => Promise<boolean>> {
  const unknown = async (): Promise<boolean> => true;
  try {
    const objectId = await objectOf(cdp, backendNodeId);
    if (!objectId) return unknown;
    const reply = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: false,
      functionDeclaration: `function () {
        const doc = this.ownerDocument;
        return { seen: new Promise((resolve) => {
          const seen = () => { clearTimeout(timer); resolve(true); };
          const timer = setTimeout(() => { doc.removeEventListener('mousedown', seen, true); resolve(false); }, ${Math.max(0, timeoutMs)});
          doc.addEventListener('mousedown', seen, { capture: true, once: true });
        }) };
      }`,
    })) as { result?: { objectId?: string } };
    const holder = reply?.result?.objectId;
    if (!holder) return unknown;
    return async () => {
      try {
        const promise = (await cdp.send('Runtime.callFunctionOn', {
          objectId: holder,
          returnByValue: false,
          functionDeclaration: 'function () { return this.seen; }',
        })) as { result?: { objectId?: string } };
        const promiseObjectId = promise?.result?.objectId;
        if (!promiseObjectId) return true;
        const settled = (await cdp.send('Runtime.awaitPromise', { promiseObjectId, returnByValue: true })) as {
          result?: { value?: unknown };
        };
        return settled?.result?.value !== false;
      } catch {
        // The document went away under the press — a navigation, which it felt.
        return true;
      }
    };
  } catch {
    return unknown;
  }
}

/** What a field shows: its value, or the text of an editable element. Null if it is neither. */
export async function valueOf(cdp: Cdp, backendNodeId: number): Promise<string | null> {
  try {
    const objectId = await objectOf(cdp, backendNodeId);
    if (!objectId) return null;
    const reply = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        if ('value' in this && typeof this.value === 'string') return this.value;
        if (this.isContentEditable) return (this.innerText || '').replace(/\n$/, '');
        return null;
      }`,
    })) as { result?: { value?: unknown } };
    const value = reply?.result?.value;
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Select everything in a field, so what is typed next replaces it. */
export async function selectContents(cdp: Cdp, backendNodeId: number): Promise<void> {
  const objectId = await objectOf(cdp, backendNodeId);
  if (!objectId) return;
  await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () {
      if (typeof this.select === 'function' && 'value' in this) { this.select(); return; }
      const range = this.ownerDocument.createRange();
      range.selectNodeContents(this);
      const selection = this.ownerDocument.getSelection();
      if (selection) { selection.removeAllRanges(); selection.addRange(range); }
    }`,
  });
}

/** Type text one character at a time, each a real key press carrying its character. */
export async function typeCharacters(cdp: Cdp, text: string): Promise<void> {
  for (const character of text) {
    const typed = character === '\n' ? '\r' : character;
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: character, text: typed, unmodifiedText: typed });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: character });
  }
}

/** Move to the point, then press and release, the way a hand would. */
export async function pressAt(cdp: Cdp, point: Point, clickCount = 1): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount });
}

/** CDP's modifier bitmask. */
export const MOD_ALT = 1;
export const MOD_CONTROL = 2;
export const MOD_META = 4;
export const MOD_SHIFT = 8;

const MODIFIERS: Record<string, number> = {
  alt: MOD_ALT,
  option: MOD_ALT,
  control: MOD_CONTROL,
  ctrl: MOD_CONTROL,
  meta: MOD_META,
  cmd: MOD_META,
  command: MOD_META,
  shift: MOD_SHIFT,
};

/**
 * Editing commands a modified letter is expected to perform.
 *
 * Chromium routes these below the key event, so dispatching the modified letter
 * alone selects nothing — which is precisely the failure that sent the agent
 * looking for another browser. Control and Meta map to the same command so a
 * task written on one platform still works on the other.
 */
const EDITING: Record<string, string> = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' };

/**
 * Named keys, with the virtual-key code Chromium wants and, where a key types
 * something, the text it types.
 *
 * Enter carries `\r` for the same reason a letter carries itself: Blink submits
 * a form from the keypress an Enter with text produces, not from the bare key
 * down. Sent without it, Enter in a search box did nothing at all — measured on
 * Wikipedia and in a plain `<form>`.
 */
const NAMED: Record<string, { key: string; code: string; vk: number; text?: string }> = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
};

/** How Chromium wants one key spelled, or null if we cannot spell it. */
function spellKey(name: string): { key: string; code: string; vk: number; text?: string } | null {
  const named = NAMED[name.toLowerCase()];
  if (named) return named;
  if ([...name].length !== 1) return null;
  const upper = name.toUpperCase();
  const isLetter = upper >= 'A' && upper <= 'Z';
  const isDigit = name >= '0' && name <= '9';
  if (isLetter || isDigit) {
    return { key: name, code: isLetter ? `Key${upper}` : `Digit${name}`, vk: upper.charCodeAt(0), text: name };
  }
  // Punctuation and letters beyond ASCII: no virtual key to name, but the text
  // is what the page wants from them.
  return { key: name, code: '', vk: 0, text: name };
}

/** The two CDP key events a key name stands for, or an error saying why not. */
export function keyEvents(spec: string): { down: Record<string, unknown>; up: Record<string, unknown> } | { error: string } {
  const parts = spec.split('+').filter(Boolean);
  const name = parts.pop() ?? '';
  let modifiers = 0;
  for (const mod of parts) {
    const bit = MODIFIERS[mod.toLowerCase()];
    if (bit === undefined) return { error: `unknown modifier ${mod} in ${spec}` };
    modifiers |= bit;
  }
  const spelled = spellKey(name);
  if (!spelled) return { error: `unknown key ${spec} — name it the way a keyboard event does, e.g. Enter, Escape, Meta+a` };

  // Modified letters do not reach the editing pipeline on their own; the
  // command does, and is what a real Cmd+A produces. Chromium takes both.
  const command = modifiers & (MOD_CONTROL | MOD_META) ? EDITING[name.toLowerCase()] : undefined;
  // A key with Control or Meta held types nothing, whatever it would alone.
  const plain = modifiers & (MOD_CONTROL | MOD_META | MOD_ALT) ? undefined : spelled.text;
  const text = plain && modifiers & MOD_SHIFT ? plain.toUpperCase() : plain;
  const base = {
    key: spelled.key,
    code: spelled.code,
    windowsVirtualKeyCode: spelled.vk,
    nativeVirtualKeyCode: spelled.vk,
    modifiers,
  };
  return {
    down: {
      type: text ? 'keyDown' : 'rawKeyDown',
      ...base,
      ...(text ? { text, unmodifiedText: text } : {}),
      ...(command ? { commands: [command] } : {}),
    },
    up: { type: 'keyUp', ...base },
  };
}

/** Press one key, named the way `keyEvents` reads it. */
export async function pressKey(cdp: Cdp, spec: string): Promise<string | null> {
  const events = keyEvents(spec);
  if ('error' in events) return events.error;
  await cdp.send('Input.dispatchKeyEvent', events.down);
  await cdp.send('Input.dispatchKeyEvent', events.up);
  return null;
}
