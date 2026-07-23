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

const KEYCAP_EMOJI_RE = /[#*0-9]\uFE0F?\u20E3/gu;
const NON_VERBAL_SYMBOL_RE = /\p{So}/gu;
const EMOJI_MODIFIER_RE = /\p{Emoji_Modifier}/gu;
const EMOJI_JOINER_RE = /(?:\uFE0E|\uFE0F|\u200D|[\u{E0020}-\u{E007F}])/gu;

function stripNonVerbalArtifacts(text: string): string {
  return text
    // Remove complete keycap sequences first so their ASCII base is not left
    // behind after the surrounding emoji marks disappear.
    .replace(KEYCAP_EMOJI_RE, ' ')
    // Emoji, flags and dingbats are visual tone, not words Piper should
    // pronounce. Joiners/modifiers must be removed as well because they are
    // separate Unicode code points in compound emoji.
    .replace(NON_VERBAL_SYMBOL_RE, ' ')
    .replace(EMOJI_MODIFIER_RE, '')
    .replace(EMOJI_JOINER_RE, '')
    // Paired Markdown emphasis has already been unwrapped below. Any stars
    // that remain are incomplete/decorative markup and must stay silent.
    .replace(/\*/g, ' ');
}

/**
 * Reduce markdown to clean, speakable prose. Removes structural syntax
 * (headings, bullets, blockquotes, tables, rules), keeps the text inside
 * links/emphasis, and collapses fenced code blocks to a single spoken
 * "(code block)" rather than reading source line-by-line.
 */
function normalizeSpeakableMarkdown(markdown: string, fencedCodeReplacement: string): string {
  const stripped = markdown
    // Fenced code is either summarized for explicit read-aloud or omitted in
    // a live conversation where announcing it interrupts the spoken answer.
    .replace(/```[\s\S]*?```/g, fencedCodeReplacement)
    .replace(/~~~[\s\S]*?~~~/g, fencedCodeReplacement)
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
  return stripNonVerbalArtifacts(stripped)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => (/[.!?:]$/.test(p) ? p : `${p}.`))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function toSpeakableText(markdown: string): string {
  return normalizeSpeakableMarkdown(markdown, ' (code block) ');
}

/**
 * Voice-call prose omits fenced source entirely. The transcript still shows
 * the original answer, while Piper speaks only the surrounding explanation.
 */
export function toVoiceConversationText(markdown: string): string {
  const withoutCode = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/```[\s\S]*$/g, ' ')
    .replace(/~~~[\s\S]*$/g, ' ')
    .replace(/^(?: {4}|\t).*(?:\n|$)/gm, ' ');
  return normalizeSpeakableMarkdown(withoutCode, ' ');
}
