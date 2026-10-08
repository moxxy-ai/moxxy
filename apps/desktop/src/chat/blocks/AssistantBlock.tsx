import { MarkdownBody } from '../MarkdownBody';

/** How an answer ends when nothing cut it short: it finished, or it paused to use a tool. */
const COMPLETE: ReadonlySet<string> = new Set(['', 'end_turn', 'tool_use']);

/** What the agent said, as its bubble. The time and the actions that go with
 *  an answer belong to the entry around it. */
export function AssistantBlock({
  text,
  streaming,
  stopReason,
}: {
  readonly text: string;
  readonly streaming: boolean;
  readonly stopReason?: string;
}): JSX.Element {
  const cutShort = stopReason !== undefined && !COMPLETE.has(stopReason);
  return (
    <div className="bubble bubble--agent" data-testid="block-assistant" data-streaming={streaming}>
      <MarkdownBody text={text} streaming={streaming} />
      {cutShort && <p className="bubble__note">Stopped: {stopReason.replace(/_/g, ' ')}</p>}
    </div>
  );
}
