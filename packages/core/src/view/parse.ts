import type {
  AttrSpec,
  ViewDoc,
  ViewNode,
  ViewParseError,
  ViewParseResult,
  ViewTagSpec,
} from '@moxxy/sdk';

/**
 * Hand-rolled, zero-dependency parser for the JSX/XML-like view-spec, in the
 * style of the TUI markdown block parser. Pipeline:
 *   tokenize → tree-build → allow-list validate → action extract → expand.
 *
 * Security posture: the allow-list is the wall. Unknown tags/attributes are
 * hard errors (never silently dropped); `on*` handler attributes and unsafe URL
 * schemes are rejected; raw HTML never survives because only known tags build
 * nodes. The browser renderer applies the same allow-list as defense in depth.
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

interface RawAttr {
  readonly name: string;
  readonly value: string | true;
}

type Token =
  | { readonly t: 'open'; readonly tag: string; readonly attrs: ReadonlyArray<RawAttr>; readonly selfClose: boolean; readonly pos: number }
  | { readonly t: 'close'; readonly tag: string; readonly pos: number }
  | { readonly t: 'text'; readonly value: string; readonly pos: number };

class ParseFail extends Error {
  constructor(readonly info: ViewParseError) {
    super(info.message);
  }
}

function lineColAt(src: string, pos: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos && i < src.length; i++) {
    if (src[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

function fail(src: string, pos: number, message: string): never {
  throw new ParseFail({ message, ...lineColAt(src, pos) });
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      if (src.slice(i).trim()) tokens.push({ t: 'text', value: src.slice(i), pos: i });
      break;
    }
    if (lt > i && src.slice(i, lt).trim()) {
      tokens.push({ t: 'text', value: src.slice(i, lt), pos: i });
    }

    // Comment: <!-- ... -->
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }

    // Closing tag
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt);
      if (gt === -1) fail(src, lt, 'unterminated closing tag');
      tokens.push({ t: 'close', tag: src.slice(lt + 2, gt).trim(), pos: lt });
      i = gt + 1;
      continue;
    }

    // Opening tag — read to the matching top-level '>' (quotes/braces aware)
    const { end, inner } = readRawTag(src, lt);
    let body = inner.trim();
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1).trim();
    const sp = body.search(/\s/);
    const tag = (sp === -1 ? body : body.slice(0, sp)).trim();
    if (!tag || !/^[A-Za-z][A-Za-z0-9-]*$/.test(tag)) fail(src, lt, `invalid tag name "${tag}"`);
    const attrs = sp === -1 ? [] : parseAttrs(body.slice(sp));
    tokens.push({ t: 'open', tag, attrs, selfClose, pos: lt });
    i = end + 1;
  }
  return tokens;
}

function readRawTag(src: string, lt: number): { end: number; inner: string } {
  let i = lt + 1;
  const n = src.length;
  let quote: string | null = null;
  let brace = 0;
  while (i < n) {
    const c = src[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '{') {
      brace++;
    } else if (c === '}') {
      if (brace > 0) brace--;
    } else if (c === '>' && brace === 0) {
      return { end: i, inner: src.slice(lt + 1, i) };
    }
    i++;
  }
  fail(src, lt, 'unterminated tag');
}

function parseAttrs(s: string): RawAttr[] {
  const attrs: RawAttr[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i]!)) i++;
    if (i >= n) break;
    let name = '';
    while (i < n && /[A-Za-z0-9\-_:]/.test(s[i]!)) {
      name += s[i]!;
      i++;
    }
    if (!name) {
      i++; // skip a stray separator char
      continue;
    }
    let j = i;
    while (j < n && /\s/.test(s[j]!)) j++;
    if (s[j] === '=') {
      i = j + 1;
      while (i < n && /\s/.test(s[i]!)) i++;
      const q = s[i];
      let value = '';
      if (q === '"' || q === "'") {
        i++;
        while (i < n && s[i] !== q) {
          value += s[i]!;
          i++;
        }
        i++; // closing quote
      } else if (q === '{') {
        const start = i;
        let depth = 0;
        while (i < n) {
          if (s[i] === '{') depth++;
          else if (s[i] === '}') {
            depth--;
            if (depth === 0) {
              i++;
              break;
            }
          }
          i++;
        }
        value = s.slice(start, i); // keep braces; raw
      } else {
        while (i < n && !/\s/.test(s[i]!)) {
          value += s[i]!;
          i++;
        }
      }
      attrs.push({ name, value });
    } else {
      attrs.push({ name, value: true });
      i = j;
    }
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Tree builder (mutable builder nodes → validated ViewNode)
// ---------------------------------------------------------------------------

interface BNode {
  readonly tag: string;
  readonly attrs: ReadonlyArray<RawAttr>;
  readonly children: BChild[];
  readonly pos: number;
}
type BChild = BNode | { readonly text: string };

function isBNode(c: BChild): c is BNode {
  return 'tag' in c;
}

function build(tokens: Token[], src: string): BNode {
  const top: BChild[] = [];
  const stack: BNode[] = [];
  for (const tok of tokens) {
    const target = stack.length ? stack[stack.length - 1]!.children : top;
    if (tok.t === 'text') {
      target.push({ text: decodeEntities(tok.value) });
    } else if (tok.t === 'open') {
      const node: BNode = { tag: tok.tag, attrs: tok.attrs, children: [], pos: tok.pos };
      target.push(node);
      if (!tok.selfClose) stack.push(node);
    } else {
      const open = stack.pop();
      if (!open) fail(src, tok.pos, `unexpected closing tag </${tok.tag}>`);
      if (open.tag !== tok.tag) {
        fail(src, tok.pos, `mismatched closing tag: expected </${open.tag}>, got </${tok.tag}>`);
      }
    }
  }
  if (stack.length) fail(src, stack[stack.length - 1]!.pos, `unclosed tag <${stack[stack.length - 1]!.tag}>`);
  const elements = top.filter(isBNode);
  if (elements.length !== 1) {
    throw new ParseFail({ message: `expected exactly one root element, found ${elements.length}` });
  }
  return elements[0]!;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// Validation + coercion (BNode → ViewNode), collecting all errors
// ---------------------------------------------------------------------------

function isSafeUrl(url: string, attr: string): boolean {
  const u = url.trim().toLowerCase();
  if (u.startsWith('javascript:') || u.startsWith('vbscript:')) return false;
  if (u.startsWith('data:')) return attr === 'src' && u.startsWith('data:image/');
  if (/^[a-z][a-z0-9+.-]*:/.test(u)) return /^(https?:|mailto:)/.test(u);
  return true; // relative / fragment
}

function coerceValue(
  tag: string,
  name: string,
  value: string | true,
  spec: AttrSpec,
  errors: ViewParseError[],
): string | number | boolean {
  if (spec.type === 'boolean') {
    if (value === true) return true;
    return value !== 'false';
  }
  if (value === true) {
    errors.push({ message: `<${tag}> attribute "${name}" expects a value` });
    return '';
  }
  if (spec.type === 'number') {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      errors.push({ message: `<${tag}> attribute "${name}" must be a number` });
      return 0;
    }
    if (spec.min !== undefined && num < spec.min) {
      errors.push({ message: `<${tag}> attribute "${name}" must be ≥ ${spec.min}` });
    }
    if (spec.max !== undefined && num > spec.max) {
      errors.push({ message: `<${tag}> attribute "${name}" must be ≤ ${spec.max}` });
    }
    return num;
  }
  if (spec.type === 'enum') {
    if (!spec.values?.includes(value)) {
      errors.push({ message: `<${tag}> attribute "${name}" must be one of: ${spec.values?.join(', ')}` });
    }
    return value;
  }
  // string
  if ((name === 'href' || name === 'src') && !isSafeUrl(value, name)) {
    errors.push({ message: `<${tag}> attribute "${name}" has a disallowed URL scheme` });
  }
  return value;
}

function coerceAttrs(b: BNode, spec: ViewTagSpec | undefined, errors: ViewParseError[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const seen = new Set<string>();
  for (const a of b.attrs) {
    if (/^on/i.test(a.name)) {
      errors.push({ message: `<${b.tag}> forbidden attribute "${a.name}"` });
      continue;
    }
    const aspec = spec?.attrs[a.name];
    if (!aspec) {
      errors.push({ message: `<${b.tag}> unknown attribute "${a.name}"` });
      continue;
    }
    seen.add(a.name);
    out[a.name] = coerceValue(b.tag, a.name, a.value, aspec, errors);
  }
  if (spec) {
    for (const [name, aspec] of Object.entries(spec.attrs)) {
      if (aspec.required && !seen.has(name)) {
        errors.push({ message: `<${b.tag}> missing required attribute "${name}"` });
      }
    }
  }
  return out;
}

function convert(b: BNode, specByTag: Map<string, ViewTagSpec>, errors: ViewParseError[]): ViewNode {
  const spec = specByTag.get(b.tag);
  if (!spec) errors.push({ message: `unknown tag <${b.tag}>` });
  const props = coerceAttrs(b, spec, errors);
  const children: ViewNode[] = [];
  for (const c of b.children) {
    if (!isBNode(c)) {
      const v = c.text.replace(/\s+/g, ' ').trim();
      if (!v) continue; // drop whitespace-only text
      if (spec && spec.allowedChildren !== 'any') {
        errors.push({ message: `<${b.tag}> may not contain text` });
      }
      children.push({ kind: 'text', value: v });
    } else {
      if (spec) {
        if (spec.allowedChildren === 'none') {
          errors.push({ message: `<${b.tag}> may not have children` });
        } else if (Array.isArray(spec.allowedChildren) && !spec.allowedChildren.includes(c.tag)) {
          errors.push({ message: `<${b.tag}> may not contain <${c.tag}>` });
        }
      }
      children.push(convert(c, specByTag, errors));
    }
  }
  return finalizeNode({ kind: 'element', tag: b.tag, props, children }, spec);
}

// ---------------------------------------------------------------------------
// Action + navigation extraction
// ---------------------------------------------------------------------------

function collectFieldNames(node: ViewNode): string[] {
  const names: string[] = [];
  const walk = (n: ViewNode) => {
    if (n.kind !== 'element') return;
    if ((n.tag === 'input' || n.tag === 'select' || n.tag === 'checkbox') && typeof n.props.name === 'string') {
      names.push(n.props.name);
    }
    n.children.forEach(walk);
  };
  walk(node);
  return names;
}

function finalizeNode(node: ViewNode, spec: ViewTagSpec | undefined): ViewNode {
  if (node.kind !== 'element') return node;
  let out = node;
  // Client-side navigation: any element carrying a `to` (link/button).
  if (typeof node.props.to === 'string' && node.props.to) {
    out = { ...out, nav: node.props.to };
  }
  if (spec?.interactive) {
    if (node.tag === 'form') {
      const name = typeof node.props.action === 'string' ? node.props.action : '';
      out = { ...out, action: { name, fields: collectFieldNames(node) } };
    } else if (node.tag === 'button' && typeof node.props.action === 'string' && node.props.action) {
      const fields =
        typeof node.props.fields === 'string' && node.props.fields
          ? node.props.fields.split(',').map((f) => f.trim()).filter(Boolean)
          : [];
      out = { ...out, action: { name: node.props.action, fields } };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rich-component expansion (results → primitive card stack)
// ---------------------------------------------------------------------------

function el(
  tag: string,
  props: Record<string, string | number | boolean>,
  children: ViewNode[],
  action?: { name: string; fields: string[] },
  nav?: string,
): ViewNode {
  return { kind: 'element', tag, props, children, ...(action ? { action } : {}), ...(nav ? { nav } : {}) };
}
function txt(value: string): ViewNode {
  return { kind: 'text', value };
}

/**
 * `results` → a stack of selectable cards (one per `result`). Each card shows
 * title/subtitle/badge and an "Open" affordance: `to` navigates client-side to a
 * named view; else `action` (or `open:<id>` when only `id` is given) drives a turn.
 */
