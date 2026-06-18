/**
 * A tiny, dependency-free YAML codec scoped to the workflow artifact shape.
 *
 * Why hand-rolled instead of the `yaml` package: this model must bundle clean
 * under React Native (Hermes), and `yaml` reaches for `node:process` in its log
 * path, which Metro would have to shim. The workflow document is a bounded,
 * well-known shape (a map with scalars, string lists, nested string-keyed maps,
 * and `|`-style block scalars for prompts), so a focused emitter/parser is both
 * safe and small. Authoritative validation still happens server-side via
 * `workflows.validateDraft`; this codec only needs to round-trip the builder's
 * own output and re-hydrate canonical YAML that the host returned.
 */

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** Serialize a plain JSON value to a workflow-flavoured YAML document. */
export function toYaml(value: unknown): string {
  const lines: string[] = [];
  emitMap(value as Record<string, unknown>, 0, lines);
  return lines.join('\n') + '\n';
}

function emitMap(obj: Record<string, unknown>, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  for (const [key, raw] of Object.entries(obj)) {
    if (raw === undefined) continue;
    const k = emitKey(key);
    if (raw === null) {
      out.push(`${pad}${k}: null`);
    } else if (Array.isArray(raw)) {
      if (raw.length === 0) {
        out.push(`${pad}${k}: []`);
      } else {
        out.push(`${pad}${k}:`);
        emitArray(raw, indent + 1, out);
      }
    } else if (isPlainObject(raw)) {
      if (Object.keys(raw).length === 0) {
        out.push(`${pad}${k}: {}`);
      } else {
        out.push(`${pad}${k}:`);
        emitMap(raw as Record<string, unknown>, indent + 1, out);
      }
    } else {
      emitScalarField(pad, k, raw, indent, out);
    }
  }
}

function emitArray(arr: ReadonlyArray<unknown>, indent: number, out: string[]): void {
  const pad = '  '.repeat(indent);
  for (const item of arr) {
    if (item === null || item === undefined) {
      out.push(`${pad}- null`);
    } else if (Array.isArray(item)) {
      out.push(`${pad}-`);
      emitArray(item, indent + 1, out);
    } else if (isPlainObject(item)) {
      // Inline the first key on the `-` line, then continue the map indented.
      const entries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
      if (entries.length === 0) {
        out.push(`${pad}- {}`);
        continue;
      }
      const first = out.length;
      emitMap(item as Record<string, unknown>, indent + 1, out);
      // Splice the dash onto the first emitted child line.
      out[first] = `${pad}- ${out[first]!.slice((indent + 1) * 2)}`;
    } else {
      out.push(`${pad}- ${emitScalar(item)}`);
    }
  }
}

function emitScalarField(
  pad: string,
  key: string,
  raw: unknown,
  indent: number,
  out: string[],
): void {
  if (typeof raw === 'string' && raw.includes('\n')) {
    // Block scalar (`|`) preserves newlines verbatim — used for prompts.
    out.push(`${pad}${key}: |`);
    const childPad = '  '.repeat(indent + 1);
    for (const line of raw.replace(/\n$/, '').split('\n')) {
      out.push(line.length > 0 ? `${childPad}${line}` : '');
    }
  } else {
    out.push(`${pad}${key}: ${emitScalar(raw)}`);
  }
}

function emitKey(key: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(key) ? key : emitScalar(key);
}

function emitScalar(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (value === null) return 'null';
  const s = String(value);
  if (s === '') return '""';
  if (needsQuote(s)) return JSON.stringify(s);
  return s;
}

