import {
  assertDefined,
  fileDiffSummary,
  fileDiffVerb,
  isFileDiffDisplay,
  type FileDiffDisplay,
  type MoxxyEvent,
  type StepListDisplay,
  type ToolImage,
} from '@moxxy/sdk';
import {
  STEP_MARKS,
  TurnAgentWork,
  agentComputerText,
  imagesLine,
  stepListHeading,
  unifiedDiffText,
  usedUpLimitText,
} from '@moxxy/channel-kit';

/**
 * Discord messages cap at 2000 chars; leave margin for the fence-reopen text a
 * split may prepend to a tail part.
 */
export const DISCORD_MESSAGE_LIMIT = 1_900;

/**
 * Accumulates one turn's events into a single Discord-markdown string (the
 * frame the pump sends/edits). Discord renders standard markdown natively
 * (bold, `code`, ``` fences, > quotes), so — unlike Telegram — no HTML
 * conversion pass is needed; the assistant body passes through as-is with a
 * compact tool-activity quote block above it.
 *
 * Structure of a frame:
 *
 *   > 🖥 **Codex is using your computer · Arc** — send /cancel to stop
 *   > 📋 **Steps · 1 of 3 done**
 *   > ✓ first step …
 *   > -  `tool_name` (args) — done 0.4s
 *   > -  `another_tool` (args) — running…
 *
 *   <assistant body>
 *
 *   **Update src/app.ts** — Added 1 line, removed 1 line
 *   ```diff …```
 *
 *   <error if any>
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

export interface DiscordTurnRendererOptions {
  /** The name of the agent of the session's active agent connection ("Codex"), read when a frame is drawn. */
  readonly agentName?: () => string | undefined;
}

export class DiscordTurnRenderer {
  private chunks: string[] = [];
  private finalAssistant: string | null = null;
  private readonly tools = new Map<string, ToolEntry>();
  private notices: string[] = [];
  /** One summary line + diff fence per file-diff tool result, in arrival order. */
  private diffBlocks: string[] = [];
  private errorLine: string | null = null;
  /** The step list, images and computer use of the turn, as every channel reads them. */
  private readonly work = new TurnAgentWork();
  private readonly agentName: () => string | undefined;
  private lastFrame = '';

  constructor(opts: DiscordTurnRendererOptions = {}) {
    this.agentName = opts.agentName ?? (() => undefined);
  }

  /** Returns true when the event changed the frame (schedule an edit). */
  accept(event: MoxxyEvent): boolean {
    this.work.accept(event);
    switch (event.type) {
      case 'assistant_chunk':
        this.chunks.push(event.delta);
        break;
      case 'assistant_message':
        this.finalAssistant = event.content;
        this.chunks = [];
        break;
      case 'tool_call_requested':
        this.tools.set(String(event.callId), {
          id: String(event.callId),
          name: event.name,
          inputPreview: previewArgs(event.input),
          status: { kind: 'pending', startedAt: Date.now() },
        });
        break;
      case 'tool_call_denied': {
        const entry = this.tools.get(String(event.callId));
        if (entry) entry.status = { kind: 'denied', reason: event.reason };
        break;
      }
      case 'tool_result': {
        const entry = this.tools.get(String(event.callId));
        if (!entry) break;
        const started = entry.status.kind === 'pending' ? entry.status.startedAt : Date.now();
        const ms = Date.now() - started;
        entry.status = event.ok
          ? { kind: 'ok', ms }
          : {
              kind: 'err',
              ms,
              message: `${event.error?.kind ?? 'error'}: ${event.error?.message ?? ''}`,
            };
        const display = (event.output as { display?: unknown } | undefined)?.display;
        if (event.ok && isFileDiffDisplay(display)) this.diffBlocks.push(renderFileDiff(display));
        break;
      }
      case 'skill_invoked':
        this.notices.push(`💡 skill: **${event.name}**`);
        break;
      case 'plugin_event': {
        if (event.pluginId === '@moxxy/subagents' && event.subtype === 'subagent_started') {
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          const label = typeof payload.label === 'string' ? payload.label : 'agent';
          this.notices.push(`🤖 spawned agent **${label}**`);
        }
        // The agent's used-up account limit ends the turn in place of an error.
        const limit = usedUpLimitText(event);
        if (limit) this.errorLine = `⛔ **${limit}**`;
        break;
      }
      case 'error':
        this.errorLine = `❗ **${event.kind}**: ${event.message}`;
        break;
      default:
        break;
    }
    const frame = this.snapshot();
    const changed = frame !== this.lastFrame;
    this.lastFrame = frame;
    return changed;
  }

  /**
   * The frame as it stands. `final` (the last flush, once the turn is over)
   * drops what is only true while the turn runs: the agent using the computer.
   */
  snapshot(opts: { final?: boolean } = {}): string {
    const parts: string[] = [];
    const activity = this.renderActivity(opts.final ?? false);
    if (activity) parts.push(activity);
    const body = this.finalText();
    if (body) parts.push(body);
    parts.push(...this.diffBlocks);
    if (this.errorLine) parts.push(this.errorLine);
    return parts.join('\n\n').trim();
  }

  /** The assistant body alone (no activity/error block) — the text a voice
   *  reply speaks. Empty for a tool-only turn. */
  finalText(): string {
    return (this.finalAssistant ?? this.chunks.join('')).trim();
  }

  /** The images tools returned this turn, each once, for the channel to send after the reply. */
  images(): ReadonlyArray<ToolImage> {
    return this.work.images;
  }

