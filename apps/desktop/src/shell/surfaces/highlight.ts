/**
 * Syntax highlighting for the code-preview pane. Uses highlight.js's "common"
 * bundle (~37 languages) so the desktop bundle doesn't pull every grammar.
 * Token colors are theme-aware via the `.hljs-*` → `var(--syntax-*)` rules in
 * styles.css, so we never import a fixed hljs theme stylesheet.
 */

import hljs from 'highlight.js/lib/common';

/** Files larger than this skip highlighting (auto-detect gets slow + the pane
 *  would jank). They render as plain monospace text instead. */
const MAX_HIGHLIGHT_BYTES = 200_000;

/** Map a filename's extension to a highlight.js language id. Unknown → null
 *  (caller falls back to auto-detect). */
function langFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', vue: 'xml',
    css: 'css', scss: 'scss', less: 'less',
    md: 'markdown', markdown: 'markdown',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
    php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml',
    sql: 'sql', swift: 'swift', kt: 'kotlin', toml: 'ini', ini: 'ini',
    dockerfile: 'dockerfile', diff: 'diff', patch: 'diff',
  };
  return map[ext] ?? null;
}

export interface Highlighted {
  /** hljs-escaped HTML with token spans, safe for dangerouslySetInnerHTML. */
  readonly html: string;
  /** True when highlighting actually ran (false = plain escaped text). */
  readonly highlighted: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Highlight `code` for `filename`. hljs escapes the source text, so the result
 *  is safe to inject; on any failure / oversize input we return escaped plain
 *  text rather than throwing. */
export function highlightCode(code: string, filename?: string | null): Highlighted {
  if (code.length > MAX_HIGHLIGHT_BYTES) return { html: escapeHtml(code), highlighted: false };
  try {
    const lang = langFromName(filename);
    if (lang && hljs.getLanguage(lang)) {
      return { html: hljs.highlight(code, { language: lang }).value, highlighted: true };
    }
    return { html: hljs.highlightAuto(code).value, highlighted: true };
  } catch {
    return { html: escapeHtml(code), highlighted: false };
  }
}