function needsQuote(s: string): boolean {
  if (/^\s|\s$/.test(s)) return true;
  if (/[:#[\]{}&*!|>'"%@`,]/.test(s)) return true;
  if (/^[-?]/.test(s)) return true;
  // Reserved bare words / number-looking strings must be quoted to keep type.
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^-?\d/.test(s) && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return true;
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a workflow-flavoured YAML document into a plain JSON value. Supports
 * the subset this codec emits plus what the host's canonical emitter produces:
 * nested maps, `- ` sequences (scalar, inline-map, and nested), `|` and `|-`
 * block scalars, flow `[]`/`{}` empties, and quoted scalars. Throws on the
 * obvious malformations; the server schema is the real arbiter.
 */
export function fromYaml(text: string): unknown {
  const lines = stripComments(text)
    .replace(/\r\n/g, '\n')
    .split('\n');
  const ctx = { lines, i: 0 };
  return parseBlock(ctx, 0);
}

interface ParseCtx {
  readonly lines: string[];
  i: number;
}

function stripComments(text: string): string {
  // Strip full-line `#` comments and trailing ` # ...` on structural lines, but
  // NEVER inside a `|`/`>` block scalar body — prompt text is emitted as a block
  // scalar and routinely contains `#` (markdown headings, inline `text # note`),
  // which must survive the round-trip verbatim. We track block-scalar regions by
  // indentation: a `key: |` (or `>`/`|-`/`>-`) line opens a block whose body is
  // every following line indented deeper than the key (blank lines included);
  // the block ends at the first non-blank line indented at/under the key.
  const lines = text.split('\n');
  let blockIndent = -1; // -1 = not in a block scalar; else the key's indent
  return lines
    .map((line) => {
      if (blockIndent >= 0) {
        // Inside a block scalar: pass the line through untouched unless it has
        // de-indented back to/under the opening key (which ends the block).
        if (isBlank(line) || indentOf(line) > blockIndent) return line;
        blockIndent = -1; // fell out of the block — fall through to strip below
      }
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) return '';
      const hash = findBareHash(line);
      const stripped = hash >= 0 ? line.slice(0, hash).replace(/\s+$/, '') : line;
      // Does this line OPEN a block scalar? `key: |`, `key: >`, with chomp/keep.
      if (opensBlockScalar(stripped)) blockIndent = indentOf(stripped);
      return stripped;
    })
    .join('\n');
}

/** True when a (comment-stripped) line is `…key…: |`/`>` with an optional chomp. */
function opensBlockScalar(line: string): boolean {
  return /:\s+[|>][+-]?\s*$/.test(line);
}

function findBareHash(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let j = 0; j < line.length; j++) {
    const c = line[j];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble && j > 0 && /\s/.test(line[j - 1]!)) return j;
  }
  return -1;
}

function indentOf(line: string): number {
  const m = /^( *)/.exec(line);
  return m ? m[1]!.length : 0;
}

function isBlank(line: string): boolean {
  return line.trim().length === 0;
}

function parseBlock(ctx: ParseCtx, minIndent: number): unknown {
  // Skip blanks, then dispatch on whether the first content line is a sequence.
  while (ctx.i < ctx.lines.length && isBlank(ctx.lines[ctx.i]!)) ctx.i++;
  if (ctx.i >= ctx.lines.length) return null;
  const line = ctx.lines[ctx.i]!;
  const indent = indentOf(line);
  if (indent < minIndent) return null;
  return line.slice(indent).startsWith('- ') || line.slice(indent).trim() === '-'
    ? parseSequence(ctx, indent)
    : parseMap(ctx, indent);
}

function parseMap(ctx: ParseCtx, indent: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  while (ctx.i < ctx.lines.length) {
    const line = ctx.lines[ctx.i]!;
    if (isBlank(line)) {
      ctx.i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind < indent) break;
    if (ind > indent) throw new Error(`yaml: unexpected indent at line ${ctx.i + 1}`);
    const body = line.slice(indent);
    if (body.startsWith('- ')) break; // a sequence at this level ends the map
    const colon = splitKey(body);
    if (!colon) throw new Error(`yaml: expected "key: value" at line ${ctx.i + 1}`);
    const { key, rest } = colon;
    ctx.i++;
    if (rest === '' ) {
      obj[key] = parseChild(ctx, indent);
    } else if (rest === '|' || rest === '|-' || rest === '>' || rest === '>-') {
      obj[key] = parseBlockScalar(ctx, indent, rest.startsWith('>'), rest.endsWith('-'));
    } else {
      obj[key] = parseScalar(rest);
    }
  }
  return obj;
}

