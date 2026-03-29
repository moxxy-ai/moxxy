export function resolveAutocompleteSelection(inputValue, matches, selectedIndex) {
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const selected = matches[selectedIndex];
  if (!selected?.name) return null;

  const current = String(inputValue || '').trim();
  if (!current.startsWith('/')) return null;
  if (current === selected.name) return null;

  return selected.name;
}

export function clampAutocompleteScroll(selectedIndex, scrollOffset, visibleRows, totalCount) {
  if (!visibleRows || visibleRows <= 0) return 0;

  const total = Math.max(0, Number(totalCount) || 0);
  const viewport = Math.max(1, Number(visibleRows) || 1);
  const maxScroll = Math.max(0, total - viewport);
  const selected = Math.max(0, Math.min(Math.max(0, Number(selectedIndex) || 0), Math.max(0, total - 1)));
  const scroll = Math.max(0, Math.min(Math.max(0, Number(scrollOffset) || 0), maxScroll));
  const end = scroll + viewport - 1;

  if (selected < scroll) return selected;
  if (selected > end) return Math.min(selected - viewport + 1, maxScroll);
  return scroll;
}