function expandResults(node: Extract<ViewNode, { kind: 'element' }>): ViewNode {
  const cards = node.children
    .filter((c): c is Extract<ViewNode, { kind: 'element' }> => c.kind === 'element' && c.tag === 'result')
    .map((r) => {
      const p = r.props;
      const id = p.id != null ? String(p.id) : '';
      const title = String(p.title ?? '');
      const subtitle = p.subtitle != null ? String(p.subtitle) : '';
      const badge = p.badge != null ? String(p.badge) : '';
      const to = typeof p.to === 'string' && p.to ? p.to : undefined;
      const action = typeof p.action === 'string' && p.action ? p.action : id ? `open:${id}` : undefined;

      const left = el('stack', { gap: 'none' }, [
        el('text', { weight: 'bold' }, [txt(title)]),
        ...(subtitle ? [el('text', { tone: 'muted' }, [txt(subtitle)])] : []),
      ]);
      const right: ViewNode[] = [];
      if (badge) right.push(el('badge', {}, [txt(badge)]));
      if (to) right.push(el('button', { to, label: 'Open', variant: 'secondary' }, [], undefined, to));
      else if (action) right.push(el('button', { action, label: 'Open', variant: 'primary' }, [], { name: action, fields: [] }));

      return el('card', {}, [
        el('row', { justify: 'between', align: 'center' }, [left, el('row', { gap: 'md', align: 'center' }, right)]),
      ]);
    });
  return el('stack', { gap: 'md' }, cards);
}