  reset(): void {
    this.work.reset();
    this.chunks = [];
    this.finalAssistant = null;
    this.tools.clear();
    this.notices = [];
    this.diffBlocks = [];
    this.errorLine = null;
    this.lastFrame = '';
  }

  private renderActivity(final: boolean): string | null {
    const lines: string[] = [];
    const computer = this.work.computerUse;
    if (computer && !final) {
      lines.push(`🖥 **${agentComputerText(computer, this.agentName())}** — send /cancel to stop`);
    }
    const steps = this.work.stepList;
    if (steps) lines.push(...stepListLines(steps));
    // A call that changed the list of steps shows in the list, not as a tool line.
    const tools = [...this.tools.values()].filter((t) => !this.work.isStepListCall(t.id));
    const visible = tools.slice(-10);
    const hidden = tools.length - visible.length;
    if (hidden > 0) lines.push(`… ${hidden} earlier tool call${hidden === 1 ? '' : 's'} hidden`);
    for (const t of visible) {
      const args = t.inputPreview ? ` (${t.inputPreview})` : '';
      lines.push(`- \`${t.name}\`${args} — ${statusBadge(t.status)}`);
    }
    const images = this.work.images.length;
    if (images > 0) lines.push(`🖼 ${imagesLine(images)}`);
    for (const n of this.notices.slice(-5)) lines.push(n);
    if (lines.length === 0) return null;
    return lines.map((l) => `> ${l}`).join('\n');
  }
}

/** An agent's list of steps: its heading, an optional reason it changed, then one marked line per step. */
function stepListLines(list: StepListDisplay): string[] {
  const lines = [`📋 **${stepListHeading(list)}**`];
  if (list.explanation) lines.push(`*${list.explanation}*`);
  for (const step of list.steps) {
    const shown = step.status === 'in_progress' ? `**${step.text}**` : step.status === 'cancelled' ? `~~${step.text}~~` : step.text;
    lines.push(`${STEP_MARKS[step.status]} ${shown}`);
  }
  return lines;
}

/**
 * One file-diff tool result: a bold summary line, then the change as a
 * ```diff fence (Discord colours its `+`/`-` lines). A diff cut down to its
 * counts (no hunks) shows the summary line alone.
 */
function renderFileDiff(d: FileDiffDisplay): string {
  const header = `**${fileDiffVerb(d)} ${d.path}** — ${fileDiffSummary(d)}`;
  const diffText = unifiedDiffText(d);
  return diffText ? `${header}\n\`\`\`diff\n${diffText}\n\`\`\`` : header;
}

function statusBadge(status: ToolStatus): string {
  switch (status.kind) {
    case 'pending':
      return 'running…';
    case 'ok':
      return `done ${fmtElapsed(status.ms)}`;
    case 'err':
      return `error: ${status.message.slice(0, 80)}`;
    case 'denied':
      return `denied: ${status.reason.slice(0, 80)}`;
  }
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function truncJson(value: unknown, max = 60): string {
  const s = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
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
    const pairs = keys.map((k) => `${k}=${truncJson(obj[k], 20)}`);
    const tail = Object.keys(obj).length > keys.length ? ', …' : '';
    return pairs.join(', ') + tail;
  } catch {
    return truncJson(input);
  }
}

/**
 * Split Discord markdown into <=`limit`-char parts that each render sanely on
 * their own (mirrors `splitForTelegram`'s shape, adapted from HTML tags to the
 * one markdown construct that breaks when cut: a ``` code fence). Cuts prefer
 * a newline at/under the budget; if the cut lands inside an open fence, the
 * fence is closed at the head part's end and reopened (with its original
 * info-string, e.g. ```diff) at the tail's start, so every part is
 * independently valid. Parts are separate Discord messages, so the newline a
 * cut lands on is consumed (not carried into the tail).
 */
export function splitForDiscord(text: string, limit: number = DISCORD_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return text ? [text] : [];
  const out: string[] = [];
  /** The fence opener carried over from the previous part (reopened at its head). */
  let carryFence: string | null = null;
  let remaining = text;
  while (remaining.length > limit) {
    const prefix = carryFence ? carryFence + '\n' : '';
    // The reopened fence + a possible closing fence eat into the budget.
    const budget = Math.max(1, limit - prefix.length - '\n```'.length);
    let idx = Math.min(budget, remaining.length);
    const nl = remaining.lastIndexOf('\n', idx);
    if (nl > 0) idx = nl;
    const openFence = openFenceAt(remaining, idx, carryFence);
    const head = prefix + remaining.slice(0, idx) + (openFence ? '\n```' : '');
    out.push(head);
    carryFence = openFence;
    remaining = remaining.slice(idx);
    // Drop the leading newline the cut left behind (it was consumed by the cut
    // point, and the reopened fence supplies its own).
    if (remaining.startsWith('\n')) remaining = remaining.slice(1);
  }
  if (remaining) out.push((carryFence ? carryFence + '\n' : '') + remaining);
  return out;
}

/**
 * Is a ``` fence open at `idx`? Returns the fence's opening line (e.g.
 * "```diff") when open, else null. `seed` is the fence carried into this part
 * from the previous split (the text below it starts inside that fence).
 */
function openFenceAt(text: string, idx: number, seed: string | null): string | null {
  let open: string | null = seed;
  const scan = text.slice(0, idx);
  const fenceRe = /(?:^|\n)(```[^\n]*)/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(scan)) !== null) {
    const fence = m[1];
    assertDefined(fence, 'fenceRe has a mandatory capture group when it matches');
    open = open === null ? fence : null;
  }
  return open;
}
