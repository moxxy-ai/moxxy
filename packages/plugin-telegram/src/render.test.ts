import { describe, expect, it } from 'vitest';
import { asPluginId, asSessionId, asToolCallId, asTurnId, type MoxxyEvent } from '@moxxy/sdk';
import { splitForTelegram, TurnRenderer } from './render.js';
import { composeFrame } from './channel/html.js';
import type { FileDiffDisplay } from '@moxxy/sdk';

const sid = asSessionId('s');
const tid = asTurnId('t');
const c1 = asToolCallId('c1');
const baseEvent = (e: Partial<MoxxyEvent> & Pick<MoxxyEvent, 'type'>, seq = 0): MoxxyEvent =>
  ({
    sessionId: sid,
    turnId: tid,
    source: 'system',
    id: `e${seq}` as never,
    seq,
    ts: 0,
    ...e,
  }) as MoxxyEvent;

describe('TurnRenderer', () => {
  it('accumulates assistant chunks into the body', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'assistant_chunk', delta: 'hello ', source: 'model' }, 0));
    const second = r.accept(baseEvent({ type: 'assistant_chunk', delta: 'world', source: 'model' }, 1));
    expect(second.body).toBe('hello world');
    expect(second.activityHtml).toBe('');
  });

  it('replaces chunks with the final assistant_message on stop', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'assistant_chunk', delta: 'partial', source: 'model' }, 0));
    const final = r.accept(
      baseEvent({ type: 'assistant_message', content: 'final', stopReason: 'end_turn', source: 'model' }, 1),
    );
    expect(final.body).toBe('final');
  });

  it('emits tool entries with status badges on tool_call_requested + tool_result', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'tool_call_requested', callId: c1, name: 'Read', input: { path: '/a' }, source: 'model' }, 0));
    const after = r.accept(baseEvent({ type: 'tool_result', callId: c1, ok: true, output: 'ok', source: 'tool' }, 1));
    expect(after.activityHtml).toContain('<code>Read</code>');
    expect(after.activityHtml).toContain('path=');
    expect(after.activityHtml).toContain('✓');
  });

  it('marks failed tool calls with the error badge', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'tool_call_requested', callId: c1, name: 'Read', input: {}, source: 'model' }, 0));
    const after = r.accept(
      baseEvent({
        type: 'tool_result',
        callId: c1,
        ok: false,
        error: { kind: 'threw', message: 'boom' },
        source: 'tool',
      }, 1),
    );
    expect(after.activityHtml).toContain('✗');
    expect(after.activityHtml).toContain('threw');
  });

  it('renders a file-diff tool_result as a diff fence + summary in the composed frame', () => {
    const r = new TurnRenderer();
    const display: FileDiffDisplay = {
      kind: 'file-diff',
      path: 'src/app.ts',
      mode: 'update',
      added: 2,
      removed: 1,
      hunks: [
        {
          oldStart: 10,
          oldLines: 2,
          newStart: 10,
          newLines: 3,
          lines: [
            { kind: 'context', text: 'const a = 1;', oldNo: 10, newNo: 10 },
            { kind: 'del', text: 'const b = 2;', oldNo: 11 },
            { kind: 'add', text: 'const b = 3;', newNo: 11 },
            { kind: 'add', text: 'const c = 4;', newNo: 12 },
          ],
        },
      ],
    };
    r.accept(baseEvent({ type: 'tool_call_requested', callId: c1, name: 'Edit', input: { file_path: 'src/app.ts' }, source: 'model' }, 0));
    const frame = r.accept(
      baseEvent({ type: 'tool_result', callId: c1, ok: true, output: { forModel: 'edited', display }, source: 'tool' }, 1),
    );

    // Frame carries the pre-formatted diff HTML.
    expect(frame.diffHtml).toContain('<pre><code class="language-diff">');
    expect(frame.diffHtml).toContain('@@ -10,2 +10,3 @@');
    expect(frame.diffHtml).toContain('-const b = 2;');
    expect(frame.diffHtml).toContain('+const b = 3;');
    expect(frame.diffHtml).toContain('<b>Update src/app.ts</b>');
    expect(frame.diffHtml).toContain('Added 2 lines, removed 1 line');

    // Composed frame includes the diff block after the (empty) body.
    const composed = composeFrame(frame);
    expect(composed).toContain('language-diff');
    expect(composed).toContain('@@ -10,2 +10,3 @@');
  });

  it('shows only the summary line for a truncated file-diff with no hunks', () => {
    const r = new TurnRenderer();
    const display: FileDiffDisplay = {
      kind: 'file-diff',
      path: 'big.json',
      mode: 'create',
      added: 5000,
      removed: 0,
      hunks: [],
      truncated: true,
    };
    r.accept(baseEvent({ type: 'tool_call_requested', callId: c1, name: 'Write', input: { file_path: 'big.json' }, source: 'model' }, 0));
    const frame = r.accept(
      baseEvent({ type: 'tool_result', callId: c1, ok: true, output: { forModel: 'wrote', display }, source: 'tool' }, 1),
    );
    expect(frame.diffHtml).toContain('<b>Create big.json</b>');
    expect(frame.diffHtml).toContain('Added 5000 lines');
    expect(frame.diffHtml).toContain('(diff truncated)');
    // No empty code block when there are no hunks.
    expect(frame.diffHtml).not.toContain('<pre>');
  });

  it('escapes HTML special chars inside the diff fence body', () => {
    const r = new TurnRenderer();
    const display: FileDiffDisplay = {
      kind: 'file-diff',
      path: 'x.tsx',
      mode: 'update',
      added: 1,
      removed: 0,
      hunks: [
        {
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ kind: 'add', text: 'const x = <Foo a={b && c} />;', newNo: 1 }],
        },
      ],
    };
    r.accept(baseEvent({ type: 'tool_call_requested', callId: c1, name: 'Edit', input: {}, source: 'model' }, 0));
    const frame = r.accept(
      baseEvent({ type: 'tool_result', callId: c1, ok: true, output: { forModel: 'ok', display }, source: 'tool' }, 1),
    );
    expect(frame.diffHtml).toContain('+const x = &lt;Foo a={b &amp;&amp; c} /&gt;;');
    expect(frame.diffHtml).not.toContain('<Foo');
  });

  it('appends an error footer when an error event arrives', () => {
    const r = new TurnRenderer();
    const out = r.accept(baseEvent({ type: 'error', kind: 'fatal', message: 'boom', source: 'system' }, 0));
    expect(out.errorHtml).toContain('fatal');
    expect(out.errorHtml).toContain('boom');
  });

  it('reports hasUpdate=false when the same event yields the same frame', () => {
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'assistant_chunk', delta: 'x', source: 'model' }, 0));
    const second = r.accept(baseEvent({ type: 'plugin_event', pluginId: asPluginId('p'), subtype: 'noop', payload: null, source: 'plugin' }, 1));
    expect(second.hasUpdate).toBe(false);
  });

  // Push `n` tool calls (request + ok result) into a renderer.
  const withTools = (n: number): TurnRenderer => {
    const r = new TurnRenderer();
    for (let i = 0; i < n; i++) {
      const id = asToolCallId(`c${i}`);
      r.accept(baseEvent({ type: 'tool_call_requested', callId: id, name: `Tool${i}`, input: {}, source: 'model' }, i * 2));
      r.accept(baseEvent({ type: 'tool_result', callId: id, ok: true, output: 'ok', source: 'tool' }, i * 2 + 1));
    }
    return r;
  };

  it('folds a long activity trace into an expandable box with a summary on the final frame', () => {
    const r = withTools(4);
    const snap = r.snapshot({ collapse: true });
    expect(snap.activityHtml).toContain('<blockquote expandable>');
    expect(snap.activityHtml).toContain('🔧 <b>4 steps</b>');
    // The tool lines are still in the (collapsed) box.
    expect(snap.activityHtml).toContain('<code>Tool3</code>');
  });

  it('keeps the activity open (no expandable) while streaming', () => {
    const r = withTools(5);
    const snap = r.snapshot(); // default collapse=false
    expect(snap.activityHtml).toContain('<blockquote>');
    expect(snap.activityHtml).not.toContain('expandable');
    expect(snap.activityHtml).not.toContain('🔧');
  });

  it('keeps a short activity trace inline even on the final frame', () => {
    const r = withTools(2); // below the collapse threshold
    const snap = r.snapshot({ collapse: true });
    expect(snap.activityHtml).toContain('<blockquote>');
    expect(snap.activityHtml).not.toContain('expandable');
  });

  it('uses singular "step" for a single-tool collapsed trace', () => {
    // One tool + a skill banner + 2 notices = 4 lines, enough to collapse,
    // but only ONE tool call → "1 step".
    const r = new TurnRenderer();
    r.accept(baseEvent({ type: 'skill_invoked', name: 'demo', source: 'system' }, 0));
    const id = asToolCallId('only');
    r.accept(baseEvent({ type: 'tool_call_requested', callId: id, name: 'Read', input: {}, source: 'model' }, 1));
    r.accept(baseEvent({ type: 'tool_result', callId: id, ok: true, output: 'ok', source: 'tool' }, 2));
    r.accept(baseEvent({ type: 'skill_created', name: 's1', source: 'system' }, 3));
    r.accept(baseEvent({ type: 'skill_created', name: 's2', source: 'system' }, 4));
    const snap = r.snapshot({ collapse: true });
    expect(snap.activityHtml).toContain('<blockquote expandable>');
    expect(snap.activityHtml).toContain('🔧 <b>1 step</b>');
  });
});

