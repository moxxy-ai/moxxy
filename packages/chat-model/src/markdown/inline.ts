import { assertDefined } from '../assert.js';
import type { InlineTok } from './types.js';

/**
 * Match `inline code`, **bold**, *italic*, [label](url) in priority order
 * (longest-match-wins via single combined regex). Everything between
 * matches becomes a plain text token. Framework-neutral — the Ink/DOM
 * renderers map the token stream to their own elements.
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
      const value = match[3];
      assertDefined(value, 'bold inner group is captured when the bold group matches');
      out.push({ kind: 'bold', value });
    } else if (match[4]) {
      const value = match[5];
      assertDefined(value, 'italic inner group is captured when the italic group matches');
      out.push({ kind: 'italic', value });
    } else if (match[6]) {
      const label = match[7];
      const url = match[8];
      assertDefined(label, 'link label group is captured when the link group matches');
      assertDefined(url, 'link url group is captured when the link group matches');
      out.push({ kind: 'link', label, url });
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < input.length) {
    out.push({ kind: 'text', value: input.slice(lastIdx) });
  }
  return out;
}

/** Drop inline markdown markup, leaving the bare text. The patterns mirror
 *  {@link tokenizeInline} exactly (no newlines inside code/bold/italic, no
 *  whitespace in a link URL) so stripping and tokenizing agree on what counts
 *  as markup — otherwise a string could strip a span that tokenize leaves as
 *  plain text, or vice versa. */
export function stripInline(s: string): string {
  return s
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1');
}
