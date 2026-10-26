import { describe, it, expect } from 'vitest';
import { focusSearch, isSearchShortcut } from '../utils/searchShortcut.js';

const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe('search shortcut', () => {
  it('is Ctrl+K or ⌘K, nothing else', () => {
    expect(isSearchShortcut(key('k', { ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key('K', { metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key('k'))).toBe(false);
    expect(isSearchShortcut(key('k', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key('j', { ctrlKey: true }))).toBe(false);
  });

  it('focuses and selects the marked field, if any', () => {
    document.body.innerHTML = '<input id="other"><input id="search" data-search-shortcut value="abc">';
    expect(focusSearch()).toBe(true);
    const input = document.getElementById('search');
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);

    document.body.innerHTML = '<input>';
    expect(focusSearch()).toBe(false);
  });
});
