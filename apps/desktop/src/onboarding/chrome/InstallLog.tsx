/**
 * The raw output of an install, folded away under "Show details": most people
 * never need it, and the one helping them later can open it.
 */

export function InstallLog({ lines }: { readonly lines: ReadonlyArray<string> }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <details className="onboard-log">
      <summary>Show details</summary>
      <pre className="mono onboard-log__body">{lines.slice(-40).join('\n')}</pre>
    </details>
  );
}
