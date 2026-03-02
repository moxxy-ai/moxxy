import { marked } from 'marked';
import { Box, Text } from 'ink';
import { h, COLORS } from './helpers.js';

/**
 * Render markdown content as Ink elements.
 * @param {string} content - Raw markdown string
 * @returns {Array} Array of React elements
 */
export function renderMarkdown(content) {
  if (!content) return [h(Text, null, '')];

  const tokens = marked.lexer(content);
  return tokens.map((token, i) => renderToken(token, i));
}

function renderToken(token, key) {
  switch (token.type) {
    case 'heading':
      return h(Box, { key, marginTop: 1 },
        h(Text, { bold: true, color: COLORS.accent },
          '#'.repeat(token.depth) + ' ' + renderInlineText(token.text))
      );

    case 'paragraph':
      return h(Box, { key, marginTop: 0 },
        h(Text, { wrap: 'wrap' }, renderInlineText(token.text))
      );

    case 'code':
      return h(Box, { key, marginTop: 1, marginBottom: 1, borderStyle: 'single', borderColor: COLORS.dim, paddingLeft: 1, paddingRight: 1 },
        h(Text, { color: COLORS.accent },
          (token.lang ? `[${token.lang}]\n` : '') + token.text)
      );

    case 'list':
      return h(Box, { key, flexDirection: 'column', marginLeft: 2 },
        ...token.items.map((item, j) => {
          const bullet = token.ordered ? `${j + 1}. ` : '• ';
          return h(Box, { key: j },
            h(Text, { color: COLORS.dim }, bullet),
            h(Text, { wrap: 'wrap' }, renderInlineText(item.text))
          );
        })
      );

    case 'blockquote':
      return h(Box, { key, marginLeft: 2, borderStyle: 'single', borderColor: COLORS.dim, borderLeft: true, borderRight: false, borderTop: false, borderBottom: false, paddingLeft: 1 },
        h(Text, { color: COLORS.dim, italic: true, wrap: 'wrap' }, renderInlineText(token.text || ''))
      );

    case 'hr':
      return h(Box, { key },
        h(Text, { color: COLORS.dim }, '─'.repeat(40))
      );

    case 'space':
      return h(Box, { key, height: 1 });

    default:
      return token.raw
        ? h(Text, { key, wrap: 'wrap' }, token.raw.trim())
        : null;
  }
}

/**
 * Render inline markdown (bold, italic, code, links) as plain text with markers.
 * Ink Text doesn't support mixed styles in a single element, so we use text markers.
 */
function renderInlineText(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')    // bold markers (Ink can't mix)
    .replace(/\*(.+?)\*/g, '$1')          // italic markers
    .replace(/`(.+?)`/g, '`$1`')         // keep backtick markers
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)'); // links as text (url)
}
