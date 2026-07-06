import type { MoxxyEvent } from '@moxxy/sdk';
import {
  assertDefined,
  fileDiffSummary,
  fileDiffVerb,
  isFileDiffDisplay,
  type FileDiffDisplay,
} from '@moxxy/sdk';

const TELEGRAM_MESSAGE_LIMIT = 4000; // 4096 minus a safety margin

/**
 * Minimum activity-block line count before the final frame folds it into an
 * expandable box. Short traces (a call or two) stay inline; busy turns collapse
 * so the answer isn't buried under the tool log.
 */
const COLLAPSE_ACTIVITY_LINES = 4;

export interface RenderedFrame {
  /** Pre-formatted HTML activity block (blockquote of tool calls). */
  readonly activityHtml: string;
  /** Assistant body in original markdown — caller converts to Telegram HTML. */
  readonly body: string;
  /** Pre-formatted HTML error line. */
  readonly errorHtml: string;
  /**
   * Pre-formatted HTML diff block(s) for any file-diff tool results in
   * this turn. Each is a summary line plus a `<pre><code
   * class="language-diff">…</code></pre>` fence; Telegram highlights the
   * `+`/`-` lines for the `diff` language. Empty string when no file was
   * edited. Composed after the body — see `composeFrame`.
   */
  readonly diffHtml: string;
  /** True if any of the above changed since the previous frame. */
  readonly hasUpdate: boolean;
}

/**
 * Accumulates events from a turn into a single string ready for
 * Telegram. Output goes through `markdownToTelegramHtml` in the
 * channel before being sent, so anything we emit here that LOOKS like
 * markdown (`**bold**`, `` `code` ``, list bullets) ends up as proper
 * Telegram-rendered formatting in the chat.
 *
 * Visual structure of a frame:
 *
 *   ┌─ tool / skill activity (header, dim) ─┐
 *   │ • tool_name (args)          ✓ 0.4s    │
 *   │ • another_tool (args)       running…  │
 *   └───────────────────────────────────────┘
 *
 *   <assistant body>
 *
 *   <error if any>
 *
 * Bot rate limits favor edits over many separate sends, so the whole
 * turn collapses into one editable message until it overflows.
 */
type ToolStatus =
  | { kind: 'pending'; startedAt: number }
  | { kind: 'ok'; ms: number }
  | { kind: 'err'; ms: number; message: string }
  | { kind: 'denied'; reason: string };

interface ToolEntry {
  readonly id: string;
  readonly name: string;
  readonly inputPreview: string;
  status: ToolStatus;
}

interface SkillEntry {
  readonly name: string;
  readonly toolCount: number;
}

export class TurnRenderer {
  private chunks: string[] = [];
  /** In-flight + completed tool calls keyed by callId, in arrival order. */
  private tools = new Map<string, ToolEntry>();
  private skillBanner: SkillEntry | null = null;
  private notices: string[] = [];
  private finalAssistant: string | null = null;
  private errorLine: string | null = null;
  /** Pre-formatted HTML diff blocks, one per file-diff tool result, in arrival order. */
  private diffBlocks: string[] = [];
  private lastFrame = '';

