/**
 * Per-workspace collapse store:
 *   1. Toggling folds/unfolds a desk id.
 *   2. State persists to localStorage and survives a "restart" (re-read).
 *   3. An all-expanded state stores nothing (key removed).
 *   4. Corrupt storage degrades to all-expanded.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  reloadWorkspaceCollapsedFromStorage,
  toggleWorkspaceCollapsed,
} from './useWorkspaceCollapsed';

const KEY = 'moxxy.workspacesCollapsed';

/** The module store is a singleton — read it back via a fresh reload. */
function storedIds(): string[] {
  const raw = window.localStorage.getItem(KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

beforeEach(() => {
  window.localStorage.clear();
  reloadWorkspaceCollapsedFromStorage();
});

describe('useWorkspaceCollapsed store', () => {
  it('toggle collapses, second toggle expands', () => {
    toggleWorkspaceCollapsed('a');
    expect(storedIds()).toEqual(['a']);
    toggleWorkspaceCollapsed('a');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('tracks several desks independently and survives a restart', () => {
    toggleWorkspaceCollapsed('a');
    toggleWorkspaceCollapsed('b');
    expect(new Set(storedIds())).toEqual(new Set(['a', 'b']));
    // "Restart": the module re-reads storage.
    reloadWorkspaceCollapsedFromStorage();
    toggleWorkspaceCollapsed('a'); // expand a again
    expect(storedIds()).toEqual(['b']);
  });

  it('degrades to all-expanded on corrupt storage', () => {
    window.localStorage.setItem(KEY, 'not json{{');
    reloadWorkspaceCollapsedFromStorage();
    toggleWorkspaceCollapsed('x');
    expect(storedIds()).toEqual(['x']);
  });
});
