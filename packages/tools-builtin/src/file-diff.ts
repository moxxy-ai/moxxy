import * as path from 'node:path';
import type { FileDiffDisplay, ToolDisplayResult } from '@moxxy/sdk';
import { fileDiffFromText, fileDiffSummary } from '@moxxy/sdk';

/**
 * The file-diff result of Write/Edit: the changed slices for channels, and a
 * short line for the model that keeps the absolute path the agent used.
 */
export function buildFileDiffDisplay(args: {
  cwd: string;
  absPath: string;
  before: string;
  after: string;
  mode: 'create' | 'update';
}): ToolDisplayResult {
  const { cwd, absPath, before, after, mode } = args;
  const display = fileDiffFromText({ path: relForDisplay(cwd, absPath), mode, before, after });
  return { forModel: forModelLine(absPath, mode, display), display };
}

function relForDisplay(cwd: string, absPath: string): string {
  const rel = path.relative(cwd, absPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return absPath;
  return rel;
}

function forModelLine(absPath: string, mode: 'create' | 'update', d: FileDiffDisplay): string {
  const verb = mode === 'create' ? 'created' : 'edited';
  return `${verb} ${absPath} — ${fileDiffSummary(d).toLowerCase()}`;
}
