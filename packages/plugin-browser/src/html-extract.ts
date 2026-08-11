/**
 * Minimal HTML → text / markdown extractors used by `web_fetch`. Not a
 * full DOM parser: regex-based, intentionally limited. For stricter
 * extraction use the markdown converter with a selector or upgrade to
 * browser_session.
 */

import { assertDefined } from '@moxxy/sdk';

export interface ExtractOptions {
  selector?: string;
}

/**
 * Hard ceiling on the HTML fed to the regex extractors. web_fetch caps the raw
 * body at up to 20MB (maxBytes), but the lazy `[\s\S]*?` passes here run
 * SYNCHRONOUSLY on the runner event loop — a multi-MB adversarial page with
 * many unmatched open tags could block it. Truncating to a generous 4MB bounds
 * that worst case while still covering virtually every real article.
 */
const MAX_EXTRACT_INPUT = 4 * 1024 * 1024;

/** Bound the regex-extractor input so a hostile, oversized page can't stall the
 *  event loop. Cuts at a tag boundary when one is near the limit to avoid
 *  splitting an entity/tag mid-token. */
function capInput(html: string): string {
  if (html.length <= MAX_EXTRACT_INPUT) return html;
  const slice = html.slice(0, MAX_EXTRACT_INPUT);
  const lastLt = slice.lastIndexOf('<');
  return lastLt > MAX_EXTRACT_INPUT - 1024 ? slice.slice(0, lastLt) : slice;
}

/**
 * Minimal HTML → plain text. Strips <script>, <style>, comments, and tags.
 * Collapses whitespace. Decodes the common HTML entities.
 */
export function htmlToPlainText(html: string, opts: ExtractOptions = {}): string {
  let body = removeNonContent(sliceBySelector(capInput(html), opts.selector));
  body = body.replace(/<br\b[^>]*>/gi, '\n');
  body = body.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');
  body = stripMarkupTags(body);
  body = decodeEntities(body);
  return collapseWhitespace(body);
}

/**
 * Minimal HTML → markdown. Maps headings, lists, links, code blocks, and
 * paragraphs. Falls through to plain-text rules for unknown structure.
 */
export function htmlToMarkdown(html: string, opts: ExtractOptions = {}): string {
  let body = removeNonContent(sliceBySelector(capInput(html), opts.selector));

  // headings
  body = body.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl: string, inner: string) =>
    `\n\n${'#'.repeat(Number(lvl))} ${stripTags(inner).trim()}\n\n`,
  );

  // links: keep text + url. Accept double-quoted, single-quoted, and unquoted
  // hrefs — real-world HTML uses all three, and matching only "double" silently
  // dropped the URL (the link text survived via the later tag-strip).
  body = body.replace(
    /<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
    (_, dq: string | undefined, sq: string | undefined, uq: string | undefined, inner: string) =>
      `[${stripTags(inner).trim()}](${dq ?? sq ?? uq})`,
  );

  // code
  body = body.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner: string) =>
    `\n\n\`\`\`\n${stripTags(inner)}\n\`\`\`\n\n`,
  );
  body = body.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner: string) =>
    `\`${stripTags(inner)}\``,
  );

  // lists
  body = body.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) =>
    `\n- ${stripTags(inner).trim()}`,
  );
  body = body.replace(/<\/?(ul|ol)\b[^>]*>/gi, '\n');

  // line breaks
  body = body.replace(/<br\b[^>]*>/gi, '\n');
  body = body.replace(/<\/?p\b[^>]*>/gi, '\n\n');
  body = stripMarkupTags(body);
  body = decodeEntities(body);
  return collapseWhitespace(body);
}

function sliceBySelector(html: string, selector?: string): string {
  if (!selector) return html;
  const slice = extractFirstTagBlock(html, selector);
  return slice ?? html;
}

function collapseWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripTags(s: string): string {
  return stripMarkupTags(s);
}

/** Remove comments plus script/style elements in one left-to-right pass.
 *  Regex replacement can join two fragments into a fresh opening tag; this
 *  scanner only recognizes tags that existed in the original input. */
function removeNonContent(html: string): string {
  const lower = html.toLowerCase();
  const out: string[] = [];
  let copiedUntil = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const start = lower.indexOf('<', cursor);
    if (start === -1) break;

    let end = -1;
    if (lower.startsWith('<!--', start)) {
      const close = lower.indexOf('-->', start + 4);
      end = close === -1 ? html.length : close + 3;
    } else if (isOpeningTag(lower, start, 'script')) {
      end = endOfElement(lower, start, 'script');
    } else if (isOpeningTag(lower, start, 'style')) {
      end = endOfElement(lower, start, 'style');
    }

    if (end === -1) {
      cursor = start + 1;
      continue;
    }
    out.push(html.slice(copiedUntil, start));
    copiedUntil = end;
    cursor = end;
  }

  out.push(html.slice(copiedUntil));
  return out.join('');
}

function isOpeningTag(lower: string, start: number, tag: string): boolean {
  if (!lower.startsWith(`<${tag}`, start)) return false;
  const boundary = lower[start + tag.length + 1];
  return boundary === undefined || boundary === '>' || boundary === '/' || /\s/.test(boundary);
}

function endOfElement(lower: string, start: number, tag: string): number {
  const openEnd = lower.indexOf('>', start + tag.length + 1);
  if (openEnd === -1) return lower.length;
  const closeToken = `</${tag}`;
  let close = lower.indexOf(closeToken, openEnd + 1);
  while (close !== -1) {
    const boundary = lower[close + closeToken.length];
    if (boundary === undefined || boundary === '>' || /\s/.test(boundary)) {
      const closeEnd = lower.indexOf('>', close + closeToken.length);
      return closeEnd === -1 ? lower.length : closeEnd + 1;
    }
    close = lower.indexOf(closeToken, close + closeToken.length);
  }
  return lower.length;
}

/** Strip markup without repeated replacements that can synthesize new tags. */
function stripMarkupTags(input: string): string {
  const out: string[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    if (input[cursor] !== '<') {
      out.push(input[cursor] ?? '');
      cursor += 1;
      continue;
    }
    const end = input.indexOf('>', cursor + 1);
    if (end === -1) {
      out.push(input.slice(cursor));
      break;
    }
    cursor = end + 1;
  }
  return out.join('');
}

function decodeEntities(s: string): string {
  const map: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
  };
  return s.replace(/&[a-zA-Z]+;|&#\d+;/g, (m) => {
    if (m in map) {
      const decoded = map[m as keyof typeof map];
      assertDefined(decoded, `entity "${m}" is a known map key ("m in map" checked above)`);
      return decoded;
    }
    const numMatch = /^&#(\d+);$/.exec(m);
    if (numMatch) return String.fromCharCode(Number(numMatch[1]));
    return m;
  });
}

/**
 * Pull the first <tag>...</tag> block (or self-closing tag with id="x") whose
 * tag name OR id matches `selector`. Very limited — supports `tagName` and
 * `#id` only. For richer querying upgrade to browser_session.
 */
function extractFirstTagBlock(html: string, selector: string): string | null {
  if (selector.startsWith('#')) {
    const id = selector.slice(1);
    const re = new RegExp(
      `<([a-z][a-z0-9-]*)\\b[^>]*\\bid=["']${escapeReSelector(id)}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
      'i',
    );
    const match = re.exec(html);
    return match?.[2] ?? null;
  }
  const tag = selector.toLowerCase();
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = re.exec(html);
  return match?.[1] ?? null;
}

function escapeReSelector(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
