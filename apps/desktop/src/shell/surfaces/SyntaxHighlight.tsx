import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Grammar, PrismStatic, Token, TokenStream } from 'prismjs';

const MAX_HIGHLIGHT_CHARS = 250_000;

const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  '.bash': 'bash',
  '.c': 'c',
  '.cc': 'cpp',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.cts': 'typescript',
  '.cxx': 'cpp',
  '.dockerfile': 'docker',
  '.env': 'properties',
  '.gql': 'graphql',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.htm': 'markup',
  '.html': 'markup',
  '.ini': 'ini',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.json5': 'json5',
  '.jsonc': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.less': 'less',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.mjs': 'javascript',
  '.mts': 'typescript',
  '.php': 'php',
  '.plist': 'markup',
  '.properties': 'properties',
  '.ps1': 'powershell',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sass': 'sass',
  '.scss': 'scss',
  '.sh': 'bash',
  '.sql': 'sql',
  '.svelte': 'markup',
  '.svg': 'markup',
  '.swift': 'swift',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.vue': 'markup',
  '.xml': 'markup',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'bash',
};

const EXACT_LANGUAGE: Readonly<Record<string, string>> = {
  dockerfile: 'docker',
  gemfile: 'ruby',
  makefile: 'makefile',
  rakefile: 'ruby',
};

let prismPromise: Promise<PrismStatic> | null = null;
const grammarPromises = new Map<string, Promise<PrismStatic>>();

/** Resolve the lexer from the filename without trusting file contents. */
export function languageForPath(path: string): string | null {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const exact = EXACT_LANGUAGE[name];
  if (exact) return exact;
  if (name.startsWith('.env')) return 'properties';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  return EXTENSION_LANGUAGE[name.slice(dot)] ?? null;
}

function loadPrism(): Promise<PrismStatic> {
  prismPromise ??= import('prismjs').then((module) => module.default);
  return prismPromise;
}

async function importGrammar(language: string): Promise<void> {
  switch (language) {
    case 'bash': await import('prismjs/components/prism-bash.js'); break;
    case 'c': await import('prismjs/components/prism-c.js'); break;
    case 'cpp': await import('prismjs/components/prism-cpp.js'); break;
    case 'csharp': await import('prismjs/components/prism-csharp.js'); break;
    case 'docker': await import('prismjs/components/prism-docker.js'); break;
    case 'go': await import('prismjs/components/prism-go.js'); break;
    case 'graphql': await import('prismjs/components/prism-graphql.js'); break;
    case 'ini': await import('prismjs/components/prism-ini.js'); break;
    case 'java': await import('prismjs/components/prism-java.js'); break;
    case 'json': await import('prismjs/components/prism-json.js'); break;
    case 'json5': await import('prismjs/components/prism-json5.js'); break;
    case 'jsx': await import('prismjs/components/prism-jsx.js'); break;
    case 'kotlin': await import('prismjs/components/prism-kotlin.js'); break;
    case 'less': await import('prismjs/components/prism-less.js'); break;
    case 'lua': await import('prismjs/components/prism-lua.js'); break;
    case 'makefile': await import('prismjs/components/prism-makefile.js'); break;
    case 'markdown': await import('prismjs/components/prism-markdown.js'); break;
    case 'php': await import('prismjs/components/prism-php.js'); break;
    case 'powershell': await import('prismjs/components/prism-powershell.js'); break;
    case 'properties': await import('prismjs/components/prism-properties.js'); break;
    case 'python': await import('prismjs/components/prism-python.js'); break;
    case 'ruby': await import('prismjs/components/prism-ruby.js'); break;
    case 'rust': await import('prismjs/components/prism-rust.js'); break;
    case 'sass': await import('prismjs/components/prism-sass.js'); break;
    case 'scss': await import('prismjs/components/prism-scss.js'); break;
    case 'sql': await import('prismjs/components/prism-sql.js'); break;
    case 'swift': await import('prismjs/components/prism-swift.js'); break;
    case 'toml': await import('prismjs/components/prism-toml.js'); break;
    case 'tsx': await import('prismjs/components/prism-tsx.js'); break;
    case 'typescript': await import('prismjs/components/prism-typescript.js'); break;
    case 'yaml': await import('prismjs/components/prism-yaml.js'); break;
    default: break;
  }
}

