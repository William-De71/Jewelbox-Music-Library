// Ctrl+K (⌘K on a Mac) focuses the search field at the top of the page: the
// field marked with this attribute. A page without one opens the home page,
// whose search is then focused.
export const SEARCH_ATTR = 'data-search-shortcut';

export const isSearchShortcut = (e) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key?.toLowerCase() === 'k';

export function focusSearch(root = document) {
  const input = root.querySelector(`[${SEARCH_ATTR}]`);
  if (!input) return false;
  input.focus();
  input.select?.();
  return true;
}

export const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? '');
