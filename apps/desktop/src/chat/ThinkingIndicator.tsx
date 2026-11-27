import { WorkingMark } from './WorkingMark';

/** The first wait, before the turn has an action of its own to show. */
export function ThinkingIndicator(): JSX.Element {
  return (
    <div className="bubble bubble--agent thinking" role="status" aria-label="Moxxy is thinking">
      <WorkingMark />
      <span>Thinking…</span>
    </div>
  );
}
