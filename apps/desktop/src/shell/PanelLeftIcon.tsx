/**
 * Lucide-style "panel-left" glyph for the sidebar collapse/expand
 * buttons. The shared `@moxxy/desktop-ui` Icon set has no panel/sidebar
 * glyph and nothing else there reads as "toggle the left rail", so this
 * lives as a local inline SVG following the same conventions
 * (currentColor stroke, 24px viewBox, strokeWidth 1.75, aria-hidden).
 */
export function PanelLeftIcon({ size = 18 }: { readonly size?: number }): JSX.Element {
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
      <path d="M9.5 4v16" />
    </svg>
  );
}