  accept(event: MoxxyEvent): RenderedFrame {
    switch (event.type) {
      case 'assistant_chunk':
        this.chunks.push(event.delta);
        break;
      case 'assistant_message':
        this.finalAssistant = event.content;
        this.chunks = [];
        break;
      case 'tool_call_requested': {
        const callId = String(event.callId);
        this.tools.set(callId, {
          id: callId,
          name: event.name,
          inputPreview: previewArgs(event.input),
          status: { kind: 'pending', startedAt: Date.now() },
        });
        break;
      }
      case 'tool_call_denied': {
        const entry = this.tools.get(String(event.callId));
        if (entry) entry.status = { kind: 'denied', reason: event.reason };
        break;
      }
      case 'tool_result': {
        const entry = this.tools.get(String(event.callId));
        if (!entry) break;
        const started =
          entry.status.kind === 'pending' ? entry.status.startedAt : Date.now();
        const ms = Date.now() - started;
        if (event.ok) {
          entry.status = { kind: 'ok', ms };
          // Write/Edit tools return { forModel, display: FileDiffDisplay }.
          // Render the structured diff as a fenced ```diff block so
          // Telegram highlights +/- lines, plus a summary line.
          const display = (event.output as { display?: unknown } | undefined)?.display;
          if (isFileDiffDisplay(display)) {
            this.diffBlocks.push(renderFileDiff(display));
          }
        } else {
          entry.status = {
            kind: 'err',
            ms,
            message: `${event.error?.kind ?? 'error'}: ${event.error?.message ?? ''}`,
          };
        }
        break;
      }
      case 'skill_invoked':
        // skill_invoked fires when a skill scope opens; its tool calls
        // arrive immediately after as tool_call_requested. Show a
        // banner so the user knows the bot is now in a skill scope.
        this.skillBanner = { name: event.name, toolCount: 0 };
        break;
      case 'skill_created':
        this.notices.push(`💡 created skill: <b>${escape(event.name)}</b>`);
        break;
      case 'plugin_event':
        if (event.pluginId === '@moxxy/subagents' && event.subtype === 'subagent_started') {
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          const label = typeof payload.label === 'string' ? payload.label : 'agent';
          this.notices.push(`🤖 spawned agent <b>${escape(label)}</b>`);
        }
        break;
      case 'error':
        this.errorLine = `❗ <b>${escape(event.kind)}</b>: ${escape(event.message)}`;
        break;
      default:
        break;
    }
    const frame = this.snapshot();
    const key = `${frame.activityHtml}\u0000${frame.body}\u0000${frame.diffHtml}\u0000${frame.errorHtml}`;
    const hasUpdate = key !== this.lastFrame;
    this.lastFrame = key;
    return { ...frame, hasUpdate };
  }

  /**
   * Compose the current frame. `collapse` (set on the final flush) folds a
   * long tool-activity trace into an expandable box so the finished message
   * leads with the answer; during streaming it's left false so the activity
   * stays fully visible while work is in flight.
   */
  snapshot(opts: { collapse?: boolean } = {}): RenderedFrame {
    const activityHtml = this.renderActivity(opts.collapse ?? false) ?? '';
    const body = this.finalAssistant ?? this.chunks.join('');
    const diffHtml = this.diffBlocks.join('\n\n');
    const errorHtml = this.errorLine ?? '';
    return { activityHtml, body, diffHtml, errorHtml, hasUpdate: false };
  }

  /**
   * Format the tool/skill activity block. Returns null when there's
   * nothing to show — keeps frames lean for chat-only turns.
   *
   * The block is rendered with HTML tags (`<b>`, `<code>`, `<i>`) so
   * it survives `markdownToTelegramHtml` intact (the function escapes
   * `<` `>` `&` in text segments but leaves existing tags alone via
   * the fence/inline placeholder dance). Use `__inert__` markers so
   * already-formed HTML doesn't get re-escaped.
   *
   * When `collapse` is set (final frame) and the trace ran long, fold it
   * into a `<blockquote expandable>` topped by a one-line summary — the
   * tool noise becomes a tap-to-open box and the assistant's answer leads.
   */
  private renderActivity(collapse: boolean): string | null {
    const lines: string[] = [];
    if (this.skillBanner) {
      lines.push(`💡 <b>${escape(this.skillBanner.name)}</b>`);
    }
    // Show last N tool entries to keep the message compact when a turn
    // makes many calls. Most-recent at the bottom (matches chronology).
    const tools = [...this.tools.values()];
    const visible = tools.slice(-10);
    const hidden = tools.length - visible.length;
    if (hidden > 0) {
      lines.push(`<i>… ${hidden} earlier tool call${hidden === 1 ? '' : 's'} hidden</i>`);
    }
    for (const t of visible) {
      lines.push(`• <code>${escape(t.name)}</code>(${escape(t.inputPreview)}) ${statusBadge(t.status)}`);
    }
    for (const n of this.notices.slice(-5)) lines.push(n);
    if (lines.length === 0) return null;
    if (collapse && lines.length >= COLLAPSE_ACTIVITY_LINES) {
      const summary = activitySummary(tools.length);
      const inner = summary ? `${summary}\n${lines.join('\n')}` : lines.join('\n');
      return `<blockquote expandable>${inner}</blockquote>`;
    }
    return `<blockquote>${lines.join('\n')}</blockquote>`;
  }

