import React from 'react';
import { Text } from 'ink';
import { tokenizeInline, type InlineTok } from '@moxxy/chat-model/markdown';
import { terminalSafeText } from '../terminal-text.js';

/**
 * Inline-span renderer: handles `code`, **bold**, *italic*, and [text](url)
 * within a paragraph. Tokenizes once (via @moxxy/chat-model) then maps the
 * framework-neutral token stream onto Ink <Text> nodes.
 */
export const InlineText: React.FC<{ text: string }> = ({ text }) => {
  const tokens = tokenizeInline(text);
  return (
    <Text color="white">
      {tokens.map((t, i) => (
        <InlineToken key={i} tok={t} />
      ))}
    </Text>
  );
};

const InlineToken: React.FC<{ tok: InlineTok }> = ({ tok }) => {
  switch (tok.kind) {
    case 'text':
      return <Text>{tok.value}</Text>;
    case 'code':
      return <Text color="cyan" backgroundColor="black">{` ${tok.value} `}</Text>;
    case 'bold':
      // Models commonly bold a complete link (`**[label](url)**`). The shared
      // tokenizer intentionally emits a flat bold token, so recurse once here
      // to preserve the nested link instead of leaking Markdown punctuation.
      return (
        <Text bold>
          <InlineText text={tok.value} />
        </Text>
      );
    case 'italic':
      return (
        <Text italic>
          <InlineText text={tok.value} />
        </Text>
      );
    case 'link':
      return <LinkToken label={tok.label} url={tok.url} />;
  }
};

const LinkToken: React.FC<{ label: string; url: string }> = ({ label, url }) => {
  const visibleLabel = terminalSafeText(label, 512);
  const link = terminalHyperlinkText(visibleLabel, url);
  return (
    <>
      <Text underline color="blue">{link}</Text>
      <Text dimColor>{formatLinkHint(url, visibleLabel.length)}</Text>
    </>
  );
};

const OSC_LINK = '\u001B]8;;';
// Warp's documented OSC 8 contract uses the String Terminator (ESC + `\\`).
// Keep the exact sequence instead of BEL so Warp recognizes the styled label
// as a link inside its terminal block renderer.
const OSC_END = '\u001B\\';

export interface TerminalHyperlinkParts {
  readonly open: string;
  readonly close: string;
}

/** Wrap the complete styled span in OSC 8 boundaries. Keeping the boundaries
 * outside Ink's color/underline node prevents the reconciler from closing the
 * hyperlink while it restores nested text styles. */
export function terminalHyperlinkParts(
  url: string,
  enabled = terminalHyperlinksEnabled(),
): TerminalHyperlinkParts {
  if (!enabled) return { open: '', close: '' };
  const safeUrl = safeTerminalLinkUrl(url);
  if (!safeUrl) return { open: '', close: '' };
  return {
    open: `${OSC_LINK}${safeUrl}${OSC_END}`,
    close: `${OSC_LINK}${OSC_END}`,
  };
}

/** Keep the complete OSC 8 region in one Ink text leaf. Visual styling wraps
 * this leaf from outside, leaving Warp the exact documented OSC payload. */
export function terminalHyperlinkText(label: string, url: string, enabled?: boolean): string {
  const hyperlink = terminalHyperlinkParts(url, enabled);
  return `${hyperlink.open}${label}${hyperlink.close}`;
}

function terminalHyperlinksEnabled(): boolean {
  if (process.env.FORCE_HYPERLINK === '0') return false;
  if (process.env.FORCE_HYPERLINK === '1') return true;
  return process.stdout.isTTY === true && process.env.TERM !== 'dumb';
}

function safeTerminalLinkUrl(url: string): string | null {
  if (/[\u0000-\u001F\u007F]/.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:'
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

/** Keep link destinations recognizable without printing an unbounded raw URL. */
export function formatLinkHint(
  url: string,
  labelLength = 0,
  availableWidth = Math.min(108, process.stdout.columns ?? 80) - 8,
): string {
  let hint = ' ↗';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const host = parsed.hostname.replace(/^www\./, '');
      if (host) hint = ` ↗ ${terminalSafeText(host, 30)}`;
    } else if (parsed.protocol === 'mailto:') {
      hint = ' ↗ email';
    }
  } catch {
    // Relative links and malformed model output still get a bounded cue.
  }
  // Never strand a domain or arrow on a line by itself. The underlined label
  // remains recognizable and clickable when the viewport cannot fit a hint.
  return labelLength > 0 && labelLength + hint.length > availableWidth ? '' : hint;
}
