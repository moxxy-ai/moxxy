/**
 * OpenCode's file changes as Moxxy diffs. The updates are shaped as OpenCode
 * 1.18 sends them over ACP: a finished call carries the tool's own output and
 * metadata in `rawOutput`, and for an edit only the replaced text in `content`.
 */
import { describe, expect, it } from 'vitest';
import type { AcpSessionUpdate } from './protocol.js';
import { AcpTurnTranslator } from './translate.js';

const started = (id: string, tool: string, rawInput: Record<string, unknown>): AcpSessionUpdate => ({
  sessionUpdate: 'tool_call',
  toolCallId: id,
  title: tool,
  kind: 'edit',
  status: 'in_progress',
  rawInput,
});
const finished = (id: string, output: string, metadata: Record<string, unknown>, content: unknown[] = []): AcpSessionUpdate => ({
  sessionUpdate: 'tool_call_update',
  toolCallId: id,
  status: 'completed',
  content: [{ type: 'content', content: { type: 'text', text: output } }, ...content],
  rawOutput: { output, metadata },
});

describe("OpenCode's file changes", () => {
  it('show an edit as a diff, from the unified diff in its metadata', () => {
    const t = new AcpTurnTranslator('moxxy_', '/repo');
    t.update(started('e1', 'edit', { filePath: '/repo/src/db.ts', oldString: 'const port = 5432;', newString: 'const port = 5433;' }));
    const diff =
      'Index: /repo/src/db.ts\n===================================================================\n--- /repo/src/db.ts\n+++ /repo/src/db.ts\n' +
      '@@ -1,2 +1,2 @@\n const host = "x";\n-const port = 5432;\n+const port = 5433;\n';

    const [result] = t.update(
      finished('e1', 'Edit applied successfully.', { diagnostics: {}, diff, filediff: { file: '/repo/src/db.ts', additions: 1, deletions: 1 }, truncated: false }, [
        { type: 'diff', path: '/repo/src/db.ts', oldText: 'const port = 5432;', newText: 'const port = 5433;' },
      ]),
    );

    expect(result).toMatchObject({
      type: 'tool_result',
      callId: 'e1',
      ok: true,
      output: { display: { kind: 'file-diff', path: 'src/db.ts', mode: 'update', added: 1, removed: 1 } },
    });
    const output = (result as { output: { forModel: string; display: { hunks: Array<{ lines: Array<{ newNo?: number }> }> } } }).output;
    expect(output.forModel).toContain('Edit applied successfully.');
    expect(output.display.hunks[0]?.lines[2]?.newNo).toBe(2);
  });

  it('show a new file as all added, from the content it was given', () => {
    const t = new AcpTurnTranslator('moxxy_', '/repo');
    t.update(started('w1', 'write', { filePath: '/repo/notes.md', content: '# Notes\nport 5433\n' }));

    const [result] = t.update(finished('w1', 'Wrote file successfully.', { diagnostics: {}, filepath: '/repo/notes.md', exists: false, truncated: false }));

    expect(result).toMatchObject({ output: { display: { kind: 'file-diff', path: 'notes.md', mode: 'create', added: 2, removed: 0 } } });
  });

  it('keep the text when a write replaced a file whose old content OpenCode does not send', () => {
    const t = new AcpTurnTranslator('moxxy_', '/repo');
    t.update(started('w2', 'write', { filePath: '/repo/notes.md', content: 'new\n' }));

    expect(t.update(finished('w2', 'Wrote file successfully.', { filepath: '/repo/notes.md', exists: true }))).toEqual([
      { type: 'tool_result', callId: 'w2', ok: true, output: 'Wrote file successfully.' },
    ]);
  });
});
