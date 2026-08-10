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
    <Text>
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
      return <Text bold>{tok.value}</Text>;
    case 'italic':
      return <Text italic>{tok.value}</Text>;
    case 'link':
      return (
        <Text>
          <Text underline color="blue">{tok.label}</Text>
          <Text dimColor>{formatLinkHint(tok.url)}</Text>
        </Text>
      );
  }
};

/** Keep link destinations recognizable without printing an unbounded raw URL. */
export function formatLinkHint(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const host = parsed.hostname.replace(/^www\./, '');
      return host ? ` ↗ ${terminalSafeText(host, 30)}` : ' ↗';
    }
    if (parsed.protocol === 'mailto:') return ' ↗ email';
  } catch {
    // Relative links and malformed model output still get a bounded cue.
  }
  return ' ↗';
}