const DEPENDENCIES: Readonly<Record<string, ReadonlyArray<string>>> = {
  cpp: ['c'],
  php: ['markup-templating'],
  sass: ['css'],
  scss: ['css'],
  tsx: ['typescript', 'jsx'],
};

async function ensureGrammar(language: string): Promise<PrismStatic> {
  const existing = grammarPromises.get(language);
  if (existing) return existing;
  const task = (async () => {
    const Prism = await loadPrism();
    if (Prism.languages[language]) return Prism;
    for (const dependency of DEPENDENCIES[language] ?? []) {
      if (dependency === 'markup-templating') {
        await import('prismjs/components/prism-markup-templating.js');
      } else {
        await ensureGrammar(dependency);
      }
    }
    await importGrammar(language);
    return Prism;
  })();
  grammarPromises.set(language, task);
  return task;
}

export interface SyntaxGrammar {
  readonly language: string;
  readonly grammar: Grammar;
  readonly prism: PrismStatic;
}

export function useSyntaxGrammar(path: string): SyntaxGrammar | null {
  const language = languageForPath(path);
  const [loaded, setLoaded] = useState<SyntaxGrammar | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!language) {
      setLoaded(null);
      return () => {
        cancelled = true;
      };
    }
    void ensureGrammar(language)
      .then((prism) => {
        const grammar = prism.languages[language];
        if (!cancelled && grammar) setLoaded({ language, grammar, prism });
      })
      .catch(() => {
        if (!cancelled) setLoaded(null);
      });
    return () => {
      cancelled = true;
    };
  }, [language]);

  return loaded?.language === language ? loaded : null;
}

function safeClass(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value) ? value : null;
}

function renderTokenStream(stream: TokenStream, key: string): ReactNode {
  if (typeof stream === 'string') return stream;
  if (Array.isArray(stream)) {
    return stream.map((token, index) => renderTokenStream(token, `${key}-${index}`));
  }
  const token = stream as Token;
  const aliases = (Array.isArray(token.alias) ? token.alias : [token.alias])
    .map(safeClass)
    .filter((alias): alias is string => alias !== null);
  const type = safeClass(token.type) ?? 'plain';
  return (
    <span key={key} className={['token', type, ...aliases].join(' ')}>
      {renderTokenStream(token.content, `${key}-content`)}
    </span>
  );
}

/** Tokenize to React nodes; source text is never injected as HTML. */
export function highlightedSyntax(text: string, syntax: SyntaxGrammar | null): ReactNode {
  if (!syntax || text.length > MAX_HIGHLIGHT_CHARS) return text;
  try {
    return renderTokenStream(syntax.prism.tokenize(text, syntax.grammar), 'syntax');
  } catch {
    return text;
  }
}

export function SyntaxCode({
  path,
  content,
  truncated = false,
}: {
  readonly path: string;
  readonly content: string;
  readonly truncated?: boolean;
}): JSX.Element {
  const syntax = useSyntaxGrammar(path);
  const shown = truncated ? `${content}\n\n… (truncated)` : content;
  const lineNumbers = useMemo(
    () => Array.from({ length: Math.max(1, shown.split('\n').length) }, (_, index) => index + 1).join('\n'),
    [shown],
  );
  const highlighted = useMemo(() => highlightedSyntax(shown, syntax), [shown, syntax]);

  return (
    <div
      className="syntax-code"
      data-language={languageForPath(path) ?? 'text'}
      data-highlighted={syntax !== null && shown.length <= MAX_HIGHLIGHT_CHARS}
    >
      <pre className="syntax-code__gutter" aria-hidden="true">{lineNumbers}</pre>
      <pre className="syntax-code__body"><code>{highlighted}</code></pre>
    </div>
  );
}
