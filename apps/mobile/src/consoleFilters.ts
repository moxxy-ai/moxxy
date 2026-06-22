const POINTER_EVENTS_WARNING = 'props.pointerEvents is deprecated. Use style.pointerEvents';
const VIRTUALIZED_LIST_PERF_HEURISTIC =
  'VirtualizedList: You have a large list that is slow to update';

export function shouldIgnoreConsoleMessage(message: unknown): boolean {
  return typeof message === 'string'
    && (message.includes(POINTER_EVENTS_WARNING) || message.includes(VIRTUALIZED_LIST_PERF_HEURISTIC));
}

export function installConsoleFilters(): void {
  const originalWarn = console.warn.bind(console);
  const originalLog = console.log.bind(console);
  console.warn = (...args: unknown[]) => {
    if (shouldIgnoreConsoleMessage(args[0])) return;
    originalWarn(...args);
  };
  console.log = (...args: unknown[]) => {
    if (shouldIgnoreConsoleMessage(args[0])) return;
    originalLog(...args);
  };
}
