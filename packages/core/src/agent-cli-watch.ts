import type { AgentCliReport, ProviderDef } from '@moxxy/sdk';
import type { Logger } from './logger.js';

const HOUR_MS = 60 * 60_000;

/**
 * Where each agent connection's CLI stands — missing, too old, behind the
 * vendor's latest — kept as one state per session and reported in its info,
 * so the desktop, the TUI and any attached client read the same answer.
 *
 * A long-lived host (the TUI, `moxxy serve`) calls `start()`: a check now and
 * one every hour. Checking only reads versions; updating is the person's
 * action and never happens here.
 */
export class AgentCliWatch {
  private readonly reports = new Map<string, AgentCliReport>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly providers: () => ReadonlyArray<ProviderDef>,
    private readonly logger: Logger,
  ) {}

  report(name: string): AgentCliReport | undefined {
    return this.reports.get(name);
  }

  /** Called when a CLI's state or version changed; returns the unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Check every connection's CLI; `refresh` asks the vendors' registry again. Overlapping plain checks share one run. */
  check(opts: { readonly refresh?: boolean } = {}): Promise<void> {
    if (this.running && !opts.refresh) return this.running;
    const run = this.checkAll(opts.refresh === true).finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  start(intervalMs = HOUR_MS): void {
    if (this.timer) return;
    void this.check();
    this.timer = setInterval(() => void this.check(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async checkAll(refresh: boolean): Promise<void> {
    let changed = false;
    await Promise.all(
      this.providers().map(async (def) => {
        if (!def.agentCli) return;
        try {
          const next = await def.agentCli.check({ refresh });
          const before = this.reports.get(def.name);
          this.reports.set(def.name, next);
          if (!before || differs(before, next)) changed = true;
        } catch (err) {
          this.logger.warn('could not check an agent CLI', {
            provider: def.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
    if (!changed) return;
    for (const listener of this.listeners) listener();
  }
}

/** What a person would see change; `checkedAt` alone is not a change. */
function differs(a: AgentCliReport, b: AgentCliReport): boolean {
  return (
    a.state !== b.state ||
    a.installed !== b.installed ||
    a.latest !== b.latest ||
    a.signedIn !== b.signedIn ||
    a.account !== b.account
  );
}
