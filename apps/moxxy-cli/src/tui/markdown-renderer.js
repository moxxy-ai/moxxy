import { marked } from 'marked';

/**
 * Render markdown content as an array of plain text strings.
 * Used for simple text extraction. The TUI chat panel handles
 * display formatting directly via pi-tui's wrapTextWithAnsi.
 *
 * @param {string} content - Raw markdown string
 * @returns {string[]} Array of text lines
 */
export function renderMarkdown(content) {
  if (!content) return [''];

  const tokens = marked.lexer(content);
  const lines = [];

  for (const token of tokens) {
    const tokenLines = renderToken(token);
    lines.push(...tokenLines);
  }

  return lines.length > 0 ? lines : [''];
}

function renderToken(token) {
  switch (token.type) {
    case 'heading':
      return ['#'.repeat(token.depth) + ' ' + stripInline(token.text)];

    case 'paragraph':
      return [stripInline(token.text)];

    case 'code':
      return [
        (token.lang ? `[${token.lang}]` : ''),
        token.text,
      ].filter(Boolean);

    case 'list':
      return token.items.map((item, j) => {
        const bullet = token.ordered ? `${j + 1}. ` : '- ';
        return bullet + stripInline(item.text);
      });

    case 'blockquote':
      return ['> ' + stripInline(token.text || '')];

    case 'hr':
      return ['---'];

    case 'space':
      return [''];

    default:
      return token.raw ? [token.raw.trim()] : [];
  }
}

function stripInline(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '`$1`')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1 ($2)');
}
