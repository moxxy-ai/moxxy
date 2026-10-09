/** One line of plain text: whitespace collapsed, Markdown marks dropped. Used
 *  wherever a message is quoted in passing (a run row, the focus pet's bubble). */
export function plainLine(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*`]|^\s*(#{1,6}|>|[-+])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
