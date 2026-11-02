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

import { detectSpeechLanguage, speakMarkdownTables, type SpeechLanguage } from '@moxxy/chat-model';

import { isBareDomain, isWebAddress, siteName, spokenLink } from './spoken-links.js';

const KEYCAP_EMOJI_RE = /[#*0-9]\uFE0F?\u20E3/gu;
/** The degree sign is `So` too, but it is how a temperature is said. */
const NON_VERBAL_SYMBOL_RE = /(?!°)\p{So}/gu;
const EMOJI_MODIFIER_RE = /\p{Emoji_Modifier}/gu;
const EMOJI_JOINER_RE = /(?:\uFE0E|\uFE0F|\u200D|[\u{E0020}-\u{E007F}])/gu;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>)]*)?/giu;
const FILE_EXTENSION_RE = /\.(?:js|jsx|ts|tsx|mjs|cjs|json|jsonl|ya?ml|toml|md|mdx|txt|log|pdf|docx|xlsx|pptx|csv|tsv|py|rs|go|java|kt|c|h|cpp|hpp|cs|php|sh|bash|zsh|sql|html|css|scss|xml|ini|env|conf|png|jpe?g|svg|webp|wav|mp3|ogg)(?::\d+(?::\d+)?)?$/iu;
const ABSOLUTE_FILE_PATH_RE = /(?<![\p{L}\p{N}_])(?:~[\\/]|[A-Za-z]:[\\/]|\/)[^<>\r\n`"'()[\],;!?]*?\.[A-Za-z]{2,8}(?::\d+(?::\d+)?)?(?=$|[\s),;.!?])/gu;
const FILE_PATH_RE = /(?<![\p{L}\p{N}_])(?:~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)?(?:[\p{L}\p{N}_.@+-]+[\\/])+[\p{L}\p{N}_.@+-]+(?:\.[A-Za-z0-9]{2,8})?(?::\d+(?::\d+)?)?(?![\p{L}\p{N}_])/gu;
/** Fractions, slashed dates, speeds, acronym pairs and either-or words: prose that only looks like a path. */
/** Prose that a domain pattern would swallow: "m.in." is "among others". */
const DOTTED_PROSE_RE = /^m\.in$/iu;
const SLASHED_PROSE_RE = /^(?:\d+(?:[.,]\d+)?(?:\/\d+(?:[.,]\d+)?)+|(?:k?m|mi|[kKMG][bB])\/(?:h|s|min)|\p{Lu}{1,5}\/\p{Lu}{1,5}|and\/or|i\/lub)[.,;:!?]?$/u;

function stripNonVerbalArtifacts(text: string): string {
  return text
    // Remove complete keycap sequences first so their ASCII base is not left
    // behind after the surrounding emoji marks disappear.
    .replace(KEYCAP_EMOJI_RE, ' ')
    // Emoji, flags and dingbats are visual tone, not words the voice should
    // pronounce. Joiners/modifiers must be removed as well because they are
    // separate Unicode code points in compound emoji.
    .replace(NON_VERBAL_SYMBOL_RE, ' ')
    .replace(EMOJI_MODIFIER_RE, '')
    .replace(EMOJI_JOINER_RE, '')
    // Paired Markdown emphasis has already been unwrapped below. Any stars
    // that remain are incomplete/decorative markup and must stay silent.
    .replace(/\*/g, ' ');
}

function isUrlOrFileReference(value: string): boolean {
  const candidate = value.trim().replace(/[),.;:!?]+$/u, '');
  return /^(?:https?:\/\/|www\.)/iu.test(candidate)
    || /^(?:~[\\/]|\.{1,2}[\\/]|[A-Za-z]:[\\/]|\/)/u.test(candidate)
    || /(?:[\\/][^\\/]+)+\.[A-Za-z0-9]{2,8}(?::\d+(?::\d+)?)?$/u.test(candidate)
    || FILE_EXTENSION_RE.test(candidate)
    || (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>)]*)?$/iu.test(candidate)
      && !FILE_EXTENSION_RE.test(candidate));
}

const TRAILING_PUNCTUATION_RE = /[),.;:!?]+$/u;
const WEB_ADDRESS_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]`]+/giu;