  reset(): void {
    this.chunks = [];
    this.tools.clear();
    this.skillBanner = null;
    this.notices = [];
    this.finalAssistant = null;
    this.errorLine = null;
    this.diffBlocks = [];
    this.lastFrame = '';
  }
}

/**
 * One-line summary that heads a collapsed activity box, so the box reads as
 * "🔧 8 steps ▸" before it's opened. Empty when the turn made no tool calls
 * (a skill-only / notice-only trace already names itself in its first line).
 */
function activitySummary(toolCount: number): string {
  if (toolCount <= 0) return '';
  return `🔧 <b>${toolCount} step${toolCount === 1 ? '' : 's'}</b>`;
}

function statusBadge(status: ToolStatus): string {
  // Pair the glyph with a text word ('done'/'error') so the pass/fail
  // distinction survives screen-reader announcement / glyph-stripping —
  // the ✓/✗ alone are read inconsistently (or as verbose emoji names).
  switch (status.kind) {
    case 'pending':
      return '<i>running…</i>';
    case 'ok':
      return `✓ done <i>${fmtElapsed(status.ms)}</i>`;
    case 'err':
      return `✗ error: <i>${escape(status.message).slice(0, 80)}</i>`;
    case 'denied':
      return `✗ <i>denied: ${escape(status.reason).slice(0, 80)}</i>`;
  }
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function escape(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

/**
 * Render one file-diff tool result as a Telegram HTML block: a bold
 * summary line followed by a fenced `diff`-language code block. Telegram
 * highlights `+`/`-` prefixed lines for the `diff` language, which is the
 * closest it can get to red/green backgrounds.
 *
 * The fence body is HTML-escaped exactly like `format.ts` does for
 * ```fenced blocks (only `< > &` matter inside `<pre><code>`), so the
 * diff text survives parse_mode=HTML intact. When `hunks` is empty (a
 * huge diff that got truncated to just counts), we emit only the summary
 * line — no empty code block.
 */
function renderFileDiff(d: FileDiffDisplay): string {
  const header = `<b>${escape(fileDiffVerb(d))} ${escape(d.path)}</b> — ${escape(fileDiffSummary(d))}`;
  const diffText = unifiedDiffText(d);
  if (!diffText) return header;
  return (
    header +
    '\n' +
    `<pre><code class="language-diff">${escape(diffText)}</code></pre>`
  );
}

/**
 * Build a classic unified-diff body from a file-diff display: a
 * `@@ -oldStart,oldLines +newStart,newLines @@` header per hunk, then each
 * line prefixed with ` `/`+`/`-`. Hunks are separated by a blank line.
 * Returns '' when there are no hunks.
 */
function unifiedDiffText(d: FileDiffDisplay): string {
  const blocks: string[] = [];
  for (const hunk of d.hunks) {
    const lines: string[] = [
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    ];
    for (const line of hunk.lines) {
      const marker = line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' ';
      lines.push(`${marker}${line.text}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n');
}

function truncJson(value: unknown, max = 60): string {
  const s = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function previewArgs(input: unknown): string {
  if (input == null || (typeof input === 'object' && Object.keys(input as object).length === 0)) {
    return '';
  }
  if (typeof input === 'string') return truncJson(input);
  try {
    const obj = input as Record<string, unknown>;
    const keys = Object.keys(obj).slice(0, 3);
    const pairs = keys.map((k) => {
      const v = obj[k];
      return `${k}=${truncJson(v, 20)}`;
    });
    const tail = Object.keys(obj).length > keys.length ? ', …' : '';
    return pairs.join(', ') + tail;
  } catch {
    return truncJson(input);
  }
}

/**
 * Telegram block-level tags that can legally wrap a cut: if one is open at the
 * chosen split boundary we close it in the head part and reopen it in the tail
 * so each emitted message is independently valid `parse_mode=HTML`. Inline
 * marks (`<b>`/`<i>`/bare `<code>`/`<a>`) aren't reopenable cleanly here — we
 * simply never cut while any tag is open unless we have to, so they stay intact.
 */
interface OpenTag {
  /** Lowercased tag name, e.g. `pre` / `code` / `blockquote`. */
  readonly name: string;
  /** The exact opening tag text (incl. attributes) to reopen with in the tail. */
  readonly open: string;
}

interface BoundaryInfo {
  stack: OpenTag[];
  /** True when `idx` falls inside a `<...>` tag or `&...;` entity (unsafe to cut). */
  insideTag: boolean;
}

/**
 * Precomputed cut-boundary index for one `html` part. Replaces the old
 * `tagStackAt(html, idx)` which re-scanned from offset 0 on every probe — that
 * made `splitForTelegram` O(n²) per part because it calls it inside a
 * walk-back/walk-forward loop. This scans the part exactly once, recording for
 * every index whether it is inside a `<...>` tag or `&...;` entity and the
 * open-tag stack as of the last completed tag, so `at(idx)` is O(stackDepth).
 */
class TagBoundaryIndex {
  // unsafe[i] === 1 when index i falls inside a tag or entity (unsafe to cut).
  private readonly unsafe: Uint8Array;
  // Checkpoints of the open-tag stack, one per completed tag, ordered by `pos`
  // (the offset just AFTER the tag's `>`). stackAt(idx) = the latest checkpoint
  // whose pos <= idx. The stack only changes at a tag close-bracket, so this is
  // exact between checkpoints.
  private readonly checkPos: number[] = [0];
  private readonly checkStack: OpenTag[][];

  constructor(html: string, seed: OpenTag[]) {
    const n = html.length;
    this.unsafe = new Uint8Array(n);
    const stack: OpenTag[] = seed.slice();
    this.checkStack = [stack.slice()];
    let i = 0;
    while (i < n) {
      const ch = html[i];
      if (ch === '<') {
        const end = html.indexOf('>', i);
        if (end === -1) {
          // Unterminated tag straddling the end — every offset AFTER the `<` is
          // inside it (cutting before the `<`, at i, is still safe). Mark + stop.
          for (let k = i + 1; k < n; k++) this.unsafe[k] = 1;
          break;
        }
        // Offsets strictly inside `<...>` (i.e. i+1..end) are unsafe; the `<`
        // itself at i is a safe boundary (cutting before the tag is fine).
        for (let k = i + 1; k <= end; k++) this.unsafe[k] = 1;
        const raw = html.slice(i, end + 1);
        // Allow a hyphen in the tag name so Telegram's own elements
        // (`<tg-spoiler>`, `<tg-emoji>`) are recognised — otherwise the name
        // would truncate at `tg` and the reopened/closed tag across a split
        // would be the bogus `</tg>`.
        const m = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(raw);
        if (m) {
          const closing = m[1] === '/';
          const name = (m[2] ?? '').toLowerCase();
          if (closing) {
            for (let s = stack.length - 1; s >= 0; s--) {
              const entry = stack[s];
              if (entry?.name === name) {
                stack.splice(s, 1);
                break;
              }
            }
          } else if (!raw.endsWith('/>')) {
            stack.push({ name, open: raw });
          }
        }
        // Checkpoint the new stack at the offset just after the tag.
        this.checkPos.push(end + 1);
        this.checkStack.push(stack.slice());
        i = end + 1;
        continue;
      }
      if (ch === '&') {
        const semi = html.indexOf(';', i);
        if (semi !== -1 && semi - i <= 12 && /^&[a-zA-Z0-9#]+;$/.test(html.slice(i, semi + 1))) {
          // Offsets strictly inside `&...;` (i+1..semi) are unsafe; cutting
          // before the `&` is fine.
          for (let k = i + 1; k <= semi; k++) this.unsafe[k] = 1;
          i = semi + 1;
          continue;
        }
      }
      i += 1;
    }
  }

  /** Boundary info at `idx`: the open-tag stack there + whether it's unsafe. */
  at(idx: number): BoundaryInfo {
    const inside = idx > 0 && idx < this.unsafe.length && this.unsafe[idx] === 1;
    // The stack only changes at completed tags; find the latest checkpoint at or
    // before idx via binary search over the (sorted) checkpoint positions.
    let lo = 0;
    let hi = this.checkPos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const pos = this.checkPos[mid];
      assertDefined(pos, 'binary-search mid is always a valid checkpoint index');
      if (pos <= idx) lo = mid;
      else hi = mid - 1;
    }
    // Returns the checkpoint stack by reference — it is an immutable snapshot;
    // the only consumer that re-roots it (`new TagBoundaryIndex(.., carry)`)
    // copies via `seed.slice()` before mutating, so no probe can corrupt it.
    const checkpointStack = this.checkStack[lo];
    assertDefined(checkpointStack, 'binary-search lo is always a valid checkpoint index');
    return {
      stack: checkpointStack,
      insideTag: inside,
    };
  }
}

/**
 * Split composed Telegram HTML into <=`limit`-char parts that are each
 * independently valid `parse_mode=HTML`. Cuts are chosen so they never land
 * inside a `<...>` tag or an `&...;` entity; if a block-level tag (e.g. a
 * `<pre><code class="language-diff">` fence or a `<blockquote>`) is open at the
 * boundary it is closed in the head part and reopened in the tail. For plain
 * text with no open tags this reduces to the old newline-preferring behaviour
 * and `parts.join('')` reconstructs the input exactly.
 */
export function splitForTelegram(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return text ? [text] : [];
  const out: string[] = [];
  // Tags carried over from the previous part's tail (reopened at its head).
  let carry: OpenTag[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    // The reopened tags from the previous cut eat into this part's budget.
    const carryLen = carry.reduce((n, t) => n + t.open.length, 0);
    const budget = limit - carryLen;
    // Index this part's tag/entity boundaries ONCE; every probe below is then an
    // O(stackDepth) lookup instead of an O(idx) re-scan from offset 0.
    const boundaries = new TagBoundaryIndex(remaining, carry);
    // Closing tags appended to the head also consume budget; reserve a margin
    // and search downward for a boundary that's safe (outside tag/entity).
    let idx = Math.min(budget, remaining.length);
    // Prefer a newline at/under the budget so we cut on a natural boundary.
    const nl = remaining.lastIndexOf('\n', idx);
    if (nl > 0) idx = nl;
    let info = boundaries.at(idx);
    // If the chosen boundary is inside a tag or entity, walk back to a safe one.
    while (info.insideTag && idx > 1) {
      idx -= 1;
      info = boundaries.at(idx);
    }
    // No safe boundary at/below budget (e.g. budget smaller than a single tag):
    // never cut mid-tag — scan FORWARD to the next safe point even if it pushes
    // this part over the soft cap. Validity beats the size margin.
    if (info.insideTag) {
      idx = Math.min(budget, remaining.length);
      while (idx < remaining.length) {
        const probe = boundaries.at(idx);
        if (!probe.insideTag) {
          info = probe;
          break;
        }
        idx += 1;
      }
      if (idx >= remaining.length) info = boundaries.at(remaining.length);
    }
    // Guard against a zero-width cut (would loop forever): fall back to the
    // remaining length so the loop terminates.
    if (idx <= 0) {
      idx = remaining.length;
      info = boundaries.at(idx);
    }
    const closeTags = info.stack
      .slice()
      .reverse()
      .map((t) => `</${t.name}>`)
      .join('');
    const head = carry.map((t) => t.open).join('') + remaining.slice(0, idx) + closeTags;
    out.push(head);
    carry = info.stack;
    remaining = remaining.slice(idx);
  }
  if (remaining) out.push(carry.map((t) => t.open).join('') + remaining);
  return out;
}
