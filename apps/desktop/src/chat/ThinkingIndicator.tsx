/**
 * Shown between a send and the agent's first chunk: the agent's bubble with
 * three dots in it, so the wait reads as the agent working and not as the app
 * being stuck.
 */
export function ThinkingIndicator(): JSX.Element {
  return (
    <div className="bubble bubble--agent thinking" role="status" aria-label="Moxxy is thinking">
      <span className="thinking-dot" />
      <span className="thinking-dot" />
      <span className="thinking-dot" />
    </div>
  );
}
