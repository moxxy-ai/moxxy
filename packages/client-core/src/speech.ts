/**
 * Markdown → speakable prose. This is the platform-neutral half of read-aloud:
 * the browser's Web Speech API (and most TTS engines) read markdown punctuation
 * literally — "hash hash Heading", "star star bold", URL soup. {@link
 * toSpeakableText} strips the syntax down to the prose a human would actually
 * say, dropping code fences to a short "(code block)" aside.
 *
 * The actual synthesis (voices, `speechSynthesis`, audio playback) is a platform
 * capability ({@link TextToSpeech} in `./platform`), implemented per platform.
 */

/**
 * Reduce markdown to clean, speakable prose. Removes structural syntax
 * (headings, bullets, blockquotes, tables, rules), keeps the text inside
 * links/emphasis, and collapses fenced code blocks to a single spoken
 * "(code block)" rather than reading source line-by-line.
 */
export function toSpeakableText(markdown: string): string {
  const stripped = markdown
    // Fenced code → a short spoken aside, not line-by-line source.
    .replace(/```[\s\S]*?```/g, ' (code block) ')
    .replace(/~~~[\s\S]*?~~~/g, ' (code block) ')
    // Images / links → their human-readable text (the URL is dropped, never
    // spoken). Bare URLs in prose are stripped too so the engine doesn't read
    // out "h-t-t-p-s-colon-slash-slash…".
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    // Inline code + emphasis → bare content. The `_italic_` rule requires
    // both underscores so snake_case identifiers survive.
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[^a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g, '$1$2')
    .replace(/~~([^~]+)~~/g, '$1')
    // Line-leading structure: headings, blockquotes, list bullets.
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    // Horizontal rules + table pipes.
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
    .replace(/\|/g, ' ');

  // Split on blank lines into paragraphs; soft-wrap newlines collapse to
  // spaces. Each paragraph gets terminal punctuation so the engine pauses
  // between them — without doubling a mark the prose already ends on.
  return stripped
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => (/[.!?:]$/.test(p) ? p : `${p}.`))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
