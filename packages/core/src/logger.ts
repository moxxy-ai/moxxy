export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const levelRank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  minLevel?: LogLevel;
  sink?: (line: string) => void;
  bindings?: Record<string, unknown>;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const minLevel = opts.minLevel ?? 'info';
  const sink = opts.sink ?? ((line) => process.stderr.write(line + '\n'));
  const bindings = opts.bindings ?? {};

  const emit = (level: LogLevel, msg: string, meta?: Record<string, unknown>): void => {
    if (levelRank[level] < levelRank[minLevel]) return;
    const payload = { ts: new Date().toISOString(), level, msg, ...bindings, ...(meta ?? {}) };
    sink(JSON.stringify(payload));
  };

  return {
    debug: (msg, meta) => emit('debug', msg, meta),
    info: (msg, meta) => emit('info', msg, meta),
    warn: (msg, meta) => emit('warn', msg, meta),
    error: (msg, meta) => emit('error', msg, meta),
    child: (extra) =>
      createLogger({ minLevel, sink, bindings: { ...bindings, ...extra } }),
  };
}

export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};
