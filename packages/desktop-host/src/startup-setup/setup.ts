/**
 * What a launch does before its first runner when an installer or an update
 * left work behind: the steps, how far they are, and what a person should know
 * afterwards. The window shows this instead of a spinner; nothing here asks
 * anything. A launch with nothing to set up runs the same code unseen.
 *
 * Electron-free: who hears about a change is the caller's.
 */

import type { AppSetupState, AppSetupStep, AppSetupStepId } from '@moxxy/desktop-ipc-contract';

export interface StartupSetupDeps {
  readonly onChange?: (state: AppSetupState) => void;
  readonly log?: (message: string) => void;
}

export class StartupSetup {
  private state: AppSetupState = { reason: null, phase: 'pending', steps: [], notes: [] };

  constructor(private readonly deps: StartupSetupDeps = {}) {}

  snapshot(): AppSetupState {
    return this.state;
  }

  /** Names the steps this launch will go through; none means nothing to show. */
  begin(reason: AppSetupState['reason'], steps: ReadonlyArray<AppSetupStepId>): void {
    this.state = { reason, phase: 'pending', steps: steps.map((id) => ({ id, status: 'pending' })), notes: [] };
  }

  /** Runs one step. A failure is recorded on the step, not thrown: the launch
   *  goes on with what it has, and `undefined` comes back. */
  async step<T>(id: AppSetupStepId, work: () => Promise<T>): Promise<T | undefined> {
    const started = Date.now();
    this.mark(id, { id, status: 'running' });
    try {
      const result = await work();
      this.mark(id, { id, status: 'done' });
      this.deps.log?.(`setup ${id}: done in ${Date.now() - started} ms`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.mark(id, { id, status: 'failed', error: message });
      this.deps.log?.(`setup ${id}: failed after ${Date.now() - started} ms: ${message}`);
      return undefined;
    }
  }

  note(text: string): void {
    this.state = { ...this.state, notes: [...this.state.notes, text] };
  }

  /** The runner may start. Steps that were never reached had nothing to do. */
  finish(): void {
    const close = (step: AppSetupStep): AppSetupStep =>
      step.status === 'pending' || step.status === 'running' ? { id: step.id, status: 'done' } : step;
    this.state = { ...this.state, phase: 'done', steps: this.state.steps.map(close) };
    this.deps.onChange?.(this.state);
  }

  private mark(id: AppSetupStepId, next: AppSetupStep): void {
    if (!this.state.steps.some((step) => step.id === id)) return;
    this.state = { ...this.state, phase: 'running', steps: this.state.steps.map((step) => (step.id === id ? next : step)) };
    this.deps.onChange?.(this.state);
  }
}
