export function resolveAutocompleteSelection(inputValue, matches, selectedIndex) {
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const selected = matches[selectedIndex];
  if (!selected?.name) return null;

  const current = String(inputValue || '').trim();
  if (!current.startsWith('/')) return null;
  if (current === selected.name) return null;

  return selected.name;
}
