import { z } from '@moxxy/sdk';

const MAX_TEXT = 280;

const browserBoundsSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  })
  .strict();

const rawBrowserNodeSchema = z
  .object({
    ref: z.string().regex(/^b[1-9][0-9]{0,5}$/),
    role: z.string().min(1).max(64),
    name: z.string().max(MAX_TEXT),
    text: z.string().max(MAX_TEXT).optional(),
    value: z.string().max(MAX_TEXT).optional(),
    inputType: z.string().max(64).optional(),
    checked: z.boolean().optional(),
    disabled: z.boolean().optional(),
    focused: z.boolean().optional(),
    selector: z.string().min(1).max(16_384),
    bounds: browserBoundsSchema,
  })
  .strict();

const rawBrowserObservationSchema = z
  .object({
    revision: z.string().min(1).max(128),
    title: z.string().max(1_024),
    url: z.string().max(16_384),
    visibleText: z.string().max(20_000),
    viewport: z
      .object({
        width: z.number().finite().positive().max(16_384),
        height: z.number().finite().positive().max(16_384),
        deviceScaleFactor: z.number().finite().positive().max(8),
      })
      .strict(),
    nodes: z.array(rawBrowserNodeSchema).max(300),
  })
  .strict();

export interface BrowserObservationNode {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly text?: string;
  readonly value?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly focused?: boolean;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface BrowserObservation {
  readonly revision: string;
  readonly title: string;
  readonly url: string;
  readonly visibleText: string;
  readonly viewport: {
    readonly width: number;
    readonly height: number;
    readonly deviceScaleFactor: number;
  };
  readonly nodes: ReadonlyArray<BrowserObservationNode>;
  readonly screenshot?: { readonly mediaType: 'image/png'; readonly base64: string };
}

export interface BrowserObservationTarget {
  readonly selector: string;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface ParsedBrowserObservation {
  readonly observation: BrowserObservation;
  readonly targets: ReadonlyMap<string, BrowserObservationTarget>;
}

export function formatBrowserObservationForModel(observation: BrowserObservation): string {
  return JSON.stringify({
    revision: observation.revision,
    title: observation.title,
    url: observation.url,
    visibleText: observation.visibleText,
    viewport: observation.viewport,
    nodes: observation.nodes,
  });
}

export function parseBrowserObservation(value: unknown): ParsedBrowserObservation {
  const parsed = rawBrowserObservationSchema.parse(value);
  const targets = new Map<string, BrowserObservationTarget>();
  const nodes = parsed.nodes.map((node): BrowserObservationNode => {
    targets.set(node.ref, { selector: node.selector, bounds: node.bounds });
    const value = node.inputType?.toLowerCase() === 'password' ? undefined : node.value;
    return {
      ref: node.ref,
      role: node.role,
      name: node.name,
      ...(node.text ? { text: node.text } : {}),
      ...(value ? { value } : {}),
      ...(node.checked !== undefined ? { checked: node.checked } : {}),
      ...(node.disabled !== undefined ? { disabled: node.disabled } : {}),
      ...(node.focused !== undefined ? { focused: node.focused } : {}),
      bounds: node.bounds,
    };
  });
  return {
    observation: {
      revision: parsed.revision,
      title: parsed.title,
      url: parsed.url,
      visibleText: parsed.visibleText,
      viewport: parsed.viewport,
      nodes,
    },
    targets,
  };
}

export function buildBrowserObservationScript(maxNodes: number, maxTextChars = 6_000): string {
  const boundedMaxNodes = Math.min(300, Math.max(1, Math.round(maxNodes)));
  const boundedMaxTextChars = Math.min(20_000, Math.max(0, Math.round(maxTextChars)));
  return `(() => {
    const MAX_NODES = ${boundedMaxNodes};
    const MAX_TEXT_CHARS = ${boundedMaxTextChars};
    const STATE_KEY = '__moxxyBrowserObservationState__';
    const root = document.documentElement;
    const current = window[STATE_KEY];
    if (!current || current.document !== document) {
      const random = new Uint32Array(2);
      if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        globalThis.crypto.getRandomValues(random);
      } else {
        random[0] = Math.floor(Math.random() * 0xffffffff);
        random[1] = Date.now() >>> 0;
      }
      const state = {
        document,
        documentId: random[0].toString(36) + random[1].toString(36),
        generation: 1,
        revision: null,
      };
      const observer = new MutationObserver(() => {
        state.generation += 1;
        state.revision = null;
      });
      if (root) observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
      });
      window[STATE_KEY] = state;
    }
    const state = window[STATE_KEY];
    const compact = (value, limit = ${MAX_TEXT}) =>
      String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const roleOf = (element) => {
      const explicit = compact(element.getAttribute('role'), 64);
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'summary') return 'button';
      if (tag === 'img') return 'img';
      if (tag === 'input') {
        const type = compact(element.getAttribute('type') || 'text', 32).toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
        return 'textbox';
      }
      return element.isContentEditable ? 'textbox' : 'generic';
    };
    const selectorOf = (element) => {
      if (element.id && document.querySelectorAll('#' + CSS.escape(element.id)).length === 1) {
        return '#' + CSS.escape(element.id);
      }
      for (const attr of ['data-testid', 'data-test', 'name']) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        const candidate = element.tagName.toLowerCase() + '[' + attr + '="' +
          CSS.escape(value) + '"]';
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
      const path = [];
      let node = element;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
        let segment = node.tagName.toLowerCase();
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
          if (same.length > 1) segment += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        path.unshift(segment);
        node = parent;
      }
      return path.join(' > ');
    };
    const nameOf = (element) => {
      const aria = element.getAttribute('aria-label');
      if (aria) return compact(aria);
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\\s+/)
          .map((id) => document.getElementById(id)?.textContent || '')
          .join(' ');
        if (compact(text)) return compact(text);
      }
      if ('labels' in element && element.labels) {
        const text = Array.from(element.labels)
          .map((label) => label.innerText || label.textContent || '')
          .join(' ');
        if (compact(text)) return compact(text);
      }
      return compact(
        element.getAttribute('alt') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.innerText ||
        element.textContent ||
        element.getAttribute('value')
      );
    };
    const candidates = Array.from(document.querySelectorAll(
      'a[href],button,input,textarea,select,summary,[role],[contenteditable="true"],[tabindex]'
    ));
    const visible = candidates.filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== 'none' && style.visibility !== 'hidden' &&
        style.opacity !== '0' && element.getAttribute('aria-hidden') !== 'true';
    }).slice(0, MAX_NODES);
    const nodes = visible.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const inputType = element instanceof HTMLInputElement ? element.type : undefined;
      const rawValue = 'value' in element ? element.value : undefined;
      return {
        ref: 'b' + (index + 1),
        role: roleOf(element),
        name: nameOf(element),
        text: compact(element.innerText || element.textContent),
        value: inputType === 'password' ? undefined : compact(rawValue),
        inputType,
        checked: 'checked' in element ? Boolean(element.checked) : undefined,
        disabled: 'disabled' in element ? Boolean(element.disabled) : undefined,
        focused: document.activeElement === element,
        selector: selectorOf(element),
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    });
    const revision = 'rev-' + state.documentId + '-' + state.generation + '-' + nodes.length;
    state.revision = revision;
    return {
      revision,
      title: compact(document.title, 1024),
      url: String(location.href).slice(0, 16384),
      visibleText: compact(document.body?.innerText || '', MAX_TEXT_CHARS),
      viewport: {
        width: Math.max(1, window.innerWidth),
        height: Math.max(1, window.innerHeight),
        deviceScaleFactor: Math.max(0.1, window.devicePixelRatio || 1),
      },
      nodes,
    };
  })()`;
}

export function buildBrowserRefPointScript(
  target: BrowserObservationTarget,
  revision: string,
): string {
  return `(() => {
    const state = window.__moxxyBrowserObservationState__;
    if (!state || state.revision !== ${JSON.stringify(revision)}) {
      return { stale: true };
    }
    const element = document.querySelector(${JSON.stringify(target.selector)});
    if (!element) return { stale: true };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' ||
        style.visibility === 'hidden' || style.opacity === '0') {
      return { stale: true };
    }
    return { stale: false, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`;
}

export function buildBrowserSelectorPointScript(selector: string): string {
  return `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (rect.width <= 0 || rect.height <= 0 || style.display === 'none' ||
        style.visibility === 'hidden' || style.opacity === '0') {
      return null;
    }
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`;
}

export function buildBrowserRefValidationScript(revision: string): string {
  return `(() => {
    const state = window.__moxxyBrowserObservationState__;
    return Boolean(state && state.revision === ${JSON.stringify(revision)});
  })()`;
}
