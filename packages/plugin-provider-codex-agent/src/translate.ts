import type { AgentStepEvent, ContentBlock, FileDiffDisplay, QuestionAnswers, QuestionItem, TokenUsage, ToolImage } from '@moxxy/sdk';
import { diffPathIn, fileDiffFromPatch, fileDiffFromText, imageToolOutput, parseUnifiedDiff, stepListOutput, stepStatusOf, type ListedStep } from '@moxxy/sdk';
import { MOXXY_MCP_SERVER } from './constants.js';
import {
  knownItem,
  otherItem,
  type CodexAsyncQuestion,
  type CodexFileChange,
  type CodexItem,
  type CodexOtherItem,
  type CodexTokenUsage,
  type CodexUserInput,
  type CodexUserInputQuestion,
  type CodexWebSearchAction,
} from './protocol.js';

const STILL_RUNNING = 'Still running in the background when Codex ended its turn.';

/** Questions Codex asked in its message `itemId`. */
export interface CodexAskedQuestions {
  readonly itemId: string;
  readonly questions: ReadonlyArray<CodexAsyncQuestion>;
}

/** A tool Codex runs itself, as Moxxy names it (`Bash` so Moxxy's shell rules and formatting apply). */
export interface CodexToolCall {
  readonly name: string;
  readonly input: unknown;
}

/**
 * Codex's notifications for one Moxxy turn, as Moxxy agent events. Calls to
 * Moxxy's own tools are left out: Moxxy records those when it runs them.
 */
export class TurnTranslator {
  private readonly announced = new Set<string>();
  private readonly calls = new Map<string, CodexToolCall>();
  /** Items that started and have not ended yet. */
  private readonly running = new Map<string, CodexToolCall>();
  /** Plan updates shown this turn; each is a call of its own. */
  private plans = 0;
  /** Questions Codex just asked in a message, until the session takes them. */
  private asked: CodexAskedQuestions | undefined;
  /** The item Codex is on: the last one it started or finished. */
  private latestItem: string | undefined;
  /** Codex's last message so far. */
  private latestMessage: string | undefined;

  /**
   * `cwd`: the project folder, which the paths of file diffs are shown relative to.
   * `readImage`: the picture at a path, for an image Codex viewed (it names only the file).
   */
  constructor(
    private readonly cwd = '',
    private readonly readImage: (path: string) => ToolImage | undefined = () => undefined,
  ) {}

  /** Show a call before Moxxy decides on it, unless it is already shown. */
  announce(callId: string, call: CodexToolCall): AgentStepEvent[] {
    if (this.announced.has(callId)) return [];
    this.announced.add(callId);
    this.calls.set(callId, call);
    return [{ type: 'tool_call', callId, name: call.name, input: call.input }];
  }

  /**
   * What Codex left running as its turn ended (a command in the background):
   * shown as still running, and handed back so its end can be shown when it comes.
   */
  leftRunning(): { readonly events: AgentStepEvent[]; readonly calls: ReadonlyMap<string, CodexToolCall> } {
    const calls = new Map(this.running);
    this.running.clear();
    const events = [...calls.keys()].map((callId): AgentStepEvent => ({ type: 'tool_result', callId, ok: true, output: STILL_RUNNING }));
    return { events, calls };
  }

  /** The questions Codex just asked in a message (`delivery: 'async'`), handed out once. */
  takeQuestions(): CodexAskedQuestions | undefined {
    const asked = this.asked;
    this.asked = undefined;
    return asked;
  }

  /** Codex started or finished another item since `itemId`: it works on without waiting. */
  movedOnFrom(itemId: string): boolean {
    return this.latestItem !== undefined && this.latestItem !== itemId;
  }

  /** Message `itemId` is the last thing Codex said. */
  lastSaid(itemId: string): boolean {
    return this.latestMessage === itemId;
  }

  /** The call shown for an item, for an approval that names only the item. */
  callOf(callId: string): CodexToolCall | undefined {
    return this.calls.get(callId);
  }

