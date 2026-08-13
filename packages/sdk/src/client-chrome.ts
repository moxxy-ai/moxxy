/** Stable, UI-neutral extension points in a client's persistent chrome. */
export type ClientChromeSlot = 'status.leading' | 'status.trailing';

export type ClientChromeTone = 'neutral' | 'positive' | 'attention';

/**
 * A small status item contributed by a plugin. Plugins provide data, never
 * renderer code: every client keeps ownership of layout, accessibility, and
 * terminal safety. Rich content belongs in the transcript through view-specs.
 */
export interface ClientChromeContribution {
  /** Unique within the contributing plugin. */
  readonly id: string;
  readonly slot: ClientChromeSlot;
  /** Short label; hosts sanitize and cap it before crossing a client boundary. */
  readonly label: string;
  readonly tone?: ClientChromeTone;
  /** Higher-priority items survive first when a narrow client has less room. */
  readonly priority?: number;
}

/** Wire-safe contribution with its owning plugin made explicit. */
export interface ClientChromeItem extends ClientChromeContribution {
  readonly source: string;
}
