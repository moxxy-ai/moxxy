/**
 * Convert the model's Markdown output into Telegram-flavoured HTML so
 * the bot renders **bold**, `code`, ```code blocks```, [links](…),
 * lists, and headings instead of dumping raw `**` and `#` characters
 * into the chat.
 *
 * Why HTML and not MarkdownV2: MarkdownV2 requires escaping
 * `_ * [ ] ( ) ~ \` > # + - = | { } . !` literally everywhere they
 * AREN'T part of formatting — one stray `.` in a sentence breaks the
 * whole message. HTML only needs three escapes (`< > &`) in text
 * segments, and Telegram's HTML mode supports every tag we need
 * (`<b>`, `<i>`, `<s>`, `<tg-spoiler>`, `<code>`, `<pre>`, `<a>`,
 * `<blockquote>` / `<blockquote expandable>`).
 *
 * Telegram has no native headings or list elements, so:
 *   - `#`, `##`, `###` headings → bold text on their own line.
 *   - `- item` / `* item` bullets → `• item` (bullet glyph).
 *   - `1. item` numbered → kept as-is (the digit is fine).
 *
 * Beyond CommonMark we also map a few extensions so the model can lean
 * on Telegram's richer surface without learning a new syntax:
 *   - `~~strike~~`           → `<s>` strikethrough.
 *   - `||spoiler||`          → `<tg-spoiler>` (tap-to-reveal hidden text).
 *   - `> [!note] Heading`    → a titled, emoji-tagged callout blockquote.
 *   - `> [!details]- Title`  → a COLLAPSED (expandable) callout — the
 *                              load-bearing "hide the details" box. The
 *                              trailing `-` forces collapsed, `+` forces
 *                              open; some types (details/example/faq)
 *                              collapse by default.
 *   - a plain `>` quote that runs long auto-collapses into an
 *     `<blockquote expandable>` so a wall of quoted text stays tidy.
 *
 * Code blocks are emitted as `<pre><code class="language-xxx">…</code></pre>`,
 * inline code as `<code>…</code>`. Everything inside code is escaped
 * but no formatting markers run.
 */