  translate(method: string, params: unknown): AgentStepEvent[] {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'item/agentMessage/delta':
        return typeof p.delta === 'string' && p.delta ? [{ type: 'text_delta', delta: p.delta }] : [];
      case 'item/reasoning/summaryTextDelta':
        return typeof p.delta === 'string' && p.delta ? [{ type: 'reasoning_delta', delta: p.delta }] : [];
      case 'item/started': {
        this.noteItem(p.item);
        const other = otherItem(p.item);
        const item = knownItem(p.item);
        // A search is shown once it ends: Codex knows its query only then.
        const call = other ? { name: other.type, input: other.fields } : item && item.type !== 'webSearch' ? toolCallOf(item) : undefined;
        const id = other?.id ?? item?.id;
        if (!call || id === undefined) return [];
        this.running.set(id, call);
        return this.announce(id, call);
      }
      case 'item/completed': {
        this.noteItem(p.item);
        const ended = (p.item as { id?: unknown } | undefined)?.id;
        if (typeof ended === 'string') this.running.delete(ended);
        const other = otherItem(p.item);
        if (other) return this.otherCompleted(other);
        const item = knownItem(p.item);
        return item ? this.completed(item) : [];
      }
      case 'turn/plan/updated':
        return this.planUpdated(p);
      case 'thread/tokenUsage/updated': {
        const last = (p.tokenUsage as { last?: CodexTokenUsage } | undefined)?.last;
        return last ? [{ type: 'usage', usage: toTokenUsage(last) }] : [];
      }
      default:
        return [];
    }
  }

  private noteItem(item: unknown): void {
    const id = (item as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string') this.latestItem = id;
  }

  /**
   * Codex's checklist (its `update_plan` tool) as it stands after a change.
   * Codex reports it as a notification, not an item, so it is shown as a call
   * of its own; the plan of plan mode is a `plan` item instead.
   */
  private planUpdated(p: Record<string, unknown>): AgentStepEvent[] {
    if (!Array.isArray(p.plan)) return [];
    const steps = p.plan.flatMap((item: unknown): ListedStep[] => {
      const step = (item ?? {}) as { step?: unknown; status?: unknown };
      const status = stepStatusOf(step.status);
      return typeof step.step === 'string' && step.step.trim() && status ? [{ text: step.step.trim(), status }] : [];
    });
    const explanation = typeof p.explanation === 'string' && p.explanation.trim() ? p.explanation.trim() : undefined;
    this.plans += 1;
    const callId = `plan-${String(p.turnId ?? 'turn')}-${this.plans}`;
    const forModel = steps.map((step) => `${step.status === 'completed' ? '[x]' : '[ ]'} ${step.text}`).join('\n');
    return [
      ...this.announce(callId, { name: 'update_plan', input: { plan: p.plan, ...(explanation ? { explanation } : {}) } }),
      { type: 'tool_result', callId, ok: true, output: stepListOutput(forModel, steps, explanation) },
    ];
  }

  /**
   * An item of a kind Moxxy does not know (one a newer Codex added), shown as
   * a call named after it: what Codex said as it started, and what it added by the end.
   */
  private otherCompleted(item: CodexOtherItem): AgentStepEvent[] {
    const announced = this.announce(item.id, { name: item.type, input: item.fields });
    const before = (this.calls.get(item.id)?.input ?? {}) as Record<string, unknown>;
    const added = Object.fromEntries(Object.entries(item.fields).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)));
    const failed = item.status !== undefined && /fail|declin|error/i.test(item.status);
    const result: AgentStepEvent = failed
      ? { type: 'tool_result', callId: item.id, ok: false, error: `Codex reports ${item.type} as ${item.status}.` }
      : { type: 'tool_result', callId: item.id, ok: true, output: Object.keys(added).length > 0 ? added : '' };
    return [...announced, result];
  }

  private completed(item: CodexItem): AgentStepEvent[] {
    switch (item.type) {
      case 'agentMessage':
        this.latestMessage = item.id;
        if (item.delivery === 'async' && item.questions && item.questions.length > 0) this.asked = { itemId: item.id, questions: item.questions };
        return item.text ? [{ type: 'message', text: item.text, stopReason: item.phase === 'commentary' ? 'tool_use' : 'end_turn' }] : [];
      case 'plan':
        return [{ type: 'plan', text: item.text }];
      case 'reasoning': {
        const text = item.summary.join('\n\n').trim();
        return text ? [{ type: 'reasoning', text }] : [];
      }
      default: {
        const call = toolCallOf(item);
        if (!call) return [];
        return [...this.announce(item.id, call), { type: 'tool_result', callId: item.id, ...toolResultOf(item, this.cwd, this.readImage) }];
      }
    }
  }
}