describe('splitForTelegram', () => {
  it('returns one chunk when under the limit', () => {
    expect(splitForTelegram('hello')).toEqual(['hello']);
  });

  it('splits at newline preference when over the limit', () => {
    const text = 'a'.repeat(2000) + '\n' + 'b'.repeat(2000) + '\n' + 'c'.repeat(2000);
    const parts = splitForTelegram(text, 2500);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(2500);
    expect(parts.join('')).toBe(text);
  });

  // A minimal balanced-tag check: every opened tag (non-self-closing) is closed
  // and no `<` / `&` is left dangling without its `>` / `;` terminator.
  const isBalancedHtml = (html: string): boolean => {
    const stack: string[] = [];
    const re = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*?>/g;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = re.exec(html))) {
      // No bare '<' between the previous tag and this one.
      if (html.slice(lastIndex, m.index).includes('<')) return false;
      lastIndex = re.lastIndex;
      const closing = m[1] === '/';
      const name = m[2]!.toLowerCase();
      if (m[0].endsWith('/>')) continue;
      if (closing) {
        if (stack.pop() !== name) return false;
      } else {
        stack.push(name);
      }
    }
    if (html.slice(lastIndex).includes('<')) return false;
    if (stack.length !== 0) return false;
    // No truncated entity: every '&'-prefixed entity-looking run is `;`-terminated.
    for (const em of html.matchAll(/&[a-zA-Z0-9#]+/g)) {
      const after = html[em.index! + em[0].length];
      if (after !== ';') return false;
    }
    return true;
  };

  it('never cuts inside an HTML tag (each part is balanced HTML)', () => {
    // Force the limit to land right where a tag straddles the boundary. Sweep
    // limits comfortably larger than any single tag (a 4-char cap can't hold
    // even `<b>`; the real Telegram cap is 4000).
    const html = '<b>' + 'x'.repeat(50) + '</b>' + '<i>' + 'y'.repeat(50) + '</i>';
    for (let limit = 4; limit < html.length; limit++) {
      const parts = splitForTelegram(html, limit);
      for (const part of parts) {
        expect(isBalancedHtml(part)).toBe(true);
      }
    }
  });

  it('closes and reopens a <pre><code> diff fence across the cut (no broken fence)', () => {
    const body = 'd'.repeat(120);
    const html =
      'before\n\n<pre><code class="language-diff">' + body + '</code></pre>\n\nafter';
    const parts = splitForTelegram(html, 60);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(isBalancedHtml(part)).toBe(true);
    }
    // The fence content survives once we strip the reopened/closed wrapper tags.
    const recombined = parts.join('').replace(/<\/?(pre|code)[^>]*>/g, '');
    expect(recombined).toContain(body);
  });

  it('never cuts inside an &amp; entity', () => {
    const html = 'a'.repeat(30) + '&amp;' + 'b'.repeat(30);
    for (let limit = 10; limit < html.length; limit++) {
      const parts = splitForTelegram(html, limit);
      for (const part of parts) expect(isBalancedHtml(part)).toBe(true);
    }
  });

  it('stays linear and correct on a large tag-dense diff fence', () => {
    // Worst case for the old O(n^2) prefix re-scan: a long fenced block with no
    // newline-free run. The single-pass boundary index must keep this fast and
    // still produce balanced, reconstructable parts.
    const body = ('x'.repeat(40) + '\n').repeat(2000); // ~82KB, tag-dense via fence
    const html = '<pre><code class="language-diff">' + body + '</code></pre>';
    const start = Date.now();
    const parts = splitForTelegram(html, 4000);
    const elapsed = Date.now() - start;
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4000 + 64); // soft cap + reopen/close margin
      expect(isBalancedHtml(part)).toBe(true);
    }
    // The fence body survives once the reopened/closed wrapper tags are stripped.
    const recombined = parts.join('').replace(/<\/?(pre|code)[^>]*>/g, '');
    expect(recombined).toContain('x'.repeat(40));
    // Generous bound — the old quadratic path blew well past this on 82KB.
    expect(elapsed).toBeLessThan(2000);
  });

  it('reopens a hyphenated <tg-spoiler> across a cut (never emits </tg>)', () => {
    const body = 'b'.repeat(60);
    const html = 'a'.repeat(40) + '<tg-spoiler>' + body + '</tg-spoiler>' + 'c'.repeat(40);
    let cut = false;
    for (let limit = 30; limit < html.length; limit++) {
      const parts = splitForTelegram(html, limit);
      if (parts.length > 1) cut = true;
      for (const part of parts) {
        expect(isBalancedHtml(part)).toBe(true);
        // The buggy path closed the spoiler with the truncated `</tg>`.
        expect(part).not.toContain('</tg>');
      }
      // The spoiler body survives once the wrapper tags are stripped.
      const recombined = parts.join('').replace(/<\/?tg-spoiler>/g, '');
      expect(recombined).toContain(body);
    }
    expect(cut).toBe(true);
  });

  it('closes and reopens a <blockquote expandable> across the cut', () => {
    // No newlines inside, body far over the limit → the box itself must split.
    const html = '<blockquote expandable>' + 'q'.repeat(300) + '</blockquote>';
    const parts = splitForTelegram(html, 100);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(isBalancedHtml(part)).toBe(true);
    // Every continuation head reopens the box WITH its `expandable` attribute.
    for (const tail of parts.slice(1)) {
      expect(tail.startsWith('<blockquote expandable>')).toBe(true);
    }
    const recombined = parts.join('').replace(/<\/?blockquote[^>]*>/g, '');
    expect(recombined).toContain('q'.repeat(300));
  });
});
