export interface ParsedSkillFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

const FRONTMATTER_FENCE = '---';

export function parseSkillFile(content: string): ParsedSkillFile {
  if (!content.startsWith(FRONTMATTER_FENCE + '\n') && !content.startsWith(FRONTMATTER_FENCE + '\r\n')) {
    return { frontmatter: {}, body: content };
  }
  const fenceLen = content.startsWith(FRONTMATTER_FENCE + '\r\n') ? 5 : 4;
  const rest = content.slice(fenceLen);
  const endRe = /\r?\n---(?:\r?\n|$)/;
  const endMatch = endRe.exec(rest);
  if (!endMatch) return { frontmatter: {}, body: content };
  const fmText = rest.slice(0, endMatch.index);
  const body = rest.slice(endMatch.index + endMatch[0].length);
  return { frontmatter: parseFrontmatter(fmText), body };
}

export function parseFrontmatter(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let raw = trimmed.slice(colon + 1).trim();

    if (raw === '' && i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1] ?? '')) {
      const items: unknown[] = [];
      while (i + 1 < lines.length && /^\s*-\s/.test(lines[i + 1] ?? '')) {
        i += 1;
        items.push(parseScalar((lines[i] ?? '').replace(/^\s*-\s*/, '').trim()));
      }
      result[key] = items;
      continue;
    }

    result[key] = parseScalar(raw);
  }
  return result;
}

function parseScalar(v: string): unknown {
  if (!v) return '';
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return splitArray(inner).map((s) => parseScalar(s.trim()));
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'null' || v === '~') return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  return stripQuotes(v);
}

function stripQuotes(s: string): string {
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

function splitArray(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  let inStr: '"' | "'" | null = null;
  for (const c of s) {
    if (inStr) {
      buf += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      buf += c;
      continue;
    }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) {
      out.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) out.push(buf);
  return out;
}
