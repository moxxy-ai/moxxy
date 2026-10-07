import { MarkdownBody } from '../MarkdownBody';

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
  const cutShort = stopReason !== undefined && stopReason !== '' && stopReason !== 'end_turn';
  return (
    <div className="bubble bubble--agent" data-testid="block-assistant" data-streaming={streaming}>
      <MarkdownBody text={text} streaming={streaming} />
      {cutShort && <p className="bubble__note">Stopped: {stopReason.replace(/_/g, ' ')}</p>}
    </div>
  );
}