export function markdownToTelegramHtml(md: string): string {
  // Pull fenced code blocks out FIRST so their contents skip inline
  // markdown processing. Replace each with a placeholder, render the
  // rest, then splice them back.
  const fences: string[] = [];
  let working = md.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (_, lang, body) => {
    const html =
      `<pre><code${lang ? ` class="language-${escapeHtml(String(lang))}"` : ''}>` +
      escapeHtml(String(body)).replace(/\n+$/, '') +
      '</code></pre>';
    fences.push(html);
    return ` FENCE${fences.length - 1} `;
  });

  // Pull inline code spans out next, same reason.
  const inlines: string[] = [];
  working = working.replace(/`([^`\n]+)`/g, (_, body) => {
    inlines.push(`<code>${escapeHtml(String(body))}</code>`);
    return ` INLINE${inlines.length - 1} `;
  });

  // Now safe to escape HTML special chars in everything else.
  working = escapeHtml(working);

  // Headings → bold. Telegram has no heading element; bold + line
  // break is the conventional substitution.
  working = working.replace(/^(#{1,6})\s+(.*)$/gm, (_, _hashes, text) => `<b>${String(text)}</b>`);

  // Block quotes (>) — Telegram supports <blockquote> and, since Bot API
  // 7.0, <blockquote expandable> (a collapsible "show more" box). Wrap
  // consecutive quote lines into one block and let `renderBlockquote`
  // decide collapsed-vs-open from an optional `[!callout]` marker or the
  // quote's length.
  working = working.replace(/((?:^&gt;[^\n]*\n?)+)/gm, (m: string) => {
    const stripped = m
      .replace(/&gt; ?/g, '')
      .replace(/\n$/, '');
    return `${renderBlockquote(stripped)}\n`;
  });

  // Bullet list items → bullet glyph. Match leading whitespace +
  // -/*/+ + space. Don't touch indented sub-bullets' indent.
  working = working.replace(/^(\s*)([-*+])\s+/gm, (_m, indent: string) => `${indent}• `);

  // Bold **text** — process before italic so `**text**` doesn't get
  // captured by the single-asterisk italic rule first.
  working = working.replace(/\*\*([^*\n]+)\*\*/g, (_, body) => `<b>${String(body)}</b>`);
  // Bold __text__
  working = working.replace(/__([^_\n]+)__/g, (_, body) => `<b>${String(body)}</b>`);

  // Strikethrough ~~text~~ → <s>. (GitHub flavour; a single `~` stays
  // literal so it never eats a stray tilde in prose.)
  working = working.replace(/~~([^~\n]+)~~/g, (_, body) => `<s>${String(body)}</s>`);

  // Spoiler ||text|| → <tg-spoiler> (Telegram's tap-to-reveal). Content
  // can't span a `|` so a single bar / table pipe is left untouched.
  working = working.replace(/\|\|([^|\n]+)\|\|/g, (_, body) => `<tg-spoiler>${String(body)}</tg-spoiler>`);

  // Italic *text* and _text_. Use lookarounds to avoid matching
  // mid-word underscores (`some_var_name`) and stray bullets.
  working = working.replace(/(^|[\s(,.!?:;])\*([^*\n]+)\*(?=$|[\s),.!?:;])/g, (_m, pre, body) => `${pre}<i>${String(body)}</i>`);
  working = working.replace(/(^|[\s(,.!?:;])_([^_\n]+)_(?=$|[\s),.!?:;])/g, (_m, pre, body) => `${pre}<i>${String(body)}</i>`);

  // Links [text](url) — strip url tracking params if needed later;
  // for now just emit. URLs may contain `&` which is already escaped
  // to `&amp;` by escapeHtml above; that's valid inside href.
  working = working.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
    // The url got HTML-escaped earlier; restore enough that the link
    // actually points where it should. Only `&amp;` → `&` is needed
    // for the typical case; `<>` shouldn't appear in a URL but unescape
    // them defensively.
    const cleanUrl = String(url).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    // The anchor target comes from arbitrary model output (and, via prompt
    // injection, untrusted data the model echoes). Don't rely on Telegram's
    // server-side parser as the sole sanitizer: emit a clickable <a> only for
    // an explicit allow-list of schemes (and scheme-relative URLs). Anything
    // else — `javascript:`, `data:`, `file:`, `tg://` deep links — is left as
    // the original `[text](url)` text (already HTML-escaped upstream) so it
    // can't navigate the client.
    if (!isAllowedUrl(cleanUrl)) return String(m);
    return `<a href="${escapeAttr(cleanUrl)}">${String(text)}</a>`;
  });

  // Splice fenced + inline code back in.
  working = working.replace(/ INLINE(\d+) /g, (_, i) => inlines[Number(i)] ?? '');
  working = working.replace(/ FENCE(\d+) /g, (_, i) => fences[Number(i)] ?? '');

  return working;
}

/**
 * GitHub / Obsidian-style callout types we recognise as the first line of a
 * blockquote (`[!note]`, `[!warning]`, …). Each maps to a leading emoji, a
 * default title, and whether the box collapses by default. `fold: true` types
 * (details / example / faq) start COLLAPSED — they're meant for "extra info you
 * can open if you want", which is exactly the detail-hiding the channel is for.
 */
const CALLOUTS: Record<string, { emoji: string; label: string; fold: boolean }> = {
  note: { emoji: 'ℹ️', label: 'Note', fold: false },
  info: { emoji: 'ℹ️', label: 'Info', fold: false },
  tip: { emoji: '💡', label: 'Tip', fold: false },
  hint: { emoji: '💡', label: 'Hint', fold: false },
  important: { emoji: '❗', label: 'Important', fold: false },
  warning: { emoji: '⚠️', label: 'Warning', fold: false },
  caution: { emoji: '⚠️', label: 'Caution', fold: false },
  danger: { emoji: '🚨', label: 'Danger', fold: false },
  error: { emoji: '🚨', label: 'Error', fold: false },
  success: { emoji: '✅', label: 'Success', fold: false },
  done: { emoji: '✅', label: 'Done', fold: false },
  question: { emoji: '❓', label: 'Question', fold: false },
  faq: { emoji: '❓', label: 'FAQ', fold: true },
  quote: { emoji: '💬', label: 'Quote', fold: false },
  details: { emoji: '📋', label: 'Details', fold: true },
  example: { emoji: '📋', label: 'Example', fold: true },
};

