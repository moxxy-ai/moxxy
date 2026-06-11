/**
 * Tiny external store bridging the Phaser scene and the React overlay: which
 * worker is selected (chat panel target), the roster as the HUD shows it, and
 * the connection banner. Subscribable outside React; React reads it via
 * useSyncExternalStore. Updated on transitions only — never per frame or per
 * streaming chunk.
 */

export type WorkerStatus = 'idle' | 'thinking' | 'awaiting-approval';

export interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly status: WorkerStatus;
  readonly isPrimary: boolean;
}

export interface OfficeUiState {
  readonly selectedId: string | null;
  readonly roster: ReadonlyArray<RosterEntry>;
  readonly connection: 'connecting' | 'open' | 'reconnecting' | 'disconnected' | 'demo';
}

type Listener = () => void;

class OfficeUiStore {
  private state: OfficeUiState = { selectedId: null, roster: [], connection: 'connecting' };
  private readonly listeners = new Set<Listener>();

  get(): OfficeUiState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  select(id: string | null): void {
    if (this.state.selectedId === id) return;
    this.patch({ selectedId: id });
  }

  setRoster(roster: ReadonlyArray<RosterEntry>): void {
    this.patch({ roster });
    // Selection of a removed worker falls back to nothing.
    if (this.state.selectedId && !roster.some((r) => r.id === this.state.selectedId)) {
      this.patch({ selectedId: null });
    }
  }

  setConnection(connection: OfficeUiState['connection']): void {
    if (this.state.connection === connection) return;
    this.patch({ connection });
  }

  private patch(partial: Partial<OfficeUiState>): void {
    this.state = { ...this.state, ...partial };
    for (const fn of [...this.listeners]) fn();
  }
}

export const officeUiStore = new OfficeUiStore();
