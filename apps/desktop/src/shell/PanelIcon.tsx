/**
 * A window with one side panel marked off: the glyph for showing and hiding
 * the sidebar (`left`) and the work panel (`right`). The shared
 * `@moxxy/desktop-ui` Icon set has no panel glyph, so this is a local inline
 * SVG in the same conventions (currentColor stroke, 24px viewBox,
 * strokeWidth 1.75, aria-hidden).
 */
export function PanelIcon({
  side = 'left',
  size = 18,
}: {
  readonly side?: 'left' | 'right';
  readonly size?: number;
}): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d={side === 'left' ? 'M9.5 4v16' : 'M14.5 4v16'} />
    </svg>
  );
}