function expand(node: ViewNode): ViewNode {
  if (node.kind !== 'element') return node;
  if (node.tag === 'results') return expandResults(node);
  return { ...node, children: node.children.map(expand) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function parseView(source: string, allowList: ReadonlyArray<ViewTagSpec>): ViewParseResult {
  try {
    const tokens = tokenize(source);
    const rootB = build(tokens, source);
    const specByTag = new Map(allowList.map((s) => [s.tag, s]));
    const errors: ViewParseError[] = [];
    let root = convert(rootB, specByTag, errors);
    if (errors.length) return { ok: false, errors };
    root = expand(root);
    const title = root.kind === 'element' && root.tag === 'view' && typeof root.props.title === 'string' ? root.props.title : undefined;
    return { ok: true, doc: { root, ...(title ? { title } : {}) } };
  } catch (e) {
    if (e instanceof ParseFail) return { ok: false, errors: [e.info] };
    return { ok: false, errors: [{ message: e instanceof Error ? e.message : String(e) }] };
  }
}

/** Validate an already-built (expanded) AST against the allow-list. */
export function validateDoc(doc: ViewDoc, allowList: ReadonlyArray<ViewTagSpec>): ViewParseError[] {
  const specByTag = new Map(allowList.map((s) => [s.tag, s]));
  const errors: ViewParseError[] = [];
  const walk = (node: ViewNode) => {
    if (node.kind !== 'element') return;
    const spec = specByTag.get(node.tag);
    if (!spec) {
      errors.push({ message: `unknown tag <${node.tag}>` });
      return;
    }
    for (const key of Object.keys(node.props)) {
      if (!spec.attrs[key]) errors.push({ message: `<${node.tag}> unknown attribute "${key}"` });
    }
    for (const [name, aspec] of Object.entries(spec.attrs)) {
      if (aspec.required && !(name in node.props)) {
        errors.push({ message: `<${node.tag}> missing required attribute "${name}"` });
      }
    }
    for (const c of node.children) {
      if (c.kind === 'element') {
        if (spec.allowedChildren === 'none') {
          errors.push({ message: `<${node.tag}> may not have children` });
        } else if (Array.isArray(spec.allowedChildren) && !spec.allowedChildren.includes(c.tag)) {
          errors.push({ message: `<${node.tag}> may not contain <${c.tag}>` });
        }
      } else if (spec.allowedChildren !== 'any' && c.value.trim()) {
        errors.push({ message: `<${node.tag}> may not contain text` });
      }
      walk(c);
    }
  };
  walk(doc.root);
  return errors;
}

/** Count element + text nodes (for tool result `nodeCount`). */
export function countNodes(node: ViewNode): number {
  if (node.kind === 'text') return 1;
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}
