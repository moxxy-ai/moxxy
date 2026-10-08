function cellText(cell: Element): string {
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * What a block of a message is as plain text: a table as rows of tab-separated
 * cells (what a sheet pastes), anything else as its words.
 */
export function blockText(block: HTMLElement): string {
  const table = block.matches('table') ? block : block.querySelector('table');
  if (table !== null) {
    return Array.from(table.querySelectorAll('tr'))
      .map((row) => Array.from(row.querySelectorAll('th, td')).map(cellText).join('\t'))
      .join('\n');
  }
  // Rendered text keeps the line breaks between a quotation's paragraphs; it
  // is missing only where nothing is laid out.
  const text = typeof block.innerText === 'string' ? block.innerText : (block.textContent ?? '');
  return text.trim();
}
