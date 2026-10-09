import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { __setApiOverride } from '@moxxy/client-core';
import type { MoxxyApi } from '@moxxy/desktop-ipc-contract';
import { AutomationsIndex } from '../automations/AutomationsIndex';
import { ChannelsIndex } from '../channels/ChannelsSurface';
import { SettingsIndex, useSettingsTab } from '../settings/SettingsPanel';
import { reloadSidebarCollapsedFromStorage } from '@/lib/useSidebarCollapsed';

/**
 * Every destination gets an index column, and each one answers the same question
 * in the same shape: "what is in here". These pin the contract that made the
 * split-nav fix worth doing — one navigation organ (the rail), one contextual
 * list beside it, and no destination that navigates from somewhere else.
 */

beforeEach(() => {
  window.localStorage.clear();
  reloadSidebarCollapsedFromStorage();
  // Shape-correct payloads: a bare `{}` leaves each hook's `list` undefined once
  // its fetch settles, so the first render passes and every later one throws.
  __setApiOverride({
    invoke: vi.fn(async (channel: string) =>
      channel.endsWith('.list') ? [] : ({} as unknown),
    ),
    subscribe: () => () => undefined,
  } as unknown as MoxxyApi);
});
afterEach(() => __setApiOverride(null));

describe('AutomationsIndex', () => {
  it('lists the three kinds as collapsible groups', () => {
    render(<AutomationsIndex kind="workflows" onPick={vi.fn()} />);
    for (const id of ['workflows', 'schedules', 'webhooks']) {
      const group = screen.getByTestId(`automations-group-${id}`);
      expect(group).toBeTruthy();
      // Open by default: a fresh column that hides everything behind three
      // chevrons answers no question at all.
      expect(group).toHaveAttribute('aria-expanded', 'true');
    }
  });

  it('folds a group and picks its kind', () => {
    const onPick = vi.fn();
    render(<AutomationsIndex kind="workflows" onPick={onPick} />);
    const group = screen.getByTestId('automations-group-webhooks');
    fireEvent.click(group);
    expect(onPick).toHaveBeenCalledWith('webhooks');
    expect(screen.getByTestId('automations-group-webhooks')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('says a group is empty rather than rendering nothing under it', () => {
    // An open group with no rows and no message reads as a rendering failure.
    render(<AutomationsIndex kind="workflows" onPick={vi.fn()} />);
    expect(screen.getAllByText('None yet').length).toBeGreaterThan(0);
  });
});

describe('ChannelsIndex', () => {
  it('renders the catalog as one collapsible group, open by default', () => {
    render(<ChannelsIndex selected={null} onSelect={vi.fn()} />);
    const group = screen.getByTestId('channels-group');
    expect(group).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(group);
    expect(screen.getByTestId('channels-group')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says the catalog is empty rather than rendering nothing', async () => {
    // Only AFTER the fetch settles: while it is in flight the column is loading,
    // not empty, and claiming "none available" then would be a lie with a race.
    render(<ChannelsIndex selected={null} onSelect={vi.fn()} />);
    expect(await screen.findByText('None available')).toBeTruthy();
  });
});

describe('SettingsIndex', () => {
  const captions = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll('.index-group__label')).map((el) => el.textContent ?? '');

  const rows = (container: HTMLElement): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>('.index-row'));

  it('groups the sections by what they are about', () => {
    const { container } = render(<SettingsIndex tab="providers" onPick={vi.fn()} />);
    expect(captions(container)).toEqual(['Agent', 'Voice', 'Computer use', 'Trust', 'App', 'Extend']);
    // A flat row gave "Vault" and "Skills" the same standing, when one is a
    // secret store and the other a capability.
    expect(screen.getByTestId('settings-tab-vault')).toBeTruthy();
    expect(screen.getByTestId('settings-tab-skills')).toBeTruthy();
    expect(screen.getByTestId('settings-tab-voice')).toBeTruthy();
  });

  it('keeps the model connection in Settings, and only what extends Moxxy in Extensions', () => {
    // Connecting a model is the first thing a person sets up; under
    // "Extensions" it was looked for in Settings and not found.
    const { container, rerender } = render(<SettingsIndex tab="mcp" onPick={vi.fn()} scope="extensions" />);
    expect(captions(container)).toEqual(['Extend']);
    expect(rows(container).map((row) => row.dataset.testid)).toEqual(['settings-tab-mcp', 'settings-tab-skills']);
    expect(screen.queryByTestId('settings-tab-providers')).toBeNull();

    rerender(<SettingsIndex tab="providers" onPick={vi.fn()} scope="settings" />);
    expect(screen.getByTestId('settings-tab-providers')).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByTestId('settings-tab-skills')).toBeNull();
  });

  it('opens Settings on the providers, and Extensions on the MCP servers', () => {
    expect(renderHook(() => useSettingsTab('settings')).result.current[0]).toBe('providers');
    expect(renderHook(() => useSettingsTab('extensions')).result.current[0]).toBe('mcp');
  });

  it('draws no caption over a list where every group is a single row', () => {
    // "Voice" over "Voice", "Trust" over "Vault": a caption per row sorts
    // nothing, and reads as a second row that cannot be pressed.
    const { container } = render(<SettingsIndex tab="voice" onPick={vi.fn()} scope="settings" />);
    expect(captions(container)).toEqual([]);
    expect(rows(container).map((row) => row.dataset.testid)).toEqual([
      'settings-tab-providers',
      'settings-tab-voice',
      'settings-tab-jev',
      'settings-tab-vault',
      'settings-tab-preferences',
    ]);
    // A row says its own name and nothing else: one row with a note beside
    // three without reads as a mistake.
    for (const row of rows(container)) {
      expect(row.querySelector('.index-row__note'), row.dataset.testid).toBeNull();
    }
    expect(screen.getByTestId('settings-tab-jev').textContent).toBe('Jev');
  });

  it('gives every section an icon, so a row never looks like a caption', () => {
    const { container } = render(<SettingsIndex tab="providers" onPick={vi.fn()} />);
    expect(rows(container)).toHaveLength(7);
    for (const row of rows(container)) {
      expect(row.querySelector('svg.index-row__icon'), row.dataset.testid).not.toBeNull();
    }
  });

  it('picks a section on click', () => {
    const onPick = vi.fn();
    render(<SettingsIndex tab="providers" onPick={onPick} />);
    fireEvent.click(screen.getByTestId('settings-tab-vault'));
    expect(onPick).toHaveBeenCalledWith('vault');
  });
});