/** A quote this big collapses into an expandable box even without a marker. */
const LONG_QUOTE_LINES = 4;
const LONG_QUOTE_CHARS = 280;

/**
 * Render the (already HTML-escaped) inner text of a `>` blockquote into a
 * Telegram `<blockquote>` / `<blockquote expandable>`.
 *
 * Three shapes, in order of precedence:
 *   1. Recognised callout — first line is `[!type]`, optionally `+`/`-` then a
 *      title. Emits a bold `emoji Title` header line, then the body; collapses
 *      when the marker is `-` or the type folds by default.
 *   2. Long plain quote — no marker but ≥4 lines / ≥280 chars → expandable so a
 *      wall of quoted text doesn't dominate the chat.
 *   3. Short plain quote — a normal, always-open `<blockquote>`.
 *
 * The close tag is always `</blockquote>` (the `expandable` lives only on the
 * open tag — Telegram rejects it on the close).
 */
function renderBlockquote(stripped: string): string {
  const callout = parseCallout(stripped);
  let inner: string;
  let expandable: boolean;
  if (callout) {
    inner = callout.body ? `${callout.header}\n${callout.body}` : callout.header;
    expandable = callout.expandable;
  } else {
    inner = stripped;
    expandable = isLongQuote(stripped);
  }
  const open = expandable ? '<blockquote expandable>' : '<blockquote>';
  return `${open}${inner}</blockquote>`;
}

interface ParsedCallout {
  readonly header: string;
  readonly body: string;
  readonly expandable: boolean;
}

/**
 * Parse a `[!type]`/`[!type]-`/`[!type]+ Title` first line. Returns null when
 * the first line isn't a RECOGNISED callout, so an unknown `[!whatever]` is left
 * as ordinary quote text rather than guessing a rendering for it.
 */
function parseCallout(stripped: string): ParsedCallout | null {
  const nl = stripped.indexOf('\n');
  const firstLine = nl === -1 ? stripped : stripped.slice(0, nl);
  const rest = nl === -1 ? '' : stripped.slice(nl + 1);
  const m = /^\[!(\w+)\]([+-]?)[ \t]*(.*)$/.exec(firstLine.trim());
  if (!m) return null;
  const meta = CALLOUTS[(m[1] ?? '').toLowerCase()];
  if (!meta) return null;
  const fold = m[2];
  const title = (m[3] ?? '').trim() || meta.label;
  return {
    header: `<b>${meta.emoji} ${title}</b>`,
    body: rest,
    expandable: fold === '-' ? true : fold === '+' ? false : meta.fold,
  };
}

/** True when a plain quote is long enough to be worth collapsing. */
function isLongQuote(stripped: string): boolean {
  if (stripped.length >= LONG_QUOTE_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < stripped.length; i++) if (stripped[i] === '\n') lines++;
  return lines >= LONG_QUOTE_LINES;
}

/** Schemes we let through as a clickable `<a href>`. */
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/**
 * True when `url` is safe to emit as an anchor target. A URL with an explicit
 * `scheme:` prefix must use an allow-listed scheme; URLs without a scheme
 * (relative paths, `#anchors`, `//host`, bare `host.com/...`) carry no
 * navigation scheme and are allowed. This rejects `javascript:`, `data:`,
 * `file:`, `tg://`, and any other unexpected scheme.
 */
function isAllowedUrl(url: string): boolean {
  // Control chars (incl. an embedded NUL/SOH) have no legitimate place in a URL
  // and are a classic way to slip a dangerous scheme past a naive check — reject
  // outright rather than try to normalize them away.
  for (let i = 0; i < url.length; i++) {
    if (url.charCodeAt(i) <= 0x1f || url.charCodeAt(i) === 0x7f) return false;
  }
  // Strip leading whitespace/hyphen an attacker might use to shift the apparent
  // scheme boundary, then detect the scheme.
  const trimmed = url.replace(/^[\s-]+/, '');
  // RFC3986 scheme: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":".
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!m) return true; // no explicit scheme — relative/anchor/host-only link
  return ALLOWED_URL_SCHEMES.has((m[1] ?? '').toLowerCase());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}
