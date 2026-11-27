import { oneLine, truncate } from '@moxxy/chat-model';

const browserActions: Readonly<Record<string, string>> = {
  browser_snapshot: 'Reading the page',
  browser_find: 'Finding an element',
  browser_click: 'Clicking an element',
  browser_navigate: 'Opening a page',
};

function textField(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return '';
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

type VerbPair = readonly [inProgress: string, completed: string];

const browserSteps = new Map<string, VerbPair>([
  ['browser_history:back', ['Going back to the previous page', 'Returned to the previous page']],
  ['browser_history:forward', ['Going forward to the next page', 'Moved to the next page']],
  ['browser_history:reload', ['Reloading the page', 'Reloaded the page']],
  ['browser_tabs:list', ['Checking open tabs', 'Reviewed open tabs']],
  ['browser_tabs:select', ['Switching tabs', 'Switched tabs']],
  ['browser_tabs:close', ['Closing the tab', 'Closed the tab']],
  ['browser_session:text', ['Reading the page', 'Read the page']],
  ['browser_session:html', ['Inspecting the page', 'Inspected the page']],
  ['browser_session:screenshot', ['Capturing the page', 'Captured the page']],
  ['browser_session:url', ['Checking the page address', 'Checked the page address']],
  ['browser_session:eval', ['Running a page action', 'Ran a page action']],
  ['browser_session:click', ['Clicking a page element', 'Clicked a page element']],
  ['browser_session:fill', ['Filling in a field', 'Filled in a field']],
]);

const targetVerbs = new Map<string, VerbPair>([
  ['read', ['Reading', 'Read']],
  ['write', ['Writing', 'Wrote']],
  ['edit', ['Editing', 'Edited']],
  ['computer_get_app_state', ['Checking', 'Checked']],
  ['computer_click', ['Clicking in', 'Clicked in']],
  ['computer_type_text', ['Typing in', 'Typed in']],
  ['computer_scroll', ['Scrolling in', 'Scrolled in']],
]);

/** Short, identified targets only. Field values, script bodies and URL parameters stay out of the header. */
export function contextualToolCaption(name: string, input: unknown, done: boolean): string | undefined {
  const tool = name.split('__').at(-1)?.toLowerCase() ?? '';
  const tense = done ? 1 : 0;
  const verbs = targetVerbs.get(tool);
  if (verbs) {
    const computer = tool.startsWith('computer_');
    const target = computer
      ? textField(input, 'app')
      : textField(input, 'file_path') || textField(input, 'filePath') || textField(input, 'path');
    const basename = target.split(/[\\/]/).pop() || (computer ? 'the app' : 'a file');
    return `${verbs[tense]} ${truncate(oneLine(basename), 80)}`;
  }
  if (!tool.startsWith('browser_')) return undefined;
  const action = textField(input, 'action');
  const session = tool === 'browser_session' && input && typeof input === 'object' && 'action' in input ? input.action : undefined;
  const kind = textField(session, 'kind');
  const step = browserSteps.get(`${tool}:${kind || action}`);
  if (step) return step[tense];
  if (tool === 'browser_navigate' || (tool === 'browser_tabs' && action === 'new') || kind === 'goto') {
    try {
      const url = new URL(textField(kind === 'goto' ? session : input, 'url'));
      if (url.hostname && (url.protocol === 'https:' || url.protocol === 'http:')) {
        return `${done ? 'Opened' : 'Opening'} ${truncate(url.hostname, 64)}`;
      }
    } catch {
      // A missing or partial address still gets the ordinary page caption.
    }
  }
  const target = truncate(oneLine(textField(input, 'element')), 64);
  if (tool === 'browser_click' && target) return `${done ? 'Clicked' : 'Clicking'} ${target}`;
  if (tool === 'browser_find') {
    const query = truncate(oneLine(textField(input, 'query')), 64);
    if (query) return `${done ? 'Looked for' : 'Looking for'} “${query}”`;
  }
  return undefined;
}

/** A compact caption for work in progress. The disclosure holds the full input. */
export function currentToolActivity(name: string, input: unknown): string {
  const field = (key: string) => textField(input, key);
  const title = field('title');
  if (title) return truncate(oneLine(title), 80);

  const tool = name.split('__').at(-1)?.toLowerCase() ?? '';
  const caption = contextualToolCaption(name, input, false);
  if (caption) return caption;
  if (tool.startsWith('browser_')) return browserActions[tool] ?? 'Working in the browser';
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
