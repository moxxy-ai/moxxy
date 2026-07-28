/**
 * What a tool looks like, as a semantic name rather than a glyph.
 *
 * A CLOSED vocabulary on purpose. Surfaces render wildly differently: the
 * desktop draws SVG, the TUI prints a character, a future web surface might do
 * something else again. If this were a free string, a plugin could name an icon
 * no surface owns and every surface would have to guess, so in practice
 * everything would fall back and the field would be decorative. A fixed set
 * means each surface maps it exhaustively and a plugin's choice actually
 * survives to the screen.
 *
 * The names describe WHAT THE TOOL TOUCHES, not what it looks like, so a
 * surface is free to change its artwork without every plugin becoming wrong.
 *
 * Adding a member is a breaking change for surfaces (their maps stop being
 * exhaustive and stop compiling), which is the intended cost: a new icon should
 * be a deliberate decision across surfaces, not a silent fallback to a wrench.
 */
export const TOOL_ICONS = [
  'file',
  'folder',
  'search',
  'edit',
  'diff',
  'terminal',
  'globe',
  'chat',
  'workflow',
  'agent',
  'settings',
  'lock',
  'plug',
  'mic',
  'speaker',
  'smartphone',
  'workspace',
  'clipboard',
  'spark',
  'wrench',
] as const;

export type ToolIcon = (typeof TOOL_ICONS)[number];

export function isToolIcon(value: unknown): value is ToolIcon {
  return typeof value === 'string' && (TOOL_ICONS as ReadonlyArray<string>).includes(value);
}
