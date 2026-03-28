import React from 'react';
import { Box, Text } from 'ink';
import { marked } from 'marked';
import { THEME } from '../../theme.js';

const C = {
  text: '#CCCCCC',
  bold: '#FFFFFF',
  italic: '#B0B0B0',
  code: '#E5C07B',
  link: '#61AFEF',
  linkUrl: '#666666',
  heading12: '#61AFEF',
  heading3plus: '#98C379',
  quote: '#777777',
  bullet: '#61AFEF',
  dim: '#555555',
};

function renderInline(tokens) {
  if (!tokens) return null;
  return tokens.map((tok, i) => {
    switch (tok.type) {
      case 'text':
        if (tok.tokens && tok.tokens.length > 0) {
          return <Text key={i}>{renderInline(tok.tokens)}</Text>;
        }
        return tok.text;
      case 'strong':
        return <Text key={i} bold color={C.bold}>{renderInline(tok.tokens)}</Text>;
      case 'em':
        return <Text key={i} italic color={C.italic}>{renderInline(tok.tokens)}</Text>;
      case 'codespan':
        return <Text key={i} color={C.code}>{tok.text}</Text>;
      case 'del':
        return <Text key={i} color={C.dim} dimColor strikethrough>{renderInline(tok.tokens)}</Text>;
      case 'link':
        return <Text key={i}><Text underline color={C.link}>{renderInline(tok.tokens)}</Text><Text color={C.linkUrl} dimColor> ({tok.href})</Text></Text>;
      case 'image':
        return <Text key={i} color={C.link}>{tok.text || 'image'}</Text>;
      case 'br':
        return '\n';
      case 'escape':
        return tok.text;
      default:
        if (tok.tokens) return <Text key={i}>{renderInline(tok.tokens)}</Text>;
        return tok.raw || tok.text || '';
    }
  });
}

function renderListItem(item, bullet) {
  const children = item.tokens || [];
  if (children.length === 0) {
    return <Text><Text color={C.bullet}>{bullet}</Text></Text>;
  }

  return children.map((child, k) => {
    if (k === 0) {
      const inlineTokens = child.tokens || [];
      return (
        <Text key={k}>
          <Text color={C.bullet}>{bullet}</Text>
          {renderInline(inlineTokens)}
        </Text>
      );
    }
    if (child.type === 'list') {
      return renderBlock(child, k, false);
    }
    const inlineTokens = child.tokens || [];
    return (
      <Text key={k}>{'  '}{renderInline(inlineTokens)}</Text>
    );
  });
}

function renderBlock(token, key, isFirst) {
  const gap = isFirst ? 0 : 1;

  switch (token.type) {
    case 'heading': {
      const hColor = token.depth <= 2 ? C.heading12 : C.heading3plus;
      return (
        <Box key={key} marginTop={gap}>
          <Text bold color={hColor}>
            {renderInline(token.tokens)}
          </Text>
        </Box>
      );
    }
    case 'paragraph':
      return (
        <Box key={key} marginTop={gap}>
          <Text>{renderInline(token.tokens)}</Text>
        </Box>
      );
    case 'list':
      return (
        <Box key={key} marginTop={gap} flexDirection="column">
          {token.items.map((item, j) => {
            const bullet = token.ordered ? `${(token.start || 1) + j}. ` : '- ';
            return (
              <Box key={j} flexDirection="column">
                {renderListItem(item, bullet)}
              </Box>
            );
          })}
        </Box>
      );
    case 'code':
      return (
        <Box key={key} marginTop={1} marginBottom={1} borderStyle="round" borderColor={C.dim} paddingX={1}>
          <Text color={C.code}>{token.text}</Text>
        </Box>
      );
    case 'blockquote': {
      const innerTokens = token.tokens || [];
      return (
        <Box key={key} marginTop={gap} flexDirection="row">
          <Text color={C.quote}>│ </Text>
          <Box flexDirection="column">
            {innerTokens.map((t, j) => renderBlock(t, j, j === 0))}
          </Box>
        </Box>
      );
    }
    case 'hr':
      return <Text key={key} color={C.dim}>{'─'.repeat(40)}</Text>;
    case 'space':
      return null;
    default:
      if (token.raw) return <Text key={key}>{token.raw.trimEnd()}</Text>;
      return null;
  }
}

function MarkdownBody({ content }) {
  if (!content) return null;

  let tokens;
  try {
    tokens = marked.lexer(content, { gfm: true });
  } catch {
    return <Text>{content}</Text>;
  }

  const blocks = tokens.map((token, i) => renderBlock(token, i, i === 0)).filter(Boolean);
  if (blocks.length === 0) return <Text>{content}</Text>;
  return <Box flexDirection="column">{blocks}</Box>;
}

export function AssistantMessage({ msg, agentName }) {
  const name = agentName || 'Moxxy';

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        <Text bold color={THEME.assistant}>{name}</Text>
        {msg.streaming && <Text color={THEME.dim}> typing…</Text>}
      </Text>
      <MarkdownBody content={msg.content || ''} />
    </Box>
  );
}
