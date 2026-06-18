import type { FileDiffDisplay, DiffLine } from '@moxxy/sdk';
import { toDiffRows, diffGutterNo, fileDiffVerb } from '@moxxy/sdk/tool-display';

/**
 * Renders a {@link FileDiffDisplay} as a classic diff: a line-number gutter,
 * +/- markers, green background for added lines, red for removed, dim context,
 * and a `⋯` separator between non-contiguous hunks.
 *
 * Row-flattening, the gutter number, and the header verb come from
 * `@moxxy/sdk/tool-display` (the dependency-free subpath — only type-erased
 * imports plus those tiny pure helpers reach the browser bundle). The `+X −Y`
 * count summary stays local: the shared `fileDiffSummary` renders human prose
 * ("Added N lines, removed M line"), not this compact glyph form.
 */

/** "+10 −1" style summary of the change counts. */
function plusMinus(display: FileDiffDisplay): string {
  return `+${display.added} −${display.removed}`;
}

/** Gutter number for a line — new number, or old for deletions. */
function gutter(line: DiffLine): string {
  const n = diffGutterNo(line);
  return n === undefined ? '' : String(n);
}

const MARKER: Record<DiffLine['kind'], string> = { context: ' ', add: '+', del: '-' };
const ROW_CLASS: Record<DiffLine['kind'], string> = {
  context: 'v-diff-ctx',
  add: 'v-diff-add',
  del: 'v-diff-del',
};

export function FileDiffView(props: { display: FileDiffDisplay }): JSX.Element {
  const { display } = props;
  const verb = fileDiffVerb(display);
  const rows = toDiffRows(display);
  return (
    <div className="v-diff">
      <div className="v-diff-head">
        <span className="v-diff-path">
          {verb} · {display.path}
        </span>
        <span className="v-diff-sum">{plusMinus(display)}</span>
      </div>
      <div className="v-diff-body">
        {rows.map((row, i) =>
          row.kind === 'gap' ? (
            <div key={i} className="v-diff-row v-diff-gap">
              <span className="v-diff-no" />
              <span className="v-diff-mark">⋯</span>
              <span className="v-diff-text" />
            </div>
          ) : (
            <div key={i} className={`v-diff-row ${ROW_CLASS[row.kind]}`}>
              <span className="v-diff-no">{gutter(row)}</span>
              <span className="v-diff-mark">{MARKER[row.kind]}</span>
              <span className="v-diff-text">{row.text}</span>
            </div>
          ),
        )}
      </div>
      {display.truncated && <div className="v-diff-trunc">diff truncated</div>}
    </div>
  );
}
