const POINTER_EVENTS_WARNING = 'props.pointerEvents is deprecated. Use style.pointerEvents';

export function shouldIgnoreConsoleMessage(message: unknown): boolean {
  return typeof message === 'string' && message.includes(POINTER_EVENTS_WARNING);
}

export function installConsoleFilters(): void {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    if (shouldIgnoreConsoleMessage(args[0])) return;
    originalWarn(...args);
  };
}
