import React from 'react';
import { Box, Text } from 'ink';

/**
 * Minimal terminal-friendly markdown renderer. Handles the subset the
 * assistant produces in chat replies — headings, bullet lists, numbered
 * lists, fenced code blocks, inline code, bold, italic, and links.
 * Anything else falls through as plain text.
 *
 * Zero dependencies (no `marked` / `markdown-it`); ~200 lines of pure
 * regex transforms. Good-enough is the right bar here — the chat is
 * ephemeral, the user will catch any rendering edge case visually.
 */
export const Markdown: React.FC<{ content: string }> = ({ content }) => {
  const blocks = parseBlocks(content);
  return (
    <Box flexDirection="column">
      {blocks.map((b, i) => (
        <BlockNode key={i} block={b} />
      ))}
    </Box>
  );
};

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: ReadonlyArray<string> }
  | { kind: 'code'; lang: string | null; body: string }
  | { kind: 'blank' };

function parseBlocks(src: string): Block[] {
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    // Fenced code block
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] || null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ kind: 'code', lang, body: body.join('\n') });
      continue;
    }

    // ATX heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, Math.max(1, heading[1]!.length)) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ kind: 'heading', level, text: heading[2]!.trim() });
      i++;
      continue;
    }

    // List (bullet or numbered) — consume consecutive list lines
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const m = ordered
          ? /^\s*\d+\.\s+(.*)$/.exec(lines[i]!)
          : /^\s*[-*+]\s+(.*)$/.exec(lines[i]!);
        if (!m) break;
        items.push(m[1]!.trim());
        i++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      blocks.push({ kind: 'blank' });
      i++;
      continue;
    }

    // Otherwise: paragraph — gather until blank/structural line
    const paraLines: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== '') {
      const next = lines[i]!;
      if (
        /^```/.test(next) ||
        /^#{1,6}\s+/.test(next) ||
        /^\s*[-*+]\s+/.test(next) ||
        /^\s*\d+\.\s+/.test(next)
      ) {
        break;
      }
      paraLines.push(next);
      i++;
    }
    blocks.push({ kind: 'paragraph', text: paraLines.join(' ') });
  }
  return blocks;
}

const BlockNode: React.FC<{ block: Block }> = ({ block }) => {
  switch (block.kind) {
    case 'heading': {
      const color = block.level === 1 ? 'cyan' : block.level === 2 ? 'magenta' : 'yellow';
      return (
        <Box marginTop={block.level <= 2 ? 1 : 0}>
          <Text bold color={color}>{'#'.repeat(block.level)} </Text>
          <Text bold color={color}>{block.text}</Text>
        </Box>
      );
    }
    case 'paragraph':
      return (
        <Box>
          <InlineText text={block.text} />
        </Box>
      );
    case 'list':
      return (
        <Box flexDirection="column">
          {block.items.map((item, i) => (
            <Box key={i}>
              <Text dimColor>{block.ordered ? `${i + 1}. ` : '• '}</Text>
              <InlineText text={item} />
            </Box>
          ))}
        </Box>
      );
    case 'code':
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" borderDimColor paddingX={1}>
          {block.lang ? (
            <Text dimColor italic>{block.lang}</Text>
          ) : null}
          {block.body.split('\n').map((line, i) => (
            <Text key={i} color="cyan">{line}</Text>
          ))}
        </Box>
      );
    case 'blank':
      return <Text> </Text>;
  }
};

/**
 * Inline-span renderer: handles `code`, **bold**, *italic*, and [text](url)
 * within a paragraph. Tokenizes once with a single combined regex.
 */
const InlineText: React.FC<{ text: string }> = ({ text }) => {
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
      return <Text color="cyan" backgroundColor="black">{` ${tok.value} `}</Text>;
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

type InlineTok =
  | { kind: 'text'; value: string }
  | { kind: 'code'; value: string }
  | { kind: 'bold'; value: string }
  | { kind: 'italic'; value: string }
  | { kind: 'link'; label: string; url: string };

/**
 * Match `inline code`, **bold**, *italic*, [label](url) in priority order
 * (longest-match-wins via single combined regex). Everything between
 * matches becomes a plain text token.
 */
function tokenizeInline(input: string): InlineTok[] {
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
