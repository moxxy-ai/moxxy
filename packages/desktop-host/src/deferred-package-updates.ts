/**
 * Bundled package updates (the OpenAI connections, Computer Use) that may need
 * the user's approval, kept off the runner's startup path. A question asked
 * before the first runner starts held every runner until someone answered it,
 * and an unparented dialog could sit hidden behind the window — the app then
 * stayed on "Waiting for workspace information…". So: before the runner, only
 * what needs nobody's answer; once the window is up, the questions; an
 * approved update installs and the runners restart onto it.
 *
 * Electron-free: the dialog and the runner restart are the caller's.
 */

export type UpdateOutcome = 'current' | 'declined' | 'updated';

export interface ManagedPackageUpdate<Offer> {
  readonly plugin: string;
  /** Runs the package's updater; `confirm` is asked only when the update needs approval. */
  readonly run: (confirm: (offer: Offer) => Promise<boolean>) => Promise<UpdateOutcome>;
  /** Asks the user whether to install `offer`. */
  readonly ask: (offer: Offer) => Promise<boolean>;
}

export interface DeferredPackageUpdatesDeps {
  /** Restart the running runners so they load the updated packages. */
  readonly restartRunners: () => Promise<void>;
  /** Tell the user an update failed; the previous version stays. */
  readonly warn: (plugin: string, error: unknown) => Promise<void>;
  readonly log?: (message: string) => void;
}

interface PendingUpdate {
  readonly plugin: string;
  readonly ask: () => Promise<boolean>;
  readonly install: () => Promise<UpdateOutcome>;
}

export class DeferredPackageUpdates {
  private pending: PendingUpdate[] = [];
  private failures: Array<{ readonly plugin: string; readonly error: unknown }> = [];

  constructor(private readonly deps: DeferredPackageUpdatesDeps) {}

  /** Before the first runner: installs what needs no approval and keeps the
   *  questions for {@link offer}. Never waits on a person. */
  async prepare<Offer>(updates: ReadonlyArray<ManagedPackageUpdate<Offer>>): Promise<void> {
    for (const update of updates) {
      const offers: Offer[] = [];
      try {
        const outcome = await update.run(async (offer) => {
          offers.push(offer);
          return false;
        });
        this.deps.log?.(`${update.plugin} preparation: ${offers.length > 0 ? 'waiting for approval' : outcome}`);
      } catch (error) {
        this.failures.push({ plugin: update.plugin, error });
        continue;
      }
      const [offer] = offers;
      if (offer !== undefined) {
        this.pending.push({
          plugin: update.plugin,
          ask: () => update.ask(offer),
          install: () => update.run(async () => true),
        });
      }
    }
  }

  /** Once the window is up: reports failures, asks about each waiting update,
   *  installs the approved ones and restarts the runners once if any did. */
  async offer(): Promise<void> {
    for (const { plugin, error } of this.failures.splice(0)) await this.deps.warn(plugin, error);
    let installed = false;
    for (const update of this.pending.splice(0)) {
      if (!(await update.ask())) {
        this.deps.log?.(`${update.plugin} update postponed`);
        continue;
      }
      try {
        installed = (await update.install()) === 'updated' || installed;
      } catch (error) {
        await this.deps.warn(update.plugin, error);
      }
    }
    if (installed) await this.deps.restartRunners();
  }
}
