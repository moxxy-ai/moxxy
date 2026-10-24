import { stepStatusOf, stepsFromTodos, type ListedStep } from '@moxxy/sdk';

/** Claude's tools that change its list of steps. `TodoWrite` is the older one, written whole each time. */
export const CLAUDE_STEP_TOOLS: ReadonlySet<string> = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList']);

/**
 * Claude's task list for one of its sessions. Claude Code 2.1 keeps it with
 * TaskCreate, TaskUpdate and TaskList, one task at a time, and the list lives
 * on across turns, so it is kept here as the calls finish. Ids come from
 * Claude (TaskCreate reports its new task's id).
 */
export class ClaudeTaskList {
  private readonly tasks = new Map<string, ListedStep>();

  /**
   * The whole list after a call that finished, or undefined when the call is
   * not one of the step tools or says nothing Moxxy can follow (a task it never
   * saw created, from before Moxxy started this Claude).
   */
  apply(name: string, input: unknown, result: unknown): ListedStep[] | undefined {
    if (name === 'TodoWrite') return stepsFromTodos(field(input, 'todos'));
    if (name === 'TaskList') return this.replace(field(result, 'tasks'));
    if (name === 'TaskCreate') {
      const created = field(result, 'task');
      const id = text(created, 'id');
      const subject = text(created, 'subject') ?? text(input, 'subject');
      if (id === undefined || subject === undefined) return undefined;
      this.tasks.set(id, { text: subject, status: 'pending' });
      return this.list();
    }
    if (name !== 'TaskUpdate' || field(result, 'success') === false) return undefined;
    const id = text(input, 'taskId') ?? text(result, 'taskId');
    const task = id === undefined ? undefined : this.tasks.get(id);
    if (id === undefined || task === undefined) return undefined;
    const status = field(input, 'status');
    if (status === 'deleted') this.tasks.delete(id);
    else this.tasks.set(id, { text: text(input, 'subject') ?? task.text, status: stepStatusOf(status) ?? task.status });
    return this.list();
  }

  private replace(listed: unknown): ListedStep[] | undefined {
    if (!Array.isArray(listed)) return undefined;
    this.tasks.clear();
    for (const task of listed) {
      const id = text(task, 'id');
      const subject = text(task, 'subject');
      const status = stepStatusOf(field(task, 'status'));
      if (id !== undefined && subject !== undefined && status !== undefined) this.tasks.set(id, { text: subject, status });
    }
    return this.list();
  }

  private list(): ListedStep[] {
    return [...this.tasks.values()];
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

function text(value: unknown, key: string): string | undefined {
  const found = field(value, key);
  return typeof found === 'string' && found.trim() ? found.trim() : undefined;
}