/**
 * A reference as it is said: a link as a link to its site, a bare domain as
 * the site's name, a file path not at all, and anything else as written.
 */
function speakReference(value: string, language: SpeechLanguage): string {
  const trimmed = value.trim();
  const reference = trimmed.replace(TRAILING_PUNCTUATION_RE, '');
  const after = trimmed.slice(reference.length);
  if (isWebAddress(reference)) return `${spokenLink(reference, language)}${after}`;
  if (isBareDomain(reference) && !FILE_EXTENSION_RE.test(reference)) return `${siteName(reference) ?? ' '}${after}`;
  return isUrlOrFileReference(reference) ? ' ' : value;
}

/** The language of the prose around the addresses, which decides how a link is said. */
function proseLanguage(markdown: string): SpeechLanguage {
  return detectSpeechLanguage(markdown.replace(/\([^)]*\)|<[^>]*>/gu, ' ').replace(WEB_ADDRESS_RE, ' '));
}

/**
 * Reduce markdown to clean, speakable prose. Removes structural syntax
 * (headings, bullets, blockquotes, tables, rules), keeps the text inside
 * links/emphasis, and collapses fenced code blocks to a single spoken
 * "(code block)" rather than reading source line-by-line.
 */
function normalizeSpeakableMarkdown(markdown: string, fencedCodeReplacement: string): string {
  const language = proseLanguage(markdown);
  const stripped = speakMarkdownTables(markdown)
    // Fenced code is either summarized for explicit read-aloud or omitted in
    // a live conversation where announcing it interrupts the spoken answer.
    .replace(/```[\s\S]*?```/g, fencedCodeReplacement)
    .replace(/~~~[\s\S]*?~~~/g, fencedCodeReplacement)
    // Images / links → their human-readable text; an address is never spelled
    // out ("h-t-t-p-s-colon-slash-slash…") but said as a link to its site.
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_match, label: string) => speakReference(label, language))
    .replace(/\[([^\]]+)\]\([^)]*\)/g, (_match, label: string) => speakReference(label, language))
    .replace(/\[([^\]]+)\]\s*\[[^\]]*\]/g, (_match, label: string) => speakReference(label, language))
    .replace(/<(https?:\/\/[^>]+)>/giu, (_match, address: string) => spokenLink(address, language))
    .replace(WEB_ADDRESS_RE, (address) => speakReference(address, language))
    // Inline code + emphasis → bare content. The `_italic_` rule requires
    // both underscores so snake_case identifiers survive.
    .replace(/`([^`]+)`/g, (_match, code: string) => speakReference(code, language))
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

  const withoutPaths = stripped
    .replace(ABSOLUTE_FILE_PATH_RE, ' ')
    .replace(FILE_PATH_RE, (match) => {
      if (SLASHED_PROSE_RE.test(match)) return match;
      return isWebAddress(match) ? speakReference(match, language) : ' ';
    })
    .replace(DOMAIN_RE, (match, offset: number, whole: string) =>
      FILE_EXTENSION_RE.test(match) || DOTTED_PROSE_RE.test(match) || whole[offset - 1] === '@'
        ? match
        : speakReference(match, language));

  // Split on blank lines into paragraphs; soft-wrap newlines collapse to
  // spaces. Each paragraph gets terminal punctuation so the engine pauses
  // between them — without doubling a mark the prose already ends on.
  return stripNonVerbalArtifacts(withoutPaths)
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((p) => (/[.!?:]$/.test(p) ? p : `${p}.`))
    .join(' ')
    .replace(/\s+([.!?])/gu, '$1')
    .replace(/\s+([,;:!?])/gu, '$1')
    .replace(/([,;:])\s*[.!?]/gu, '.')
    .replace(/([,;:])(?:\s*[,;:])+/gu, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function toSpeakableText(markdown: string): string {
  return normalizeSpeakableMarkdown(markdown, ' (code block) ');
}

/**
 * Voice-call prose omits fenced source entirely. The transcript still shows
 * the original answer, while the voice speaks only the surrounding explanation.
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
