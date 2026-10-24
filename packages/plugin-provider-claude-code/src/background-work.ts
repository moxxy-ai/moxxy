import { open } from 'node:fs/promises';
import { AGENT_WORK_OUTPUT_LIMIT, type AgentBackgroundWork, type AgentStepEvent, type AgentWorkEnd } from '@moxxy/sdk';

/** Claude's `task_type` of a helper agent; every other task runs a command (a shell, a monitor, a workflow). */
const AGENT_TASK = 'local_agent';

interface Task {
  type?: string;
  description?: string;
  /** The call that started it; a helper's work id, as its `subagent_*` events carry it. */
  toolUseId?: string;
}

interface Note {
  readonly subtype?: unknown;
  readonly task_id?: unknown;
  readonly tool_use_id?: unknown;
  readonly task_type?: unknown;
  readonly description?: unknown;
  readonly tasks?: unknown;
  readonly status?: unknown;
  readonly summary?: unknown;
  readonly output_file?: unknown;
}

/**
 * What Claude runs in the background, as Moxxy's background work: its
 * `background_tasks_changed` list (the whole list each time, so a missed end
 * cannot leave work shown running), and how each command it ran there ended.
 */
export class ClaudeBackgroundWork {
  private readonly tasks = new Map<string, Task>();
  /** Ids of the tasks in Claude's last list. */
  private live: ReadonlyArray<string> = [];
  private shown: ReadonlyArray<AgentBackgroundWork> = [];
  /** Tasks that ran in the background at some point: only their end is background work ending. */
  private readonly wentBackground = new Set<string>();
  private readonly ended = new Set<string>();

  /** A `task_started` or `background_tasks_changed`: the list again when what it shows changed. */
  fromNote(note: Note): AgentStepEvent[] {
    if (note.subtype === 'task_started' && typeof note.task_id === 'string') {
      this.task(note.task_id, {
        ...(typeof note.task_type === 'string' ? { type: note.task_type } : {}),
        ...(typeof note.description === 'string' ? { description: note.description } : {}),
        ...(typeof note.tool_use_id === 'string' ? { toolUseId: note.tool_use_id } : {}),
      });
      return this.listed();
    }
    if (note.subtype !== 'background_tasks_changed' || !Array.isArray(note.tasks)) return [];
    const live: string[] = [];
    for (const entry of note.tasks as ReadonlyArray<Record<string, unknown>>) {
      // Housekeeping Claude runs for itself is not work of the person's conversation.
      if (typeof entry.task_id !== 'string' || entry.ambient === true) continue;
      this.task(entry.task_id, {
        ...(typeof entry.task_type === 'string' ? { type: entry.task_type } : {}),
        ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
      });
      this.wentBackground.add(entry.task_id);
      live.push(entry.task_id);
    }
    this.live = live;
    return this.listed();
  }

  /** A `task_notification`: how a command Claude ran in the background ended, with the end of its output. A helper's end is its `subagent_completed`. */
  async end(note: Note, read: (file: string) => Promise<string> = readOutputEnd): Promise<AgentStepEvent[]> {
    if (note.subtype !== 'task_notification' || typeof note.task_id !== 'string') return [];
    const id = note.task_id;
    const task = this.tasks.get(id);
    if (!task || task.type === AGENT_TASK || !this.wentBackground.has(id) || this.ended.has(id)) return [];
    this.ended.add(id);
    const output = typeof note.output_file === 'string' && note.output_file ? await read(note.output_file).catch(() => '') : '';
    const summary = typeof note.summary === 'string' ? note.summary : '';
    return [
      {
        type: 'background_work_ended',
        id,
        kind: 'command',
        label: task.description ?? (summary || 'Background command'),
        status: endOf(note.status),
        ...(summary ? { summary } : {}),
        ...(output ? { output } : {}),
      },
    ];
  }

  /** The id Moxxy knows a task by: a helper's call id, else the task's own. */
  workIdOf(taskId: string, toolUseId?: string): string {
    const task = this.tasks.get(taskId);
    if (task?.type === AGENT_TASK) return task.toolUseId ?? toolUseId ?? taskId;
    return taskId;
  }

  /** The Claude task running the work, if Claude runs it now. */
  taskOf(workId: string): string | undefined {
    return this.live.find((taskId) => this.workIdOf(taskId) === workId);
  }

  /** Claude is gone: nothing it ran goes on. */
  stopped(): AgentStepEvent[] {
    this.live = [];
    return this.listed();
  }

  private task(id: string, fields: Task): void {
    this.tasks.set(id, { ...this.tasks.get(id), ...fields });
  }

  private listed(): AgentStepEvent[] {
    // Claude lists a helper before its `task_started` says which call started it,
    // and that call is the helper's id everywhere else: it is listed once that is known.
    const known = this.live.filter((taskId) => {
      const task = this.tasks.get(taskId);
      return task?.type !== AGENT_TASK || task.toolUseId !== undefined;
    });
    const work = known.map((taskId): AgentBackgroundWork => {
      const task = this.tasks.get(taskId);
      const kind = task?.type === AGENT_TASK ? 'agent' : 'command';
      return { id: this.workIdOf(taskId), kind, label: task?.description ?? (kind === 'agent' ? 'Helper' : 'Background command') };
    });
    if (sameWork(work, this.shown)) return [];
    this.shown = work;
    return [{ type: 'background_work', work }];
  }
}

function endOf(status: unknown): AgentWorkEnd {
  return status === 'completed' || status === 'failed' ? status : 'stopped';
}

function sameWork(a: ReadonlyArray<AgentBackgroundWork>, b: ReadonlyArray<AgentBackgroundWork>): boolean {
  return a.length === b.length && a.every((work, i) => work.id === b[i]?.id && work.kind === b[i]?.kind && work.label === b[i]?.label);
}

/** The end of a task's output file, its colour codes taken out: what a command printed last says how it went. */
export async function readOutputEnd(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, AGENT_WORK_OUTPUT_LIMIT);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return withoutEscapes(buffer.toString('utf8'));
  } finally {
    await handle.close();
  }
}

function withoutEscapes(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) !== 0x1b || text[i + 1] !== '[') {
      out += text[i];
      continue;
    }
    // A CSI sequence: ESC [ parameters, ending at the first character in @–~.
    let j = i + 2;
    while (j < text.length && !(text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e)) j += 1;
    i = j;
  }
  return out;
}
