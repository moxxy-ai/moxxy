import { markdownToTelegramHtml } from '../format.js';
import type { RenderedFrame } from '../render.js';

/**
 * Compose one Telegram message string from the renderer's structured
 * snapshot. The activity block is pre-formatted HTML (the renderer
 * emits `<blockquote>`, `<code>`, `<b>`, `<i>` directly so it can
 * style tool calls without going through the markdown converter). The
 * assistant body is plain Markdown from the model — convert it through
 * `markdownToTelegramHtml` so `**bold**`, `` `code` ``, ```code blocks```,
 * `[links](…)`, and list bullets render natively in Telegram.
 *
 * The error line is also pre-formatted HTML (small, controlled).
 */
export function composeFrame(snap: RenderedFrame): string {
  const parts: string[] = [];
  if (snap.activityHtml) parts.push(snap.activityHtml);
  if (snap.body) parts.push(markdownToTelegramHtml(snap.body));
  // File-diff blocks are already Telegram HTML (summary line + a
  // <pre><code class="language-diff"> fence), so they skip the markdown
  // converter. Append after the body; the frame pump's `splitForTelegram`
  // handles the 4000-char cap, sending overflow as follow-up messages.
  if (snap.diffHtml) parts.push(snap.diffHtml);
  if (snap.errorHtml) parts.push(snap.errorHtml);
  return parts.join('\n\n');
}

/** Strip every HTML tag for plain-text fallback when Telegram rejects
 *  our parse_mode=HTML payload (rare — usually a malformed entity in
 *  user-supplied content). Keeps text content intact.
 *
 *  Entities are decoded in a single pass with `&amp;` LAST: decoding it first
 *  would double-decode (`&amp;lt;` → `&lt;` → `<`). Numeric entities
 *  (`&#39;`, `&#x27;`) are handled too, since escaped user/code content can
 *  carry them and they'd otherwise leak literally into the fallback message. */
export function stripHtml(html: string): string {
  return html
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/** Decode a numeric entity's code point, leaving an out-of-range/invalid value
 *  untouched (return empty) rather than throwing. */
function safeFromCodePoint(cp: number): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return '';
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
