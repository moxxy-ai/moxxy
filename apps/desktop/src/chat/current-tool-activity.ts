import { oneLine, truncate } from '@moxxy/chat-model';

function textField(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return '';
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** A compact caption for work in progress. The disclosure holds the full input. */
export function currentToolActivity(name: string, input: unknown): string {
  const field = (key: string) => textField(input, key);
  const title = field('title');
  if (title) return truncate(oneLine(title), 80);

  const tool = name.toLowerCase();
  if (tool === 'read' || tool === 'write' || tool === 'edit') {
    const path = field('file_path') || field('path') || field('filePath');
    const file = path.split(/[\\/]/).pop() || 'a file';
    const verb = { read: 'Reading', write: 'Writing', edit: 'Editing' }[tool];
    return `${verb} ${truncate(oneLine(file), 80)}`;
  }
  if (tool === 'bash' || tool === 'exec_command') {
    const description = field('description');
    if (description) return truncate(oneLine(description), 80);
    const command = field('command') || field('cmd');
    const executable = command.match(/^(?:\/[\w./-]*\/)?([\w.-]+)(?:\s|$)/)?.[1];
    return executable ? `Running ${truncate(executable, 80)}` : 'Running a command';
  }
  const pattern = truncate(oneLine(field('pattern')), 80);
  if (tool === 'glob') return `Listing ${pattern || 'files'}`;
  if (tool === 'grep') return pattern ? `Searching for ${pattern}` : 'Searching files';
  const label = name.split('__').pop()?.replace(/[_-]+/g, ' ').trim();
  return label ? `Using ${truncate(oneLine(label), 80)}` : 'Working…';
}