export function toolCallOf(item: CodexItem): CodexToolCall | undefined {
  switch (item.type) {
    case 'commandExecution':
      return { name: 'Bash', input: { command: shownCommand(item.command), cwd: item.cwd } };
    case 'fileChange':
      return { name: 'apply_patch', input: { changes: item.changes.map((change) => ({ path: change.path, kind: change.kind.type })) } };
    case 'mcpToolCall':
      return item.server === MOXXY_MCP_SERVER ? undefined : { name: `mcp__${item.server}__${item.tool}`, input: item.arguments };
    case 'webSearch':
      return { name: 'web_search', input: webSearchInput(item.query, item.action) };
    case 'imageView':
      return { name: 'view_image', input: { path: item.path } };
    case 'sleep':
      return { name: 'Sleep', input: { ms: item.durationMs } };
    case 'imageGeneration':
      return { name: 'image_generation', input: item.revisedPrompt ? { prompt: item.revisedPrompt } : {} };
    default:
      return undefined;
  }
}

function toolResultOf(item: CodexItem, cwd: string, readImage: (path: string) => ToolImage | undefined): { readonly ok: boolean; readonly output?: unknown; readonly error?: string } {
  const status = 'status' in item ? item.status : 'completed';
  if (status === 'declined') return { ok: false, error: 'The person declined this.' };
  switch (item.type) {
    case 'commandExecution': {
      const output = item.aggregatedOutput ?? '';
      const ok = status === 'completed' && (item.exitCode === null || item.exitCode === 0);
      return ok ? { ok, output } : { ok, error: output || `The command ended with exit code ${item.exitCode ?? 'unknown'}.` };
    }
    case 'fileChange': {
      if (status !== 'completed') return { ok: false, error: 'The change was not applied.' };
      const text = item.changes.map((change) => change.diff ?? `${change.kind.type} ${change.path}`).join('\n');
      const display = item.changes.length === 1 && item.changes[0] ? fileDiffOf(item.changes[0], cwd) : undefined;
      return { ok: true, output: display ? { forModel: text, display } : text };
    }
    case 'mcpToolCall': {
      if (item.error) return { ok: false, error: item.error.message };
      const shown = mcpImagesOf(item.result);
      return { ok: status !== 'failed', output: shown ? imageToolOutput(shown.text, shown.images) : item.result };
    }
    case 'imageView': {
      const image = readImage(item.path);
      return { ok: true, output: image ? imageToolOutput(item.path, [image]) : '' };
    }
    case 'sleep':
      return { ok: true, output: `Waited ${Math.round(item.durationMs / 1000)} s.` };
    case 'imageGeneration': {
      if (item.failure || status === 'failed') {
        return { ok: false, error: item.failure?.type === 'usageLimitExceeded' ? 'Codex has used up its limit for pictures.' : 'Codex could not make the picture.' };
      }
      const saved = item.savedPath ? readImage(item.savedPath) : undefined;
      const image = saved ?? (item.result ? { mediaType: 'image/png', base64: item.result } : undefined);
      const text = item.savedPath ? `Saved to ${item.savedPath}` : 'The picture Codex made.';
      return { ok: true, output: image ? imageToolOutput(text, [image]) : text };
    }
    default:
      return { ok: true, output: '' };
  }
}

