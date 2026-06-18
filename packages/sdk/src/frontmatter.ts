/**
 * Canonical minimal Markdown + YAML-subset frontmatter parser.
 *
 * Pure string work, zero dependencies (node builtins only). This is the single
 * home for the mini-parser that was previously copy-pasted into
 * `packages/core/src/skills/parse.ts` and `packages/plugin-memory/src/parse.ts`.
 * The plugin-memory copy had diverged (its inline-array scalar split on bare
 * commas and dropped null/float typing); this module keeps the more-correct
 * `core` behavior — depth/quote-aware inline arrays via {@link splitArray},
 * `null`/`~`, and float parsing — so both packages share one source of truth.
 *
 * Supports a deliberately tiny YAML subset:
 *   - `key: value` scalars (string/number/float/bool/null, with quote stripping)
 *   - inline arrays `key: [a, b, "c d"]` (depth- and quote-aware)
 *   - block-list arrays (`key:` followed by `  - item` lines)
 * Comments (`#`) and blank lines are skipped. Anything not recognized is left
 * out of the frontmatter object.
 */

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_FENCE = '---';
const OPENING_FENCE_LF = FRONTMATTER_FENCE + '\n';
const OPENING_FENCE_CRLF = FRONTMATTER_FENCE + '\r\n';

/**
 * Split a `---`-fenced Markdown document into its parsed frontmatter and body.
 *
 * If the content does not open with a `---` fence (LF or CRLF), or the closing
 * `---` is missing, returns `{ frontmatter: {}, body: <original content> }`
 * unchanged. The body excludes the closing fence and its trailing newline.
 */
export function parseFrontmatterFile(content: string): ParsedFrontmatter {
  if (!content.startsWith(OPENING_FENCE_LF) && !content.startsWith(OPENING_FENCE_CRLF)) {
    return { frontmatter: {}, body: content };
  }
  const fenceLen = content.startsWith(OPENING_FENCE_CRLF) ? OPENING_FENCE_CRLF.length : OPENING_FENCE_LF.length;
  const rest = content.slice(fenceLen);
  const endMatch = /\r?\n---(?:\r?\n|$)/.exec(rest);
  if (!endMatch) return { frontmatter: {}, body: content };
  return {
    frontmatter: parseFrontmatter(rest.slice(0, endMatch.index)),
    body: rest.slice(endMatch.index + endMatch[0].length),
  };
}

/** Parse the inner text of a frontmatter block into a key/value object. */
export function parseFrontmatter(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? '').trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const raw = trimmed.slice(colon + 1).trim();

    if (raw === '' && i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1] ?? '')) {
      const items: unknown[] = [];
      while (i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1] ?? '')) {
        i += 1;
        items.push(parseScalar((lines[i] ?? '').replace(/^\s*-\s*/, '').trim()));
      }
      result[key] = items;
      continue;
    }

    result[key] = parseScalar(raw);
  }
  return result;
}

function parseScalar(v: string): unknown {
  if (!v) return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitArray(inner).map((s) => parseScalar(s.trim()));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return stripQuotes(v);
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Split a comma-separated inline-array body, honoring nesting and quotes. */
function splitArray(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inStr: '"' | "'" | null = null;
  for (const c of s) {
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}

/**
 * Render a frontmatter object back into a `---`-fenced YAML-subset block.
 * Inverse-ish of {@link parseFrontmatter}; `undefined`/`null` values are
 * skipped. (Used by callers that round-trip Markdown documents, e.g. the
 * memory store.)
 */
export function renderFrontmatter(frontmatter: Record<string, unknown>): string {
  const out: string[] = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (v === undefined || v === null) continue;
    out.push(`${k}: ${renderValue(v)}`);
  }
  out.push('---');
  return out.join('\n');
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    return needsQuoting(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
  }
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    return `[${v.map((x) => renderValue(x)).join(', ')}]`;
  }
  return JSON.stringify(v);
}

function needsQuoting(s: string): boolean {
  return s.includes(':') || s.includes('#') || s.includes('"') || s.startsWith(' ') || s.endsWith(' ');
}
