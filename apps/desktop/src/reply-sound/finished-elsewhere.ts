/**
 * The chats that were answering and have stopped, other than the one on
 * screen. A chat that is gone from the list did not finish: it was removed.
 */
export function finishedElsewhere({
  before,
  after,
  known,
  onScreen,
}: {
  /** The chats that were answering. */
  readonly before: ReadonlySet<string>;
  /** The chats that are answering now. */
  readonly after: ReadonlySet<string>;
  /** Every chat in the list now. */
  readonly known: ReadonlySet<string>;
  readonly onScreen: string | null;
}): string[] {
  return [...before].filter((id) => id !== onScreen && !after.has(id) && known.has(id));
}