/** A value on its own line(s) below `parentIndent` — map, sequence, or null. */
function parseChild(ctx: ParseCtx, parentIndent: number): unknown {
  // Peek the next non-blank line; if it's deeper, recurse, else the value is null.
  let j = ctx.i;
  while (j < ctx.lines.length && isBlank(ctx.lines[j]!)) j++;
  if (j >= ctx.lines.length) return null;
  const ind = indentOf(ctx.lines[j]!);
  if (ind <= parentIndent) return null;
  ctx.i = j;
  return parseBlock(ctx, ind);
}

function parseSequence(ctx: ParseCtx, indent: number): unknown[] {
  const arr: unknown[] = [];
  while (ctx.i < ctx.lines.length) {
    const line = ctx.lines[ctx.i]!;
    if (isBlank(line)) {
      ctx.i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind < indent) break;
    const body = line.slice(indent);
    if (!body.startsWith('-')) break;
    const after = body.slice(1).replace(/^ /, '');
    if (after === '') {
      ctx.i++;
      arr.push(parseChild(ctx, indent));
    } else if (looksLikeKey(after)) {
      // Inline map: `- key: value` — re-indent the rest as a map child.
      const itemIndent = indent + 2;
      ctx.lines[ctx.i] = ' '.repeat(itemIndent) + after;
      arr.push(parseMap(ctx, itemIndent));
    } else {
      ctx.i++;
      arr.push(parseScalar(after));
    }
  }
  return arr;
}

function parseBlockScalar(ctx: ParseCtx, parentIndent: number, fold: boolean, strip: boolean): string {
  // First collect the raw body lines (blanks kept as null markers), then strip
  // the block's indentation by the MINIMUM indent across non-blank lines — not
  // the first line's indent. Using the first line's indent under-sliced any
  // later line indented LESS than it (cutting into real content); the minimum
  // is the YAML rule and preserves the relative indentation of deeper lines.
  const raw: Array<string | null> = [];
  let blockIndent = Infinity;
  while (ctx.i < ctx.lines.length) {
    const line = ctx.lines[ctx.i]!;
    if (isBlank(line)) {
      raw.push(null);
      ctx.i++;
      continue;
    }
    const ind = indentOf(line);
    if (ind <= parentIndent) break;
    if (ind < blockIndent) blockIndent = ind;
    raw.push(line);
    ctx.i++;
  }
  if (!Number.isFinite(blockIndent)) blockIndent = 0;
  const lines = raw.map((l) => (l === null ? '' : l.slice(blockIndent)));
  // Trim trailing blank lines collected past the block.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  // NOTE: folded (`>`) joins all lines with a single space (blank lines included
  // as empties). The canonical emitter only ever produces literal `|`/`|-`, so
  // fold's blank-line-as-paragraph-break nuance is not modelled here — only the
  // literal path (the one the emitter round-trips) is treated as exact.
  const joined = fold ? lines.join(' ') : lines.join('\n');
  return strip ? joined : joined + '\n';
}

function splitKey(body: string): { key: string; rest: string } | null {
  // Find the first `: ` (or trailing `:`) outside quotes.
  let inSingle = false;
  let inDouble = false;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === ':' && !inSingle && !inDouble) {
      const next = body[j + 1];
      if (next === undefined || next === ' ') {
        const key = unquote(body.slice(0, j).trim());
        const rest = body.slice(j + 1).trim();
        return { key, rest };
      }
    }
  }
  return null;
}

function looksLikeKey(s: string): boolean {
  return splitKey(s) !== null;
}

function parseScalar(token: string): unknown {
  const t = token.trim();
  if (t === '[]') return [];
  if (t === '{}') return {};
  if (t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+$/.test(t)) return Number.parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return Number.parseFloat(t);
  // Flow sequence of scalars: ["a", "b"] / [a, b]
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner === '') return [];
    return splitFlow(inner).map((x) => parseScalar(x));
  }
  return unquote(t);
}

function splitFlow(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let cur = '';
  for (const c of inner) {
    if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && !inDouble) inSingle = !inSingle;
    if (!inSingle && !inDouble) {
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) {
        parts.push(cur.trim());
        cur = '';
        continue;
      }
    }
    cur += c;
  }
  if (cur.trim() !== '') parts.push(cur.trim());
  return parts;
}

function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}
