/**
 * Who drives the Browser pane: the agent, or the person watching it.
 *
 * The person takes over with the pane's button, or simply by pressing on the
 * page or typing into it while the agent is not. From then on every action the
 * agent attempts is refused with a message that says so, until the person
 * resumes — or sends a new message, which starts a new turn and is itself the
 * go-ahead. Reading the page stays allowed; acting on it does not.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export type Driver = 'agent' | 'user';

export interface ControlState {
  readonly driver: Driver;
  /** The turn that last used the browser; the pane shows its controls while that turn runs. */
  readonly turnId: string | null;
}

export class BrowserControl {
  private readonly commandSignal = new AsyncLocalStorage<AbortSignal>();
  private driver: Driver = 'agent';
  private turnId: string | null = null;
  /** Agent input in flight: what the page reports during it is the agent's own. */
  private acting = 0;

  constructor(private readonly onChange: () => void) {}

  /** Keep cancellation local when several bridge calls share this browser. */
  withSignal<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    return this.commandSignal.run(signal, run);
  }

  get state(): ControlState {
    return { driver: this.driver, turnId: this.turnId };
  }

  /** An agent call from `turnId`. A new turn hands the browser back to the agent. */
  noteAgentTurn(turnId: string): void {
    if (turnId === this.turnId) return;
    this.turnId = turnId;
    this.driver = 'agent';
    this.onChange();
  }

  takeOver(): void {
    this.set('user');
  }

  resume(): void {
    this.set('agent');
  }

  /** The person pressed on the page or typed into it. */
  noteUserInput(): void {
    if (this.acting === 0) this.takeOver();
  }

  /** Run the agent's own input, so the page's report of it is not taken for the person's. */
  async during<T>(run: () => Promise<T>): Promise<T> {
    this.commandSignal.getStore()?.throwIfAborted();
    const refusal = this.refusal();
    if (refusal) throw new Error(refusal);
    this.acting++;
    try {
      return await run();
    } finally {
      this.acting--;
    }
  }

  /** Why the agent may not act right now, or null when it may. */
  refusal(): string | null {
    if (this.driver === 'agent') return null;
    return (
      'The user has taken over the browser. Do not act on the page until they hand it back: ' +
      'tell them what you were about to do and wait — they resume from the Browser pane, or by sending a new message.'
    );
  }

  private set(driver: Driver): void {
    if (driver === this.driver) return;
    this.driver = driver;
    this.onChange();
  }
}
