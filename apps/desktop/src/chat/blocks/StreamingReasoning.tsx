import { MarkdownBody } from '../MarkdownBody';

/** The model's thinking while it is still arriving. Drawn as quiet text under
 *  a moving label, so it reads as working-out and not as the answer; the
 *  answer's bubble takes its place as soon as the answer starts. */
export function StreamingReasoning({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="reasoning" data-testid="block-streaming-reasoning">
      <span className="reasoning__label activity-shimmer">Thinking…</span>
      <div className="reasoning__body">
        <MarkdownBody text={text} streaming />
      </div>
    </div>
  );
}
