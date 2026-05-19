import React from 'react';
import { Text } from 'ink';
import type { InlineTok } from './types.js';

/**
 * Inline-span renderer: handles `code`, **bold**, *italic*, and [text](url)
 * within a paragraph. Tokenizes once with a single combined regex.
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
          <Text dimColor>{` (${tok.url})`}</Text>
        </Text>
      );
  }
};

/**
 * Match `inline code`, **bold**, *italic*, [label](url) in priority order
 * (longest-match-wins via single combined regex). Everything between
 * matches becomes a plain text token.
 */
export function tokenizeInline(input: string): InlineTok[] {
  const re = /(`[^`\n]+`)|(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  const out: InlineTok[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIdx) {
      out.push({ kind: 'text', value: input.slice(lastIdx, match.index) });
    }
    if (match[1]) {
      out.push({ kind: 'code', value: match[1].slice(1, -1) });
    } else if (match[2]) {
      out.push({ kind: 'bold', value: match[3]! });
    } else if (match[4]) {
      out.push({ kind: 'italic', value: match[5]! });
    } else if (match[6]) {
      out.push({ kind: 'link', label: match[7]!, url: match[8]! });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < input.length) {
    out.push({ kind: 'text', value: input.slice(lastIdx) });
  }
  return out;
}

export function stripInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