/** The images of an MCP result, in order, and its text; Codex's computer use sends each screenshot twice. */
function mcpImagesOf(result: unknown): { readonly images: ToolImage[]; readonly text: string } | undefined {
  const content = (result as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  const parts = content as ReadonlyArray<{ type?: unknown; text?: unknown; data?: unknown; mimeType?: unknown }>;
  const images = parts.flatMap((part) =>
    part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string' ? [{ mediaType: part.mimeType, base64: part.data }] : [],
  );
  if (images.length === 0) return undefined;
  const text = parts.flatMap((part) => (part.type === 'text' && typeof part.text === 'string' ? [part.text] : [])).join('\n');
  return { images, text };
}

/** A new or changed file as a diff: Codex sends a new file's content, and a change as a unified diff. */
function fileDiffOf(change: CodexFileChange, cwd: string): FileDiffDisplay | undefined {
  if (change.diff === undefined) return undefined;
  if (change.kind.type === 'add') return fileDiffFromText({ path: diffPathIn(cwd, change.path), mode: 'create', before: '', after: change.diff });
  if (change.kind.type !== 'update') return undefined;
  const hunks = parseUnifiedDiff(change.diff);
  const path = diffPathIn(cwd, change.kind.move_path ?? change.path);
  return hunks.length > 0 ? fileDiffFromPatch({ path, mode: 'update', hunks }) : undefined;
}

function webSearchInput(query: string, action: CodexWebSearchAction | null | undefined): Record<string, string> {
  if (action?.type === 'open_page' && action.url) return { url: action.url };
  if (action?.type === 'find_in_page' && action.url) return { url: action.url, ...(action.pattern ? { pattern: action.pattern } : {}) };
  const searched = action?.type === 'search' ? action.query || action.queries?.join(' · ') : undefined;
  return { query: query || searched || '' };
}

/** The command as the person would type it: Codex wraps it in `<shell> -lc '…'`. */
export function shownCommand(command: string): string {
  const wrapped = /^\S*\b(?:ba|z)?sh -l?c '((?:[^']|'\\'')*)'$/s.exec(command);
  return wrapped?.[1] !== undefined ? wrapped[1].replace(/'\\''/g, "'") : command;
}

/** Codex counts cached prompt tokens inside `inputTokens`; Moxxy keeps them apart. */
export function toTokenUsage(usage: CodexTokenUsage): TokenUsage {
  const cached = usage.cachedInputTokens;
  return {
    inputTokens: Math.max(0, usage.inputTokens - cached),
    outputTokens: usage.outputTokens,
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
  };
}

/** The person's message as Codex input: text as it is, images inline. */
export function toCodexInput(prompt: ReadonlyArray<ContentBlock>): CodexUserInput[] {
  return prompt.flatMap((block): CodexUserInput[] => {
    if (block.type === 'text') return [{ type: 'text', text: block.text, text_elements: [] }];
    if (block.type === 'image') return [{ type: 'image', url: `data:${block.mediaType};base64,${block.data}` }];
    return [];
  });
}

export function promptText(prompt: ReadonlyArray<ContentBlock>): string {
  return prompt.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

/** Codex plan-mode questions as Moxxy Questions. Codex takes any text back, so an own answer always fits. */
export function fromAsyncQuestions(questions: ReadonlyArray<CodexAsyncQuestion>): QuestionItem[] {
  return questions.map((q, i) => ({
    id: `q${i}`,
    question: q.title,
    options: (q.options ?? []).map((label, j) => ({ id: `q${i}o${j}`, label })),
    multiSelect: false,
    allowOther: true,
  }));
}

/** The answers as the next message Codex reads: one `question: answer` line each. */
export function answersMessage(items: ReadonlyArray<QuestionItem>, answers: QuestionAnswers): string {
  return items
    .map((item) => `${item.question}: ${chosenLabels(item, answers).join(', ')}`)
    .join('\n');
}

/** `item/tool/requestUserInput` questions as Moxxy Questions. */
export function fromUserInputQuestions(questions: ReadonlyArray<CodexUserInputQuestion>): QuestionItem[] {
  return questions.map((q) => ({
    id: q.id,
    ...(q.header ? { header: q.header } : {}),
    question: q.question,
    options: (q.options ?? []).map((option, j) => ({ id: `${q.id}o${j}`, label: option.label, ...(option.description ? { description: option.description } : {}) })),
    multiSelect: false,
    allowOther: q.isOther || (q.options ?? []).length === 0,
  }));
}

export function toUserInputAnswers(items: ReadonlyArray<QuestionItem>, answers: QuestionAnswers): Record<string, { answers: string[] }> {
  const out: Record<string, { answers: string[] }> = {};
  for (const item of items) out[item.id] = { answers: chosenLabels(item, answers) };
  return out;
}

function chosenLabels(item: QuestionItem, answers: QuestionAnswers): string[] {
  const answer = answers[item.id];
  if (!answer) return [];
  const labels = item.options.filter((option) => answer.selected.includes(option.id)).map((option) => option.label);
  if (answer.other) labels.push(answer.other);
  return labels;
}
